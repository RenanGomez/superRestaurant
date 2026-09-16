begin;

-- Candidate only: no runtime capability until private transactional writers are implemented.
alter table app.memberships add constraint memberships_capture_actor_scope_unique
  unique (restaurant_id, branch_id, id, user_id);

-- One accepted command is also its audit event: do not maintain a second replay history.
create table app.capture_command_events (
  event_id uuid primary key,
  restaurant_id uuid not null,
  branch_id uuid not null,
  capture_draft_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_membership_id uuid not null,
  device_id uuid not null,
  operation text not null,
  idempotency_key text not null,
  command_fingerprint text not null,
  expected_version bigint not null,
  result_version bigint not null,
  result_capture jsonb not null,
  reason text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint capture_events_capture_scope_fk foreign key (restaurant_id, branch_id, capture_draft_id)
    references app.capture_drafts (restaurant_id, branch_id, id) on delete restrict,
  constraint capture_events_actor_scope_fk foreign key (restaurant_id, branch_id, actor_membership_id, actor_id)
    references app.memberships (restaurant_id, branch_id, id, user_id) on delete restrict,
  constraint capture_events_idempotency_unique unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint capture_events_version_unique unique (restaurant_id, branch_id, capture_draft_id, result_version),
  constraint capture_events_idempotency_valid check (
    char_length(idempotency_key) between 1 and 200 and idempotency_key = btrim(idempotency_key)
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  constraint capture_events_fingerprint_valid check (command_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint capture_events_operation_valid check (operation in (
    'capture.created','capture.autosaved','capture.held','capture.claimed','capture.resumed',
    'capture.transferred','capture.confirmed','capture.no_sale',
    'capture.recovery_preference_changed','capture.taken_over'
  )),
  constraint capture_events_version_valid check (
    expected_version between 0 and 9007199254740990 and result_version = expected_version + 1
    and ((operation = 'capture.created') = (expected_version = 0))
  ),
  constraint capture_events_reason_valid check (
    (reason is null or (char_length(btrim(reason)) between 1 and 500 and reason !~ '[[:cntrl:]]'))
    and (operation not in ('capture.no_sale','capture.taken_over') or reason is not null)
  ),
  constraint capture_events_result_valid check (coalesce(
    pg_catalog.jsonb_typeof(result_capture) = 'object'
    and result_capture - array['schemaVersion','detail','recoveryPolicy'] = '{}'::jsonb
    and result_capture ->> 'schemaVersion' = '1'
    and pg_catalog.jsonb_typeof(result_capture -> 'detail') = 'object'
    and result_capture #>> '{detail,schemaVersion}' = '1'
    and result_capture #>> '{detail,captureDraftId}' = capture_draft_id::text
    and result_capture #>> '{detail,scope,restaurantId}' = restaurant_id::text
    and result_capture #>> '{detail,scope,branchId}' = branch_id::text
    and result_capture #>> '{detail,version}' = result_version::text
    and pg_catalog.jsonb_typeof(result_capture -> 'recoveryPolicy') = 'object'
    and result_capture #>> '{recoveryPolicy,schemaVersion}' = '1'
    and pg_catalog.jsonb_typeof(result_capture #> '{recoveryPolicy,autoRenewSelected}') = 'boolean'
    and pg_catalog.jsonb_typeof(result_capture #> '{recoveryPolicy,recoveryExpiresAt}') = 'string'
  , false))
);

-- The version uniqueness index also serves ordered per-capture history reads.
alter table app.capture_command_events enable row level security;
alter table app.capture_command_events force row level security;
revoke all on app.capture_command_events from public, anon, authenticated, service_role, app_api;

comment on table app.capture_command_events is
  'Server-only append-only accepted-command journal and audit. Fingerprint binds complete canonical command, actor and scope. Exact stored result is replayed only after renewed authorization; no raw customer command payload. Private writers must atomically persist capture + event and forbid update/delete.';

commit;
