# shell-sidebar-perf — barra lateral fija y diagnóstico de lentitud al navegar (escribe código sólo para la barra)
Agente: Gemini   Nivel de rigor: C   Complejidad: Estándar

## Objetivo
Retroalimentación de Emmanuel (2026-11-02):
1. La barra lateral izquierda de navegación debe quedar **fija**: al hacer scroll en la página no se mueve (sticky con su propio scroll si no cabe) en escritorio; en móvil se conserva el comportamiento actual.
2. El sistema se siente lento: 1.5 a 3 s al cambiar de sección. Diagnostica causas en el código, no en el navegador: server components que esperan varias peticiones al API en serie en el `page.tsx` de cada sección, falta de `loading.tsx`, `prefetch` desactivado en los `Link`, layouts que recargan el scope o la sucursal en cada navegación, `dynamic = "force-dynamic"`, etc. Distingue lo que es sólo del modo desarrollo (compilación bajo demanda de Turbopack) de lo que también afectará en producción.

## Dónde trabajar (obligatorio)
1. Desde la raíz del repo: `git worktree add "C:\tmp\sr-wt\shell-sidebar-perf" -b gemini/shell-sidebar-perf main`; edita sólo ahí.
2. Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía corepack como en los demás briefs.

## Archivos (editables, sólo para el punto 1)
- `apps/web/src/app/app/app-nav.tsx`, `apps/web/src/app/app/layout.tsx`, `apps/web/src/app/globals.css` si hace falta una clase.
## Sólo lectura (punto 2)
- `apps/web/src/app/app/**/page.tsx`, `**/loading.tsx`, `apps/web/src/lib/*`, `apps/web/src/app/app/*/actions.ts`, `apps/web/next.config.ts`, el middleware o proxy de la app.
## Prohibido
- Cambiar lógica de datos en este brief; no tocar `menu/**`, `tables/**`, `caja/**`, `capture/**` más allá de leer.

## Criterios de aceptación
- Barra lateral con `position: sticky; top: 0; height: 100dvh; overflow-y: auto` (o equivalente) en pantallas de 1024 px o más; el contenido principal hace scroll solo; sin saltos de layout; `prefers-reduced-motion` respetado; targets ≥ 44 px intactos.
- Reporte de diagnóstico con una tabla: sección, qué espera su `page.tsx` (número de llamadas al API y si son en serie o en paralelo), si hay `loading.tsx`, si los `Link` tienen `prefetch`, y una propuesta de corrección por sección ordenada por impacto, separando «sólo desarrollo» de «también producción».

## Verificación (en el worktree)
- `turbo run lint typecheck test build --filter=@super-restaurant/web`; `git diff --check`; commit `fix(web-shell): sticky sidebar`.

## Formato de salida: reporte §8 en .agents/reports/shell-sidebar-perf.md
Resumen, archivos, salida de puertas, hash, y la tabla de diagnóstico. Máximo 90 líneas.
