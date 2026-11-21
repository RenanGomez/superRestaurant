# Brief review-wave1b (revisión nivel C, SIN escritura)

## Objetivo
Una sola ronda de revisión del diff pendiente de `apps/web` (git diff + archivos nuevos) para: capture-customer-search, capture-shortcuts-r2, capture-address-note-fix, menu-sizes-inline, menu-product-actions, menu-photos-recent, menu-photo-crop (photo-crop-dialog.tsx, lib/menu-photo-crop.ts), customer-search-stale-results. Ya revisado y fuera de alcance: field-hint, app-nav, capture-workspace.

## Criterios
Bugs, accesibilidad (foco, aria, targets 44 px, teclado, reduced-motion), seguridad, carga real, tests faltantes, y qué sobra. Atención: photo-crop-dialog (canvas, liberación de object URLs, teclado), menu-catalog-editor (menú ⋮, Quitar), carreras en búsqueda de clientes.

## Alcance
Solo lectura; no edites ni ejecutes nada que escriba. Prohibido git commit/push.

## Hecho cuando
Veredicto APROBAR / CORREGIR; por hallazgo: P1/P2/P3, archivo:línea y fix. Sin P1/P2 = APROBAR. Informe en `.agents/reports/review-wave1b.md` (≤20 líneas) con bloque ``` con comando y salida real.
