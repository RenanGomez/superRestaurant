# Revisi├│n cruzada ΓÇö PR #54 `ao/web-sync-status-ui`

- **PR:** https://github.com/RenanGomez/superRestaurant/pull/54
- **T├¡tulo:** feat(web): barra de estado de conectividad y vista /app/sync (m2-web-sync-status-ui)
- **Head revisado:** `af9158d5eb849c8195122f12086f528fa56bd1f2` (ronda 0)
  y `61e699f28758dcbd989beb60f20c593e4c482a8d` (ronda 1, re-revisi├│n acotada)
- **Base:** `main` (`2a57270b`)
- **Nivel:** C ┬╖ `apps/web`
- **Revisor:** sesi├│n de revisi├│n solo lectura (no modifica el PR)
- **Fecha:** 2026-11-23

## Re-revisi├│n ronda 1 ΓÇö `61e699f2`

Alcance acotado: confirmar que P1.1 qued├│ resuelto y que no hay P1 nuevos.

**P1.1 resuelto.** `not_deployed` ya no fabrica un timestamp:

- `actions.ts:136-160`: `ConnectivityProbeOutcome` separa `ok` (servidor alcanzable)
  de `syncAvailable` y `syncConfirmedAt: string | null`; `not_deployed` devuelve
  `syncAvailable: false, syncConfirmedAt: null`.
- `server-fetch.ts:44-46`: `404`/`501` devuelven `{ status: "not_deployed" }` sin
  `confirmedAt` (adem├ís se movi├│ fuera de `"use server"`, resolviendo P2.3).
- `page.tsx:45-46`: `initialConfirmedAt` s├│lo se toma de `status === "ok"`; si no, `null`.
- `layout.tsx:83-88`: la barra arranca con `initialConfirmedAt={null}` y
  `initialServerReachable` separado (resuelve P2.4).
- `sync-ui.ts:487-549`: `buildSyncBannerMessage` recibe `syncServiceAvailable` y, si es
  `false`, emite ΓÇ£Conectado con el servidor. El servicio de sincronizaci├│n a├║n no est├í
  habilitado en este entorno.ΓÇ¥ antes de cualquier `reconciliationComplete`; sin
  `lastConfirmedSyncAt` devuelve ΓÇ£A├║n no hay una sincronizaci├│n confirmadaΓÇ¥.
- `sync-dashboard.tsx:291,345-370,399-425`: s├│lo se llama `reconciliationComplete` con un
  timestamp real (bridge o API `ok`); con `not_deployed` muestra un aviso informativo de
  servicio no habilitado.
- Test nuevo `sync-ui.test.ts:441-472` fija que `not_deployed`/sin confirmar nunca emiten
  ΓÇ£Sincronizaci├│n confirmadaΓÇ¥.

Mejoras colaterales verificadas: P2.1 (copy honesto de la bandeja), P2.2
(`tryGenerateSyncId` fail-closed sin UUID cero), P2.5 (`rejected` no se rotula como permiso
salvo c├│digos de autorizaci├│n), P3.1/P3.3/P3.4.

**Sin P1 nuevos.** Se revisaron las rutas de reintento/resync: `handleRetryPending` y
`handleFullResync` s├│lo emiten `reconciliationComplete` con `bridgeConfirmedAt` o
`serverResult.syncConfirmedAt` no nulos; `denied`/`not_deployed` producen mensajes de
conectividad/servicio, no de reconciliaci├│n.

**Puertas ronda 1 (Node 24.19.0, pnpm 11.19.0):** `lint` exit 0 ┬╖ `typecheck` exit 0 ┬╖
`test` exit 0 (`sync-ui.test` 15/15).

## Alcance revisado

`SyncStatusBar` (`apps/web/src/components/sync-status-bar.tsx`), `/app/sync`
(`apps/web/src/app/app/sync/{page,actions,sync-dashboard}.tsx`), helpers puros
(`apps/web/src/lib/sync-ui.ts` + `sync-ui.test.ts`), integraci├│n en
`apps/web/src/app/app/layout.tsx` / `app-nav.tsx` y cambio de `apps/web/package.json`.

## Puertas ejecutadas (Node 24.19.0, pnpm 11.19.0)

Se ejecutaron sobre el head del PR (checkout desprendido, worktree limpio):

| Comando | Resultado |
|---|---|
| `pnpm --filter @super-restaurant/shared-types build` (prerrequisito, `dist/` ausente en worktree) | exit 0 |
| `pnpm --filter @super-restaurant/web lint` (`--max-warnings=0`) | exit 0 |
| `pnpm --filter @super-restaurant/web typecheck` | exit 0 |
| `pnpm --filter @super-restaurant/web test` | exit 0 ┬╖ `sync-ui.test` 12/12, `class-conflicts` 11/11, `rsc-boundary` 7/7 |

No se ejecut├│ `next build` ni verificaci├│n visual (fuera del alcance pedido; el autor
declara build y capturas en `HANDOFF.md`, no reproducidas aqu├¡).

## Conformidad con los criterios pedidos

- **No calcula dinero:** `formatSyncAmountMinor` (`sync-ui.ts:586-604`) s├│lo formatea
  enteros de unidad menor provistos por el servidor (`Number.isSafeInteger`, sin floats);
  no hay rec├ílculo de totales ni impuestos. **Cumple.**
- **No decide permisos:** `canResolveManualReview` es s├│lo pista visual
  (`page.tsx:56`, `sync-dashboard.tsx:899-918`); las Server Actions revalidan sesi├│n,
  membres├¡a y sucursal (`actions.ts:54-101`) y la resoluci├│n se apoya en el 403 del API
  (`actions.ts:276-278`). **Cumple** (ver P3 de defensa en profundidad).
- **Sin `alert`/`confirm`/`prompt`:** grep sobre los archivos nuevos sin coincidencias;
  el di├ílogo es `role="dialog"` con Escape y `trapFocusIndex` (`sync-dashboard.tsx:426-445, 927-1061`). **Cumple.**
- **Targets ΓëÑ 44 px:** base `min-h-11` en `uiButton`/`uiChip`/`uiOption`
  (`ui-classes.ts:15`), enlace de la barra `min-h-11` (`sync-status-bar.tsx:230`) y
  bot├│n de cierre `min-w-11` (`sync-dashboard.tsx:958`). **Cumple.**
- **Textos ┬º2.3:** los 9 mensajes de `SYNC_MATRIX_MESSAGES` (`sync-ui.ts:37-56`) coinciden
  literalmente con `docs/architecture/OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX.md:75-89`
  y est├ín cubiertos por test exacto (`sync-ui.test.ts:102-139`). **Cumple.**
- **Aislamiento por sucursal:** `normalizeScopedSyncSnapshot`/`normalizeScopedSyncEvent`
  descartan eventos de otro `restaurantId`/`branchId` (`sync-ui.ts:661-758`);
  `parseScopedManualReviewList` falla cerrado ante casos cruzados (`sync-ui.ts:824-851`);
  las acciones toman el scope de la cookie de sucursal autorizada. **Cumple.**
- **Sin secretos:** no hay credenciales ni tokens en el c├│digo; el access token s├│lo se usa
  server-side. Observaci├│n P2 sobre la superficie de `fetchManualReviewCases`.
- **Degradaci├│n `not_deployed` honesta:** **NO cumple** ΓÇö ver P1.

## Hallazgos

### P1 ΓÇö Bloqueante

**P1.1 ┬╖ `not_deployed` fabrica una ΓÇ£sincronizaci├│n confirmadaΓÇ¥ que nunca ocurri├│.**

- `apps/web/src/app/app/sync/actions.ts:143-145`: ante `404`/`501` se devuelve
  `status: "not_deployed"` **con `confirmedAt = new Date().toISOString()`**, es decir, el
  instante en que el endpoint *no exist├¡a* se trata como confirmaci├│n.
- `apps/web/src/app/app/sync/page.tsx:45-48` y `sync-dashboard.tsx:138-142` usan ese
  `confirmedAt` como ΓÇ£├║ltima confirmaci├│nΓÇ¥; `layout.tsx:86` hace lo mismo con
  `new Date().toISOString()` en cada carga autenticada.
- Con estado `online`, cola vac├¡a y `formattedTime !== null`,
  `buildSyncBannerMessage` (`sync-ui.ts:522-531`) emite
  `SYNC_MATRIX_MESSAGES.reconciliationComplete`:
  **ΓÇ£Sincronizaci├│n confirmada a las HH:mm. No hay pendientes.ΓÇ¥**, y la m├⌐trica
  ΓÇ£├Ültima confirmaci├│nΓÇ¥ se rotula ΓÇ£Verificada con el servidorΓÇ¥
  (`sync-dashboard.tsx:641-649`).

Efecto real: mientras `m2-api-sync-pull-review` no exista (el estado por defecto descrito
por el propio PR), todo operador que abra `/app/sync` ver├í una reconciliaci├│n confirmada y
ΓÇ£no hay pendientesΓÇ¥ aunque no haya ocurrido sincronizaci├│n alguna. Es exactamente el tipo de
afirmaci├│n que ┬º2.3 reserva para reconciliaci├│n real y contradice el criterio de degradaci├│n
honesta. Debe distinguirse ΓÇ£servidor alcanzable/probadoΓÇ¥ de ΓÇ£sync confirmadoΓÇ¥: con
`not_deployed` no debe propagarse `confirmedAt` ni emitirse `reconciliationComplete`.

### P2 ΓÇö No bloqueante, registrar y corregir en seguimiento

- **P2.1 ┬╖ Copy de la bandeja de revisi├│n enga├▒oso en `not_deployed`** ΓÇö
  `sync-dashboard.tsx:831-835`: con `reviewSourceStatus === "not_deployed"` y sin casos
  locales se afirma ΓÇ£No hay casos pendientes de revisi├│n en este momento. Cuando exista un
  conflictoΓÇª aparecer├í aqu├¡ΓÇ¥. Cuando el servicio no existe la respuesta honesta es declarar
  que la bandeja no est├í disponible en este entorno, no que no hay casos.
- **P2.2 ┬╖ Fallback de UUID todo-ceros rompe la idempotencia** ΓÇö
  `sync-dashboard.tsx:117-122`: si `crypto.randomUUID` no est├í disponible (contexto no
  seguro/navegador antiguo), `createUuid()` devuelve
  `00000000-0000-4000-8000-000000000000`. Como se usa para `idempotencyKey`
  (`mr-resolve-${uuid}`) y `compensatingEventId` (`sync-dashboard.tsx:469-474`), dos
  resoluciones distintas obtendr├¡an la misma clave idempotente y el mismo evento
  compensatorio, anulando la protecci├│n anti-duplicado del servidor. Debe fallar cerrado
  (deshabilitar y avisar) en ausencia de `randomUUID`.
- **P2.3 ┬╖ Server Action exportada que acepta token y `apiBaseUrl` arbitrarios** ΓÇö
  `actions.ts:124-128`: `fetchManualReviewCases(accessToken, apiBaseUrl, scope)` est├í
  exportada desde un m├│dulo `"use server"`, por lo que Next la registra como Server Action
  invocable. Acepta credenciales y URL de destino como par├ímetros del llamador, lo que abre
  una superficie de petici├│n saliente dirigida (SSRF/uso del token) sin revalidar sesi├│n
  interna. Debe moverse a un m├│dulo sin `"use server"` (helper interno) o resolver
  sesi├│n/scope/URL en servidor y no recibirlos como argumentos.
- **P2.4 ┬╖ La barra marca ΓÇ£├Ültima confirmaci├│nΓÇ¥ al cargar la p├ígina** ΓÇö
  `layout.tsx:83-87` pasa `new Date().toISOString()` siempre que hay membres├¡as;
  `sync-status-bar.tsx:56,58,183` lo usa para fijar `serverReachable = true` y mostrar
  ΓÇ£En l├¡nea ┬╖ ├Ültima confirmaci├│n: HH:mmΓÇ¥ sin sonda ni sync real. La barra debe arrancar en
  estado ΓÇ£sin confirmarΓÇ¥ y poblar la hora s├│lo desde una sonda/bridge real.
- **P2.5 ┬╖ `rejected` se traduce siempre a ΓÇ£permiso inv├ílidoΓÇ¥** ΓÇö
  `sync-ui.ts:439-441`: un evento `rejected` por precondici├│n/versi├│n/scope (no s├│lo por
  permiso) muestra ΓÇ£La autorizaci├│n no fue v├ílida en el servidorΓÇ¥. Debe mapearse por c├│digo
  de error y reservar el mensaje de permiso para los c├│digos de autorizaci├│n.

### P3 ΓÇö Menor

- **P3.1** `deriveConnectivityState` declara `pendingCount` en `DeriveConnectivityInput`
  (`sync-ui.ts:146`) pero no lo usa (`sync-ui.ts:162-182`); par├ímetro muerto que puede
  inducir a error. Retirarlo o documentar que no participa.
- **P3.2** `formatSyncAmountMinor` antepone `$` a cualquier moneda ISO
  (`sync-ui.ts:597-603`), incluido JPY/EUR; el test lo fija (`sync-ui.test.ts:324`). Si el
  producto s├│lo opera MXN es aceptable, pero conviene derivar el s├¡mbolo o el c├│digo ISO.
- **P3.3** `resolveManualReviewCaseAction` no verifica el rol de supervisor en el borde web
  (`actions.ts:225-232`); conf├¡a en el 403 del API. Es correcto por autoridad del servidor,
  pero a├▒adir `isSupervisorRoleList` como defensa temprana reduce llamadas in├║tiles.
- **P3.4** El di├ílogo de resoluci├│n no restaura el foco al control que lo abri├│ al cerrarse
  (`sync-dashboard.tsx:419-424`); s├│lo enfoca al abrir (`260-267`).
- **P3.5** No hay pruebas de las Server Actions ni de render del dashboard/barra; nivel C
  s├│lo exige helpers puros y ├⌐stos est├ín cubiertos, pero la l├│gica de degradaci├│n P1 no
  tiene test que la blinde.

## Veredicto

**APROBAR** (ronda 1, head `61e699f2`). P1.1 qued├│ resuelto: con `not_deployed` no se fabrica
`confirmedAt` ni se emite `reconciliationComplete`, y la UI declara de forma honesta que el
servicio de sincronizaci├│n no est├í habilitado. No se detectaron P1 nuevos y las puertas del
web (`lint`, `typecheck`, `test` 15/15) est├ín en verde.

Los P2/P3 restantes de la ronda 0 pasan a deuda de seguimiento, en particular:
`formatSyncAmountMinor` con s├¡mbolo `$` fijo para toda moneda (P3.2), ausencia de pruebas de
render/Server Actions (P3.5) y la verificaci├│n visual/build que el autor declara en
`HANDOFF.md` pero que esta revisi├│n acotada no reprodujo.
