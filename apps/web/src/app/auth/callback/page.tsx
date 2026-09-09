"use client";

import { useEffect, useState } from "react";

import { createAuthCallbackConsumer } from "../../../lib/auth-callback";

type CallbackState = "processing" | "error";

/**
 * Handles the implicit-flow fragment used by Supabase's hosted recovery and
 * invitation emails. Tokens are read only in memory, removed from the URL
 * immediately, and POSTed once to the server so the session is persisted in
 * the existing httpOnly cookie jar. They are never logged or rendered.
 */
export default function AuthCallbackPage(): React.ReactElement {
  const [state, setState] = useState<CallbackState>("processing");
  const [consumeCallback] = useState(createAuthCallbackConsumer);

  useEffect(() => {
    let active = true;
    void consumeCallback(window).then((accepted) => {
      if (!active) return;
      if (accepted) window.location.replace("/reset-password");
      else setState("error");
    });
    return () => { active = false; };
  }, [consumeCallback]);

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
            <p className="mt-2 text-sm text-text-muted">No pudimos verificar el enlace. Si ya tienes contraseña, vuelve a iniciar sesión; de lo contrario, solicita un enlace nuevo.</p>
            <a href="/login" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Volver a iniciar sesión</a>
          </>
        )}
      </section>
    </main>
  );
}
