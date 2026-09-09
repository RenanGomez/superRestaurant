import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { createServerSupabaseClient } from "../../lib/supabase-server";
import { updatePasswordAction } from "./actions";

export const dynamic = "force-dynamic";

interface ResetPasswordPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | ReadonlyArray<string> | undefined>>>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps): Promise<ReactNode> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) redirect("/login?error=invalid_credentials");

  const params = await searchParams;
  const error = params.error === "invalid_password"
    ? "La contraseña debe tener al menos 10 caracteres y coincidir en ambos campos."
    : params.error === "update_failed"
      ? "No se pudo actualizar la contraseña. Solicita un enlace nuevo."
      : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-6">
      <section className="w-full max-w-[420px] rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="font-heading text-2xl font-bold text-text">Configura tu contraseña</h1>
        <p className="mt-2 text-sm text-text-muted">Cuenta: {user.email ?? "usuario autenticado"}</p>
        {error !== undefined && <p role="alert" className="mt-4 rounded-lg bg-error-bg px-3 py-2 text-sm text-error">{error}</p>}
        <form action={updatePasswordAction} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-text">
            Nueva contraseña
            <input name="password" type="password" minLength={10} required autoComplete="new-password" className="h-11 rounded-lg border border-border bg-surface px-3 outline-none focus:border-accent focus:ring-2 focus:ring-accent/40" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-text">
            Repite la contraseña
            <input name="confirmation" type="password" minLength={10} required autoComplete="new-password" className="h-11 rounded-lg border border-border bg-surface px-3 outline-none focus:border-accent focus:ring-2 focus:ring-accent/40" />
          </label>
          <button type="submit" className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white">Guardar contraseña</button>
        </form>
      </section>
    </main>
  );
}
