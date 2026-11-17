# Puffbuddy project setup

## Stack
- Next.js App Router and React
- Supabase Auth, Postgres and Storage
- Vercel hosting
- QR sharing with the `qrcode` package

## Environment
Copy `.env.example` to `.env.local` for local development and set:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase publishable key is accepted here)

Never put a Supabase service-role key in a browser environment variable or commit secrets.

## Existing Supabase schema
The app expects the existing Puffbuddy tables:
- `categories`: id, name, is_active, sort_order
- `products`: id, category_id, name, brand, series, description, highlights, specs, image_url, is_active, sort_order, created_at
- `product_requests`: product_name, brand, customer_note, source
- `admin_users`: user_id

Storage bucket: `puffbuddy-product-images`.

Staff accounts must be explicitly inserted into `admin_users`. Public kiosk policies should only expose active catalog rows. Keep the product-request insert policy constrained and add rate limiting / abuse controls before wider public rollout.

## Local development
```bash
npm install
npm run dev
```

## Deployment safety
The Git branch `integration/app-source` is a source-control baseline. It is not the production deployment. Do not point the existing production alias at a new project until:
1. Environment variables are configured in the new Vercel project.
2. The build succeeds.
3. Auth redirect URLs are updated and tested.
4. Kiosk and admin flows are checked on the target iPad.
5. Existing production remains available for rollback.

## Known MVP limits
- The age confirmation is a UX gate, not legal compliance or identity verification.
- QR sharing encodes a small product list in the URL; use server-side share tokens for durable links and larger lists.
- Product import, source verification, variant hierarchy, category editor, request inbox, audit history, and rate limiting are not implemented yet.
- Product image URLs should be official or authorized product images; staff should verify image-to-model matching before publishing.


## Importer preview email sign-in redirect

The importer uses the fixed preview callback URL `https://puffbuddy-importer-preview.vercel.app/importer` so local development origins cannot leak into email sign-in links.

In the Supabase development project (`puffbuddy-importer-dev`), configure **Authentication → URL Configuration**:

- **Site URL:** `https://puffbuddy-importer-preview.vercel.app`
- **Redirect URLs:** add `https://puffbuddy-importer-preview.vercel.app/**`
- Keep `http://localhost:3000/**` only for intentional local development; it must not be the Site URL.

Also check **Authentication → Email Templates → Magic Link**. The link must use Supabase's `{{ .ConfirmationURL }}` variable (or an equivalent link that preserves Supabase's generated `redirect_to` parameter). Do not hard-code `http://localhost:3000` or `{{ .SiteURL }}` as the final destination.

The Vercel preview alias is `https://puffbuddy-importer-preview.vercel.app`. Test a newly requested email after saving these settings; previously sent magic links retain their original redirect and should not be reused.
