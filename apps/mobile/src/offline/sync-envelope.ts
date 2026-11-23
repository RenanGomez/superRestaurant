/**
 * Per-scope AES-256-GCM envelopes of the durable sync snapshot (ADR-005 §4.2/§4.3,
 * extended for mobile by the m2-mobile-local-storage-crypto brief).
 *
 * The snapshot is not stored as one plaintext JSON blob anymore: it is split by
 * the operational scope `restaurantId|branchId`, and each scope is encrypted as
 * its own AES-256-GCM entry. The Additional Authenticated Data of every entry is
 *
 *     `${restaurantId}|${branchId}|${deviceId}|${keyVersion}`
 *
 * so a ciphertext can never be replayed under another branch, another tenant or
 * another device, and a downgrade to a different key version fails the GCM tag
 * instead of decrypting silently. A per-scope envelope also means a key rotation
 * re-encrypts each scope independently without dropping pending outbox events.
 *
 * This module is pure: it accepts an injected `MobileSyncEnvelopeCipher` so the
 * Node test build runs real WebCrypto AES-GCM while the native adapter
 * (`expo-offline.ts`) resolves the same 32-byte key from `expo-secure-store`.
 * If the runtime has no `crypto.subtle`, the adapter fails closed with
 * `ENCRYPTION_UNAVAILABLE`; nothing is ever written as plaintext.
 */
import type {
  DurableSyncState,
  OutboxEntry,
  ReplicaEntity,
  ScopeState,
  SyncScopeInput,
} from "@super-restaurant/sync-engine";

/** Marker of the on-disk document; a missing or different value is `STATE_CORRUPT`. */
export const SCOPE_ENVELOPE_FORMAT = "sr-scope-envelope-v1" as const;

/** AES-GCM nonce size mandated by ADR-005 §4.2. */
export const SCOPE_ENVELOPE_IV_BYTES = 12;

/** AES-256 key size. */
export const SCOPE_ENVELOPE_KEY_BYTES = 32;

const HEX = /^(?:[0-9a-f]{2})*$/u;

export type MobileScopeEnvelopeErrorCode = "STATE_CORRUPT" | "ENCRYPTION_UNAVAILABLE" | "STORAGE_LOAD_FAILED";

export class MobileScopeEnvelopeError extends Error {
  public constructor(public readonly code: MobileScopeEnvelopeErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "MobileScopeEnvelopeError";
  }
}

/** One encrypted scope entry: hex-encoded nonce + hex-encoded ciphertext. */
export interface MobileScopeEnvelopeCiphertext {
  readonly iv: string;
  readonly ciphertext: string;
}

/** Injected AEAD. `keyVersion` selects the DEK version and is also bound into the AAD. */
export interface MobileSyncEnvelopeCipher {
  readonly encrypt: (
    plaintext: string,
    aad: string,
    keyVersion: number,
  ) => Promise<MobileScopeEnvelopeCiphertext>;
  readonly decrypt: (
    envelope: MobileScopeEnvelopeCiphertext,
    aad: string,
    keyVersion: number,
  ) => Promise<string>;
}

export function scopeEnvelopeId(scope: SyncScopeInput): string {
  return `${scope.restaurantId}|${scope.branchId}`;
}

/** Exact AAD the brief fixed: `restaurantId|branchId|deviceId|version`. */
export function scopeEnvelopeAad(scope: SyncScopeInput, deviceId: string, keyVersion: number): string {
  return `${scope.restaurantId}|${scope.branchId}|${deviceId}|${keyVersion}`;
}

export interface ScopedSnapshotSlice {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly scope: ScopeState | null;
  readonly outbox: readonly OutboxEntry[];
  readonly replica: readonly ReplicaEntity[];
}

interface ScopedSnapshotEntry extends MobileScopeEnvelopeCiphertext {
  readonly scope: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly keyVersion: number;
}

interface ScopedSnapshotDocument {
  readonly format: typeof SCOPE_ENVELOPE_FORMAT;
  readonly deviceId: string;
  readonly stateVersion: 1;
  readonly lastLocalSequence: number;
  readonly entries: readonly ScopedSnapshotEntry[];
}

/**
 * Splits the whole durable state into one slice per `restaurantId|branchId`.
 * A scope appears if any of the scope cursor, an outbox entry or a replica
 * entity belongs to it. Slices are ordered for deterministic ciphertext.
 */
export function partitionStateByScope(state: DurableSyncState): readonly ScopedSnapshotSlice[] {
  const slices = new Map<string, { restaurantId: string; branchId: string; scope: ScopeState | null; outbox: OutboxEntry[]; replica: ReplicaEntity[] }>();
  const sliceFor = (restaurantId: string, branchId: string): { restaurantId: string; branchId: string; scope: ScopeState | null; outbox: OutboxEntry[]; replica: ReplicaEntity[] } => {
    const id = `${restaurantId}|${branchId}`;
    const existing = slices.get(id);
    if (existing !== undefined) return existing;
    const created = { restaurantId, branchId, scope: null as ScopeState | null, outbox: [] as OutboxEntry[], replica: [] as ReplicaEntity[] };
    slices.set(id, created);
    return created;
  };

  for (const scope of state.scopes) sliceFor(scope.restaurantId, scope.branchId).scope = scope;
  for (const item of state.outbox) sliceFor(item.restaurantId, item.branchId).outbox.push(item);
  for (const entity of state.replica) sliceFor(entity.restaurantId, entity.branchId).replica.push(entity);

  return Object.freeze(
    [...slices.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, slice]) => Object.freeze({
        restaurantId: slice.restaurantId,
        branchId: slice.branchId,
        scope: slice.scope,
        outbox: Object.freeze([...slice.outbox]),
        replica: Object.freeze([...slice.replica]),
      })),
  );
}

/** Encrypts every scope of `state` into the serialized envelope document. */
export async function encodeScopedSnapshot(
  state: DurableSyncState,
  cipher: MobileSyncEnvelopeCipher,
  deviceId: string,
  keyVersion: number,
): Promise<string> {
  const entries: ScopedSnapshotEntry[] = [];
  for (const slice of partitionStateByScope(state)) {
    const plaintext = JSON.stringify({ outbox: slice.outbox, replica: slice.replica, scope: slice.scope });
    const aad = scopeEnvelopeAad(slice, deviceId, keyVersion);
    const sealed = await cipher.encrypt(plaintext, aad, keyVersion);
    entries.push(Object.freeze({
      branchId: slice.branchId,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      keyVersion,
      restaurantId: slice.restaurantId,
      scope: scopeEnvelopeId(slice),
    }));
  }
  const document: ScopedSnapshotDocument = Object.freeze({
    deviceId,
    entries: Object.freeze(entries),
    format: SCOPE_ENVELOPE_FORMAT,
    lastLocalSequence: state.lastLocalSequence,
    stateVersion: 1 as const,
  });
  return JSON.stringify(document);
}

/**
 * Decrypts each scope envelope and reassembles the durable state. Any structural
 * mismatch, a fabricated scope key or a failed GCM tag (another scope/device, a
 * swapped key version, tampered ciphertext) collapses to `STATE_CORRUPT`: the
 * caller must quarantine, never reset, and never guess a fallback plaintext.
 */
export async function decodeScopedSnapshot(
  serialized: string,
  cipher: MobileSyncEnvelopeCipher,
  deviceId: string,
): Promise<DurableSyncState> {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new MobileScopeEnvelopeError("STATE_CORRUPT", "json");
  }
  const document = asDocument(value, deviceId);
  const scopes: ScopeState[] = [];
  const outbox: OutboxEntry[] = [];
  const replica: ReplicaEntity[] = [];
  const seen = new Set<string>();
  for (const entry of document.entries) {
    const expectedScope = `${entry.restaurantId}|${entry.branchId}`;
    if (entry.scope !== expectedScope || seen.has(entry.scope)) {
      throw new MobileScopeEnvelopeError("STATE_CORRUPT", "scope");
    }
    seen.add(entry.scope);
    const aad = `${entry.restaurantId}|${entry.branchId}|${deviceId}|${entry.keyVersion}`;
    let plaintext: string;
    try {
      plaintext = await cipher.decrypt({ ciphertext: entry.ciphertext, iv: entry.iv }, aad, entry.keyVersion);
    } catch {
      // Wrong branch/tenant/device/key version or a tampered tag: never retried in clear.
      throw new MobileScopeEnvelopeError("STATE_CORRUPT", "tag");
    }
    let slice: unknown;
    try {
      slice = JSON.parse(plaintext) as unknown;
    } catch {
      throw new MobileScopeEnvelopeError("STATE_CORRUPT", "slice");
    }
    const parsed = asSlice(slice);
    if (parsed.scope !== null) scopes.push(parsed.scope);
    for (const item of parsed.outbox) outbox.push(item);
    for (const entity of parsed.replica) replica.push(entity);
  }
  outbox.sort((left, right) => left.localSequence - right.localSequence);
  return Object.freeze({
    deviceId,
    lastLocalSequence: document.lastLocalSequence,
    outbox: Object.freeze(outbox),
    replica: Object.freeze(replica),
    scopes: Object.freeze(scopes),
    stateVersion: 1 as const,
  });
}

function asDocument(value: unknown, deviceId: string): ScopedSnapshotDocument {
  const record = asRecord(value);
  if (record === undefined) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "document");
  if (record["format"] !== SCOPE_ENVELOPE_FORMAT) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "format");
  if (record["deviceId"] !== deviceId) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "deviceId");
  if (record["stateVersion"] !== 1) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "stateVersion");
  const lastLocalSequence = record["lastLocalSequence"];
  if (typeof lastLocalSequence !== "number" || !Number.isSafeInteger(lastLocalSequence) || lastLocalSequence < 0) {
    throw new MobileScopeEnvelopeError("STATE_CORRUPT", "lastLocalSequence");
  }
  const rawEntries = record["entries"];
  if (!Array.isArray(rawEntries)) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "entries");
  const entries: ScopedSnapshotEntry[] = [];
  for (const raw of rawEntries) entries.push(asEntry(raw));
  return Object.freeze({
    deviceId,
    entries: Object.freeze(entries),
    format: SCOPE_ENVELOPE_FORMAT,
    lastLocalSequence,
    stateVersion: 1 as const,
  });
}

function asEntry(value: unknown): ScopedSnapshotEntry {
  const record = asRecord(value);
  if (record === undefined) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "entry");
  const { branchId, ciphertext, iv, keyVersion, restaurantId, scope } = record;
  if (typeof scope !== "string" || typeof restaurantId !== "string" || typeof branchId !== "string") {
    throw new MobileScopeEnvelopeError("STATE_CORRUPT", "entry.scope");
  }
  if (typeof iv !== "string" || !HEX.test(iv) || iv.length !== SCOPE_ENVELOPE_IV_BYTES * 2) {
    throw new MobileScopeEnvelopeError("STATE_CORRUPT", "entry.iv");
  }
  if (typeof ciphertext !== "string" || !HEX.test(ciphertext) || ciphertext.length === 0) {
    throw new MobileScopeEnvelopeError("STATE_CORRUPT", "entry.ciphertext");
  }
  if (typeof keyVersion !== "number" || !Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw new MobileScopeEnvelopeError("STATE_CORRUPT", "entry.keyVersion");
  }
  return Object.freeze({ branchId, ciphertext, iv, keyVersion, restaurantId, scope });
}

function asSlice(value: unknown): { readonly scope: ScopeState | null; readonly outbox: readonly OutboxEntry[]; readonly replica: readonly ReplicaEntity[] } {
  const record = asRecord(value);
  if (record === undefined) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "slice");
  const scope = record["scope"];
  if (scope !== null && asRecord(scope) === undefined) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "slice.scope");
  const outbox = record["outbox"];
  const replica = record["replica"];
  if (!Array.isArray(outbox) || !Array.isArray(replica)) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "slice.lists");
  // The entries were parsed by `parseDurableState` before they were written; the
  // merged state is re-validated there. Here we only reject a non-object shape.
  return Object.freeze({
    outbox: Object.freeze(outbox as readonly OutboxEntry[]),
    replica: Object.freeze(replica as readonly ReplicaEntity[]),
    scope: scope as ScopeState | null,
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

// ---- WebCrypto cipher --------------------------------------------------------------------

export interface WebCryptoEnvelopeCipherOptions {
  readonly subtle: SubtleCrypto;
  /** Raw 32-byte AES key material for one key version (the DEK from the keystore). */
  readonly rawKey: (keyVersion: number) => Promise<Uint8Array>;
  /** Nonce source; defaults to `crypto.getRandomValues`. */
  readonly randomBytes?: (length: number) => Uint8Array;
}

/**
 * Real AES-256-GCM implementation over any `SubtleCrypto` (Node test build, the
 * web target and a native build that provides `crypto.subtle`). Keys are imported
 * non-extractable and cached per version so a rotation can still read the old
 * envelopes until each scope was re-encrypted.
 */
export function createWebCryptoEnvelopeCipher(options: WebCryptoEnvelopeCipherOptions): MobileSyncEnvelopeCipher {
  const keys = new Map<number, Promise<CryptoKey>>();
  const randomBytes = options.randomBytes ?? ((length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    // `getRandomValues` exists wherever `subtle` does; failing closed otherwise.
    const cryptoImpl = typeof globalThis.crypto === "undefined" ? undefined : globalThis.crypto;
    if (cryptoImpl?.getRandomValues === undefined) throw new MobileScopeEnvelopeError("ENCRYPTION_UNAVAILABLE", "random");
    cryptoImpl.getRandomValues(bytes);
    return bytes;
  });

  const keyFor = (keyVersion: number): Promise<CryptoKey> => {
    const cached = keys.get(keyVersion);
    if (cached !== undefined) return cached;
    const imported = options.rawKey(keyVersion).then(async (raw) => {
      if (raw.length !== SCOPE_ENVELOPE_KEY_BYTES) throw new MobileScopeEnvelopeError("ENCRYPTION_UNAVAILABLE", "key");
      return options.subtle.importKey("raw", raw as BufferSource, { length: 256, name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    });
    keys.set(keyVersion, imported);
    return imported;
  };

  return Object.freeze({
    encrypt: async (plaintext: string, aad: string, keyVersion: number): Promise<MobileScopeEnvelopeCiphertext> => {
      const key = await keyFor(keyVersion);
      const iv = randomBytes(SCOPE_ENVELOPE_IV_BYTES);
      const ciphertext = await options.subtle.encrypt(
        { additionalData: utf8Encode(aad) as BufferSource, iv: iv as BufferSource, name: "AES-GCM" },
        key,
        utf8Encode(plaintext) as BufferSource,
      );
      return Object.freeze({ ciphertext: bytesToHex(new Uint8Array(ciphertext)), iv: bytesToHex(iv) });
    },
    decrypt: async (envelope: MobileScopeEnvelopeCiphertext, aad: string, keyVersion: number): Promise<string> => {
      const key = await keyFor(keyVersion);
      const iv = hexToBytes(envelope.iv);
      if (iv.length !== SCOPE_ENVELOPE_IV_BYTES) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "iv");
      let plaintext: ArrayBuffer;
      try {
        plaintext = await options.subtle.decrypt(
          { additionalData: utf8Encode(aad) as BufferSource, iv: iv as BufferSource, name: "AES-GCM" },
          key,
          hexToBytes(envelope.ciphertext) as BufferSource,
        );
      } catch {
        // GCM authentication failure: report as corruption, never as a missing key.
        throw new MobileScopeEnvelopeError("STATE_CORRUPT", "tag");
      }
      return utf8Decode(new Uint8Array(plaintext));
    },
  });
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (!HEX.test(hex)) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "hex");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** UTF-8 encoder that does not depend on `TextEncoder` being present in Hermes. */
export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index) ?? 0;
    if (codePoint > 0xffff) index += 1;
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** UTF-8 decoder that rejects malformed input instead of emitting replacement chars. */
export function utf8Decode(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index] ?? 0;
    let codePoint = 0;
    let length = 0;
    if (first < 0x80) {
      codePoint = first;
      length = 1;
    } else if ((first & 0xe0) === 0xc0) {
      codePoint = first & 0x1f;
      length = 2;
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = first & 0x0f;
      length = 3;
    } else if ((first & 0xf8) === 0xf0) {
      codePoint = first & 0x07;
      length = 4;
    } else {
      throw new MobileScopeEnvelopeError("STATE_CORRUPT", "utf8");
    }
    if (index + length > bytes.length) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "utf8");
    for (let offset = 1; offset < length; offset += 1) {
      const next = bytes[index + offset] ?? 0;
      if ((next & 0xc0) !== 0x80) throw new MobileScopeEnvelopeError("STATE_CORRUPT", "utf8");
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    index += length;
    text += String.fromCodePoint(codePoint);
  }
  return text;
}
