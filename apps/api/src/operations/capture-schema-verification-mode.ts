export const CAPTURE_VERIFICATION_MODES = Object.freeze(["local", "remote"] as const);
export type CaptureVerificationMode = (typeof CAPTURE_VERIFICATION_MODES)[number];

/**
 * Exactly one argument is accepted: `--local-disposable-only` runs the historical verifier on a
 * brand-new disposable local cluster; `--remote-only` runs it rollback-only against the configured
 * remote. Anything else (no argument, extra arguments, unknown flags) is rejected so a typo can
 * never silently hit the remote database.
 */
export function parseCaptureVerificationMode(argv: readonly string[]): CaptureVerificationMode | undefined {
  if (argv.length !== 1) return undefined;
  if (argv[0] === "--local-disposable-only") return "local";
  if (argv[0] === "--remote-only") return "remote";
  return undefined;
}
