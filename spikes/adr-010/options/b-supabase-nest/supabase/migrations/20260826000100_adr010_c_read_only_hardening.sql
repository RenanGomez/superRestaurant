-- ADR-010 option C is a read-only evaluation over option B's disposable
-- schema. This migration must run after 20260825000100_adr010_b_thin_slice.sql.
-- Every statement is safe to repeat: it only revokes privileges or restores
-- the single authenticated SELECT surface required by the read probe.

revoke all privileges on schema adr010_b from public;
revoke all privileges on schema adr010_b_private from public, anon, authenticated, service_role;
grant usage on schema adr010_b to anon, authenticated;

revoke all privileges on all tables in schema adr010_b from anon, authenticated, service_role;
revoke all privileges on all sequences in schema adr010_b from anon, authenticated, service_role;
revoke all privileges on all functions in schema adr010_b from public, anon, authenticated, service_role;
revoke all privileges on all functions in schema adr010_b_private from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema adr010_b
  revoke all privileges on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema adr010_b
  revoke all privileges on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema adr010_b
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema adr010_b_private
  revoke execute on functions from public, anon, authenticated, service_role;

-- These functions already live in the private schema. Repeating their exact
-- ACLs catches accidental grants and avoids the stale exposed-schema reference
-- that existed in option C's original standalone hardening script.
revoke all privileges on function adr010_b_private.adr010_b_bootstrap_auth_memberships(jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function adr010_b_private.adr010_b_revoke_bootstrap_membership(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function adr010_b_private.adr010_b_cleanup_auth_bootstrap(jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function adr010_b_private.adr010_b_create_order(jsonb)
  from public, anon, authenticated, service_role;

-- Reads remain possible only for authenticated users accepted by option B's
-- RLS policies. The administrative bootstrap_users table and any future table
-- stay closed because this is an explicit allowlist, not `ALL TABLES`.
-- No INSERT/UPDATE/DELETE/TRUNCATE or EXECUTE grant is restored.
grant select on table
  adr010_b.restaurants,
  adr010_b.branches,
  adr010_b.memberships,
  adr010_b.orders,
  adr010_b.order_lines,
  adr010_b.order_line_snapshots,
  adr010_b.order_idempotency,
  adr010_b.audit_log,
  adr010_b.kds_events
to authenticated;
