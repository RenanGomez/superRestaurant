/**
 * Deterministic, non-reversible identity helpers shared by the offline sync bridge and the
 * inventory writes.
 *
 * The browser keeps one stable installation id in `localStorage`. Everything the server sees is
 * derived per actor, because `app.sync_devices` binds a device row to the first actor that
 * registers it: one shared tablet with two cashiers must not collide on the same row.
 */

/** Deterministic UUID-shaped identity so a retry with the same key keeps the same intent fingerprint. */
export function stableEntityId(parts: readonly string[]): string {
  const text = parts.join("\u0000");
  const fnv = (seed: number): number => {
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  };
  const hex = [fnv(0x811c9dc5), fnv(0x9e3779b9), fnv(0x85ebca6b), fnv(0xc2b2ae35)]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Derives the device id sent to the API from the browser installation id and the actor.
 * The version/variant nibbles are rewritten to a valid v4 UUID for the API contract.
 */
export function deviceIdForActor(baseDeviceId: string, actorId: string): string {
  const derived = stableEntityId([baseDeviceId, actorId]);
  const versioned = `${derived.slice(0, 14)}4${derived.slice(15)}`;
  const variant = ["8", "9", "a", "b"][Number.parseInt(versioned.slice(19, 20), 16) & 0x3] ?? "8";
  return `${versioned.slice(0, 19)}${variant}${versioned.slice(20)}`;
}
