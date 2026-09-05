/**
 * Application lifecycle, expressed without React Native so the rules can be
 * tested directly. The runtime adapter lives in `src/ui/app-state-lifecycle.ts`.
 */
export type MobileAppStatus = "active" | "background" | "inactive" | "unknown";

/** Source of lifecycle transitions; the UI never talks to `AppState` directly. */
export interface MobileLifecyclePort {
  readonly subscribe: (handler: (status: MobileAppStatus) => void) => () => void;
}

/** Normalizes the platform value, defaulting to `unknown` instead of guessing. */
export function toMobileAppStatus(value: unknown): MobileAppStatus {
  return value === "active" || value === "background" || value === "inactive" ? value : "unknown";
}

/**
 * True only for a real return to the foreground. Repeated `active` events — iOS
 * emits several around notification centre, control centre and app switching —
 * never trigger a second revalidation, and neither does an `unknown` origin,
 * because the app already read fresh data when it mounted.
 */
export function shouldRevalidateOnForeground(previous: MobileAppStatus, next: MobileAppStatus): boolean {
  return next === "active" && (previous === "background" || previous === "inactive");
}

/**
 * The Supabase token ticker only runs while the app is in the foreground: a
 * background timer would be unreliable on device and would keep refreshing a
 * session nobody is using.
 */
export function shouldRunAutoRefresh(status: MobileAppStatus): boolean {
  return status === "active";
}

/** What one lifecycle transition must cause, decided without side effects. */
export interface MobileLifecycleEffects {
  /** Whether the in-memory token ticker must run after this transition. */
  readonly autoRefresh: "start" | "stop";
  /** Whether session and scope must be revalidated against the server. */
  readonly revalidate: boolean;
}

/**
 * The whole foreground policy in one pure function, so the sequence
 * start → pause → resume → repeated resume can be tested without a device.
 */
export function lifecycleEffects(previous: MobileAppStatus, next: MobileAppStatus): MobileLifecycleEffects {
  return Object.freeze({
    autoRefresh: shouldRunAutoRefresh(next) ? "start" : "stop",
    revalidate: shouldRevalidateOnForeground(previous, next),
  });
}
