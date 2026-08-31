const ACTOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Server-to-server cross-check of the caller's Supabase access token against
 * `GET /api/v1/session` on apps/api. This is deliberately in addition to the
 * client-side JWT already validated by Supabase Auth: it is the authoritative
 * confirmation required by frontend.md before any `/app` route renders.
 *
 * Fails closed: an unreachable API, a non-200 response, or a response that
 * does not match the exact expected shape are all treated as "no session".
 *
 * `apiBaseUrl` is passed in rather than read from `../env` here: this keeps
 * the module free of relative imports, so it compiles identically under
 * Next's bundler (which the real app uses) and under the plain-Node ESM
 * loader this repo's hand-rolled `node:test` harness runs compiled tests
 * with — the two disagree on whether a relative import needs a `.js`
 * extension, and a module with no relative imports at all sidesteps that
 * entirely. `src/proxy.ts` is the only caller and supplies `getServerEnv().apiBaseUrl`.
 */
export async function verifyRemoteSession(
  accessToken: string,
  apiBaseUrl: string,
): Promise<{ readonly actorId: string } | undefined> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/session`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return undefined;
  }

  if (!response.ok) return undefined;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }

  return parseSessionResponse(body);
}

/**
 * Accepts only the exact contract `apps/api`'s `SessionController` returns:
 * a plain object with a single own key `actorId`, a string matching a UUID.
 * Rejects hostile shapes (extra keys, inherited/hostile prototypes, getters,
 * non-UUID values) the same way `apps/api`'s own principal normalization does.
 */
export function parseSessionResponse(value: unknown): { readonly actorId: string } | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== 1 || ownKeys[0] !== "actorId") return undefined;

    const descriptor = Object.getOwnPropertyDescriptor(value, "actorId");
    if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "string") {
      return undefined;
    }
    if (!ACTOR_ID_PATTERN.test(descriptor.value)) return undefined;

    return Object.freeze({ actorId: descriptor.value.toLowerCase() });
  } catch {
    return undefined;
  }
}
