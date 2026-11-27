# Plan — sesión siguiente: código pendiente (compras legibles) y arranque de M4

Sustituye como guía de corto plazo a `docs/plans/plan-2026-11-27-ola5-m2-m4.md` (queda como registro).
Estado verificado el 2026-11-27: `main` en `a9eaa60c`, Ola 5 fusionada (#138–#149), dev en
`20261126001500`, **M2 cerrado en su alcance técnico**, M3 al 100 % del alcance fusionado y la prueba del
operador pendiente. Sin PRs abiertos ni workers vivos.

## 0. Objetivo de la sesión

1. Cerrar el último item de producto de la Ola 5: **`o5-compras-ui-read`** (C) — que `viewer`/`auditor`
   puedan leer compras sin ver acciones de escritura.
2. Pagar la deuda que lo bloquea limpiamente: **una sola fuente de la matriz RBAC** para el cliente
   (hoy el web solo conoce `MANAGE_ROLES` y el API conoce los ocho roles de `catalog.read`).
3. Arrancar **M4** con sus dos piezas documentales (`m4-metrics-catalog`, `m4-adr-014-exports`).

Fuera de alcance: mover filas de «Día operable», tocar migraciones aplicadas, cambiar contratos de
inventario y abrir SQL de reportes (Ola 7) sin cerrar antes el catálogo de métricas.

## 1. Ola 5 · `o5-compras-ui-read` (nivel C, 45–60 min)

**Problema real:** `PurchasingPanel` no carga proveedores ni órdenes si `!canManage`
(`apps/web/src/app/app/inventario/purchasing-panel.tsx:117,142`), pero el API ya autoriza esas lecturas
con `catalog.read` desde #131 (`list_inventory_suppliers`, `list_inventory_purchase_orders`,
`read_inventory_purchase_order`). Un `viewer`/`auditor` ve el panel vacío.

**Cambios:**

| Archivo | Qué |
|---|---|
| `packages/shared-types/src/*` | Mover `RBAC_ROLE_PERMISSIONS_V1` + `rolesGrantPermission` desde `apps/api/src/auth/rbac-policy.ts` a shared-types (puro, sin infraestructura) y reexportarlos desde el API para no romper importadores. |
| `apps/web/src/lib/inventory-access.ts` (nuevo) | `canReadPurchases(roles)` y `canManagePurchases(roles)` apoyados en `rolesGrantPermission(roles, "catalog.read" \| "catalog.manage")`; sin listas de roles copiadas. |
| `apps/web/src/app/app/inventario/page.tsx` | Calcular `canReadInventory` (además de `canManage`) y pasarlo al workspace. |
| `inventory-workspace.tsx` | Prop nueva `canRead`; la reenvía a `PurchasingPanel`. |
| `purchasing-panel.tsx` | Cargar listas/detalle con `canRead`; dejar **solo** las acciones de escritura detrás de `canManage` (crear/editar proveedor, crear OC, recibir). El diálogo de recepción sigue exigiendo `canManage && deviceStatus === "ready"`. |
| `inventory-ui.test.ts` o `inventory-access.test.ts` (nuevo) | 8 roles de `catalog.read` leen; `kitchen`/`courier` no leen; solo `owner/admin/manager` gestionan. |

**Hecho cuando:** un `viewer` ve proveedores, órdenes y detalle; no ve «Nuevo proveedor», «Nueva orden»
ni «Recibir»; un `manager` no cambia de comportamiento; el helper está probado y el pase visual no
regresiona.

**Verificación:** `pnpm --filter @super-restaurant/web test` (helper nuevo incluido), `lint`,
`typecheck`, `build`, `e2e:typecheck`; `E2E_VISUAL=1 playwright test e2e/visual/inventario.spec.ts
--project desktop` → 12/12 con la sesión vigente. Para ver la variante `viewer` hace falta una segunda
cuenta con ese rol: si no está disponible, se documenta la brecha y el item queda en REVIEW, no DONE.

**Riesgos:** el panel recibía `canManage` para todo; al separar lectura/escritura hay que revisar cada
`{canManage && …}` (líneas 269, 311, 327, 385, 445, 511) para no dejar un botón visible sin permiso ni
ocultar un dato de lectura.

## 2. Ola 6 · M4 documental (nivel D, 60–90 min)

| Id | Entregable | Hecho cuando |
|---|---|---|
| `m4-metrics-catalog` | `docs/architecture/metrics-catalog.md`: una fila por métrica con definición, fuente autoritativa (tabla/consulta), zona horaria, dueño y estado; nada de cálculo en cliente. | Cada métrica dice de dónde sale y cómo se reconcilia; lo que no existe hoy (p. ej. costo histórico por receta) se anota como tarea de la Ola 7, no se inventa en la UI. |
| `m4-adr-014-exports` | `docs/adr/ADR-014.md` (siguiente número libre tras ADR-013): CSV nativo sin dependencias; XLSX y PDF con **una** dependencia cada uno y su motivo. | Alternativas descartadas, límites de tamaño/memoria/streaming y criterio de streaming para reportes grandes. |

Ambas salen de contratos que ya existen (`reports`, `day-summary`, pagos, propinas, inventario). Si el
catálogo revela un dato ausente, se abre task de SQL para la Ola 7 y **no** se simula.

## 3. Si sobra tiempo · deudas P3 que se pueden pagar

- `INVALID_SCOPE` sigue en la ruta de revocación (`apps/api/src/sync/sync-merge-executor.ts`): emitir su
  propio código y decidir si es terminal por evento.
- `correlationId` por evento en vez de por petición de push (mismo archivo).
- `verify:capture-schema:rollback` acepta argumentos extra y cae en modo remoto
  (`apps/api/src/operations/run-capture-schema-verification.ts:15`): exigir exactamente
  `--local-disposable-only` o `--remote-only`.
- `items.service.ts` mapea cualquier `42501` a 403: distinguir por `message` acotado.
- Traza de dispositivo opcional en inventario (permitir omitir `deviceId`): exigirla en la próxima
  revisión de contrato si Emmanuel lo decide.

## 4. Puertas y comandos

```powershell
. .\tools\agentic\use-node24.ps1
pnpm --filter @super-restaurant/web run test
pnpm --filter @super-restaurant/web run lint
pnpm --filter @super-restaurant/web run typecheck
pnpm --filter @super-restaurant/web run build
pnpm --filter @super-restaurant/web run e2e:typecheck
# con sesión vigente (si caducó: pnpm --filter @super-restaurant/web e2e:auth)
$env:E2E_VISUAL='1'; pnpm --filter @super-restaurant/web exec playwright test e2e/visual/inventario.spec.ts --project desktop
```

- Preflight obligatorio al arrancar y al cerrar (READ_ONLY, ver §PASO 0 del prompt). Si aparecen
  candidatas nuevas distintas de `20260908000100`, protocolo §19.6 completo.
- Servidores: `tools\agentic\local-servers\start-local.bat nobuild` **con** `SYNC_CURSOR_SECRET` en el
  entorno (sin él la API no arranca); `stop-local.bat` para cerrar.
- Un PR por tarea (o uno para RBAC+compras si van juntos) con CI verde; docs aparte.

## 5. Cierre de sesión

HANDOFF (entrada del corte), `status.md`, `backlog.json` (`o5-compras-ui-read` a `done` o `review` con
la brecha de la cuenta `viewer`), `debt.md`, smoke regenerado si hay UI y prompt de la sesión siguiente.
Nada de «Día operable» a DONE sin la prueba del operador. Sin workers vivos ni PRs abiertos al cerrar.

## 6. Riesgos y decisiones que no se reabren

- **No** se duplica la lista de roles en el web: si la matriz no cabe en shared-types sin arrastrar
  NestJS, se mueve solo el mapa y la función pura.
- **No** se relaja la validación del dispositivo: `canManage` sin `deviceStatus === "ready"` sigue
  bloqueando la recepción.
- **No** se declara `o5-compras-ui-read` DONE sin haber visto la variante `viewer`/`auditor`, salvo que
  Emmanuel decida aceptar la verificación del API + helper como suficiente.
