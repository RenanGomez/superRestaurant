begin;

-- Local candidate only. No API capability is granted by this schema foundation.
alter table app.memberships add constraint memberships_capture_scope_unique
  unique (restaurant_id, branch_id, id);

create table app.capture_drafts (
  id uuid not null,
  restaurant_id uuid not null,
  branch_id uuid not null,
  folio text not null,
  source_channel text not null,
  fulfillment_channel text,
  status text not null default 'draft',
  attention_status text not null,
  owner_membership_id uuid,
  attention_lease_id uuid,
  attention_lease_expires_at timestamptz,
  recovery_expires_at timestamptz not null,
  auto_renew_selected boolean not null default false,
  confirmed_order_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid not null references auth.users (id) on delete restrict,
  constraint capture_drafts_pk primary key (restaurant_id, branch_id, id),
  constraint capture_drafts_branch_fk foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint capture_drafts_owner_scope_fk foreign key (restaurant_id, branch_id, owner_membership_id)
    references app.memberships (restaurant_id, branch_id, id) on delete restrict,
  constraint capture_drafts_order_scope_fk foreign key (restaurant_id, branch_id, confirmed_order_id)
    references app.orders (restaurant_id, branch_id, id) on delete restrict,
  constraint capture_drafts_folio_unique unique (restaurant_id, branch_id, folio),
  constraint capture_drafts_folio_valid check (char_length(folio) between 1 and 40 and folio = btrim(folio)),
  constraint capture_drafts_source_valid check (source_channel in ('phone','whatsapp_manual','counter','table','self_service','integration')),
  constraint capture_drafts_fulfillment_valid check (fulfillment_channel in ('dine_in','counter','pickup','delivery')),
  constraint capture_drafts_status_valid check (status in ('draft','confirmed','no_sale')),
  constraint capture_drafts_attention_valid check (attention_status in ('unclaimed','claimed','held')),
  constraint capture_drafts_version_valid check (version between 1 and 9007199254740991),
  constraint capture_drafts_attention_evidence check (
    (attention_status = 'claimed' and owner_membership_id is not null and attention_lease_id is not null and attention_lease_expires_at is not null)
    or (attention_status in ('unclaimed','held') and owner_membership_id is null and attention_lease_id is null and attention_lease_expires_at is null)
  ),
  constraint capture_drafts_terminal_attention check (status = 'draft' or attention_status = 'unclaimed'),
  constraint capture_drafts_confirmation_evidence check (
    (status = 'confirmed' and confirmed_order_id is not null and fulfillment_channel is not null)
    or (status in ('draft','no_sale') and confirmed_order_id is null)
  ),
  constraint capture_drafts_timestamp_order check (updated_at >= created_at and recovery_expires_at > created_at)
);

-- One capture can create only one Order; retries must replay rather than relink it.
create unique index capture_drafts_confirmed_order_idx
  on app.capture_drafts (restaurant_id, branch_id, confirmed_order_id)
  where confirmed_order_id is not null;

-- Operational tray and abandoned-draft recovery, not customer searches or financial reports.
create index capture_drafts_work_tray_idx
  on app.capture_drafts (restaurant_id, branch_id, status, updated_at desc, id);
create index capture_drafts_recovery_idx
  on app.capture_drafts (restaurant_id, branch_id, recovery_expires_at, id)
  where status = 'draft';

alter table app.capture_drafts enable row level security;
alter table app.capture_drafts force row level security;
revoke all on app.capture_drafts from public, anon, authenticated, service_role, app_api;

comment on table app.capture_drafts is
  'Server-only commercial captures. Five-minute editing ownership and monthly recovery are distinct. No KDS/payment effect from draft/hold. Private CAS/audit/replay functions are required before use; customer snapshots arrive in a later slice.';

commit;
