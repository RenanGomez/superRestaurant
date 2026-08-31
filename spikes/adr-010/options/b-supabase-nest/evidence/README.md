# Option B remote schema audit

`remote-schema-audit.sql` is a catalog-only, read-only inspection of the
ADR-010 schemas in a linked Supabase project. It returns only named checks, booleans and
counts. It does not query business rows, emit object definitions, print role
credentials, or change persistent state.

Confirm the linked project identity before running it, and apply the ordered
B/C migration series first:

```sh
supabase db query --linked --file evidence/remote-schema-audit.sql
```

Run the command from `spikes/adr-010/options/b-supabase-nest`. Do not redirect
the output into a tracked file. If evidence must be retained, store the output
in the approved external evidence location after checking that every row has
`passed = true` and `observed_count = expected_count`.

The audit is intentionally scoped to `adr010_b`, `adr010_b_private`, their
catalog metadata, the three Data API roles, and the five expected migration
versions. Unrelated schemas and tables—including pre-existing objects in
`public`—are neither inspected nor required to be empty. This does **not**
authorize destructive gates, reset, cleanup, migration rollback, or fixture
loading against a non-isolated project; those operations retain their separate
isolated-project guard.

## Interpretation

- Every returned row is mandatory. Any `false`, missing row, SQL error, or
  unexpected count fails this structural audit; do not infer a partial pass.
- `all_expected_tables_rls_*` covers all ten tables, including the
  administrative `bootstrap_users` marker. That marker has no policy and its
  additional safety condition is the absence of direct or inherited `SELECT`
  for `anon`, `authenticated` and `service_role`.
- The policy check verifies one named permissive `SELECT` policy per read table,
  restricted to `authenticated`, with active-membership scope tokens. It also
  rejects unexpected policies in `adr010_b`.
- ACL checks compare exact grants for `anon`, `authenticated` and
  `service_role`. PostgreSQL owner privileges are intentionally outside this
  Data API boundary check.
- Private-function checks require exactly the eight expected signatures,
  `SECURITY DEFINER`, an explicitly empty `search_path`, and no `EXECUTE` grant
  to `PUBLIC` or any Data API role.
- Constraint checks cover composite tenant foreign keys, both scoped
  idempotency uniqueness constraints, and the `orders.request_payload` JSON
  object invariant.
- Migration history must contain each of the five expected B/C versions
  exactly once, including the fail-closed bootstrap RLS hardening and the
  global device-sequence conflict fix.
- Remote Auth evidence must rotate both session tokens, use the refreshed
  access token for a critical write, and reject the latest refresh token after
  global revocation; only boolean evidence may appear in the report.

## Separate manual evidence

Whether `adr010_b` is present and `adr010_b_private` is absent from Supabase
**Exposed schemas** is API configuration, not a PostgreSQL schema invariant.
This SQL deliberately does not claim to prove it. Capture that fact separately
from the project API settings without recording keys, URLs containing secrets,
or other credentials.

This structural audit does not replace remote Auth/RLS behavior tests,
concurrency/idempotency gates, rollback injection, backup/restore, or the human
write-frontier review described by `REMOTE_EVIDENCE.md`.
