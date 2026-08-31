"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Progressive enhancement only: the surrounding <form action={loginAction}>
 * already works without JavaScript. This client component adds an accessible
 * pending state (disabled button, updated label) while the Server Action runs.
 */
export function LoginSubmitButton(): ReactNode {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="mt-1.5 h-12 rounded-[10px] bg-accent text-[15px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Iniciando sesión…" : "Iniciar sesión"}
    </button>
  );
}
