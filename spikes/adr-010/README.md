# ADR-010 spike harness

This private workspace is the reusable, option-neutral Day 1 acceptance harness for ADR-010. It has deliberately minimal records, no production schema, no financial rules, no Auth implementation, no Prisma, and no Supabase integration.

`InMemoryReferenceAdapter` is only a control: it proves the harness can pass the executable gates, report the mandatory single-write-frontier inspection, and detect injected failures. It does **not** score options A/B/C and proves neither persistence nor a real backup, migration, authentication, or realtime service.

## Calendar and hard stop

- Day 1: common harness and deterministic fixtures (two restaurants, two branches each).
- Day 2: option A adapter/evidence.
- Day 3: option B and limited option C adapter/evidence.
- Day 4: induced failures, backup/restore, scoring, ADR draft.
- Hard stop: end of business Day 5. Do not extend the spike for UI, production infrastructure, or out-of-scope cases.

## Exact gates and scoring

Every option must pass all executable gates and complete the mandatory frontier inspection before it can be scored:

1. Isolation (executable): zero cross-restaurant or cross-branch reads/writes; rejected writes leave no target-scope artifact.
2. Transaction (executable): order + lines + snapshots + audit is atomic; induced failure leaves the exact artifact IDs unchanged.
3. Idempotency (executable): 20 concurrent re-sends return and persist exactly one business result for the idempotency key.
4. Single write frontier (human inspection): exactly one authorized path for Order, Payment, and CashMovement. The adapter must provide a document location and runnable verification command, but a self-reported path list is never a pass or score.
5. Realtime recovery (executable): after a deliberately omitted KDS delivery, a scoped cursor read recovers the event and does not leak it across restaurant/branch.
6. Auth/scope (executable): login membership scope is enforced and revocation is revalidated immediately before the critical write.
7. Migration (executable): migration from empty yields the thin slice, and a rerun preserves order/line/snapshot/audit counts and IDs.
8. Backup/restore (executable): the spike dataset restores the same order/line/snapshot/audit counts and identifiers.
9. Secrets (executable): no privileged credential reaches web/mobile; only the Supabase URL and publishable-key names are client-safe. Secret, legacy `anon`, legacy `service_role`, database, private-key and token names are rejected.
10. Reproducibility (executable): evidence names `pnpm-lock.yaml`, all frozen commands below, and a stable command-output location.

Only passing options are scored from 0–5. Weighted score is `sum((score / 5) × weight)`; GO needs at least 75/100 and every minimum below.

| Criterion | Weight | Minimum |
| --- | ---: | ---: |
| Security and isolation | 25 | 4/5 |
| Transactional domain and single frontier | 25 | 4/5 |
| Future offline compatibility | 15 | 3/5 |
| Operations, backup, observability | 15 | 3/5 |
| Productivity/maintainability | 10 | 3/5 |
| Cost and portability | 10 | 3/5 |

No score or GO/NO-GO is recorded here. The outcome belongs in `docs/adr/ADR-010.md` after real adapters provide evidence.

## Reproducible local commands

```sh
pnpm install --frozen-lockfile
pnpm --filter @super-restaurant/adr-010-spike lint
pnpm --filter @super-restaurant/adr-010-spike typecheck
pnpm --filter @super-restaurant/adr-010-spike test
pnpm --filter @super-restaurant/adr-010-spike build
```

An option adapter should be added without changing the common gates, then run through `runCommonGates(adapter, createFixtures())`. Its returned `pendingHumanInspection` always includes `single-write-frontier`; a reviewer must verify the adapter's documented evidence against the real write boundary before recording that gate as passed. Store command output, migration identifiers, backup/restore counts, and failure-injection evidence outside Git in `evidence/`.

## Environment names for later real options

These names intentionally have no values in this repository:

- `ADR010_OPTION`
- `ADR010_DATABASE_URL` (server/CI only)
- `ADR010_SUPABASE_URL`
- `ADR010_SUPABASE_PUBLISHABLE_KEY` (client-safe public key only)
- `ADR010_SUPABASE_SECRET_KEY` (server/CI only; never web/mobile, never `NEXT_PUBLIC_*`)

Option B/C requires an external Supabase project when their real adapters are evaluated. The project owner will need to create or authorize access to it, provide a project URL and publishable key for client checks, and configure the secret key only through the server/CI secret store. A secret key must never be committed, printed, or bundled in a client. `anon` and `service_role` are legacy JWT key names, deprecated by Supabase by the end of 2026; they are not an option for new project configuration.

## Current local option status

- A: PostgreSQL adapter and migration exist, but PostgreSQL was unavailable and Auth is a test double. Its runner is opt-in and always ends NO-GO/non-zero until real Auth exists.
- B: Nest derives the actor from `auth.getUser(token)` and invokes a private PostgreSQL function; retryable per-run Auth bootstrap and an opt-in RLS read/revocation probe exist. The common adapter and all remote evidence remain absent.
- C: publishable-key-only scoped reads exist; critical mutations are intentionally absent, so C is not eligible as the core backend.

All option tests in the normal suite are labelled `[preflight/non-evidence]`. They validate source/configuration boundaries only and confer no gate pass or score.
