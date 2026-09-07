/**
 * The stable identity of this installation, which every Order audit record
 * carries as `deviceId`.
 *
 * It is a UUID this app mints once and keeps in the platform keystore under a
 * versioned key. Nothing derived from the operator or the session may stand in
 * for it: an email or a token identifies a person and changes when they sign in
 * again, a hardware or advertising id is not ours to read and is shared with
 * everything else on the device, and a constant would make one installation
 * indistinguishable from every other. The audit trail needs to say *which
 * device* wrote a line, for as long as that device exists.
 *
 * It fails closed, in both directions:
 *
 * - if the keystore is unavailable, unreadable or refuses to write, no identity
 *   is invented and no Order mutation can be built. A `deviceId` that changed
 *   per launch would be worse than none: it would look like many devices.
 * - if the stored value is not exactly what this app writes, it is treated as
 *   **corrupt** and never silently replaced. Overwriting it would erase the
 *   only evidence that something else touched the key.
 *
 * The value is never logged, and it is the only thing this module stores: no
 * token, no draft, no operator.
 */

/** Versioned on purpose: a future format change gets its own key, not a migration in place. */
export const DEVICE_IDENTITY_STORAGE_KEY = "superRestaurant.deviceId.v1";

/** Same shape the Order commands accept, so a stored value is validated once, here. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type MobileDeviceIdentityFailure =
  /** A stored value that is not the canonical UUID this app writes. */
  | "corrupt"
  /** No keystore on this platform, or it declined to say it is available. */
  | "unavailable"
  /** The keystore threw while reading. */
  | "unreadable"
  /** The keystore threw while writing, or minted a value it then could not keep. */
  | "unwritable";

export class MobileDeviceIdentityError extends Error {
  public constructor(public readonly failure: MobileDeviceIdentityFailure) {
    super("MOBILE_DEVICE_IDENTITY_UNAVAILABLE");
    this.name = "MobileDeviceIdentityError";
  }
}

/** The slice of `expo-secure-store` this module uses, so the rules stay testable. */
export interface MobileSecureStorePort {
  readonly getItem: (key: string) => Promise<string | null>;
  readonly isAvailable: () => Promise<boolean>;
  readonly setItem: (key: string, value: string) => Promise<void>;
}

export interface MobileDeviceIdentity {
  /**
   * The identity of this installation. Concurrent callers share one attempt, so
   * two screens asking at start-up can never mint two different values.
   */
  readonly load: () => Promise<string>;
}

export function createMobileDeviceIdentity({ randomUuid, store }: {
  readonly randomUuid: () => string;
  readonly store: MobileSecureStorePort;
}): MobileDeviceIdentity {
  // The single flight. Held as a promise rather than a boolean so every caller
  // that arrives while the first read is in progress waits for *that* read
  // instead of starting its own — which is what would generate two UUIDs.
  let attempt: Promise<string> | undefined;

  async function read(): Promise<string> {
    let available: boolean;
    try {
      available = await store.isAvailable();
    } catch {
      throw new MobileDeviceIdentityError("unavailable");
    }
    if (!available) throw new MobileDeviceIdentityError("unavailable");

    let stored: string | null;
    try {
      stored = await store.getItem(DEVICE_IDENTITY_STORAGE_KEY);
    } catch {
      throw new MobileDeviceIdentityError("unreadable");
    }

    if (stored !== null) {
      // Exactly the canonical form this module writes. An uppercase or padded
      // value is the same identity to a UUID comparison, but it is not what we
      // wrote, so something else did — that is worth failing on, not fixing.
      if (typeof stored !== "string" || !UUID_PATTERN.test(stored)) {
        throw new MobileDeviceIdentityError("corrupt");
      }
      return stored;
    }

    let minted: string;
    try {
      minted = randomUuid().toLowerCase();
    } catch {
      throw new MobileDeviceIdentityError("unwritable");
    }
    // A generator that returns something else is a defect, not an identity.
    if (!UUID_PATTERN.test(minted)) throw new MobileDeviceIdentityError("unwritable");

    try {
      await store.setItem(DEVICE_IDENTITY_STORAGE_KEY, minted);
    } catch {
      throw new MobileDeviceIdentityError("unwritable");
    }
    return minted;
  }

  return Object.freeze({
    load: (): Promise<string> => {
      // A resolved attempt is the answer forever; a failed one is dropped so a
      // later call can try again — a keystore that was locked at start-up may
      // well be readable a moment later.
      attempt ??= read().catch((error: unknown) => {
        attempt = undefined;
        throw error;
      });
      return attempt;
    },
  });
}
