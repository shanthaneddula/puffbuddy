# Puffbuddy AI Product Importer — Foundation Architecture

Status: first no-cost development implementation deployed. This is a URL-based research and human-review MVP, not yet the full AI/search/publish workflow. Production kiosk remains unchanged.

## 1. Goal and boundaries

Build a staff-only workflow that discovers product families and variants, extracts source-backed facts, finds real product photography, detects likely duplicates, and queues candidates for human review before catalog insertion.

The importer is not part of kiosk browsing. It must not publish automatically, overwrite existing catalog records, invent missing specifications, or treat an LLM answer as a source.

### In scope for the first release
- Start a batch from a brand/model query and/or staff-supplied URLs.
- Discover source pages through a replaceable search-provider interface.
- Fetch public product pages safely and politely.
- Extract structured product and variant candidates with field-level evidence.
- Collect actual image candidates with source URL, page URL, dimensions, content type, and rights/permission status.
- Detect likely text and image duplicates.
- Provide staff review, edit, approve, reject, and retry.
- Insert only approved products into the existing catalog; never update an existing product silently.
- Keep an audit trail from batch through approval and catalog insertion.

### Explicitly out of scope for this phase
- Automatic publishing or automatic duplicate merging.
- Scraping behind logins, CAPTCHAs, paywalls, or access controls.
- Bypassing robots directives, rate limits, or site protections.
- Customer-facing AI, recommendations, checkout, POS, inventory, or analytics.
- Multi-tenant billing and a full tenant migration. The current catalog is single-store-shaped; multi-store ownership needs a separate architecture decision before commercial multi-tenant launch.
- Paid search/model services until cost, privacy, and credentials are explicitly approved.

## 2. Proposed pipeline

1. **Create batch** — staff enters brand/model terms and optional known URLs. Persist the request and an idempotency key.
2. **Discover** — a SearchProvider returns candidate URLs, title, snippet, domain, and query provenance. Search is a replaceable adapter; never couple business logic to one vendor.
3. **Filter URLs** — normalize/canonicalize, deduplicate, enforce allowed schemes and network safety, respect robots and per-domain rate limits.
4. **Fetch and extract** — retrieve public HTML or structured product data; extract JSON-LD/Product schema first, then Open Graph/meta and page text. Retain only bounded, useful evidence, not whole-site archives.
5. **Normalize** — resolve brand, family/model, variant, category, attributes, and units. Preserve the original source wording and normalized value separately.
6. **AI extraction** — send bounded source text and metadata to a provider adapter; require strict JSON-schema output. The model may propose values but cannot create citations or claim facts unsupported by captured evidence.
7. **Image candidates** — find image URLs from product schema, Open Graph, and page image elements. Download only after URL safety checks; inspect file signatures, decode/re-encode, strip metadata, cap dimensions/bytes, compute SHA-256 and perceptual hash. Do not hotlink third-party images in the kiosk.
8. **Duplicate screening** — exact normalized brand/model/SKU/GTIN first, then fuzzy text match and image hashes. Return possible matches and reasons; uncertain cases go to review.
9. **Human review** — show candidate facts beside source evidence and image previews. Staff can edit, select an image, reject, or approve. Low-confidence and conflicting fields are visibly flagged.
10. **Commit** — insert a new catalog row only after approval. Store provenance and an audit event. A duplicate conflict blocks insertion and asks for review; no silent overwrite.

## 3. Evidence and confidence rules

Every extracted field should carry:
- `value` — proposed normalized value.
- `raw_value` — exact source wording where practical.
- `source_id` — captured page that supports it.
- `evidence_excerpt` — short supporting excerpt or structured-data path.
- `extraction_method` — schema, metadata, deterministic parser, or model.
- `confidence` — calibrated workflow score, not a claim of statistical certainty.
- `review_status` — unreviewed, accepted, edited, or rejected.

Source preference order (not absolute proof):
1. Manufacturer's official product page or official product document.
2. Brand's official catalog / support page.
3. Authorized distributor or wholesale catalog.
4. Established retailer listing.
5. Other public pages, marked lower-trust.

Conflicting sources must be shown as conflicts, not averaged. Unknown stays null. Never infer nicotine strength, battery capacity, puff count, ingredient content, legal status, or other regulated/safety-relevant claims from a product name or a similar variant.

A product family and its sellable variants are different records in the importer. Example: family = device model; variants = color, capacity, flavor, kit/pod, or regional SKU where the source confirms the distinction. Do not flatten variant facts onto the family.

## 4. Proposed data model (not yet applied)

Use dedicated importer tables rather than adding unreviewed fields to `products`:

- `import_batches`: creator, input query, status, counts, idempotency key, timestamps, failure summary.
- `import_jobs`: batch, job type, payload, status, attempt count, available_at, locked_until, last_error, timestamps.
- `import_candidates`: batch, canonical brand/model, family/variant relation, proposed category, structured attributes, field evidence JSON, confidence summary, duplicate status, review status, approved_by/at, committed_product_id.
- `import_sources`: candidate/batch, canonical URL, domain, page title, source type, fetched_at, HTTP status, content hash, extraction metadata, bounded evidence text, robots/policy outcome.
- `import_candidate_images`: candidate/source, original URL, page URL, detected MIME, dimensions, SHA-256, perceptual hash, storage path, attribution/rights status, review status.

Requirements:
- UUID primary keys, foreign keys, timestamps, indexes on batch/status/canonical identity, and unique idempotency constraints.
- Enable RLS on every exposed-schema table. Prefer keeping internal tables in a non-exposed schema where practical; otherwise explicitly grant only what is needed and enforce admin policies.
- Supabase's Data API exposure defaults changed in 2026. New tables must not assume automatic REST exposure; configure grants deliberately.
- Browser clients never receive a service-role/secret key. Privileged imports and commits run server-side.
- Store only bounded text/evidence and hashes by default; do not retain full HTML unless a documented debugging need justifies it.
- Preserve source records after candidate rejection for audit and duplicate-learning, subject to retention rules.
- Add a foreign key to the existing `products` row only after explicit approval and successful insert.

## 5. Queue and execution model

Use a durable Postgres-backed queue (Supabase Queues / pgmq) for work that must survive request termination. A request handler should enqueue and return a batch ID; workers process small, retryable units. Supabase documents durable messages, visibility timeouts, and archival for Queues. Do not rely on an Edge Function's `waitUntil` background task as the only durable job store: the Free Edge Function wall-clock limit is 150 seconds, and background tasks are still subject to runtime limits. Supabase currently labels the Queues feature Public Alpha, so verify its availability and operational status in this project before relying on it for production workloads.

Jobs must be idempotent and have:
- bounded attempts and exponential backoff with jitter;
- lease/visibility timeout and safe reclaim after worker failure;
- per-domain concurrency and minimum delay;
- explicit terminal states and staff-visible errors;
- batch cancellation;
- maximum pages, images, response bytes, and total runtime per batch.

A scheduler/worker deployment choice must be validated against the actual Supabase/Vercel plan limits before implementation. Do not add an always-on paid worker in the MVP.

## 6. Provider interfaces

Keep three independent adapters:

### SearchProvider
Input: query, allowed domains, locale, result limit.
Output: URL, title, snippet, provider, query, rank, retrieved_at.
First release can accept staff-supplied URLs while provider selection is pending. A public meta-search service is not assumed reliable or suitable for production.

### PageFetcher / Extractor
Input: validated URL and fetch policy.
Output: response metadata, structured product data, normalized page text, discovered image candidates.
Use deterministic parsers before AI. Browser automation is a last resort, not the default.

### LLMProvider
Input: bounded source evidence and an explicit extraction schema.
Output: schema-validated proposed facts with references to supplied evidence IDs.
Provider credentials remain server-side. Keep the provider swappable; no provider is selected until its current pricing, rate limits, data-use policy, and credentials are reviewed.

## 7. Open-source reference shortlist

Prefer small, composable libraries. Review current versions and licenses before adding dependencies.

| Project | Proposed use | License / caution |
|---|---|---|
| [Crawlee](https://github.com/apify/crawlee) | TypeScript crawling, URL queues, retries, HTTP/browser adapters | Apache-2.0; use only if a separate worker runtime is justified |
| [Trafilatura](https://github.com/adbar/trafilatura) | Main text and metadata extraction in a Python worker | Apache-2.0 from v1.8.0 onward; older versions were GPLv3+ |
| [RapidFuzz](https://github.com/rapidfuzz/RapidFuzz) | Fast fuzzy brand/model matching | MIT |
| [ImageHash](https://github.com/JohannesBuchner/imagehash) | Perceptual image duplicate screening | Verify the exact release license before adoption |
| [SearXNG](https://github.com/searxng/searxng) | Possible self-hosted metasearch adapter for experiments | AGPL-3.0; introduces hosting, maintenance, and license obligations; not the default MVP choice |
| [Scrapy](https://github.com/scrapy/scrapy) | Alternative Python crawler if the extraction worker becomes Python-first | BSD-3-Clause |

Do not adopt Firecrawl or a large browser automation stack merely because it is popular. They add runtime, operational, and/or license considerations that are not justified until ordinary HTTP + structured-data extraction has been measured and shown insufficient.

## 8. Security and rights controls

### SSRF / fetch safety
- Accept only `https:` and `http:`; reject credentials in URLs, unusual ports, localhost, private, loopback, link-local, multicast, and cloud metadata IP ranges.
- Resolve DNS and validate every resolved IP; repeat validation after every redirect and before connecting to prevent DNS rebinding.
- Limit redirects, response size, decompression ratio, content types, connect/read timeout, and total fetch time.
- Do not forward cookies, auth headers, or internal credentials to source websites.
- Block non-web protocols and local file access.
- Re-validate image URLs independently; an image URL is untrusted input too.

### Content and image safety
- Treat page text and metadata as untrusted data, never as instructions to the model or worker.
- Strip scripts/styles and send only bounded extracted text to the LLM.
- Verify image file signatures; decode and re-encode to safe raster formats; strip EXIF; cap pixel count and file size.
- Record original URL, source page, capture time, and rights/permission status.
- A publicly reachable image is not automatically licensed for commercial reuse. Prefer official assets with explicit retailer/press permission or documented usage terms. Require staff confirmation before publishing any image whose rights are unclear.

### Retail accuracy
- No legal-compliance claims generated by AI.
- No unsupported health, safety, ingredient, potency, or age claims.
- No variant inheritance unless source explicitly confirms it.
- Keep citations/evidence attached to each field through approval and catalog commit.

## 9. Build sequence and release gates

1. **Foundation (this document):** architecture and scope agreed; no database or production changes.
2. **Schema and test fixtures:** add importer tables in a new migration, RLS/grants, deterministic sample fixtures, and tests. Apply only to a disposable local/test database first.
3. **Backend pipeline:** URL safety, source capture, extraction, normalization, duplicate screening, queue/retry state machine. Use fixture/mock providers first.
4. **Admin review UI:** batch list, candidate detail, field evidence, image review, duplicate warnings, approve/reject/edit.
5. **Provider integration:** select search + LLM providers only after current price, privacy, limits, and credentials are explicitly approved.
6. **Preview validation:** test representative product families and variants; verify source coverage, evidence, image correctness, retries, idempotency, and no-write-before-approval.
7. **Hosted migration and preview deploy:** require explicit go-ahead before touching the hosted Supabase schema or production-facing data.

## 10. Acceptance criteria

- Every non-empty proposed fact has source evidence or is clearly marked as a staff-entered value.
- Missing facts remain missing.
- Product-family and variant relationships are preserved.
- A source page can be retried without duplicate candidates or duplicate catalog rows.
- Duplicate warnings show the existing record and match rationale.
- Candidate/image review is separate from catalog commit.
- Rejected candidates never appear on the kiosk.
- A failed job can be resumed without losing prior source evidence.
- Image previews correspond to the exact model/variant being reviewed.
- No external provider key or privileged Supabase key reaches browser code.
- Existing kiosk and existing catalog records remain unchanged throughout preview development.


## 10. Implemented development MVP and remaining gates

The current development implementation lives in the `puffbuddy-importer-dev` Supabase project and the `feature/ai-product-importer-foundation` Git branch.

Implemented:
- Staff email OTP sign-in and server-side email allowlist check.
- Separate `/importer` route in the Vercel preview project.
- Supabase Edge Function `importer-workflow`, with JWT verification.
- Staff-submitted URL import (up to five pages per batch), bounded HTML extraction, Schema.org Product JSON-LD parsing, page title/H1 and metadata extraction.
- Candidate image URL discovery from product JSON-LD, Open Graph and page image elements.
- Source evidence, candidate review states, and approved JSON export.
- Importer schema access restricted to the server-side `service_role`; `anon` and `authenticated` have no schema usage or table privileges.
- SQL migrations and Edge Function source tracked in Git.

Not implemented / not claimed:
- Broad product discovery from search terms. Staff must provide URLs.
- LLM enrichment. No free model provider credential has been configured; extraction is deterministic and must not be labelled AI-verified.
- Automatic downloading/re-encoding of candidate images. Image URLs are previews only and rights remain unverified.
- Direct publishing into the existing live kiosk catalog. Approved records export to JSON; cross-project publishing needs a separately secured handoff.
- End-to-end authenticated browser import test. Confirm the Supabase Auth redirect allow-list for the current preview hostname and run a test with a real product page before treating this as operational.
- Socket-level DNS pinning. The fetcher validates DNS before requests, but the runtime fetch does not pin the resolved address; keep arbitrary URL fetching staff-only and development-only until a hardened fetch proxy is used.

Do not merge or promote this feature until the outstanding gates above are resolved. Do not add paid providers or production credentials without explicit approval.
