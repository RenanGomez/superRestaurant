# ADR-010 — Option B evidence and scoring eligibility

Status: **NO OFFICIAL SCORE / GO PENDING**

The master plan permits scoring only after all ten common gates pass. Option B
has remote evidence for gates 1, 2, 3, 5, 6, 8, 9 and 10. Gate 4 requires a
human inspection and gate 7 still lacks a complete five-migration application
against a second fresh project or CI environment. Therefore this document does
not assign provisional points or imply a GO decision.

## Gate status

| # | Gate | Status | Authoritative evidence |
|---:|---|---|---|
| 1 | Isolation | DEMONSTRATED | Remote common gates plus the authenticated 2×2 RLS probe reject cross-restaurant and cross-branch reads/writes. |
| 2 | Transaction | DEMONSTRATED | Remote induced failures leave no partial Order or financial artifacts; Payment/Refund/CashMovement and audit append atomically. |
| 3 | Idempotency | DEMONSTRATED | Twenty concurrent submissions converge on one Order, Payment and Refund; canonical payload reuse is enforced. |
| 4 | Single write frontier | PENDING HUMAN | `WRITE_FRONTIER.md` declares the paths and automated checks constrain grants/imports, but the plan requires human source inspection. |
| 5 | Recoverable realtime | DEMONSTRATED | Remote KDS recovery replays missed events by monotonic cursor without crossing scope. |
| 6 | Auth/scope | DEMONSTRATED | Supabase Auth principal derivation, memberships, revocation, refresh rotation and post-revocation rejection passed remotely. |
| 7 | Migrations | PARTIAL | Five versions are applied and audited 27/27 without data loss; a complete push into another empty remote project/CI remains pending. |
| 8 | Backup/restore | DEMONSTRATED | Remote logical backup/reset/restore retained identifiers, snapshots, ledger and device cursor; non-empty restore is rejected. |
| 9 | Secrets | DEMONSTRATED | Client surface is publishable-key-only; private schema/functions and financial writes have no Data API-role access. |
| 10 | Reproducibility | DEMONSTRATED | Frozen lockfile, opt-in commands, exact project guards and repeatable remote runners are present and executed. |

## Recorded remote evidence

- isolated project: `ndblkcmdgpxsxylacutx`;
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

## Scoring rule once eligible

| Criterion | Weight | Minimum |
|---|---:|---:|
| Security and isolation | 25 | 4/5 |
| Transactional domain and single frontier | 25 | 4/5 |
| Future offline compatibility | 15 | 3/5 |
| Operations, backup and observability | 15 | 3/5 |
| Productivity and maintainability | 10 | 3/5 |
| Cost and portability | 10 | 3/5 |

Weighted score: `sum((score / 5) × weight)`. GO requires all gates, every
minimum and at least 75/100.

## Remaining decision evidence

1. A human reviews `WRITE_FRONTIER.md` and the actual web/mobile/KDS/server
   imports and authorized mutation paths.
2. The five migrations are applied by the guarded fresh-project runner against
   a separately authorized empty Supabase project or CI environment.
3. Physical disaster recovery and its RPO/RTO remain an operational production
   requirement distinct from the spike's demonstrated logical dataset restore.
