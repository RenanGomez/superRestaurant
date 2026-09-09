"use client";

import { useEffect, useState } from "react";

type CallbackState = "processing" | "error";

/**
 * Handles the implicit-flow fragment used by Supabase's hosted recovery and
 * invitation emails. Tokens are read only in memory, removed from the URL
 * immediately, and POSTed once to the server so the session is persisted in
 * the existing httpOnly cookie jar. They are never logged or rendered.
 */
export default function AuthCallbackPage(): React.ReactElement {
  const [state, setState] = useState<CallbackState>("processing");

  useEffect(() => {
    const hash = window.location.hash;
    window.history.replaceState(null, "", "/auth/callback");

    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : "");
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");

    if ((type !== "recovery" && type !== "invite") || !isToken(accessToken) || !isToken(refreshToken)) {
      setState("error");
      return;
    }

    void fetch("/auth/callback/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken, refreshToken }),
      credentials: "same-origin",
    }).then((response) => {
      if (!response.ok) throw new Error("AUTH_CALLBACK_FAILED");
      window.location.replace("/reset-password");
    }).catch(() => setState("error"));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-6">
      <section aria-live="polite" className="w-full max-w-[420px] rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
        {state === "processing" ? (
          <>
            <h1 className="font-heading text-xl font-bold text-text">Verificando tu enlace</h1>
            <p className="mt-2 text-sm text-text-muted">Espera un momento. No cierres esta ventana.</p>
          </>
        ) : (
          <>
            <h1 className="font-heading text-xl font-bold text-text">Enlace no válido</h1>
            <p className="mt-2 text-sm text-text-muted">Solicita un correo nuevo e inténtalo otra vez.</p>
            <a href="/login" className="mt-5 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">Volver a iniciar sesión</a>
          </>
        )}
      </section>
    </main>
  );
}

function isToken(value: string | null): value is string {
  return value !== null && value.length >= 20 && value.length <= 8_192 && !/\s/u.test(value);
}
