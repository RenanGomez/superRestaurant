# web-nav-perf-r1 · navegación más rápida entre secciones: loading.tsx, contexto de petición compartido, llamadas en paralelo, Link en vez de a

Nivel B/C (sólo `apps/web`; no cambia contratos ni API) · Capa L2 (Gemini `-Write` o Codex) · rama desde `main` **después** de integrar las tareas en curso de caja, mesas y menú (toca `page.tsx` de todas las secciones). Base: diagnóstico en `.agents/reports/shell-sidebar-perf.md` (tabla por sección).

## Pedido de Emmanuel (2026-11-02)
El sistema tarda 1.5 a 3 s al cambiar de sección. Parte es sólo del modo desarrollo (Turbopack compila cada ruta al visitarla y `next dev` anula `prefetch`), pero hay causas que también afectan a producción.

## Cambios
1. **`loading.tsx` en todas las rutas de `/app/*`** que no lo tengan (menu, capture, deliveries, delivery-zones, tables, orders, customers, system-admin): esqueleto del mismo ancho y encabezado que la página real, textos en español, `aria-busy`, `prefers-reduced-motion`.
2. **Contexto de petición compartido**: todas las `page.tsx` usan `apps/web/src/lib/request-context.ts` (memoizado por petición) para sesión, membresías y `authorizeBranch`, en vez de repetir `listMemberships` y `authorizeBranch`. No cambiar la semántica de autorización: mismo scope, mismos redirects.
3. **Paralelizar** lo independiente con `Promise.all`: capture (contexto + catálogo), reports/day (zona horaria + resumen), caja (`loadCajaContext`: reporte + checkout), deliveries (lista, zona horaria, repartidores ya van en paralelo; mantener). Nunca paralelizar lo que depende del scope autorizado antes de tenerlo.
4. **`/app/delivery-zones`**: no descargar el catálogo completo para leer la divisa; usar el campo de la sucursal o el endpoint ligero que ya exista (si no existe, dejar como está y anotar).
5. **`<a>` → `<Link>`** en menú, caja, clientes y entregas para navegación interna (no para descargas ni `target="_blank"`); `prefetch` por defecto.
6. **`proxy.ts`**: no cambiar la verificación de sesión (seguridad); sólo documentar el costo fijo medido en el reporte.
7. No tocar lógica de negocio, server actions ni componentes de cliente más allá de los enlaces.

## Verificación (Node 24, pnpm vía corepack)
- `pnpm turbo run lint typecheck test build --filter=@super-restaurant/web`; `git diff --check`.
- Con sesión Playwright si existe: medir con `performance.now()` o `page.waitForLoadState` el cambio entre tres secciones en `next build && next start` (producción local en otro puerto) antes y después; reportar los números. Si no hay sesión, brecha.

## Formato de salida
Resumen, archivos, salida literal de puertas, mediciones o brecha, riesgos. Commits `perf(web): …`. Sin merge ni push.

## Notas del orquestador (2026-11-06)
- Las tareas de caja, mesas y menú ya están integradas; parte de `main` actual. NO toques `apps/web/src/app/app/menu/menu-catalog-editor.tsx` (otra tarea lo edita en paralelo); `menu/page.tsx` y `menu/loading.tsx` sí.
- Medición en navegador: brecha aceptada si no hay sesión.
- Informe con bloque ``` de comandos y salida real.
