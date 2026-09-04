"use client";

import { useFormStatus } from "react-dom";

export function CashierSubmitButton({ idle, pending, tone = "primary" }: {
  readonly idle: string;
  readonly pending: string;
  readonly tone?: "danger" | "primary" | "secondary";
}) {
  const { pending: isPending } = useFormStatus();
  const colors = tone === "danger"
    ? "bg-error text-white hover:brightness-90"
    : tone === "secondary"
      ? "border border-border bg-surface text-text hover:bg-bg"
      : "bg-accent text-white hover:bg-accent-hover";
  return (
    <button
      type="submit"
      disabled={isPending}
      className={`min-h-12 rounded-xl px-4 py-3 text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60 ${colors}`}
    >
      {isPending ? pending : idle}
    </button>
  );
}
