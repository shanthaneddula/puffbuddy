-- Expose the internal schema to PostgREST so the server-side Edge Function can
-- use the Supabase client. The schema is not granted to anon/authenticated roles.
-- This role-level setting overrides the dashboard Exposed Schemas setting.
alter role authenticator set pgrst.db_schemas = 'public, importer';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
