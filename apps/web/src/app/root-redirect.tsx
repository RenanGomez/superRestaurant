"use client";

import { useEffect } from "react";

export function RootRedirect({ authenticated }: { readonly authenticated: boolean }): null {
  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : "");
    const hasAuthFlow = params.get("type") === "recovery"
      || params.get("type") === "invite"
      || params.has("access_token")
      || params.has("refresh_token")
      || params.has("error");
    if (hasAuthFlow) {
      window.location.replace(`/auth/callback${hash}`);
      return;
    }
    window.location.replace(authenticated ? "/app" : "/login");
  }, [authenticated]);

  return null;
}
