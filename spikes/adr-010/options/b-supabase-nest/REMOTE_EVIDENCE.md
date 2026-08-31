# Option B remote evidence record

This file defines the evidence expected from an explicitly authorized run; it
is not evidence that the run occurred.

The runner requires `ADR010_RUN_SUPABASE=1`, all server/client credentials and
`ADR010_CONFIRM_ISOLATED_PROJECT` equal to the project ref in the Supabase URL.
It also rejects a database URL that does not identify that same project.
The match is structural (official direct host or pooler plus exact username),
not a substring search.

Before running, apply the five-migration ordered series under
`supabase/migrations`. The runner then:

1. verifies all five migration versions, forced RLS, the private functions and
   deterministic structural rows;
2. resets only disposable option-B business artifacts;
3. creates real disposable Auth users and publishable-key sessions;
4. rotates a refresh token, proves the new access token reaches a critical
   write, then verifies the latest refresh token is rejected after global
   revocation;
5. runs every common gate through Nest/Auth and private PostgreSQL;
6. emits a JSON report containing boolean refresh evidence but no credentials;
   and
7. removes business artifacts, memberships and disposable Auth users.

For a fresh-project/CI migration exercise, link the already-created isolated
project outside this repository, set both `ADR010_RUN_SUPABASE=1` and
`ADR010_RUN_SUPABASE_FRESH_PUSH=1`, and run
`test:option-b:fresh-push`. The script checks that the ADR-010 schemas and
the five migration versions are absent, runs
`supabase db push --linked --dry-run --yes`, and stops there by default.
Set `ADR010_APPLY_FRESH_REMOTE_PUSH=1` only after reviewing that dry-run.
It never creates projects or accounts and never prints secrets.

Capture the dry-run output, the applied migration list, the catalog-only audit,
and the runner JSON outside Git. A failed push is contained by the documented
fail-closed rollback: revoke the exposed schema grants, preserve migration
history, and use a later corrective migration after review; never rewrite
applied history.

Save the timestamped command result in the approved external evidence store.
Do not commit `.env`, access tokens, refresh tokens, database URLs, secret keys,
user emails or raw provider errors. A successful report remains
remote capability evidence rather than human approval by itself. Emmanuel
accepted Gate 4 on 2026-08-29 and Gate 7 was demonstrated separately by the
guarded five-migration push into the second fresh project, so the versioned
eligibility metadata now records `eligibleForAdr010Go: true`. The earlier raw
remote report predates that human decision and remains valid for the capabilities
it actually executed; physical recovery remains non-blocking operational
evidence.
Payment, Refund, CashMovement and refresh rotation/revocation are exercised by
the remote runner. The fresh-project runner separately proved application of
the five-migration series; neither runner proves physical disaster recovery.
