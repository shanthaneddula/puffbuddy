create table importer.importer_admin_users (
  email text primary key,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint importer_admin_users_email_lowercase check (email = lower(email))
);

insert into importer.importer_admin_users (email)
values ('shanthaneddula@gmail.com')
on conflict (email) do update set is_active = true;

revoke all on all tables in schema importer from public, anon, authenticated;
grant usage on schema importer to service_role;
grant all privileges on all tables in schema importer to service_role;
alter default privileges in schema importer
  grant all privileges on tables to service_role;

alter table importer.importer_admin_users enable row level security;
