# web-order-actions-r13 (addendum a r12; hallazgo Codex ronda 12, log `.claude/runs/web-order-actions/review-r12.log`)

## Tarea
web-order-actions-r13 · capa: L1 (`implementer-claude`, mismo escritor de r12) · riesgo: bajo · nivel B (`apps/api/src/orders.ts` sendToKitchen, lógica de servicio). Sin SQL ni contrato.

## Objetivo
[P2] `orders.ts:555-558`: con la versión exacta, una línea listada que no esté `pending` se omite en silencio y el lote se reporta como éxito; si ninguna está pendiente en una orden abierta, devuelve éxito sin registrar el comando. Con el envío atómico y versión exacta ya no hay motivo para omitir: el cliente listó exactamente las líneas pendientes que vio.

## Criterios de aceptación
- [ ] Antes de construir pasos: si alguna línea listada no está `pending` → `conflict` sin llamar a SQL (ids ajenos siguen → `not_found`). Eliminar la guarda r8 si queda subsumida (borrador con todas las listadas no pendientes ya cae en esta regla). Nunca devolver éxito sin haber llamado a SQL con ≥1 paso.
- [ ] Pruebas: (a) lista con una línea ya `sent` → `conflict`, sin llamada a SQL; (b) lista con una cancelada → `conflict`; (c) las pruebas existentes de éxito, replay, versión obsoleta e id ajeno siguen verdes (ajustar las que dependían del salto silencioso).
- [ ] Comentario de cabecera: «todas las líneas listadas deben estar pendientes».
- [ ] Puertas `pnpm --filter @super-restaurant/api test && typecheck && lint`. Commit `fix(api): …`.

## Archivos de entrada
- C:\tmp\sr-wt\web-order-actions\apps\api\src\orders.ts (500-600), apps\api\src\orders.test.ts (pruebas de sendToKitchen).

## Invariantes
Un comando nunca reporta trabajo que no hizo; atómico; sin SQL; contratos intactos.

## Formato de salida
Resumen, hash, resultado final de cada puerta.
