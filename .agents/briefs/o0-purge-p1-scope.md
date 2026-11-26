# Brief o0-purge-p1-scope

NO escribas archivos fuera del repo ni en `$env:TEMP`. NO ejecutes PostgreSQL ni Playwright. NO commitees, NO hagas push, NO instales dependencias.

## Objetivo
Cerrar un P1 del almacén offline cifrado: `purgeForScope` borra la réplica pero deja el scope `active` y su `pullCursor`, así que el dispositivo sigue sincronizando un tenant del que salió y el pull incremental nunca vuelve a traer entidades sin cambios (réplica incompleta).

Tiempo estimado: 25 min · Nivel A (aislamiento/tenant)

## Alcance (únicos archivos)
- `apps/web/src/lib/offline/sync-store.ts`
- `apps/web/src/lib/offline/sync-purge.test.ts`

Prohibido: `packages/sync-engine/**`, `web-sync-bridge.ts`, `sync-purge.ts`, `package.json`.

## El fallo (verificado por revisión)
`apps/web/src/lib/offline/sync-store.ts:300-333` (`purgeForScope`) filtra solo `replica`, y devuelve `retainedScopeCount` contando scopes sin tocar `scopes` ni `pullCursor`. El contrato del motor (`packages/sync-engine/src/durable-state.ts:15-24,79-95`) admite `status: "active" | "revoked" | "resync_required"` y `pullCursor: string | null`, y exige que el scope siga en `scopes` para retener su outbox.

## Arreglo
1. Tras quitar la réplica del scope purgado, deja ese scope en `status: "resync_required"` y `pullCursor: null` (no lo borres: el outbox debe seguir retenido y el motor necesita el scope para conservarlo). Documenta el porqué en un comentario corto.
2. Arregla también el P2 del wipe: hoy `wipeRows` se decide ignorando los otros scopes (`sync-store.ts:312`), así que purgar A puede borrar el scope/cursor de B. Solo se puede borrar todo (`wipeRows`) si **ningún** scope conserva réplica, outbox ni cursor.
3. `retainedScopeCount` debe seguir contando los scopes que conservan réplica u outbox (no los `resync_required` vacíos).
4. Pruebas en `sync-purge.test.ts` (usa el mismo arnés `fake-indexeddb` del archivo):
   - `purgeForScope(A)` con outbox pendiente en A: la réplica de A desaparece, el outbox de A se conserva verbatim, el scope A queda `resync_required` con `pullCursor: null`, y una lectura posterior no devuelve entidades de A.
   - dos scopes A y B con réplica y outbox: purgar A no toca B (réplica, cursor y clave siguen legibles).
   - A con réplica y B **vacío** (sin réplica/outbox): purgar A no borra el scope/cursor de B.
   - `purgeAll` sobre un store con evidencia financiera sigue degradando a `purge_replica_keep_outbox` (comportamiento actual), sin perder el outbox.
5. No cambies `reencrypt`/`rotateKey` salvo que sea imprescindible; si detectas que rompe evidencia de otro scope, anótalo como hallazgo y no lo arregles aquí.

## Hecho cuando
- `pnpm --filter @super-restaurant/web run typecheck`, `lint` y `test` en 0.
- Las pruebas nuevas fallarían con el código anterior (demuéstralo con salida real en el reporte).

## Reporte
`.agents/reports/o0-purge-p1-scope.md`: cambio, pruebas con salida real (bloque ```), hallazgo de `rotateKey` si lo hay, y qué no verificaste. Aplica Ponytail.
