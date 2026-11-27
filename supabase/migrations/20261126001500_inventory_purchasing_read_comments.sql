begin;

-- The three purchasing reads accept `catalog.read` since 20261126001400 (owner, admin, manager,
-- supervisor, cashier, waiter, viewer, auditor; kitchen and courier still fail with 42501), but their
-- catalog comments still said "manage-only". This migration only updates `pg_description`: no function
-- body, grant, policy or index changes, so it is safe to apply to a database that already has the
-- functions.
comment on function app_private.list_inventory_suppliers(uuid, uuid, boolean) is
  'Restaurant-scoped supplier read for callers with catalog.read (owner, admin, manager, supervisor, cashier, waiter, viewer, auditor); inactive rows are opt-in.';
comment on function app_private.list_inventory_purchase_orders(uuid, uuid, uuid, text, integer) is
  'Branch-scoped purchase-order read for callers with catalog.read, with the line total in integer minor units.';
comment on function app_private.read_inventory_purchase_order(uuid, uuid) is
  'Purchase-order detail with its lines and item names, readable with catalog.read; writes stay manage-only.';

commit;
