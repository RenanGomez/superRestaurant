"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** Progressive enhancement only, same pattern as `login/submit-button.tsx`. */
export function SelectBranchSubmitButton(): ReactNode {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="h-11 rounded-[10px] bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Confirmando…" : "Confirmar sucursal"}
    </button>
  );
}
