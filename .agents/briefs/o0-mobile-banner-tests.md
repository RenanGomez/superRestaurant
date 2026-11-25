# Brief o0-mobile-banner-tests (nivel B · mobile offline)

## Objetivo
Cubrir con pruebas la carrera `!alive` del banner de sync mobile y la ruta «sesión reanudada / almacén bloqueado», sin cambiar el comportamiento visible.

Tiempo estimado: 20 min.

## Alcance
- Crea/edita SOLO: `apps/mobile/src/ui/sync-banner.tsx`, `apps/mobile/src/ui/sync-banner-lifecycle.ts` (nuevo), `apps/mobile/src/ui/sync-banner-lifecycle.test.ts` (nuevo), `apps/mobile/tsconfig.test.build.json`.
- Prohibido: tocar `apps/mobile/package.json` (lo cablea `o0-wire`), `apps/web/**`, `apps/api/**`, migraciones, dependencias. Sin `git push`.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Contexto y firmas reales
- `apps/mobile/src/ui/sync-banner.tsx` exporta `SyncBanner`, `MobileSyncBridge` y `useMobileSyncBridge(options)`. El efecto vive en las líneas ~221–295: `let alive = true`, guardas `if (!alive) return`, lectura de `health.locked`, `runtime.session.resumeSession(...)` y limpieza con `alive = false`.
- El proyecto no tiene renderer de React en pruebas (no hay `.test.tsx` ni `react-test-renderer`): **no** escribas pruebas de componentes. Extrae la lógica del efecto a un módulo `.ts` puro y prueba ese módulo.
- Tests mobile: `tsc --project tsconfig.test.build.json` (lista `include` explícita) y luego `node .test-dist/<ruta>.test.js`.

## Qué construir
1. `sync-banner-lifecycle.ts`: una función pequeña que reproduzca el ciclo del efecto con dependencias inyectadas, por ejemplo
   `createSyncBannerLifecycle({ loadHealth, resumeSession, onState }): { start(): void; stop(): void }`
   con las mismas guardas que hoy: tras `stop()` ningún resultado tardío llama a `onState`; `health.locked` produce el aviso de bloqueo; `resumeSession` devuelto distinto de `resumed` produce el aviso de reanudación fallida; éxito produce el snapshot normal.
2. `sync-banner.tsx` usa ese módulo en el efecto existente **sin cambiar textos, estilos ni comportamiento observable**.
3. `sync-banner-lifecycle.test.ts` (`node:test` + `node:assert/strict`) con al menos: (a) promesa resuelta después de `stop()` no emite estado; (b) `locked` produce aviso de bloqueo; (c) `resumeSession` fallido produce aviso de reanudación; (d) éxito emite snapshot.
4. Añade al `include` de `apps/mobile/tsconfig.test.build.json` las dos rutas nuevas (`src/ui/sync-banner.tsx` y `src/ui/sync-banner-lifecycle.ts` + su test).

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # debe imprimir v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/mobile lint
& $PNPM --filter @super-restaurant/mobile typecheck
& $PNPM --filter @super-restaurant/mobile exec tsc --project tsconfig.test.build.json
node .test-dist/ui/sync-banner-lifecycle.test.js
```
No uses el `pnpm` del PATH (es Node 22). Si `tsc --project tsconfig.test.build.json` falla por módulos del banner (React Native), limita el `include` a los archivos necesarios y explica la decisión en el informe.

## Hecho cuando
- Las cuatro pruebas nuevas pasan con salida real.
- `lint`, `typecheck` y `git diff --check` en verde.
- El banner conserva exactamente los textos actuales (sin jerga ni identificadores internos).

## Cierre
- **No hagas commit ni push**: el orquestador revisa y fusiona desde tu worktree.
- Tu respuesta final ES el informe, con bloques comando + salida real. Sin evidencia = NO VERIFICADO.
- Aplica Ponytail: cambio más pequeño correcto, reutiliza lo existente, sin recortar validación, errores, seguridad ni pruebas.
