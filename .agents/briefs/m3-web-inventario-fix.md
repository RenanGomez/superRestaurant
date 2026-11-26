# Brief m3-web-inventario-fix (nivel C · P2/P3 de la revisión)

## Objetivo
Corregir los hallazgos de la revisión de `m3-web-inventario`.

Tiempo estimado: 15 min. Escritor único de `apps/web/src/app/app/inventario/**` y `apps/web/src/lib/inventory-ui.ts` (si aplica).

## Cambios
1. **P2 — timeout:** en `apps/web/src/app/app/inventario/actions.ts`, añade `signal: AbortSignal.timeout(10_000)` a los `fetch` (mismo patrón que los demás módulos del shell) y devuelve un resultado de error legible («El servidor tardó demasiado. Reintenta.») sin dejar `saving` en true. Si el usuario ya cerró el diálogo, no abras otro.
2. **P3 — unidades:** usa `INVENTORY_UNITS` de `@super-restaurant/shared-types` en lugar de la lista literal `g|ml|piece` en `inventory-workspace.tsx` (etiquetas en español derivadas de ese array; no cambies el contrato).
3. **P3 — fondo del diálogo:** marca el resto del shell como `aria-hidden`/`inert` mientras el diálogo está abierto si ya existe un helper en el repo; si no, deja el foco atrapado como está y anótalo.
4. **P3 — 401:** muestra «Vuelve a iniciar sesión» (no «sin permiso») cuando el API responde 401.

## Prohibido
- Tocar `apps/api`, SQL, otros módulos, dependencias. Sin `alert/confirm/prompt`. Sin commit/push. No ejecutes el navegador.

## Puertas (Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
& $PNPM --filter @super-restaurant/web test
& $PNPM --filter @super-restaurant/web build
```

## Hecho cuando
Los cuatro puntos aplicados (o el 3 documentado), puertas web verdes con salida real e informe con `git status --short`. Aplica Ponytail.
