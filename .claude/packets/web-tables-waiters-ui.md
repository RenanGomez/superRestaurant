# web-tables-waiters-ui · elegir mesero en el plano de mesas (D2)

## Tarea
web-tables-waiters-ui · capa: L2 (Codex) o L1 por desviación si Codex no tiene cuota · riesgo: bajo · nivel C (`apps/web/src/app/app/tables/*`, `lib/tables-board.ts`). Ritmo: operación (un toque). Cierra la deuda «sólo Asignarme» del plano de mesas.

## Hechos verificados
- `POST /access/branch-members` (`memberships.read`; `{ scope, roles?: ["waiter"] }` → `{ members: [{ userId, displayName | null, roles }] }`) ya existe (rama de entregas integrada en main `5910b68`). La pantalla de entregas ya lo consume para repartidores (`apps/web/src/app/app/deliveries/actions.ts`, helper `listCouriers`): reutiliza ese cliente, no lo dupliques.
- `POST /orders/assign-waiter` (`AssignOrderWaiterCommandV1 { orderId, expectedVersion, waiterUserId | null, audit }`, permiso `orders.update`); el plano (`tables-board.tsx`) hoy ofrece sólo «Asignarme».
- `TableBoardV1.activeOrders[].waiterUserId`; sin nombre: resolverlo con la lista de miembros (`displayName` o iniciales del id si es nulo).

## Criterios de aceptación
- [ ] En la hoja de mesa libre, selector opcional de mesero como lista de botones grandes con nombre (o «Yo»); en mesa ocupada, «Cambiar mesero» abre la misma lista (1 toque para elegir). Si no hay meseros con rol `waiter`, sólo «Asignarme» y aviso «Asigna el rol mesero en Accesos».
- [ ] El plano muestra el nombre del mesero (no sólo iniciales) cuando la lista lo resuelve; helper puro `waiterLabel(members, userId)` con prueba.
- [ ] Carga de miembros una vez por visita con refresco por foco; toda acción muestra «Guardando…» y resultado; `conflict` recarga.
- [ ] Sin `alert/confirm/prompt`; targets ≥44 px; 390×844 sin scroll horizontal; consola limpia.

## Invariantes
Servidor decide permisos; no tocar `deliveries/*` salvo reutilizar el cliente; contratos intactos.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```

## Formato de salida esperado
Resumen (toques), archivos tocados, salida literal, riesgos. Commit `feat(web): …` si lo ejecuta implementer-claude; sin commit si es Codex.
