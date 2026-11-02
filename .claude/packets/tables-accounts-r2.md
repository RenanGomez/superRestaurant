# tables-accounts-r2 · abrir cuentas desde la mesa sin paso de mesero, reasignar o quitar mesero en cualquier momento, sin «Abrir cuenta» redundante

Nivel B (web + posible ajuste en `apps/api/src/orders.ts`) · Capa L2 Codex (`tools/agentic/codex-task.ps1 -Task tables-accounts-r2 -Packet .claude/packets/tables-accounts-r2.md -Effort medium`) · rama `codex/tables-accounts-r2` desde `main` (≥ 4210207). Archivos: `apps/web/src/app/app/tables/**`, `apps/web/src/lib/tables-board.ts`, `apps/web/src/app/app/orders/order-detail-panel.tsx` (sólo el botón «Abrir cuenta»), `apps/api/src/orders.ts` y sus tests si hace falta el punto 4. No tocar SQL, `packages/*` salvo que un contrato lo exija (entonces documenta y para), ni `apps/web/src/app/app/menu/**`.

## Retroalimentación de Emmanuel (2026-11-01, /app/tables, captura 1 «Mesa nueva»)
1. Una vez asignado un mesero ya no se puede cambiar ni quitar. Debe poder reasignarse o dejar «Sin mesero» en cualquier momento, con registro de cada cambio para auditoría.
2. El diálogo mezcla la cuenta abierta (arriba) con un selector de mesero (en medio) que en realidad aplica a la «nueva cuenta»; no se entiende. Quitar la selección de mesero previa a abrir cuenta, tanto para la primera como para las siguientes.
3. «Abrir otra cuenta» no debe navegar a Órdenes: abre la cuenta ahí mismo y la lista en el diálogo igual que la ya abierta; a Órdenes se va con «Ver cuenta» de esa tarjeta.
4. Al abrir una cuenta nueva, el botón «Cambiar mesero» de la cuenta anterior pasa a «Guardando…» sin motivo.
5. Redundancia: tras abrir una cuenta sin productos, en Órdenes aparece otro botón «Abrir cuenta». La cuenta debe quedar abierta desde el primer «Abrir cuenta» de la mesa (o al agregar el primer producto), nunca pedirlo dos veces.

## Contexto que ya está en el código
- `tables-board.tsx`: `actions.create(tableId, orderId, attempt, waiterUserId)`, `actions.assign(orderId, expectedVersion, attempt, waiterUserId)` (acepta `null` para quitar; el servidor valida membresía y **audita**, ver `packages/shared-types/src/orders.ts:283-290`), `actions.waiters()`; estado `busy` único para todo el diálogo (causa probable del punto 4).
- `apps/api/src/orders.ts:1102`: la acción `open` se ofrece a toda orden de mesa en borrador sin líneas; `order-detail-panel.tsx` la pinta como «Abrir cuenta» (hoy oculta sólo mientras «Agregar producto» está abierto).

## Cambios
1. **Diálogo de mesa**: lista de cuentas de la mesa (cada tarjeta: estado · hora · total, «Mesero: X» o «Sin mesero», botones «Ver cuenta» y «Mesero»). Botón único «Abrir cuenta» / «Abrir otra cuenta» al pie, sin selector previo: crea la cuenta con `waiterUserId: null`, la añade a la lista y permanece en el diálogo. Mensaje de estado por tarjeta, no global.
2. **Mesero**: «Mesero» abre un pequeño selector inline en esa tarjeta con «Sin mesero», «Yo» y los demás meseros de la sucursal (`actions.waiters()`); elegir llama a `assign(orderId, version, attempt, idOrNull)`; funciona siempre, con o sin mesero previo. Si no hay más meseros, la ayuda «Asigna el rol mesero en Accesos para ver más opciones» se mantiene dentro del selector. El estado «Guardando…» es por tarjeta (`busyOrderId`), nunca contagia a las demás.
3. **Auditoría**: no hay que crear nada nuevo si `assign` ya audita (confírmalo leyendo `apps/api/src/orders.ts` y el SQL de `assign_order_waiter`/equivalente); si no audita motivo, deja constancia en el reporte. En el diálogo, bajo el mesero, muestra «Cambiado hh:mm» si el contrato trae la fecha; si no, omite.
4. **Sin «Abrir cuenta» redundante**: investiga en `apps/api/src/orders.ts` qué hace `open` sobre un borrador de mesa (cambio de estado `draft → open`?). Opción preferida: la creación desde la mesa deja la cuenta ya «abierta» (el API ejecuta la misma transición al crear con `tableId`, o la web llama a `open` inmediatamente después de crear, en la misma acción del servidor, con el mismo `idempotencyKey` derivado). Si la transición exige líneas, entonces «Abrir cuenta» desaparece del detalle y la apertura ocurre automáticamente al agregar el primer producto. En ningún caso el operador ve dos veces «Abrir cuenta». Si esto exige cambiar SQL (`app_private`), para y documenta: pasa a paquete A.
5. Mesas: al volver de Órdenes, la mesa muestra la cuenta como «Abierta» (o «Borrador» sólo si de verdad sigue en borrador por la regla del punto 4).

## Invariantes
Sin `any`, LF, español, sin `alert/confirm/prompt`, targets ≥ 44 px; el servidor decide estados y permisos; nada de dinero en cliente; `idempotencyKey` por intento como hoy.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía corepack)
- `pnpm turbo run lint typecheck test build --filter=@super-restaurant/web --filter=@super-restaurant/api` (api sólo si lo tocas).
- Tests: helper puro del estado de mesero por tarjeta; test del API si cambias `open`/creación.
- Navegador si hay servidores y `apps/web/playwright/.auth/user.json`: abrir dos cuentas desde la mesa sin salir del diálogo, cambiar y quitar mesero en cada una, «Ver cuenta» lleva a Órdenes sin «Abrir cuenta». Capturas en `apps/web/e2e-report/tables-accounts-r2/`; borra `.env.local` y `user.json` del worktree al final. Si no, documenta la brecha.

## Formato de salida
Resumen, diagnóstico del punto 4 con la causa exacta y la opción elegida, archivos, salida literal de puertas, capturas o brecha, riesgos. Commits locales `fix(web-tables): …` / `feat(orders): …`. Sin merge ni push.
