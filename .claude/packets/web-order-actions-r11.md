# web-order-actions-r11 (addendum; hallazgo Codex ronda 10, log `.claude/runs/web-order-actions/review-r10.log`)

## Tarea
web-order-actions-r11 · capa: L1 (`implementer-claude`, mismo escritor) · riesgo: bajo · nivel B (`apps/api/src/orders.ts` sendToKitchen). Sin SQL ni contrato.

## Objetivo
[P2] `orders.ts:490-498`: con versión avanzada, `replayed: true` se atribuye al comando sin verificar su identidad; otro operador pudo haber abierto y enviado esas líneas. Decisión del orquestador: sin payload persistido no hay identidad verificable, así que **la rama de versión avanzada devuelve siempre `conflict`**. El cliente recarga y, si las líneas ya están enviadas, la acción desaparece de `availableActions`; nada se pierde. El replay por idempotencia queda limitado a reenvíos con la misma `expectedVersion` (p. ej. doble clic), donde `persist_order_mutation` replica por claves derivadas.

## Criterios de aceptación
- [ ] `sendToKitchen`: `stored.version !== command.expectedVersion` → `conflict` sin persistir (eliminar la rama `replayed: true` por estado, `VERIFIABLY_SENT_ORDER_ITEM_STATUSES` y `everyListedLineVerifiablySent` si quedan sin uso). Mantener la guarda r8 (borrador sin líneas listadas pendientes → `conflict`) y el camino normal con la misma versión.
- [ ] Pruebas: adaptar las de replay completado / cancelación concurrente a `conflict`; añadir una prueba de reenvío byte-idéntico con la **misma** `expectedVersion` que replica sin duplicar (si no existe ya). Las demás verdes.
- [ ] Comentario de cabecera: regla en una frase y deuda nivel A (persistir el payload del comando para replay con versión avanzada).
- [ ] Puertas `pnpm --filter @super-restaurant/api test && typecheck && lint`. Commit `fix(api): …`.

## Archivos de entrada
- C:\tmp\sr-wt\web-order-actions\apps\api\src\orders.ts (425-520), apps\api\src\orders.test.ts (560-840).

## Invariantes
Un comando nunca reporta trabajo que no hizo; un reintento nunca duplica; contratos intactos; sin SQL.

## Formato de salida
Resumen, hash, resultado final de cada puerta, riesgos.
