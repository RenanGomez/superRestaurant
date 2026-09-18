export type LoginErrorCode = "invalid_credentials" | "service_unavailable";

export function classifyLoginError(error: unknown): LoginErrorCode {
  try {
    if (typeof error === "object" && error !== null) {
      const candidate = error as { readonly name?: unknown; readonly status?: unknown };
      if (candidate.name === "AuthRetryableFetchError" || candidate.status === 0) {
        return "service_unavailable";
      }
    }
  } catch {
    return "service_unavailable";
  }
  return "invalid_credentials";
}
