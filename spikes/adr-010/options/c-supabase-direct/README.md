# ADR-010 option C: direct Supabase reads (limited evaluation)

This directory evaluates only a public-client read path over option B's isolated `adr010_b` schema. The client is constructed exclusively from `ADR010_SUPABASE_URL` and a modern `ADR010_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`). It exposes scoped reads, UUID-keyset pagination for orders, and monotonic-cursor recovery reads for KDS events. It does not expose its underlying SDK client, `createOrder`, Payment, CashMovement, generic CRUD mutations, or `Adr010Adapter`.

RLS is the authorization and tenant-isolation authority. The explicit restaurant/branch filters in this client only narrow a requested result for usability and defense in depth; they cannot prove or replace RLS. Any row returned outside the requested scope is rejected as a safety tripwire.

Order UUID keyset pagination is deterministic ordering only. It is **not** a causal/version cursor, is not evidence of realtime recovery, and can miss concurrently inserted random UUIDs behind the current page boundary. Only `kds_events.cursor`, a database-generated monotonic sequence, is used for KDS recovery.

## Decision boundary

Option C can receive a limited GO for reads or explicitly allowed non-financial CRUD after its applicable evidence passes. Under the current plan it is a **NO-GO as the primary core/financial backend**: web/mobile clients must not write Order, Payment, or CashMovement. Those operations require one versioned transactional boundary; their invariants must not be duplicated between SQL and `packages/domain`.

The versioned hardening migration at `../b-supabase-nest/supabase/migrations/20260826000100_adr010_c_read_only_hardening.sql` only revokes generic client writes over option B's disposable schema. The follow-up `20260827000100_adr010_b_bootstrap_rls_hardening.sql` forces RLS and default-deny behavior on the administrative bootstrap marker. They follow the option-B thin-slice migration, are not product migrations, and create no alternative write RPC. Keeping the full ordered series in one migration directory prevents a second remote migration authority.

## Remote evidence (opt-in and non-scoring)

The remote project must expose the custom `adr010_b` schema in Supabase **API settings → Exposed schemas**; otherwise PostgREST cannot address it. This expands the Data API surface and is a deliberate security/operations requirement, not positive evidence. If the exposed schema cannot remain RLS-authoritative, read-only for public clients, and restricted to the spike objects, option C is NO-GO even for the limited read use. Apply the ordered B/C migration series from option B's directory. Never expose a secret/service-role key, legacy `anon`/`service_role` JWT, database URL, or privileged SDK client to this runtime.

Run the connectivity/read-only probe only with `ADR010_RUN_SUPABASE=1`, public configuration, and explicit restaurant/branch IDs:

```text
pnpm --filter @super-restaurant/adr-010-spike probe:option-c:read
```

The runner is a **preflight/non-evidence probe**: it executes two reads and never runs common gates or scoring. Anonymous empty results demonstrate connectivity only, not correct tenant isolation. RLS evidence requires real Supabase Auth users, memberships in the 2×2 fixtures, positive reads in their own scope, negative reads across scopes, and a revoked membership retest. KDS recovery evidence additionally requires deliberately omitting a delivery and replaying every missing event from the monotonic cursor without cross-scope rows. Migration order, exposed schemas and the fail-closed manual rollback are documented in `../b-supabase-nest/supabase/migrations/README.md`. Until those identities and results exist, isolation, Auth/revocation, migrations, backup/restore, realtime recovery, overall gates, and score remain pending.

The normal test suite is preflight/non-evidence: it proves only that the scaffold stays public-key-only and mutation-free.
