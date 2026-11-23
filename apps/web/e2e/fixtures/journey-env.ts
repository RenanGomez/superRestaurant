import { existsSync, readFileSync } from "node:fs";

/** Same message the existing smoke specs use when no saved session is available. */
export const NO_SESSION_MESSAGE = "Sin sesión: ejecuta pnpm e2e:auth";

export interface StoredCookie {
  readonly name: string;
  readonly value: string;
}

export interface StoredAuthState {
  readonly cookies: readonly StoredCookie[];
}

export interface BranchScope {
  readonly restaurantId: string;
  readonly branchId: string;
}

/** Path of the Playwright storageState with the operator session (relative to apps/web). */
export function authStatePath(): string {
  return process.env.E2E_AUTH_FILE ?? "playwright/.auth/user.json";
}

export function hasJourneySession(): boolean {
  const state = readAuthState();
  return state !== undefined && accessTokenFrom(state) !== undefined && scopeFrom(state) !== undefined;
}

export function readAuthState(): StoredAuthState | undefined {
  const path = authStatePath();
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const cookies = (parsed as { cookies?: unknown }).cookies;
    if (!Array.isArray(cookies)) return undefined;
    const safe: StoredCookie[] = [];
    for (const cookie of cookies) {
      if (typeof cookie !== "object" || cookie === null) continue;
      const name = (cookie as { name?: unknown }).name;
      const value = (cookie as { value?: unknown }).value;
      if (typeof name === "string" && typeof value === "string") safe.push({ name, value });
    }
    return { cookies: safe };
  } catch {
    return undefined;
  }
}

/** Supabase SSR stores the session as `base64-<base64url(JSON)>` inside the auth cookie. */
export function accessTokenFrom(state: StoredAuthState): string | undefined {
  const cookie = state.cookies.find((candidate) => candidate.name.endsWith("-auth-token"));
  if (cookie === undefined || !cookie.value.startsWith("base64-")) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cookie.value.slice("base64-".length), "base64url").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null) return undefined;
    const token = (decoded as { access_token?: unknown }).access_token;
    return typeof token === "string" && token.length > 20 ? token : undefined;
  } catch {
    return undefined;
  }
}

export function scopeFrom(state: StoredAuthState): BranchScope | undefined {
  const cookie = state.cookies.find((candidate) => candidate.name === "sr-branch-pref");
  if (cookie === undefined) return undefined;
  try {
    const decoded: unknown = JSON.parse(decodeURIComponent(cookie.value));
    if (typeof decoded !== "object" || decoded === null) return undefined;
    const restaurantId = (decoded as { restaurantId?: unknown }).restaurantId;
    const branchId = (decoded as { branchId?: unknown }).branchId;
    return typeof restaurantId === "string" && typeof branchId === "string" ? { branchId, restaurantId } : undefined;
  } catch {
    return undefined;
  }
}

/** Deterministic digits derived from the runId, so seeds vary per run without randomness. */
export function digitsFrom(seed: string, length: number): string {
  let hash = 2_166_136_261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  let digits = "";
  while (digits.length < length) {
    hash = (Math.imul(hash, 1_103_515_245) + 12_345) >>> 0;
    digits += String(hash % 10);
  }
  return digits;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
