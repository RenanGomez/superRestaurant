-- Fail-closed hardening for the server-only disposable Auth marker.
-- This migration follows the B thin slice and C Data API hardening. It creates
-- no policy: PostgreSQL/server-only SECURITY DEFINER functions remain the only
-- intended access path to adr010_b.bootstrap_users.

alter table adr010_b.bootstrap_users enable row level security;
alter table adr010_b.bootstrap_users force row level security;

-- Remove any policy that may have been added out of band. With no policies,
-- ordinary roles subject to RLS receive the default-deny result.
do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'adr010_b' and tablename = 'bootstrap_users'
  loop
    execute format(
      'drop policy %I on adr010_b.bootstrap_users',
      existing_policy.policyname
    );
  end loop;
end;
$$;

revoke all privileges on table adr010_b.bootstrap_users
  from public, anon, authenticated, service_role;
revoke all privileges on all sequences in schema adr010_b
  from public, anon, authenticated, service_role;
revoke all privileges on all functions in schema adr010_b
  from public, anon, authenticated, service_role;
revoke all privileges on all functions in schema adr010_b_private
  from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema adr010_b
  revoke all privileges on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema adr010_b
  revoke all privileges on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema adr010_b
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema adr010_b_private
  revoke execute on functions from public, anon, authenticated, service_role;
