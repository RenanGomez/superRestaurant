-- Supplement to the exact Capture repeat-order confirmation audit. Never apply as a migration.
do $capture_assignment_catalog$
declare
  assignment oid := pg_catalog.to_regprocedure('app_private.mutate_capture_assignment(uuid,text,jsonb)');
  directory oid := pg_catalog.to_regprocedure('app_private.list_capture_assignment_candidates(uuid,jsonb)');
  app_api_oid oid := (select oid from pg_catalog.pg_roles where rolname='app_api');
begin
  if assignment is null or directory is null or app_api_oid is null then
    raise exception using errcode='55000', message='CAPTURE_ASSIGNMENT_REQUIRED_OBJECT_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid=p.proowner
    where p.oid=assignment and p.prosecdef and p.provolatile='v'
      and owner.rolname='postgres' and owner.rolbypassrls
      and coalesce(pg_catalog.array_to_string(p.proconfig,','),'') in ('search_path=','search_path=""')
  ) then
    raise exception using errcode='55000', message='CAPTURE_ASSIGNMENT_FUNCTION_SHAPE_REJECTED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid=p.proowner
    where p.oid=directory and p.prosecdef and p.provolatile='s'
      and owner.rolname='postgres' and owner.rolbypassrls
      and coalesce(pg_catalog.array_to_string(p.proconfig,','),'') in ('search_path=','search_path=""')
  ) then
    raise exception using errcode='55000', message='CAPTURE_ASSIGNMENT_DIRECTORY_FUNCTION_SHAPE_REJECTED';
  end if;
  if not pg_catalog.has_function_privilege(app_api_oid,assignment,'EXECUTE')
    or not pg_catalog.has_function_privilege(app_api_oid,directory,'EXECUTE')
    or pg_catalog.has_function_privilege('public',assignment,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',assignment,'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',assignment,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',assignment,'EXECUTE')
    or pg_catalog.has_function_privilege('public',directory,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',directory,'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',directory,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',directory,'EXECUTE')
  then raise exception using errcode='55000', message='CAPTURE_ASSIGNMENT_GRANTS_REJECTED'; end if;
end
$capture_assignment_catalog$;
