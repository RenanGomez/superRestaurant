# Option B write-frontier inspection

Status: **requires human inspection**. A green common-gate run does not close
this gate. The repository does not yet contain production `apps/web`,
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

## Human checklist

The reviewer must inspect source and record each conclusion; automated test
output is supporting evidence, not approval.

- [ ] Public request DTOs accept an access token but no actor, supervisor,
  restaurant membership or branch authorization supplied by the client.
- [ ] Both critical services obtain the canonical actor through
  `auth.getUser(accessToken)` before any database mutation.
- [ ] Order, cash payment and cash refund mutations cross only their private
  PostgreSQL ports and functions; no Data API mutation path exists.
- [ ] `PUBLIC`, `anon`, `authenticated` and `service_role` cannot execute the
  private functions or write the protected tables directly.
- [ ] Database URL, service credentials and certificate path remain server-only
  environment inputs and are absent from committed client code and artifacts.
- [ ] Current repository search confirms that no production client application
  exists; repeat this checklist when web, mobile or KDS is added.
- [ ] Reviewer records name, date and ACCEPT/REJECT below.

Reviewer: _pending_

Date: _pending_

Decision: _pending_

Notes: _pending_

## Explicit blockers

- This is a cash-only spike; card/manual-terminal flows, cash-register shifts,
  fiscal documents and full order-total settlement remain outside it.
- A successful local or remote gate is still insufficient for ADR-010 GO until
  the human inspection and remaining ADR gates below are completed.

Verification command:

```text
pnpm --filter @super-restaurant/adr-010-spike test:option-b:gates
```
