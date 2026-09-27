# order-item-note

## Tarea
order-item-note · capa: L1 (`implementer-claude`) · riesgo: alto · nivel A (`packages/domain` Order/OrderItem, contrato compartido consumido por API, web y KDS, persistencia del agregado Order y, si hace falta, SQL).

## Objetivo
Que una línea de pedido lleve una nota a cocina opcional («sin cebolla», «bien cocida»), capturada en la hoja de producto de `/app/capture`, congelada en `OrderItem` al confirmar, visible en KDS y en el ticket impreso. Hoy `CaptureSelectionLineV1.note` existe en el contrato pero el API la rechaza con 409 `CAPTURE_SELECTION_NOTE_UNSUPPORTED` porque `OrderItem` no la modela.

## Hechos verificados (main `4392d23`)
- `packages/domain/src/order.ts`: `OrderItem extends OrderItemPricingInput { restaurantId, branchId, status, cancellationAudit? }`; `addOrderItem(order, { orderItemId, quantity, snapshot }, audit)`.
- Persistencia: `apps/api/src/persistence/order-persistence-codec.ts` codifica el agregado Order (ítems con `orderItemId`, `snapshot: PersistedOrderItemPriceSnapshotV1`, evento `item-added`). Investiga con CodeGraph si los ítems viven en JSON del agregado o en tabla; si hay tabla/columnas SQL o funciones `app_private` que validen la forma de los ítems (p. ej. `confirm_capture_draft_v3` compara snapshots byte a byte), la nota debe caber ahí y eso requiere migración candidata `20260930000100_order_item_note.sql` (reproducible, verificador local PG17, sonda `probe:migration:rollback` sólo local).
- Plan de selección: `apps/api/src/captures.ts` (`priceSelectionPlan` rechaza `note !== null` → `CaptureSelectionNoteUnsupportedError`; `materializeCaptureSelectionOrder` en `capture-repeat-order-plan.ts` no propaga la nota). Proyección `CaptureSelectionPlanProjectionLineV1.note` ya existe.
- KDS: contrato de eventos en `packages/shared-types/src/realtime.ts` (`KdsEventV1`) y cliente `apps/kds`; `packages/printing` renderiza el ticket de entrega (`renderHandoffTicket`).
- Web: `apps/web/src/app/app/capture/product-sheet.tsx` (sin campo de nota por decisión anterior), `capture-ticket.tsx` (muestra `note` de la proyección si no es null), `apps/web/src/lib/capture-selection.ts` (`buildSelectionPlan` fija `note: null`).

## Criterios de aceptación
- [ ] Dominio: `OrderItem.note: string | null` (texto 1..200, sin caracteres de control, recortado sólo por el cliente; el dominio rechaza, no corrige) en `addOrderItem` y en el snapshot congelado; pruebas unitarias (acepta null, acepta texto válido, rechaza vacío/largo/control chars, inmutable tras cancelación).
- [ ] Persistencia/codec y, si aplica, SQL: la nota se guarda y se relee en el agregado; compatibilidad con órdenes existentes sin nota (`null`). Si tocas SQL: migración candidata nueva, verificador local, pruebas de aislamiento no afectadas. Si `confirm_capture_draft_v3` valida la forma del snapshot/ítem, ajusta esa validación en la migración nueva (`create or replace`) sin relajar nada más.
- [ ] Contratos: `OrderV1`/línea de orden en shared-types (busca el contrato que consume web/KDS), `KdsEventV1` si transporta líneas, y el ticket de `packages/printing`: la nota se muestra bajo la línea con prefijo «Nota:»; pruebas byte a byte del encoder actualizadas.
- [ ] API: `priceSelectionPlan` acepta la nota; `materializeCaptureSelectionOrder` y el plan de repetición la propagan (repetición: `null`); eliminar `CaptureSelectionNoteUnsupportedError` y su mapeo; pruebas actualizadas.
- [ ] Web: campo «Nota para cocina» en la hoja de producto (≤200, contador), `buildSelectionPlan` la envía, la línea del ticket la muestra; `applyLineChange` no fusiona líneas con notas distintas (ya previsto). Puertas web.
- [ ] KDS: la tarjeta de línea muestra la nota destacada; puertas de `apps/kds`.
- [ ] `pnpm -w run lint|typecheck|test|build` verdes al final; CodeGraph/grep de consumidores de `OrderItem`, `addOrderItem`, `PersistedOrderItemPriceSnapshotV1`.

## Invariantes
- Dinero intacto: la nota no altera precios ni snapshots monetarios; ningún cálculo cambia.
- Snapshots congelados: la nota se congela con el ítem y no se edita después (una corrección es cancelar + reemplazar, S6).
- No editar migraciones aplicadas; scope y RLS sin cambios.

## Entorno
Worktree `C:\tmp\sr-wt\order-item-note` (rama `claude/order-item-note` desde `main`). Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`; PG17 en `.cache/postgres-local/pgsql`. Un commit por unidad (domain → shared-types → api/persistencia(+SQL) → printing → web → kds). Informe parcial a los ~35 turnos; nunca conectes al remoto. Sin push.

## Formato de salida
Resumen y decisiones (dónde vive la nota en persistencia), archivos y commits, salida literal de puertas y verificador PG si hay SQL, riesgos.
