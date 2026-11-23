begin;

alter table app.capture_drafts add column pickup_contact jsonb;
alter table app.capture_drafts add constraint capture_pickup_contact_valid check (
  pickup_contact is null or (fulfillment_channel is not distinct from 'pickup'
    and app_private.jsonb_has_exact_keys(pickup_contact,array['name','phone'])
    and jsonb_typeof(pickup_contact->'name') = 'string'
    and jsonb_typeof(pickup_contact->'phone') = 'string'
    and pickup_contact->>'name' = btrim(pickup_contact->>'name')
    and pickup_contact->>'phone' = btrim(pickup_contact->>'phone')
    and char_length(pickup_contact->>'name') between 1 and 120
    and char_length(pickup_contact->>'phone') between 1 and 40
    and pickup_contact->>'name' !~ '[[:cntrl:]]'
    and pickup_contact->>'phone' !~ '[[:cntrl:]]')
);

do $migration$
declare
  definition text;
  old text;
  replacement text;
begin
  definition := pg_get_functiondef('app_private.autosave_capture_draft(uuid,jsonb)'::regprocedure);
  old := $old$not app_private.jsonb_has_exact_keys(p_command,array[
    'schemaVersion','scope','captureDraftId','expectedVersion','attentionLeaseId','sourceChannel','fulfillmentChannel',
    'customerSnapshotRef','fulfillmentSnapshotRef','eventId','idempotencyKey','deviceId','occurredAt'
  ])$old$;
  replacement := $new$(not app_private.jsonb_has_exact_keys(p_command,array[
    'schemaVersion','scope','captureDraftId','expectedVersion','attentionLeaseId','sourceChannel','fulfillmentChannel',
    'customerSnapshotRef','fulfillmentSnapshotRef','eventId','idempotencyKey','deviceId','occurredAt'
  ]) and not app_private.jsonb_has_exact_keys(p_command,array[
    'schemaVersion','scope','captureDraftId','expectedVersion','attentionLeaseId','sourceChannel','fulfillmentChannel',
    'customerSnapshotRef','fulfillmentSnapshotRef','eventId','idempotencyKey','deviceId','occurredAt','pickupContact'
  ]))$new$;
  if strpos(definition,old)=0 then raise exception 'PICKUP_CONTACT_AUTOSAVE_KEYS_GUARD'; end if;
  definition := replace(definition,old,replacement);
  old := $old$  begin
    restaurant := (p_command#>>'{scope,restaurantId}')::uuid;$old$;
  replacement := $new$  if p_command ? 'pickupContact' and p_command->'pickupContact' <> 'null'::jsonb and (
    p_command->>'fulfillmentChannel' is distinct from 'pickup'
    or not app_private.jsonb_has_exact_keys(p_command->'pickupContact',array['name','phone'])
    or jsonb_typeof(p_command#>'{pickupContact,name}') is distinct from 'string'
    or jsonb_typeof(p_command#>'{pickupContact,phone}') is distinct from 'string'
    or p_command#>>'{pickupContact,name}' is distinct from btrim(p_command#>>'{pickupContact,name}')
    or p_command#>>'{pickupContact,phone}' is distinct from btrim(p_command#>>'{pickupContact,phone}')
    or char_length(p_command#>>'{pickupContact,name}') not between 1 and 120
    or char_length(p_command#>>'{pickupContact,phone}') not between 1 and 40
    or p_command#>>'{pickupContact,name}' ~ '[[:cntrl:]]' or p_command#>>'{pickupContact,phone}' ~ '[[:cntrl:]]'
  ) then return jsonb_build_object('status','rejected'); end if;
  begin
    restaurant := (p_command#>>'{scope,restaurantId}')::uuid;$new$;
  if strpos(definition,old)=0 then raise exception 'PICKUP_CONTACT_AUTOSAVE_VALIDATION_GUARD'; end if;
  definition := replace(definition,old,replacement);
  old := $old$update app.capture_drafts set source_channel=p_command->>'sourceChannel',fulfillment_channel=p_command->>'fulfillmentChannel',$old$;
  replacement := $new$update app.capture_drafts set pickup_contact=case when p_command->>'fulfillmentChannel' is distinct from 'pickup' then null when p_command ? 'pickupContact' then nullif(p_command->'pickupContact','null'::jsonb) else pickup_contact end, source_channel=p_command->>'sourceChannel',fulfillment_channel=p_command->>'fulfillmentChannel',$new$;
  if strpos(definition,old)=0 then raise exception 'PICKUP_CONTACT_AUTOSAVE_UPDATE_GUARD'; end if;
  execute replace(definition,old,replacement);

  definition := pg_get_functiondef('app_private.read_capture_workspace_v2(uuid,jsonb)'::regprocedure);
  old := $old$'detail',(v1->'detail')||pg_catalog.jsonb_build_object('schemaVersion',2,'deliveryInstructions',instructions)$old$;
  replacement := $new$'detail',(v1->'detail')||pg_catalog.jsonb_build_object('schemaVersion',2,'deliveryInstructions',instructions,'pickupContact',(select pickup_contact from app.capture_drafts where restaurant_id=restaurant and branch_id=branch and id=capture))$new$;
  if strpos(definition,old)=0 then raise exception 'PICKUP_CONTACT_WORKSPACE_GUARD'; end if;
  execute replace(definition,old,replacement);

  definition := pg_get_functiondef('app_private.confirm_capture_draft(uuid,jsonb,jsonb,jsonb)'::regprocedure);
  old := $old$    or (current_capture.fulfillment_channel='delivery' and (
      current_capture.customer_snapshot_id is null or current_capture.fulfillment_snapshot_id is null
    ))
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;$old$;
  replacement := $new$  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  if current_capture.fulfillment_channel='delivery' and current_capture.customer_id is null then
    return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_customer_required');
  end if;
  if current_capture.fulfillment_channel='delivery' and (current_capture.customer_snapshot_id is null or current_capture.fulfillment_snapshot_id is null) then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;$new$;
  if strpos(definition,old)=0 then raise exception 'PICKUP_CONTACT_CONFIRM_V2_GUARD'; end if;
  execute replace(definition,old,replacement);

  definition := pg_get_functiondef('app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb)'::regprocedure);
  old := $old$  if current_channel = 'delivery' then
    if frozen_quote is null then$old$;
  replacement := $new$  if current_channel = 'delivery' and not exists (select 1 from app.capture_drafts where restaurant_id=restaurant and branch_id=branch and id=capture and customer_id is not null) then
    return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_customer_required');
  end if;
  if current_channel = 'delivery' then
    if frozen_quote is null then$new$;
  if strpos(definition,old)=0 then raise exception 'PICKUP_CONTACT_CONFIRM_GUARD'; end if;
  execute replace(definition,old,replacement);
end
$migration$;

commit;
