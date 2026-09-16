-- Supplement to an exact migrated global audit, not a replacement for that audit.
do $audit$
declare
  target oid := pg_catalog.to_regclass('app.capture_drafts');
begin
  if target is null then raise exception 'CAPTURE_TABLE_MISSING'; end if;
  if not exists (
    select 1 from pg_catalog.pg_class as c
    join pg_catalog.pg_roles as r on r.oid = c.relowner
    where c.oid = target and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity
      and r.rolname = 'postgres' and r.rolbypassrls
  ) then raise exception 'CAPTURE_TABLE_SECURITY_REJECTED'; end if;
  if exists (select 1 from pg_catalog.pg_policy where polrelid = target)
    then raise exception 'CAPTURE_POLICY_SURFACE_REJECTED'; end if;
  if exists (
    select 1 from pg_catalog.pg_class as c,
      lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) as acl
    where c.oid = target and acl.grantee <> c.relowner
  ) then raise exception 'CAPTURE_TABLE_GRANTS_REJECTED'; end if;
  if (select count(*) from pg_catalog.pg_constraint where conrelid = target and convalidated) <> 17
    then raise exception 'CAPTURE_CONSTRAINT_SURFACE_REJECTED'; end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = target and conname = 'capture_drafts_owner_scope_fk'
      and confrelid = pg_catalog.to_regclass('app.memberships') and array_length(conkey, 1) = 3
  ) then raise exception 'CAPTURE_OWNER_SCOPE_REJECTED'; end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = target and conname = 'capture_drafts_order_scope_fk'
      and confrelid = pg_catalog.to_regclass('app.orders') and array_length(conkey, 1) = 3
  ) then raise exception 'CAPTURE_ORDER_SCOPE_REJECTED'; end if;
end
$audit$;

do $audit$
declare
  target oid := pg_catalog.to_regclass('app.capture_command_events');
begin
  if target is null or not exists (
    select 1 from pg_catalog.pg_class as c join pg_catalog.pg_roles as r on r.oid = c.relowner
    where c.oid = target and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity
      and r.rolname = 'postgres' and r.rolbypassrls
  ) then raise exception 'CAPTURE_JOURNAL_SECURITY_REJECTED'; end if;
  if exists (select 1 from pg_catalog.pg_policy where polrelid = target) or exists (
    select 1 from pg_catalog.pg_class as c,
      lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) as acl
    where c.oid = target and acl.grantee <> c.relowner
  ) then raise exception 'CAPTURE_JOURNAL_GRANTS_REJECTED'; end if;
  if (select count(*) from pg_catalog.pg_constraint where conrelid = target and convalidated) <> 12
    then raise exception 'CAPTURE_JOURNAL_CONSTRAINTS_REJECTED'; end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = target
    and conname = 'capture_events_actor_scope_fk' and contype = 'f'
    and confrelid = pg_catalog.to_regclass('app.memberships') and array_length(conkey, 1) = 4)
  or not exists (select 1 from pg_catalog.pg_constraint where conrelid = target
    and conname = 'capture_events_capture_scope_fk' and contype = 'f'
    and confrelid = pg_catalog.to_regclass('app.capture_drafts') and array_length(conkey, 1) = 3)
  then raise exception 'CAPTURE_JOURNAL_SCOPE_REJECTED'; end if;
end
$audit$;
