import type { ReactNode } from "react";

import { BrandMark } from "../../components/brand-mark";
import { loginAction } from "./actions";
import { LoginSubmitButton } from "./submit-button";

export const dynamic = "force-dynamic";

const KNOWN_ERRORS = new Set(["invalid_credentials"]);

interface LoginPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | ReadonlyArray<string> | undefined>>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps): Promise<ReactNode> {
  const resolvedSearchParams = await searchParams;
  const rawError = resolvedSearchParams.error;
  const errorCode = typeof rawError === "string" && KNOWN_ERRORS.has(rawError) ? rawError : undefined;

  return (
    <div className="flex min-h-screen bg-bg">
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-linear-to-br from-[oklch(28%_0.05_235)] to-[oklch(18%_0.035_248)] p-16 lg:flex">
        <BrandDecoration />

        <div className="relative z-10 flex items-center gap-3.5">
          <BrandMark />
          <span className="font-heading text-xl font-bold tracking-tight text-white">superRestaurant</span>
        </div>

        <div className="relative z-10 flex flex-col gap-7">
          <h1 className="max-w-[420px] font-heading text-[32px] leading-[1.25] font-bold text-white">
            Un solo lugar para operar tu restaurante, de la mesa a la caja.
          </h1>
          <ul className="flex flex-col gap-4">
            <Feature text="Aislamiento por sucursal y control de acceso por rol" />
            <Feature text="Auditoría completa de cada operación sensible" />
            <Feature text="Diseñado para pantallas táctiles y turnos de alto ritmo" />
          </ul>
        </div>

        <span className="relative z-10 text-xs text-[oklch(65%_0.02_240)]">© superRestaurant</span>
      </div>

      <div className="flex flex-1 items-center justify-center p-12">
        <div className="flex w-full max-w-[400px] flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h2 className="font-heading text-[26px] font-bold text-text">Iniciar sesión</h2>
            <p className="text-sm text-text-muted">Accede con tu cuenta de superRestaurant.</p>
          </div>

          <div aria-live="polite">
            {errorCode !== undefined && <ErrorBanner />}
          </div>

          <form action={loginAction} className="flex flex-col gap-4.5">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-text">Correo electrónico</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="tu@restaurante.com"
                className="h-[46px] rounded-[10px] border border-border bg-surface px-3.5 text-[15px] text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/40"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-text">Contraseña</span>
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="h-[46px] rounded-[10px] border border-border bg-surface px-3.5 text-[15px] text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/40"
              />
            </label>
            <LoginSubmitButton />
          </form>

          <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
            <LockIcon />
            Conexión cifrada · sesión con expiración automática
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorBanner(): ReactNode {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-[oklch(85%_0.06_25)] bg-error-bg px-3.5 py-3">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 shrink-0 text-error"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span className="text-[13px] leading-snug text-[oklch(35%_0.1_25)]">
        Correo o contraseña incorrectos. Verifica tus datos e inténtalo de nuevo.
      </span>
    </div>
  );
}

function Feature({ text }: { readonly text: string }): ReactNode {
  return (
    <li className="flex items-center gap-3 text-sm text-[oklch(88%_0.02_240)]">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="oklch(70% 0.13 160)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {text}
    </li>
  );
}

function LockIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function BrandDecoration(): ReactNode {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-35" viewBox="0 0 640 900" aria-hidden="true">
      <circle cx="560" cy="80" r="220" fill="none" stroke="oklch(60% 0.1 230)" strokeWidth="1" />
      <circle cx="560" cy="80" r="320" fill="none" stroke="oklch(60% 0.1 230)" strokeWidth="1" />
      <circle cx="80" cy="820" r="180" fill="none" stroke="oklch(60% 0.1 230)" strokeWidth="1" />
    </svg>
  );
}
