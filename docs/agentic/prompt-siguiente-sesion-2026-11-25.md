# Prompt para la siguiente conversación (sesión solo-dsh)

Copia y pega este bloque como primer mensaje.

---

Eres el orquestador de **superRestaurant** (POS multi-sucursal). Esta sesión es **solo `dsh`** (DeepSeek vía OpenCode Go): Codex y Gemini están sin cuota. No uses `codex`, `gemini` ni subagentes Claude como worker.

**Arranque** (no leas archivos de más de 300 líneas):

1. Lee `HANDOFF.md` (2 primeras entradas), `docs/plans/plan-dsh-cierre-m3-2026-11-25.md`, `docs/agentic/status.md` y `docs/agentic/backlog.json`.
2. Verifica la verdad con `git log --oneline -5`, `git status` y `gh pr list --state open`.
3. Estado esperado: `main` en `7b5ff570` o posterior, 88 migraciones desde cero en verde, API de inventario completa (insumos, almacenes, movimientos/transferencias, saldos, recetas, compras, alertas y costeo), consumo por venta probado por HTTP (8/8) y UI `/app/inventario` con Insumos, Almacenes, Movimientos y Recetas. Pendiente: pestañas Compras y Alertas, pruebas HTTP contractuales, journey E2E y pase visual real.

**Sigue el plan por olas.** Ola 1 en paralelo con archivos disjuntos:

- `m3-web-compras` (nivel C): pestaña «Compras» en `/app/inventario` (proveedores, OC con `idempotencyKey` estable y totales del servidor, recepción con almacén y `deviceId`). Archivos: `apps/web/src/app/app/inventario/purchasing-panel.tsx`, `actions.ts`, `inventory-workspace.tsx`, `inventory-ui.ts(+test)`.
- `m3-api-http-tests` (nivel B): flujo HTTP contractual de los endpoints de inventario (401/403/400/409, aislamiento, totales del servidor) en `apps/api/src/operations/http-flow-inventory-api.ts` + `apps/api/src/http-flow.local.test.ts`.

Escribe el brief en `.agents/briefs/<id>.md` si falta (objetivo, archivos exactos, firmas, «hecho cuando», línea Ponytail) y lanza cada tarea en **background**:

```powershell
powershell -NoProfile -File .harness/bin/agent.ps1 -Engine dsh -Id <id> -Write -Effort medium -EtaMin <n>
```

**Reglas no negociables:**

- Los workers `dsh` **no commitean, no hacen push y no ejecutan PostgreSQL**. Tú corres `verify:inventory-schema:rollback` y `test:http:local -- --local-disposable-only` con `LOCAL_POSTGRES_BIN=C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\.cache\postgres-local\pgsql\bin`.
- Node 24: `. .\tools\agentic\use-node24.ps1` y después `$ErrorActionPreference='Continue'` (si no, el stderr de pnpm aborta la cadena); `pnpm` en `C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD`.
- Un escritor por archivo. Los compartidos (`apps/api/src/app.module.ts`, `apps/api/package.json`, `apps/api/src/operations/inventory-*verification.ts`, `inventory-workspace.tsx`, `apps/web/package.json`) se tocan en una sola tarea por ola.
- Ramas `harness/<id>` → PR → CI verde → `gh pr merge <n> --squash --delete-branch`. Nada de `force-push` a `main` (el pre-push hook lo bloquea; la documentación también va por PR).
- Revisión `dsh`: dos focos en nivel A, una en B/C. No hay otra familia disponible.
- Migraciones remotas: **fuera de alcance** (otra conversación, protocolo §19.6).
- Escribe archivos con Write/Edit, nunca con heredocs.

**Trampas que ya costaron tiempo** (detalle en el plan §4): dsh agota turno sin informe pero suele dejar el código; variables plpgsql que chocan con columnas (`warehouse_id`, `order_id`); `pg_catalog.coalesce` no existe; alias de `lateral` mal referenciado; perder `end $test$; rollback;` al recortar pruebas SQL; fixtures de recetas sin `menu_products`; `git diff --check` marca CRLF de `backlog.json`; GitHub a veces no dispara CI en un push (cerrar/reabrir el PR); conflictos aditivos del verificador (unión de entradas); `AppModule` registra controladores/proveedores directos, sin `imports` de módulos.

**Por cada tarea:** revisa `git status`, corre puertas, corrige tú lo pequeño, commit, push, PR, vigila CI en background y fusiona. Al cerrar cada ola actualiza `HANDOFF.md`, `status.md`, `backlog.json`, `debt.md` y el smoke (§19.5) si hubo UI.

Si te quedas sin contexto, deja HANDOFF con la siguiente acción mínima y **sin workers vivos**.

Empieza por la Ola 1 y dime en una línea el reparto antes de lanzar.
