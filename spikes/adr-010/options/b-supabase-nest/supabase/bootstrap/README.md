# Remote Auth bootstrap (server-only, still non-evidence)

`src/auth-bootstrap.ts` is the only bootstrap implementation. It uses the
modern `ADR010_SUPABASE_SECRET_KEY` with the Supabase Admin API to create two
disposable users, retains their generated credentials only in memory, captures
their returned UUIDs, and uses the server-only PostgreSQL connection to add
deterministic fixture memberships. The Supabase secret is not a Data API write
credential in this spike:

| User fixture | Restaurant | Branches | Role |
|---|---|---|---|
| `amber` | Amber | Amber North, Amber South | cashier |
| `cobalt` | Cobalt | Cobalt North, Cobalt South | cashier |

The helper returns only the Auth user UUIDs and fixture scope; it never returns
or prints generated passwords, emails, API keys, sessions, or configuration.
Do not call it from web, mobile, KDS, SQL Editor, or a product endpoint.

## Remote-only commands

After migration and structural fixtures are applied to the isolated project,
run either command only from a trusted shell with `ADR010_RUN_SUPABASE=1` plus
the URL, modern secret, TLS-enabled `ADR010_DATABASE_URL`, and
`ADR010_CONFIRM_ISOLATED_PROJECT` exactly matching the hosted project ref in
its process environment:

```sh
pnpm --filter @super-restaurant/adr-010-spike run auth:bootstrap
pnpm --filter @super-restaurant/adr-010-spike run auth:cleanup
```

The bootstrap command intentionally has no success payload. The cleanup command
first calls `adr010_b_private.adr010_b_cleanup_auth_bootstrap`, which deletes only rows
owned by tracked bootstrap users in FK-safe order: KDS events, audit rows,
snapshots, lines, idempotency rows, orders, and memberships. It leaves a
`bootstrap_users` marker referencing `auth.users` with `ON DELETE CASCADE`. Each
run uses a random `bootstrap_run_id`; cleanup receives only that run's Auth IDs,
so concurrent bootstrap attempts cannot clean one another's users.
The Admin API then deletes each Auth user; that cascade removes the marker.

The business/audit identity FKs remain `ON DELETE RESTRICT`. If an Admin API
deletion fails, the marker remains after the artifacts are gone, so rerunning
cleanup is safe and does not target untracked users. Do not delete Auth users
directly while evidence exists.

This setup is not an Auth/scope gate. NestJS verifies the access token and
derives the actor from the verified Supabase user; remote JWT, membership and
revocation evidence is still pending. Isolation, revocation,
transaction, idempotency, realtime, backup/restore, and human frontier review
remain unproven until their separate remote gates execute.
