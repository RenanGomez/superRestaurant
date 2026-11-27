# Deuda tecnica

Hallazgos P2/P3 y atajos registrados. Se revisa al cerrar cada ola (barrido `debt-p3-sweep`).

**Regla de este fichero:** una entrada vive en **Activa** solo si hoy tiene impacto demostrable o riesgo
de dinero, datos, tenancy o seguridad; cada una lleva dueño y siguiente accion. Lo que ya no aplica o no
tiene impacto operativo pasa a **Archivada** con fecha y motivo (la version completa esta en el historial
de git). Nada se borra sin dejar rastro.

Barrido: 2026-11-26 (Ola 4, nivel D). Las entradas resueltas por los PR de la Ola 4 se marcan con el PR.

## Activa — muerde hoy

### Dinero y operacion
- **P2 · validacion de montos en zonas/entrega (`m3-rev-zonas`)** — `20261123000500` no valida
  incondicionalmente la paridad de moneda de `capture_delivery_manual_fees` y `frozen_quote` contra
  `p_order->>'currency'`, y `deliveryCharge.amount.amountMinor` se compara con `::text::numeric`
  (acepta `2500.0`, puede lanzar 22P02). Dueño: siguiente ola de SQL. Accion: `jsonb_typeof = 'number'`
  + regex de entero + paridad de moneda en la misma migracion con sus invariantes.
- **P3 · `transfer_out` puede dejar el almacen origen en negativo** — no hay guarda. Dueño: producto.
  Accion: decidir bloquear o alertar antes de la UI de conteo; si se bloquea, migracion con invariante.
- **P3 · `list_inventory_movements` devuelve `recipe_version_id = null` siempre** (`20261126000800`
  fija `null::uuid`). La trazabilidad vive en `app.inventory_consumptions`. Dueño: siguiente ola de
  inventario. Accion: migracion que una ambas tablas o retirar el campo del contrato.
- **P3 · `CashMovement`/reabrir turno con cruce de medianoche en caja mobile** — el selector usa la
  fecha de hoy y puede no ver el turno abierto. Dueño: mobile. Accion: usar la fecha de apertura de
  `state.shift` y prueba de cruce.
- **P3 · `transfer_out`/`receive` de compras sin asercion de `EXECUTE` negativa para
  `public/anon/authenticated/service_role`** — la tienen movimientos, no almacenes ni compras. Dueño:
  siguiente migracion de inventario. Accion: completar las aserciones en `inventory_*_invariants.sql`.

### Tenancy, permisos y sync
- **P2 · el proxy de sync valida `body.scope` contra la cookie, no cada evento** — un evento con
  `restaurantId`/`branchId` distintos depende de que el API responda `PUSH_SCOPE_VIOLATION`.
  Dueño: sync. Accion: validar por evento en el proxy o documentar la dependencia con prueba.
- **P2 · pruebas de conflictos de sync debiles** (`two_devices_add_lines`, `cancel_vs_kds_preparing`,
  `concurrent_same_line_edit`, sin push HTTP real hacia `manual_review`) y
  `test:sync-conflicts:local` fuera de CI. Dueño: sync. Accion: llevar la suite a `pg-verify` y añadir
  un push HTTP que produzca `manual_review`.
- **P3 · RBAC duplicado en SQL (PR #131)** — la lista de roles con `catalog.read` de
  `20261126001400_inventory_purchasing_reads.sql` copia `apps/api/src/auth/rbac-policy.ts`. Dueño:
  inventario. Accion: cuando cambie la matriz, cambiar la migracion; considerar una prueba que compare
  ambos conjuntos.
- **P3 · comentarios «manage-only» desactualizados en la BD (PR #131)** — **cerrado**: la migración
  `20261126001500_inventory_purchasing_read_comments` (#142) se aplicó a dev con el protocolo §19.6 y los
  tres comentarios ya describen `catalog.read`.
- **P3 · `INVALID_SCOPE` sigue en la ruta de revocación** (`sync-merge-executor.ts`): un cliente que
  envíe el scope de otro tenant recibe `AUTH_REVOKED` y pierde el scope entero en lugar de un rechazo
  por evento. Dueño: sync. Accion: emitir `INVALID_SCOPE` propio y decidir si es terminal por evento.
- **P3 · `correlationId` por evento, no por petición de push** — cada ejecución genera un `randomUUID`
  propio; sirve para trazar evento a evento pero no agrupa el batch. Dueño: sync. Accion: propagar el
  id de la petición y conservar el del evento en el detalle.
- **P3 · `items.service.ts` mapea cualquier `42501` a 403** — un fallo real de privilegios se presenta
  como "no autorizado". Dueño: API. Accion: distinguir por `message` acotado cuando exista un segundo
  42501.
- **P3 · `list_inventory_*` exige membresia pero no `catalog.read` en SQL** (movimientos/recetas) —
  el API lo frena antes. Dueño: SQL. Accion: mover la matriz a SQL como en compras si aparece otro
  consumidor.
- **P3 · `sync_review_event_facts` y commands sin RLS ni triggers de inmutabilidad;**
  `sync_read_reviews` sin paginacion; cursor sin `deviceId` y con expiracion fija de 30 dias. Dueño:
  sync. Accion: cerrar en la ola de auditoria de seguridad (M6).
- **P3 · rechazos `AUTH_REVOKED`/`DEVICE_REVOKED` del sync solo se registran parcialmente** y un token
  se verifica por evento (N por push). Dueño: sync. Accion: cachear la verificacion por push y añadir
  asercion de log estructurado.

### Pruebas visuales y e2e
- **P2 · `offline-kds.spec.ts` puede dar verde falso (`o0-rev-visual`, 2026-11-26)** — no usa
  `expectFinalRoute`/`assertBranchState` (`apps/web/e2e/visual/offline-kds.spec.ts:27-32`), asi que una
  redireccion a `/app` o `/login` deja el caso en verde. Dueño: pruebas visuales. Accion: usar el helper
  de ruta final y assertar el estado de sucursal.
- **P3 · `networkidle` con `catch` silenciado** en el mismo spec: puede fotografiar un shell de carga.
  Dueño: pruebas visuales. Accion: anclar a un elemento de datos y fallar si no aparece.
- **P3 · `assert-ui.ts` cuenta 404/501 de `/api/sync/*` como fallo de red** (backend sin desplegar),
  `accessibleName` ignora `img alt`, hay un `mkdirSync` redundante, `focus-visible` solo examina el
  primer Tab, y los insets no-`px` se leen como 0. Dueño: pruebas visuales. Accion: ajustar el helper y
  añadir los casos limite que faltan (44×43, 43×44, inset en `rem`, `::after`, control `static`).

### Offline, dispositivos y configuracion
- **P2 · la pestaña Compras queda vacia para `viewer`/`auditor` (PR #131)** — los `useEffect` de
  `apps/web/src/app/app/inventario/purchasing-panel.tsx:113,138,163` no cargan sin `canManage`, aunque
  la API ya permite leer. Dueño: UI inventario. Accion: cargar con `catalog.read` y ocultar solo las
  acciones de escritura.
- **P2 · `verify:capture-schema:rollback` cae en modo remoto con argumentos extra** — compara la cadena
  exacta de `argv` (`run-capture-schema-verification.ts:15`); cualquier argumento adicional ejecuta
  `verifyRemote()` en vez de rechazar. Dueño: verificadores. Accion: exigir exactamente
  `--local-disposable-only` o `--remote-only` y fallar cerrado.
- **P3 · `CUSTOMER_ADAPTER_VERIFICATION` tambien se lee en modo local** (corrida no hermética) y
  `docs/architecture/P2_MULTICHANNEL_CAPTURE_SLICE.md:7` sigue documentando el verificador como remoto.
  Dueño: verificadores. Accion: ignorar la variable en local y actualizar el doc.
- **P2 · identidad de dispositivo por equipo** — `debt-device-id` (Ola 4) la persiste por perfil de
  navegador y documenta que el servidor autoriza por actor. **Hallazgo de la Ola 5:** validar el
  `deviceId` de inventario contra `app.sync_devices` tal cual está hoy haría `unknown` a todo equipo
  (el id de inventario no es el id derivado por actor que registra el puente de sync) y rechazaría a
  todo equipo compartido. `o0-device-registry` exige primero derivarlo por actor y registrarlo antes de
  escribir. Dueño: inventario/sync. Accion: decidir derivacion + registro y añadir la prueba de rechazo
  de dispositivo ajeno.
- **P2 · `SYNC_CURSOR_SECRET` de produccion** — rotarlo invalida cursores. Dueño: operacion.
  Accion: definirlo (>=32) antes de desplegar y documentar la rotacion en el runbook.
- **P2 · `registerId = deviceId` en el cobro mobile** — no descubre ni permite elegir otra caja abierta
  de la sucursal. Dueño: mobile. Accion: seleccion de caja abierta o apertura controlada.
- **P3 · `FRACTION_DIGITS` duplicada** en `apps/mobile/src/money.ts` frente a
  `apps/web/src/lib/money-scale.ts`. Dueño: shared-types. Accion: consolidar una tabla por codigo ISO.
- **P3 · mobile offline sin verificacion en dispositivo real** — banner, cola, SQLCipher y
  `navigator.onLine`. Dueño: Emmanuel (puerta humana). Accion: emulador/dispositivo antes de prometer
  offline en mobile.

### Observabilidad y herramientas
- **P3 · `correlationId` solo en la linea de acceso HTTP** — no se propaga entre capas. Dueño: api.
  Accion: AsyncLocalStorage + prueba de concurrencia antes de depender de correlacion transversal.
- **P3 · rate limit sin cuota compartida ni por cuenta** — contadores en memoria por proceso; Auth de
  Supabase cubre credenciales; `x-forwarded-for` solo se confia con la cadena de proxies declarada.
  Dueño: operacion. Accion: almacenamiento compartido y despliegue exacto de `RATE_LIMIT_*`.
- **P3 · auditor visual: `insetsFromPseudo` no comprueba bloque contenedor, overflow ni oclusion.**
  Hoy todos los `FieldHint` son `relative`. Dueño: pruebas visuales. Accion: comprobar el bloque
  contenedor antes de ampliar el uso de pseudo-elementos.
- **P3 · `warehouseSaved` recarga toda la lista** y puede sustituir una lista valida por el panel de
  error. Dueño: UI inventario. Accion: parchear la fila guardada en estado.
- **P3 · `isDefault` obligatorio sin bump de contrato** — API y web deben desplegarse juntos; un bundle
  cacheado invalida la lista completa (`exactRecord`). Dueño: contratos. Accion: versionar el contrato
  al proximo cambio de inventario.
- **P3 · sin `CHECK (not (is_default and not active))`** en almacenes; el invariante depende del
  envoltorio y del indice parcial. Dueño: SQL. Accion: añadirlo en la proxima migracion de almacenes.
- **P3 · `storageState` de Playwright dura ~1 h y el pase visual rota el refresh token** — usar
  `tools/agentic/local-servers/refresh-e2e-session.mjs` antes de cada corrida; si responde
  `refresh_rejected`, login manual. Dueño: operacion de pruebas. Accion: documentado en runbook.
- **P3 · sandbox de dsh** — no lee/escribe fuera del repo y rechaza `$env:TEMP`; worktrees en
  `.harness/worktrees`. Dueño: harness. Accion: briefs con "no escribas fuera del repo" en la primera
  linea (aplicado).
- **P3 · verificador de impresion Bluetooth (#42)** — `declare function setTimeout` manual, backoff
  fijo 3×100-200 ms y error de conexion sin causa; sin impresora fisica. Dueño: impresion. Accion:
  usar tipos node, backoff configurable y registrar la causa; probar con equipo real.
- **P3 · `list_inventory_recipes` no filtra por `modifier_id`** y el parser acepta ULID y cantidades sin
  tope (SQL exige UUID y <=9 digitos). Dueño: inventario. Accion: alinear parser y SQL.
- **P3 · journey E2E no puede despublicar una receta** — si el producto nunca tuvo receta activa, deja
  la suya publicada. Dueño: inventario. Accion: endpoint de despublicacion o fixture por `runId`.
- **P3 · `deviceId` de recepcion en el cuerpo (no como `x-device-id`)** — inconsistente con
  movimientos. Dueño: inventario. Accion: unificar en la proxima revision de contrato.

## Archivada — sin impacto (2026-11-26)

- **2026-11-26 · P2 `ACTOR_MISMATCH`/`DEVICE_UNKNOWN` emitidos como revocación** — resuelto en #141:
  cada causa viaja con su código (`SYNC_RECOVERABLE_REJECTION_CODES`), el motor la trata como reintento
  con backoff y el puente vuelve a registrar el equipo; los financieros pendientes ya no van a
  `manual_review` por una causa recuperable.
- **2026-11-26 · P1 purga offline sin llamador de producción y `purgeReplica` rechazando `STORAGE_LOCKED`**
  — resuelto en #138: `sign_out` y `auth_revoked` aplican `decideOfflinePurge`; la revocación bloquea,
  purga la réplica con `allowLocked` y libera el sello sobre la evidencia retenida. `purge()` ya no
  encola un borrado entre pestañas.
- **2026-11-26 · P2 líder de sync sin consumidor productivo y seguidor sin timeout** — resuelto en #138:
  `runtime-sync-runner` abre el puente solo en el líder, el seguidor resuelve con timeout y explica el
  motivo, y la pérdida del lock descarta el motor y reintenta con la misma idempotency key.
- **2026-11-26 · P2 spec visual de KDS offline con falso verde** — resuelto en #139: ruta y sucursal
  reales, `networkidle` sin `catch` y casos límite del auditor por eje.
- **2026-11-26 · P2 verificador historico de grupos compartidos** — resuelto en PR #130 (fixture
  `begin;/commit;` + copias pineadas pre-`20261102000100`).
- **2026-11-26 · P2 verificador historico de Capture** — resuelto en PR #130 (modo local desechable +
  fixture pineado previo a `20260917000100`).
- **2026-11-26 · P1 release purgaba evidencia financiera rechazada** — resuelto en #132: `release()`
  retiene el almacén mientras quede algo que el motor no pueda compactar; prueba con `cash_collect`
  rechazado.
- **2026-11-26 · P1/P2 purga de scope conservaba cursor y podía borrar otro scope** — resuelto en #133:
  el scope purgado queda `resync_required` con cursor nulo, outbox intacto, y el wipe total exige que no
  quede nada en ningún scope.
- **2026-11-26 · P2 `deviceId` de recepción en `sessionStorage`** — resuelto en #134: persistencia por
  perfil con helper puro; la validación contra el registro queda como `o0-device-registry` (la función
  `app_private.sync_device_state` ya existe y está concedida a `app_api`).
- **2026-11-26 · P2 `o0-wire` (cableado de pruebas de la Ola 0)** — cerrado en #85; el líder productivo
  pasa a `o0-leader-wire`.
- **2026-11-26 · P3 `lists` de compras con `catalog.manage`** — cerrado en #131 junto con la migración.
- **2026-11-26 · P2 `app_api` con `EXECUTE` en `inventory_record_movement`** — cerrado en #122 con
  `inventory_record_manual_movement`.
- **2026-11-26 · P3 `items.module.ts` huerfano** — eliminado en #115.
- **2026-11-26 · P3 filas de prueba con `' cebolla '`** — el seed violaba `btrim(name)` desde el
  catalogo base; corregido en PR #130.
- **2026-11-26 · P2/P3 de #62 (lider entre pestanas, purga, `keyVersion`, AAD, timeout de transporte)**
  — resueltos en #73, #74 y #77.
- **2026-11-26 · P2 de #66 (carrera `!alive`, ruta resume/locked)** — resuelto en #75.
- **2026-11-26 · P2 de #70 (carrera release/commit, actor ajeno, tamano, timeout, headers)** —
  resueltos en el propio #70; queda solo la validacion por evento (activa).
- **2026-11-26 · P3 foco explicito en chips de zonas y copy de `customer-editor`** — sin impacto
  operativo; se recoge al unificar el patron de dialogos y al tocar ese editor.
- **2026-11-26 · P3 modales de atajos/captura sin `trapFocusIndex`** — se recoge con el helper de
  dialogos y `inert` (tambien pendiente como P3 de UI de inventario).
- **2026-11-26 · P3 `node-test-shims.d.ts` en el tsconfig de build** — solo afecta a tipos de prueba.
- **2026-11-26 · P3 smoke E2E limitado a `/health` y `/login`** — superado por los journeys (13) y el
  pase visual 12/12.
- **2026-11-26 · P3 pruebas KDS de idempotencia/IO y `clearKdsCache`** — cubierto por el motor de sync y
  el journey; se reabre si aparece un fallo de campo.
- **2026-11-26 · P3 `bootstrapTransactionalHttpApp` duplica `bootstrapHttpApp`** — duplicacion de arnes
  sin impacto en producto.
- **2026-11-26 · decision rechazada de conceder DML directo a `app_api`** — registro historico; prevalece
  ADR-013 §13.
