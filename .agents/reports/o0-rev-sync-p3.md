**Informe o0-rev-sync-p3** (modo lectura: no escribí `.agents/reports/o0-rev-sync-p3.md`; este mensaje es el entregable)

1. `VEREDICTO: APROBAR` — sin P1, cambio mínimo y las pruebas nuevas ejercitan el código real; 1 P2 preexistente y 5 P3 a deuda.
2. P2 `apps/api/src/sync/sync-merge-executor.ts:48-55` — el cable sigue emitiendo `AUTH_REVOKED` para `ACTOR_MISMATCH`/`INVALID_SCOPE` y `DEVICE_REVOKED` para `DEVICE_UNKNOWN`; el cliente revoca el scope y manda financieros pendientes a revisión manual (`packages/sync-engine/src/engine.ts:364-373,1132`) por causas que no son revocación: la distinción es sólo de log (justificado en el comentario 20-26; conducta preexistente, no regresión).
   P3 `sync-merge-executor.ts:15,49` — regex UUID-only frente a `isSyncId` que acepta ULID (`packages/shared-types/src/sync.ts:322`, probado en `sync.runtime.test.ts:137`): un envelope válido con ULID se rechaza como `AUTH_REVOKED` sin rastro en ledger.
   P3 `sync-merge-executor.ts:41,118-127` — `correlationId` nuevo por evento, no el del request: `app-setup.ts:26-30` ya emite uno por HTTP y `sync-push.service.ts:22` otro por push, así que el rechazo no se puede unir con ninguno.
   P3 `sync-merge-executor.ts:115` — `rejectEvent` (AUTH_REVOKED de contexto/catálogo, `TIMEZONE_MISMATCH`, `STALE`, `UNSUPPORTED_*`) no loguea: la deuda «rechazo sin log» queda medio cerrada.
   P3 `sync-transport.ts:111` — el 30 s por defecto también cubre `pullSnapshot` (hasta 5.000 entidades, `SYNC_MAX_SNAPSHOT_ENTITIES`): en enlaces lentos un snapshot >30 s falla siempre (retryable) y nunca establece la base; sin prueba ni límite por operación.
   P3 pruebas — no cubren el log de `AUTH_REVOKED` (`AccessTokenRejectedError`, `authorized !== true`) ni `INVALID_SCOPE`/ULID; el resto sí: la prueba de timeout demuestra el abort real (`sync-transport.test.ts:283-287`, 29.999 ms → no, +1 ms → `aborted === true`) y la de rechazos ejecuta el ejecutor con mock del ledger, sin aserciones tautológicas y comprobando el conjunto exacto de claves del log y la ausencia del token.
3. Deuda previa: `debt.md:74` (#60) log estructurado = parcial; token verificado N por push = sigue; `unknown`/`ACTOR_MISMATCH` = sólo log, cable igual (sigue, documentado); `debt.md:83` (#62) timeout 30 s = cerrado (`timeoutMs: 0` sigue desactivando, documentado, sin llamador); `Retry-After` en 429/503 = sigue; `debt.md:77` «#77 pendiente de revisión de pruebas» = cubierta aquí.
4. NO VERIFICADO: suites (`node --experimental-strip-types apps/web/src/lib/offline/sync-transport.test.ts` → `ERR_MODULE_NOT_FOUND ... sync-transport.js`; requiere build), PostgreSQL/`pg-verify`, navegador.

```powershell
> git show HEAD:apps/api/src/sync/sync-merge-executor.ts | Select-String "classifyRejection|row.device|uuid.test" 
27: export function classifyRejection(reason: RejectionReason): SyncRejection {
28:   return reason === "DEVICE_REVOKED" || reason === "DEVICE_UNKNOWN"
29:     ? { code: "DEVICE_REVOKED", reason }
49:   if (!uuid.test(event.restaurantId) || !uuid.test(event.branchId)) return reject(..., "INVALID_SCOPE")
55:   if (row.device !== "active") return reject(..., row.device === "unknown" ? "DEVICE_UNKNOWN" : "DEVICE_REVOKED")
> git show HEAD:supabase/migrations/20261123000300_sync_ledger.sql | Select-String "unique (restaurant_id"
35:  unique (restaurant_id, branch_id, idempotency_key),
```
El dedupe por `idempotency_key` (línea 35 + relectura `prior` en 184) hace determinista el reintento tras un timeout ambiguo: no hay doble efecto.