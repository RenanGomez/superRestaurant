export interface BackoffInput {
  /** Retry number being scheduled, starting at 1. */
  readonly retryCount: number;
  readonly eventId: string;
}

export interface BackoffPolicy {
  /** After this many retries a retry_wait event goes to manual_review. */
  readonly maxRetries: number;
  nextDelayMs(input: BackoffInput): number;
}

export interface ExponentialBackoffOptions {
  readonly baseMs?: number;
  readonly maxMs?: number;
  readonly maxRetries?: number;
  /** Fraction of the delay that jitter may remove, in [0, 1]. */
  readonly jitterRatio?: number;
  /** Injectable jitter source returning a value in [0, 1) for a stable seed. */
  readonly jitter?: (seed: string) => number;
}

/** Deterministic FNV-1a hash mapped to [0, 1): the same event/retry always gets the same jitter. */
export function deterministicJitter(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x1_0000_0000;
}

export function createExponentialBackoff(options: ExponentialBackoffOptions = {}): BackoffPolicy {
  const baseMs = options.baseMs ?? 1_000;
  const maxMs = options.maxMs ?? 300_000;
  const maxRetries = options.maxRetries ?? 8;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const jitter = options.jitter ?? deterministicJitter;
  if (!Number.isSafeInteger(baseMs) || baseMs < 1 || !Number.isSafeInteger(maxMs) || maxMs < baseMs) {
    throw new RangeError("baseMs and maxMs must be positive integers with maxMs >= baseMs");
  }
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 1) throw new RangeError("maxRetries must be a positive integer");
  if (!(jitterRatio >= 0 && jitterRatio <= 1)) throw new RangeError("jitterRatio must be within [0, 1]");
  return Object.freeze({
    maxRetries,
    nextDelayMs({ retryCount, eventId }: BackoffInput): number {
      const exponent = Math.min(Math.max(retryCount - 1, 0), 30);
      const ceiling = Math.min(maxMs, baseMs * 2 ** exponent);
      const factor = jitter(`${eventId}:${retryCount}`);
      return Math.max(1, Math.floor(ceiling * (1 - jitterRatio * factor)));
    },
  });
}
