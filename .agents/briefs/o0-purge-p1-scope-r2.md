# Brief o0-purge-p1-scope-r2

NO escribas archivos fuera del repo ni en `$env:TEMP`. NO ejecutes PostgreSQL ni Playwright. NO commitees, NO hagas push, NO instales dependencias. No lances comandos con redirecciones a `$env:TEMP` (el sandbox lo rechaza y el run muere).

## Objetivo
Cerrar un P1 del almacén offline cifrado: `purgeForScope` borra la réplica pero deja el scope `active` con su `pullCursor`, así que el dispositivo sigue sincronizando un tenant del que salió y el pull incremental nunca re-trae entidades sin cambios.

Tiempo estimado: 20 min · Nivel A (aislamiento entre tenants)

## Alcance (únicos archivos; empieza por leerlos completos)
- `apps/web/src/lib/offline/sync-store.ts` (método `purgeForScope` y `wipeRows`, ~línea 300)
- `apps/web/src/lib/offline/sync-purge.test.ts`

Prohibido: `packages/sync-engine/**`, `web-sync-bridge.ts`, `sync-purge.ts`, `package.json`.

## Hecho concreto (no hace falta rediseñar)
1. En `purgeForScope`, tras filtrar la réplica del scope purgado: deja ese scope en `status: "resync_required"` y `pullCursor: null` (no lo borres; el motor exige el scope en `scopes` para retener el outbox). Comentario corto explicando el porqué.
2. `wipeRows` solo puede ejecutarse si **ningún** scope conserva réplica, outbox ni cursor. Hoy se decide ignorando los demás scopes (~línea 312).
3. `retainedScopeCount` cuenta los scopes que conservan réplica u outbox.
4. No toques `reencrypt`/`rotateKey`; si ves que rompen evidencia de otro scope, anótalo como hallazgo en el reporte.

## Pruebas (añádelas en `sync-purge.test.ts`, mismo arnés fake-indexeddb)
- purgar A con outbox pendiente: réplica de A fuera, outbox de A intacto, scope A `resync_required` con `pullCursor: null`, lectura posterior sin entidades de A.
- dos scopes A y B con réplica y outbox: purgar A no toca B (réplica, cursor y legibilidad).
- A con réplica y B **vacío**: purgar A no borra el scope/cursor de B.
- `purgeAll` con evidencia financiera sigue degradando a `purge_replica_keep_outbox`.

## Hecho cuando
- `pnpm --filter @super-restaurant/web run typecheck`, `lint` y `test` en 0. Si `pnpm run` intenta instalar, ejecuta los binarios de `node_modules` directamente (`node node_modules/typescript/bin/tsc ...`), sin instalar nada.
- Reporta la salida real (bloque ```) y por qué las pruebas nuevas fallarían con el código anterior.

## Reporte
`.agents/reports/o0-purge-p1-scope-r2.md`. Aplica Ponytail: cambio mínimo, sin recortar validación ni aislamiento.
