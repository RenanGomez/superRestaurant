/** The tab must have been hidden at least this long before coming back counts as a "return". */
export const MIN_HIDDEN_MS = 15_000;
/** Minimum spacing between two revalidations, whatever the tab does. */
export const MIN_INTERVAL_MS = 30_000;

/**
 * Decides whether regaining visibility should re-read server data. `hiddenAt` is when the tab was
 * last hidden (null if unknown), `lastRunAt` when data was last revalidated (null if never).
 */
export function shouldRevalidateOnReturn(hiddenAt: number | null, lastRunAt: number | null, now: number): boolean {
  if (hiddenAt === null || now - hiddenAt < MIN_HIDDEN_MS) return false;
  return lastRunAt === null || now - lastRunAt >= MIN_INTERVAL_MS;
}

/**
 * Subscribes to tab visibility and calls `onReturn` at most once per return (visibilitychange only,
 * not `focus`, which fires together with it). Returns the unsubscribe function.
 */
export function watchTabReturn(onReturn: () => void, now: () => number = Date.now): () => void {
  let hiddenAt: number | null = null;
  let lastRunAt: number | null = null;
  function onChange(): void {
    if (document.visibilityState === "hidden") { hiddenAt = now(); return; }
    const current = now();
    if (!shouldRevalidateOnReturn(hiddenAt, lastRunAt, current)) return;
    hiddenAt = null;
    lastRunAt = current;
    onReturn();
  }
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
