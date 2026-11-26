# Plan de cierre M3 — sesión solo-dsh (2026-11-25)

Sesión siguiente con **únicamente agentes `dsh`** (DeepSeek vía OpenCode Go): Codex y Gemini están sin cuota y Claude no se usa como worker. Este plan asume eso: no hay revisión cruzada de otra familia, todo lo escribe y revisa `dsh`, y el orquestador (esta sesión) corre las puertas pesadas, integra y documenta.

## 0. Estado de partida (verificado)

- `main` en `7b5ff570`; árbol limpio. 88 migraciones SQL desde cero en verde con `verify:inventory-schema:rollback`.
- API de inventario **completa**: insumos/almacenes (#90, #98), movimientos/transferencias/saldos (#99), recetas (#100), compras (#102), alertas/costeo (#106), consumo por venta y reverso (#97) y cancelación de línea (#99/00700).
- Integración venta→stock probada por HTTP real: `http_flow_inventory` (8/8 flujos).
- UI `/app/inventario`: pestañas **Insumos, Almacenes, Movimientos, Recetas** (#99, #108, #109).
- Pendiente: pestañas **Compras** y **Alertas**, pruebas HTTP contractuales de inventario, journey E2E y **verificación visual real**.
- Deuda viva en `docs/agentic/debt.md` (P3 de recetas/UI/movimientos/compras/costeo, `items.module.ts` huérfano, ledger con `EXECUTE` para `app_api`, `x-device-id` sin validar).

## 1. Reglas de la sesión

1. **Solo `dsh`.** `-Engine dsh`, `-Effort medium` en nivel A/B, `low` en mecánico/UI pequeña. Nunca `codex`, `gemini` ni subagentes Claude como worker.
2. **Los workers no ejecutan PostgreSQL.** El orquestador corre `verify:inventory-schema:rollback` y `test:http:local` con `LOCAL_POSTGRES_BIN`.
3. **Los workers no commitean ni hacen push.** El orquestador revisa `git status`, corre puertas y commitea.
4. **Un escritor por archivo.** Los archivos compartidos (`apps/api/src/app.module.ts`, `apps/api/package.json`, `apps/api/src/operations/inventory-{schema-,}verification.ts`, `apps/web/src/app/app/inventario/inventory-workspace.tsx`, `apps/web/package.json`) se tocan en una sola tarea por ola.
5. **Brief obligatorio** en `.agents/briefs/<id>.md` con archivos exactos, firmas, "hecho cuando" y la línea Ponytail. Sin brief no hay tarea.
6. **Cada tarea termina en PR** (`harness/<id>` → `main`) con CI verde y revisión `dsh` (dos para nivel A, una para B/C). Nada de `force-push` a `main`.
7. **Migraciones remotas: fuera de alcance.** Se hacen en la conversación de despliegue con el protocolo §19.6.
8. **Al cerrar cada ola:** HANDOFF, `status.md`, `backlog.json`, `debt.md` y smoke (§19.5) actualizados.

## 2. Olas y tareas

### Ola 1 — en paralelo (archivos disjuntos)

| Tarea | Nivel | Archivos | Depende | ETA |
|---|---|---|---|---|
| `m3-web-compras` | C | `apps/web/src/app/app/inventario/purchasing-panel.tsx` (nuevo), `actions.ts`, `inventory-workspace.tsx`, `inventory-ui.ts(+test)` | — | 45 |
| `m3-api-http-tests` | B | `apps/api/src/operations/http-flow-inventory-api.ts` (nuevo), `apps/api/src/http-flow.local.test.ts` | — | 40 |

- **`m3-web-compras`**: pestaña «Compras» con proveedores (lista/alta/edición), OC (listar, crear con `idempotencyKey` estable, ver detalle con totales del servidor) y recepción (almacén + `deviceId`). Endpoints: `GET/POST/PATCH /inventory/suppliers`, `GET/POST /inventory/purchase-orders`, `GET /purchase-orders/:id`, `POST /purchase-orders/:id/receive`. Sin calcular dinero en cliente; diálogo accesible; `?tab=compras`.
- **`m3-api-http-tests`**: flujo contractual por HTTP de los endpoints de inventario (items, movements, balances, recipes, suppliers, purchase-orders, alerts/costs): 401 sin token, 403 de rol, 400 de validación, 409 de idempotencia, aislamiento entre restaurantes/sucursales y que los totales vienen del servidor. No toca `package.json`.

### Ola 2 — tras Ola 1

| Tarea | Nivel | Archivos | Depende | ETA |
|---|---|---|---|---|
| `m3-web-alertas` | C | `apps/web/src/app/app/inventario/alerts-panel.tsx` (nuevo), `actions.ts`, `inventory-workspace.tsx`, `inventory-ui.ts(+test)` | `m3-web-compras` | 35 |
| `m3-dsh-debt-clean` | B | `apps/api/src/inventory/*.ts`, `supabase/tests/inventory_api_functions_invariants.sql`, `supabase/migrations/20261126000800_inventory_movement_api.sql` (solo si hace falta) | — | 25 |

- **`m3-web-alertas`**: pestaña «Alertas» con saldo bajo mínimo (déficit), costo medio por almacén/insumo, costo de receta y margen por producto; muestra lo que da el API; `?tab=alertas`.
- **`m3-dsh-debt-clean`** (solo si el orquestador decide que entra): borrar `items.module.ts` huérfano, mapear `23505` en `recipes.service` si falta, validar `x-device-id` como UUID donde aplica y añadir aserciones `pg_proc` a la prueba de funciones. Nada de cambios de contrato.

### Ola 3 — journey E2E

| Tarea | Nivel | Archivos | Depende | ETA |
|---|---|---|---|---|
| `m3-e2e-journey` | B | `apps/web/e2e/inventario*.spec.ts`, `playwright.config.*`, `apps/web/package.json` | Ola 2 | 60 |

Journey con stack local real (PG + API + web): crear insumo → almacén predeterminado → receta → venta confirmada descuenta → cancelar repone → alerta cuando el saldo baja del mínimo → margen visible. Aserciones en UI y en API; consola limpia. `package.json` lo toca **solo** esta tarea.

### Ola 4 — orquestador (sin workers)

1. Puertas completas: `verify:inventory-schema:rollback`, `test:http:local -- --local-disposable-only`, `pnpm lint/typecheck/test/build` de los paquetes tocados.
2. **Pase visual real** de `/app/inventario` (5 pestañas) en 1366×800 y 390×844: consola sin errores, red sin 5xx/404 propios, targets ≥ 44 px, sin `alert/confirm/prompt`, foco visible, desbordes 0 px. Capturas en `docs/agentic/visual-verify-*/`.
3. Corregir hallazgos como tareas C nuevas (mismo patrón).

### Ola 5 — cierre documental

- `docs/smoke/smoke-<fecha>.data.json` + HTML (§19.5) con secciones de prueba de inventario.
- HANDOFF/status/backlog/debt al día; borrar briefs ya integrados si molestan.

## 3. Cómo lanzar una tarea (comandos exactos)

```powershell
# 1) crear rama desde main actualizado
git switch main; git pull --ff-only
git switch -c harness/<id>

# 2) lanzar dsh en background (nunca en primer plano)
powershell -NoProfile -File .harness/bin/agent.ps1 -Engine dsh -Id <id> -Write -Effort medium -EtaMin <n>

# 3) al terminar: revisar diff y correr puertas
. .\tools\agentic\use-node24.ps1          # deja Node 24.19.0
$ErrorActionPreference='Continue'          # después del script, o el stderr de pnpm aborta la cadena
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
& $PNPM --filter @super-restaurant/web test
& $PNPM --filter @super-restaurant/web build
$env:LOCAL_POSTGRES_BIN = "C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\.cache\postgres-local\pgsql\bin"
& $PNPM --filter @super-restaurant/api run verify:inventory-schema:rollback
& $PNPM --filter @super-restaurant/api run test:http:local -- --local-disposable-only

# 4) commit, push y PR
git add <archivos de la tarea>; git commit -m "feat(...): ..."
git push -u origin harness/<id>
gh pr create --base main --head harness/<id> --title "..." --body "..."

# 5) CI en background, luego merge
$id = gh run list --branch harness/<id> --limit 1 --json databaseId | ConvertFrom-Json | ForEach-Object { $_.databaseId }
gh run watch $id --exit-status
gh pr merge <n> --squash --delete-branch
```

## 4. Trampas conocidas (esta sesión las vivió)

1. **dsh agota turno sin informe** (~40 % de las corridas). Suele dejar el código: revisa `git status`, corre puertas y escribe tú el resultado. Si falta código, reintenta con el mismo `-Id` y feedback concreto.
2. **No dejar que dsh corra PG.** El sandbox y el tiempo lo impiden; el orquestador es quien verifica.
3. **Plpgsql: variables que chocan con columnas** (`order_id`, `warehouse_id`) producen `column reference is ambiguous`: renombra a `*_ref`.
4. **`pg_catalog.coalesce` no existe**: usa `coalesce(sum(x), 0::bigint)` con cast explícito.
5. **Alias de `lateral`**: un `costed` fuera de alcance da `missing FROM-clause entry`; revisar el alias real (`cost`).
6. **Al recortar el final de una prueba SQL** se puede perder `end $test$; rollback;` → `SCHEMA_VERIFICATION_SQL_REJECTED` sin mensaje útil.
7. **Fixtures de recetas/productos**: `publish_inventory_recipe` exige producto en `menu_products` (con catálogo y categoría) del mismo restaurante.
8. **`git diff --check` marca CRLF** de `docs/agentic/backlog.json` como trailing whitespace: es ruido conocido de ese archivo.
9. **Ramas atadas a worktrees viejos**: `git switch` falla; borra el worktree con `cmd /c rmdir /s /q <ruta>` + `git worktree prune` (nunca `Remove-Item -Recurse`).
10. **Pre-push bloquea `main`**: la documentación también va por PR (`docs/<tema>`), squash y merge.
11. **Bases squash-mergeadas**: para rebasar una rama hija usa `git rebase --onto origin/main <head-anterior>` y `GIT_EDITOR=true`.
12. **Conflictos aditivos** en `inventory-schema-verification.ts` / `run-inventory-schema-verification.ts`: resolver con la **unión** de imports, checks y entradas de invariantes.
13. **`AppModule` registra controladores/proveedores directos**; no hay `imports` de módulos. Mantén ese patrón y evita `*.module.ts` nuevos.
14. **GitHub no siempre dispara CI en un push**: cierra y reabre el PR (`gh pr close N; gh pr reopen N`) o force-push con lease tras rebase.
15. **Contratos**: cambios de `packages/shared-types` obligan a build antes de typecheck/test del API y de web.

## 5. Puertas de DONE por nivel (sin otra familia de revisión)

- **C:** lint/typecheck/test/build web verdes + verificación visual real (orquestador) + revisión dsh única + PR/CI.
- **B:** typecheck/lint/test del paquete + contrato HTTP si expone rutas + `pg-verify` si hay SQL + revisión dsh única.
- **A:** todo lo de B + verificador rollback-only + `test:http:local` cuando toque dinero/venta + revisión dsh doble (dos focos) + cero P1/P2 abiertos (P3 a `debt.md`).

## 6. Condiciones de parada

- Todo el plan cerrado y `main` verde.
- O una tarea falla dos veces con el mismo brief: se pasa a BLOCKED con evidencia y se sigue con otra.
- O el orquestador se queda sin contexto: HANDOFF con la siguiente acción mínima y sin workers vivos.
