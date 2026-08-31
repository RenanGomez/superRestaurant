# ADR-010 — Option B evidence and scoring eligibility

Status: **SCORED 75/100 — GO ACCEPTED / OPTION B SELECTED**

All ten common gates are now demonstrated. Emmanuel accepted Gate 4 on
2026-08-29 after the documented technical and independent frontier inspections.
The score below is therefore permitted by the master plan. Emmanuel accepted
the GO recommendation and selected option B on 2026-08-29.

## Gate status

| # | Gate | Status | Authoritative evidence |
|---:|---|---|---|
| 1 | Isolation | DEMONSTRATED | Remote common gates plus the authenticated 2×2 RLS probe reject cross-restaurant and cross-branch reads/writes. |
| 2 | Transaction | DEMONSTRATED | Remote induced failures leave no partial Order or financial artifacts; Payment/Refund/CashMovement and audit append atomically. |
| 3 | Idempotency | DEMONSTRATED | Twenty concurrent submissions converge on one Order, Payment and Refund; canonical payload reuse is enforced. |
| 4 | Single write frontier | DEMONSTRATED — HUMAN ACCEPT | Emmanuel accepted `WRITE_FRONTIER.md` on 2026-08-29 after the main and independent audits found no business-write bypass and documented the private restore/reset exceptions. |
| 5 | Recoverable realtime | DEMONSTRATED | Remote KDS recovery replays missed events by monotonic cursor without crossing scope. |
| 6 | Auth/scope | DEMONSTRATED | Supabase Auth principal derivation, memberships, revocation, refresh rotation and post-revocation rejection passed remotely. |
| 7 | Migrations | DEMONSTRATED | The guarded runner verified a second empty project, dry-ran exactly five ordered migrations, revalidated before apply, pushed all five and confirmed the exact remote history; the post-push audit passed 27/27 and `db lint` reported no errors. |
| 8 | Backup/restore | DEMONSTRATED | Remote logical backup/reset/restore retained identifiers, snapshots, ledger and device cursor; non-empty restore is rejected. |
| 9 | Secrets | DEMONSTRATED | Client surface is publishable-key-only; private schema/functions and financial writes have no Data API-role access. |
| 10 | Reproducibility | DEMONSTRATED | Frozen lockfile, opt-in commands, exact project guards and repeatable remote runners are present and executed. |

## Recorded remote evidence

- isolated project: `ndblkcmdgpxsxylacutx`;
- second fresh project: `zwbyiefqeujstyzysydn`, verified empty before the guarded five-migration push;
- five ordered migrations applied exactly once;
- catalog audit: 27/27 checks passed;
- Supabase database lint: no schema errors;
- authenticated RLS probe: passed;
- option-B runner: 15 remote capabilities verified;
- refresh evidence: both tokens rotated, refreshed access completed a critical
  write, and the current refresh was rejected after global revocation;
- final cleanup: zero Auth users and zero operational, financial or device
  cursor rows; only the deterministic 2-restaurant/4-branch structure remains;
- the downloaded Supabase Root 2021 CA was parsed as a CA certificate and a
  read-only pooler probe completed with encryption, certificate authorization,
  hostname validation and no authorization error.

The remote command output must be retained in the approved external evidence
store. Tokens, user emails, database URLs, passwords and provider secrets must
never be copied into this file or committed.

## Scoring

| Criterion | Score | Weight | Contribution | Deduction rationale |
|---|---:|---:|---:|---|
| Security and isolation | 4/5 | 25 | 20 | Strong remote Auth/RLS/grant evidence; no 5 because production controllers and client bundles do not yet exist. |
| Transactional domain and single frontier | 4/5 | 25 | 20 | Atomic/idempotent private writes and accepted Gate 4; no 5 because the thin slice is cash-only and omits full settlement/register/card flows. |
| Future offline compatibility | 4/5 | 15 | 12 | Device sequence, idempotency, compensation and scoped cursor recovery align with the neutral sync contract; no 5 because no durable outbox/sync engine exists. |
| Operations, backup and observability | 3/5 | 15 | 9 | Fresh migrations, lint, TLS and logical restore passed; physical restore, measured RPO/RTO, telemetry and alerts remain pending. |
| Productivity and maintainability | 4/5 | 10 | 8 | Managed Auth/PostgreSQL, one migration authority and repeatable pinned runners reduce custom work; definitive apps/deployment are unmeasured. |
| Cost and portability | 3/5 | 10 | 6 | PostgreSQL transport, migrations and logical export are portable; Supabase Auth/RLS coupling, free-tier limits and absent load/cost exit tests constrain the score. |
| **Total** |  | **100** | **75/100** | Every criterion minimum is met; there is no margin above the GO threshold. |

Calculation: `20 + 20 + 12 + 9 + 8 + 6 = 75`. GO requires all gates, every
minimum and at least 75/100; option B meets those conditions exactly.

## Evidence and constraints behind the score

This matrix records the demonstrated facts and unproven production concerns
used to assign the score above.

| Criterion | Demonstrated evidence | Not yet demonstrated / scoring constraint |
|---|---|---|
| Security and isolation | Auth identities are derived with `auth.getUser`; active Restaurant/Branch membership is revalidated in private SQL; 2×2 cross-scope read/write probes, revocation, 27/27 catalog checks and Data API grant denial passed remotely. | Production controllers and built client bundles do not exist, so their DTO allowlists and secret exclusion must be re-audited when introduced. |
| Transactional domain and single frontier | Order, cash Payment, Refund, CashMovement and audit writes are atomic, idempotent under 20 concurrent retries and routed through Nest plus three private PostgreSQL business functions. The technical and independent inspections found no business bypass, and Gate 4 was accepted. | Restore/reset are explicit private administrative exceptions; card, register-shift and full settlement flows are outside the spike. |
| Future offline compatibility | Global device sequence, idempotency binding, immutable financial compensation, scoped KDS cursor recovery and refresh/revocation behavior are demonstrated. The neutral offline contract already defines outbox and conflict constraints. | No durable client outbox, delayed-client schema migration, sync engine or two-device offline reconciliation is implemented in this spike. |
| Operations, backup and observability | Five migrations rebuild a fresh project; exact history, 27/27 audit, `db lint`, TLS `verify-full`, deterministic cleanup and logical backup/empty-target restore passed. | Physical restore, measured RPO/RTO, production telemetry, alerts and operational ownership remain pre-production requirements. |
| Productivity and maintainability | Managed Auth/PostgreSQL, one migration authority, frozen pnpm workflow, pinned Supabase CLI and repeatable opt-in runners reduce custom infrastructure and implicit setup. | No definitive Nest app, Prisma mapping, deployment pipeline or team maintenance measurement exists yet. |
| Cost and portability | Critical data remains in PostgreSQL; business writes use standard server PostgreSQL transport, migrations are versioned, and logical export/restore is demonstrated. | Supabase Auth/RLS/configuration create provider coupling; free-tier project limits were encountered, and no production load/cost or provider-exit exercise has been measured. |

The score cites this matrix and applies explicit deductions for every unproven
area. A future evidence change must trigger rescoring rather than silently
retaining 75/100.

## Remaining implementation evidence

1. Production web/mobile/KDS applications do not yet exist; Gate 4 must be repeated
   across their imports, DTOs and authorized mutation paths when introduced.
2. Physical disaster recovery and its RPO/RTO remain an operational production
   requirement distinct from the spike's demonstrated logical dataset restore.
