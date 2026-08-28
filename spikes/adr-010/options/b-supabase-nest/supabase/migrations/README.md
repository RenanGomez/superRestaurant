# ADR-010 B/C migration series

This directory is the only Supabase CLI migration source for the disposable
ADR-010 B/C remote spike.

## Required order

1. `20260825000100_adr010_b_thin_slice.sql` creates the isolated option-B
   tables, tenant constraints, read RLS policies and private server functions.
2. `20260826000100_adr010_c_read_only_hardening.sql` reasserts the option-C
   read-only Data API boundary after every referenced object exists.
3. `20260827000100_adr010_b_bootstrap_rls_hardening.sql` enables and forces RLS
   on the server-only `bootstrap_users` marker, removes every policy from it and
   reasserts its zero-grant, fail-closed boundary.
4. `20260828000100_adr010_b_financial_write_boundary.sql` adds the private
   device-sequence cursor and the server-only cash payment/refund boundary.
5. `20260829000100_adr010_b_financial_conflict_fix.sql` adds the global
   `(device_id, local_sequence)` unique index and updates both financial RPC
   conflict targets without changing prior migration history.

Run `supabase link --project-ref <project-ref>` from
`spikes/adr-010/options/b-supabase-nest` (or pass that directory with
`--workdir`), then inspect `supabase migration list` before any `supabase db
push`. The link metadata is local under `supabase/.temp` and must never be
versioned. Do not copy these migrations into the repository-root `supabase`
directory: doing so would create a second migration authority.

## Exposed schemas

The only custom Data API schema is `adr010_b`. Keep `adr010_b_private` absent
from the remote project's Exposed schemas. The checked-in `config.toml`
reproduces this setting for local Supabase, but it does not replace checking the
remote dashboard before and after the push. `adr010_b` grants authenticated
clients `SELECT` only through an explicit allowlist of the nine RLS read
tables. `bootstrap_users` has forced RLS, no policies and no Data API grants;
it and future tables are not readable by Data API roles;
the private PostgreSQL connection remains the sole path to privileged functions.

## Safe manual rollback

There is deliberately no automatic down migration. Reverting a security
hardening by restoring client writes or function execution would be unsafe.
If either hardening migration causes a problem, fail closed: remove `adr010_b` from
the remote Exposed schemas and revoke `USAGE`/`SELECT` from `anon` and
`authenticated`. That disables the read probe without opening a mutation path.

Run the containment below only after confirming the isolated project identity:

```sql
begin;
revoke all privileges on all tables in schema adr010_b
  from anon, authenticated, service_role;
revoke all privileges on all sequences in schema adr010_b
  from anon, authenticated, service_role;
revoke all privileges on schema adr010_b from anon, authenticated;
revoke all privileges on schema adr010_b_private
  from public, anon, authenticated, service_role;
commit;
```

This is a service rollback, not a history rewrite: leave all migration records
applied and create a later corrective migration before re-enabling reads.

Because this is an isolated disposable spike, complete teardown is allowed only
after preserving required evidence and confirming the target project. Drop
`adr010_b_private` and then `adr010_b` with `CASCADE`, or delete the isolated
project. Never run that teardown against a shared or product database.
