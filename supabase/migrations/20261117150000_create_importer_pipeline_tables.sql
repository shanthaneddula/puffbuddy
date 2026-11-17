create schema if not exists importer;
revoke all on schema importer from public, anon, authenticated;
grant usage on schema importer to service_role;

create table importer.import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft','queued','running','review','completed','failed','cancelled')),
  requested_brands text[] not null default '{}',
  requested_product_families text[] not null default '{}',
  options jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table importer.import_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references importer.import_batches(id) on delete cascade,
  job_type text not null
    check (job_type in ('discover','fetch','extract','normalize','find_images','deduplicate')),
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','cancelled')),
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, idempotency_key)
);

create table importer.import_candidates (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references importer.import_batches(id) on delete cascade,
  status text not null default 'pending_review'
    check (status in ('pending_review','approved','rejected','inserted')),
  product_name text not null,
  brand text,
  product_family text,
  variant text,
  sku text,
  normalized_identity text,
  normalized_payload jsonb not null default '{}'::jsonb,
  field_evidence jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  duplicate_of uuid references importer.import_candidates(id) on delete set null,
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  inserted_product_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table importer.import_sources (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references importer.import_batches(id) on delete cascade,
  candidate_id uuid references importer.import_candidates(id) on delete cascade,
  source_url text not null,
  canonical_url text,
  source_type text not null default 'web'
    check (source_type in ('manufacturer','brand','distributor','retailer','web','other')),
  source_title text,
  publisher text,
  fetched_at timestamptz,
  http_status integer,
  content_type text,
  content_hash text,
  extracted_text text,
  extraction_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table importer.import_candidate_images (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references importer.import_candidates(id) on delete cascade,
  source_id uuid references importer.import_sources(id) on delete set null,
  image_url text not null,
  storage_path text,
  source_page_url text,
  alt_text text,
  attribution text,
  rights_status text not null default 'unverified'
    check (rights_status in ('unverified','allowed','restricted','rejected')),
  review_status text not null default 'pending'
    check (review_status in ('pending','approved','rejected')),
  content_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  content_hash text,
  created_at timestamptz not null default now()
);

create index idx_import_batches_status_created
  on importer.import_batches(status, created_at desc);
create index idx_import_jobs_claim
  on importer.import_jobs(status, available_at, created_at)
  where status in ('queued','running');
create index idx_import_jobs_batch_status
  on importer.import_jobs(batch_id, status);
create index idx_import_candidates_batch_status
  on importer.import_candidates(batch_id, status);
create index idx_import_candidates_identity
  on importer.import_candidates(normalized_identity)
  where normalized_identity is not null;
create index idx_import_sources_candidate
  on importer.import_sources(candidate_id);
create index idx_import_candidate_images_candidate_review
  on importer.import_candidate_images(candidate_id, review_status);

alter table importer.import_batches enable row level security;
alter table importer.import_jobs enable row level security;
alter table importer.import_candidates enable row level security;
alter table importer.import_sources enable row level security;
alter table importer.import_candidate_images enable row level security;

comment on schema importer is 'Private, staff-operated product research and import pipeline. Not exposed to public kiosk clients.';
