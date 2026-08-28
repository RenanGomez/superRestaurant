export { SupabaseCriticalOrderPostgresPort, SupabaseCriticalFinancialPostgresPort, SupabaseNestAdr010Adapter } from "./adapter.js";
export type { CriticalOrderWritePort, VerifiedSupabaseServerCreateOrderCommand } from "./adapter.js";
export type { CashPaymentRecord, CashRefundRecord, CriticalFinancialWritePort, SupabaseCreateCashPaymentRequest, SupabaseCreateCashRefundRequest, VerifiedCashPaymentCommand, VerifiedCashRefundCommand } from "./financial-contract.js";
export { runOptionBFinancialGates } from "./financial-gates.js";
export { SupabaseAccessTokenRejectedError, SupabaseAuthPrincipalVerifier } from "./auth-principal.js";
export type { AuthenticatedSupabasePrincipal, AuthPrincipalVerifierPort } from "./auth-principal.js";
export {
  adr010BAuthBootstrapPlan,
  Adr010BAuthBootstrapError,
  bootstrapAdr010BAuth,
  cleanupAdr010BAuthBootstrap,
  withAdr010BAuthenticatedFixtures,
} from "./auth-bootstrap.js";
export type { Adr010BAuthenticatedFixture, Adr010BAuthenticatedFixtureContext, Adr010BAuthBootstrapPlan, Adr010BDisposableUser } from "./auth-bootstrap.js";
export { readSupabaseAdr010Config, requireSupabaseDestructiveServerOptIn, requireSupabaseGateIntegrationOptIn, requireSupabaseIntegrationOptIn, SupabaseAdr010ConfigurationError } from "./config.js";
export {
  SUPABASE_ADR010_AUTH_PRINCIPAL_VERIFIER,
  SUPABASE_ADR010_CRITICAL_FINANCIAL_WRITE_PORT,
  SUPABASE_ADR010_CRITICAL_WRITE_PORT,
  SupabaseAdr010CriticalFinancialService,
  SupabaseAdr010CriticalOrderService,
  SupabaseNestAdr010Module,
} from "./nest-boundary.js";
export type { SupabaseCreateOrderRequest } from "./nest-boundary.js";
