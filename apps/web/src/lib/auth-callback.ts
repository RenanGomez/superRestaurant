interface AuthCallbackBrowser {
  readonly location: Pick<Location, "hash" | "search">;
  readonly history: Pick<History, "replaceState">;
  readonly fetch: typeof fetch;
}

/** One attempt per mounted callback, including React development effect replay. */
export function createAuthCallbackConsumer(): (browser: AuthCallbackBrowser) => Promise<boolean> {
  let attempt: Promise<boolean> | undefined;
  return (browser) => {
    attempt ??= consumeCallback(browser);
    return attempt;
  };
}

async function consumeCallback(browser: AuthCallbackBrowser): Promise<boolean> {
  try {
    const hash = browser.location.hash;
    const search = browser.location.search;
    // Scrub before validation or any network work, even for a rejected link.
    browser.history.replaceState(null, "", "/auth/callback");
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : "");
    const query = new URLSearchParams(search);
    if ([params, query].some((source) =>
      ["error", "error_code", "error_description"].some((key) => source.has(key)))) return false;

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");
    if ((type !== null && type !== "recovery" && type !== "invite")
      || !isToken(accessToken) || !isToken(refreshToken)) return false;

    const response = await browser.fetch("/auth/callback/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken, refreshToken }),
      credentials: "same-origin",
      cache: "no-store",
    });
    return response.ok;
  } catch {
    // Neither provider responses nor transport errors may expose token material.
    return false;
  }
}

function isToken(value: string | null): value is string {
  return value !== null && value.length >= 20 && value.length <= 8_192 && !/\s/u.test(value);
}
