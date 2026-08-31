# Option B write-frontier inspection

Status: **HUMAN ACCEPTED — Gate 4 demonstrated**. Reviewer Emmanuel accepted
the documented frontier on 2026-08-29. A green common-gate run did not close
this gate by itself. The repository does not yet contain production `apps/web`,
`apps/mobile` or `apps/kds` clients, so this review covers the spike's server
boundary and must be repeated when those clients are introduced.

## Implemented critical paths

`SupabaseAdr010CriticalOrderService.createOrder` accepts an access token but no
actor ID. `SupabaseAuthPrincipalVerifier.verifyAccessToken` calls Supabase
`auth.getUser(accessToken)` and derives the actor from the returned user. The
service then calls `SupabaseCriticalOrderPostgresPort.createOrder`, whose only
critical mutation is the private PostgreSQL function
`adr010_b_private.adr010_b_create_order(jsonb)`.

The Data API roles have no write or private-schema execution grants. Search the
web, mobile and KDS sources before accepting this evidence; they must not import
the private port or possess `ADR010_DATABASE_URL` or a secret key.

`SupabaseAdr010CriticalFinancialService` applies the identical boundary to
cash Payment and refund compensation. `createCashPayment` and
`refundCashPayment` accept a bearer token but no actor ID; after
`auth.getUser(accessToken)`, their PostgreSQL port invokes only
`adr010_b_private.adr010_b_create_cash_payment(jsonb)` or
`adr010_b_private.adr010_b_refund_cash_payment(jsonb)`. Each private function
revalidates the active Restaurant/Branch membership, binds idempotency to the
canonical actor/scope/payload, creates its CashMovement and audit row in the
same transaction, and stores minor units in `bigint` plus ISO currency.

Payment, Refund, CashMovement and the financial audit ledger reject update and
delete. A refund is therefore a new immutable compensating `cash_refund`
movement, not an edit of the original cash payment.

## Evidence map

| Concern | Source of truth |
| --- | --- |
| Order request boundary and verified principal | `src/nest-boundary.ts` → `SupabaseAdr010CriticalOrderService`; `src/auth-principal.ts` → `SupabaseAuthPrincipalVerifier` |
| Financial request boundary and verified principal | `src/nest-boundary.ts` → `SupabaseAdr010CriticalFinancialService`; `src/auth-principal.ts` → `SupabaseAuthPrincipalVerifier` |
| Only server-side critical SQL calls | `src/adapter.ts` → `SupabaseCriticalOrderPostgresPort`, `SupabaseCriticalFinancialPostgresPort` |
| Private Order function and grant revocation | `supabase/migrations/20260825000100_adr010_b_thin_slice.sql` |
| Private Payment/refund functions and immutable ledgers | `supabase/migrations/20260828000100_adr010_b_financial_write_boundary.sql`, `supabase/migrations/20260829000100_adr010_b_financial_conflict_fix.sql` |
| Fail-closed catalog verification | `evidence/remote-schema-audit.sql`, with local boundary regressions in `src/preflight.test.ts` and remote execution through `test:option-b:gates` |

## Technical pre-inspection — supporting evidence only

Inspected on 2026-08-29. This section shortens the human review but does not
replace it or pre-fill its decision.

- `src/nest-boundary.ts:24-57` exposes the Order request without `actorId` and
  derives the principal before calling the write port.
- `src/nest-boundary.ts:64-117` exposes cash payment/refund requests without a
  caller-authored actor or authorization decision. A refund carries a separate
  supervisor bearer token; both bearer tokens are independently verified before
  the server constructs `authorization.actorId`.
- `src/auth-principal.ts:26-53` uses `auth.getUser(accessToken)` and returns only
  the verified Supabase user UUID. It does not trust locally decoded claims.
- `src/adapter.ts:104-143` contains the three critical PostgreSQL calls. They
  invoke only `adr010_b_private.adr010_b_create_order`,
  `adr010_b_private.adr010_b_create_cash_payment` and
  `adr010_b_private.adr010_b_refund_cash_payment`.
- Repository search found the only Supabase Data API table calls in the option-B
  adapter at `src/adapter.ts:433-434` and `src/adapter.ts:498-500`; both are
  `.select(...)` reads. No `.insert(...)`, `.update(...)`, `.upsert(...)`,
  `.delete(...)` or `.rpc(...)` business-write call exists in tracked source.
- The final financial functions in
  `supabase/migrations/20260829000100_adr010_b_financial_conflict_fix.sql:6-133`
  revalidate actor membership; refunds also revalidate the independently
  verified supervisor as an active `owner` or `manager` in the exact
  Restaurant/Branch scope.
- The migrations revoke table writes and private-function execution from
  `PUBLIC`, `anon`, `authenticated` and `service_role`. The remote schema audit
  subsequently passed all 27 catalog assertions on the isolated project.
- There is currently no production `apps` directory. Database URL, secret key
  and certificate configuration occurs only in the server/spike boundary,
  fixtures, verification utilities and documentation; no client artifact exists
  that could receive them.

Technical conclusion: no bypass of the documented critical write frontier was
found in the current business-write path. This conclusion must be revisited
when the first production client or definitive API module is introduced.

### Administrative spike-only exceptions

`SupabaseNestAdr010Adapter.resetToEmpty()` and `restore()` deliberately issue
direct PostgreSQL deletes/inserts for destructive test cleanup and Gate 8
logical restore. They do not pass through the three business functions because
they reconstruct or remove the complete test dataset. These operations:

- exist only in the remote-gate adapter and satisfy the common spike contract;
- use the same private server PostgreSQL connection, never Supabase Data API;
- are not exported as Nest services or reachable from a production client;
- are guarded by the isolated-project/opt-in requirements of the remote runner;
- must not be registered in a production dependency graph or exposed through an
  application endpoint.

They are administrative exceptions outside the normal Order/Payment/Refund
frontier, not alternative business-write routes.

### Conditions before production code is introduced

- Define controller DTOs that allowlist production fields and omit all
  `induceFailureAfter*` hooks used by the spike's atomicity tests.
- Keep the spike adapter, restore/reset utilities, PostgreSQL ports, database URL
  and secret key out of web/mobile/KDS bundles and public package entry points.
- Bind the definitive Nest module only to reviewed PostgreSQL port
  implementations; repeat this Gate 4 inspection across the real controllers,
  module graph and built client artifacts.

## Human checklist

The reviewer must inspect source and record each conclusion; automated test
output is supporting evidence, not approval.

- [x] Public request DTOs accept bearer tokens and requested scope, but no actor,
  supervisor identity, membership assertion or authorization decision authored
  by the client. Refund approval uses a separately verified supervisor token.
- [x] Both critical services obtain the canonical actor through
  `auth.getUser(accessToken)` before any database mutation.
- [x] Normal Order, cash payment and cash refund business mutations cross only
  their private PostgreSQL ports and functions; no Data API mutation path
  exists. Gate-only restore/reset are accepted explicitly as private,
  non-client-reachable administrative exceptions.
- [x] `PUBLIC`, `anon`, `authenticated` and `service_role` cannot execute the
  private functions or write the protected tables directly.
- [x] Database URL, service credentials and certificate path remain server-only
  environment inputs and are absent from committed client code and artifacts.
- [x] Current repository search confirms that no production client application
  exists; repeat this checklist when web, mobile or KDS is added.
- [x] Reviewer records name, date and ACCEPT/REJECT below.

Reviewer: Emmanuel

Date: 2026-08-29

Decision: **ACCEPT**

Notes: Accepted explicitly in the supervised implementation thread after the
technical and independent inspections found no business-write bypass. The
acceptance includes the documented private restore/reset exceptions and the
mandatory reinspection conditions before production controllers or clients are
introduced.

## Explicit blockers

- This is a cash-only spike; card/manual-terminal flows, cash-register shifts,
  fiscal documents and full order-total settlement remain outside it.
- All ten spike gates are demonstrated. The weighted scoring and final human
  ADR-010 GO/NO-GO decision remain separate from this Gate 4 acceptance.

Verification command:

```text
pnpm --filter @super-restaurant/adr-010-spike test:option-b:gates
```
