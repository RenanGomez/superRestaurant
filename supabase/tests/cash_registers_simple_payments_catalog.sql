-- Exact additive audit for cash-register and simple-payment storage.
do $audit$
declare
  app_api_oid oid;
  object_name text;
  object_oid oid;
  expected_volatility "char";
begin
  select oid into app_api_oid from pg_catalog.pg_roles where rolname = 'app_api';
  if app_api_oid is null then raise exception 'FINANCIAL_REQUIRED_ROLE_MISSING'; end if;

  foreach object_name in array array[
    'cash_register_sessions','payments','cash_movements','financial_audit_events'
  ] loop
    select c.oid into object_oid
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app' and c.relname=object_name and c.relkind='r';
    if object_oid is null then raise exception 'FINANCIAL_REQUIRED_TABLE_MISSING:%', object_name; end if;
    if not exists(select 1 from pg_catalog.pg_class c where c.oid=object_oid and c.relrowsecurity and c.relforcerowsecurity)
      or pg_catalog.has_table_privilege('anon',object_oid,'SELECT,INSERT,UPDATE,DELETE')
      or pg_catalog.has_table_privilege('authenticated',object_oid,'SELECT,INSERT,UPDATE,DELETE')
      or pg_catalog.has_table_privilege('service_role',object_oid,'SELECT,INSERT,UPDATE,DELETE')
      or pg_catalog.has_table_privilege(app_api_oid,object_oid,'SELECT,INSERT,UPDATE,DELETE')
    then raise exception 'FINANCIAL_TABLE_SECURITY_REJECTED:%', object_name; end if;
    object_oid := null;
  end loop;

  select c.oid into object_oid
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='app_private' and c.relname='financial_device_sequences' and c.relkind='r';
  if object_oid is null
    or not exists(select 1 from pg_catalog.pg_class c where c.oid=object_oid and c.relrowsecurity and c.relforcerowsecurity)
    or pg_catalog.has_table_privilege(app_api_oid,object_oid,'SELECT,INSERT,UPDATE,DELETE')
  then raise exception 'FINANCIAL_DEVICE_SEQUENCE_SECURITY_REJECTED'; end if;

  foreach object_name in array array[
    'app_private.read_cash_register(uuid,uuid,uuid,uuid,uuid)',
    'app_private.replay_financial_command(uuid,text,jsonb)',
    'app_private.open_cash_register(uuid,jsonb,jsonb)',
    'app_private.collect_simple_payment(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint)',
    'app_private.close_cash_register(uuid,jsonb,jsonb)'
  ] loop
    object_oid := pg_catalog.to_regprocedure(object_name);
    expected_volatility := case when object_name like 'app_private.read_%' or object_name like 'app_private.replay_%' then 's' else 'v' end;
    if object_oid is null or not exists(
      select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles owner on owner.oid=p.proowner
      where p.oid=object_oid and p.prosecdef and p.provolatile=expected_volatility
        and p.prorettype='jsonb'::pg_catalog.regtype and owner.rolname='postgres' and owner.rolbypassrls
        and coalesce(pg_catalog.array_to_string(p.proconfig,','),'') in ('search_path=','search_path=""')
    ) then raise exception 'FINANCIAL_FUNCTION_SECURITY_REJECTED:%', object_name; end if;
    if not pg_catalog.has_function_privilege(app_api_oid,object_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',object_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',object_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',object_oid,'EXECUTE')
      or exists(
        select 1 from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
        where p.oid=object_oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      )
    then raise exception 'FINANCIAL_FUNCTION_GRANT_REJECTED:%', object_name; end if;
  end loop;

  if not exists(
    select 1 from pg_catalog.pg_indexes
    where schemaname='app' and indexname='cash_register_one_open_session_idx'
      and indexdef ilike '%unique index%where (status = ''open''::text)%'
  ) then raise exception 'FINANCIAL_OPEN_REGISTER_UNIQUENESS_REJECTED'; end if;
  if not exists(
    select 1 from pg_catalog.pg_constraint
    where conrelid='app.financial_audit_events'::pg_catalog.regclass
      and conname='financial_audit_idempotency_unique' and contype='u'
  ) then raise exception 'FINANCIAL_IDEMPOTENCY_CONSTRAINT_REJECTED'; end if;
  if not exists(
    select 1 from pg_catalog.pg_constraint
    where conrelid='app.cash_movements'::pg_catalog.regclass
      and conname='cash_movements_compensation_fk' and contype='f'
  ) then raise exception 'FINANCIAL_COMPENSATION_CONSTRAINT_REJECTED'; end if;
end
$audit$;
