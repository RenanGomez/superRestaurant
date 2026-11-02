# shell-sidebar-perf — hecha
Resumen: Barra lateral con position sticky (top:0, h:100dvh, overflow-y:auto, self-start) en escritorio (>=1024px) y móvil intacto. Diagnóstico de lentitud al navegar documentado.
Archivos: apps/web/src/app/app/app-nav.tsx
Puertas: turbo run lint typecheck test build --filter=@super-restaurant/web -> 12/12 exit 0 (49s); git diff --check -> limpio.
Hash: 3772181

## Diagnóstico de lentitud de navegación (1.5 - 3 s)
- **Sólo desarrollo**: Next.js anula `prefetch` en `next dev`; Turbopack compila cada ruta on-demand al navegar (1 a 2.5 s por sección). Desaparece en producción compilada.
- **También producción**:
  1. `proxy.ts` corre en cada request `/app/*` ejecutando `getUser()` de Supabase + `verifyRemoteSession()` al API (~150-250 ms fijos).
  2. Falta de `loading.tsx` en 8 de 10 rutas: Next retiene la pantalla previa congelada hasta recibir el RSC completo del servidor.
  3. Peticiones API en serie en `page.tsx` sin usar `request-context.ts`: reconsultan `listMemberships` y `authorizeBranch` redundantemente.
  4. Enlaces nativos `<a>` en lugar de `<Link>` (en menú, caja, clientes, entregas) provocando recargas completas del documento.

| Sección | Llamadas API en page.tsx | loading.tsx | Link prefetch | Tipo impacto | Propuesta de corrección (ordenada por impacto) |
|---|---|---|---|---|---|
| `/app/menu` | 4 en serie (session, memberships, auth, catalog completo) | No | Sí (inactivo dev) | Prod + Dev | Reusar `request-context.ts`, paralelizar o Suspense en catálogo, añadir `loading.tsx`, `Link` en cambiar sucursal. |
| `/app/caja` | 5-6 en serie (`loadCajaContext` + tray u orden/checkout) | Sí | Sí | Prod + Dev | Usar `request-context.ts` en `loadCajaContext`, paralelizar reporte y checkout, reemplazar `<a>` por `<Link>`. |
| `/app/capture` | 5 en serie (session, memberships, auth, confirmation, catalog) | No | Sí | Prod + Dev | Reusar `request-context.ts`, `Promise.all` para context + catalog, añadir `loading.tsx`. |
| `/app/deliveries` | 5 (2 serie: memberships, auth + 3 paralelo: list, tz, couriers) | No | Sí | Prod + Dev | Usar `request-context.ts`, añadir `loading.tsx`, cambiar `<a>` por `<Link>` o Server Actions. |
| `/app/delivery-zones` | 4 en serie (session, memberships, auth, catalog solo por divisa) | No | Sí | Prod + Dev | Reusar `request-context.ts`, no descargar catálogo completo para leer divisa, añadir `loading.tsx`. |
| `/app/reports/day` | 5 en serie (session, memberships, auth, timeZone, daySummary) | Sí | Sí | Prod + Dev | Reusar `request-context.ts`, `Promise.all` para timezone y day summary. |
| `/app/tables` | 2 en paralelo (`request-context.ts` memoizado + auth) | No | Sí | Prod + Dev | Añadir `loading.tsx` para feedback visual instantáneo (<50 ms); el data fetching ya es óptimo. |
| `/app/orders` | 3 en serie (session, memberships, auth) | No | Sí | Prod + Dev | Reusar `request-context.ts`, añadir `loading.tsx`. |
| `/app/customers` | 3 en serie (session, memberships, auth) | No | Sí | Prod + Dev | Reusar `request-context.ts`, añadir `loading.tsx`, cambiar `<a>` por `<Link>`. |
| `/app/system-admin` | 2 en serie (session, listSystemRestaurants) | No | Sí | Prod + Dev | Añadir `loading.tsx`, reusar sesión/admin memoizado. |
