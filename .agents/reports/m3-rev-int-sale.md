I'll read the files specified in the prompt.
The diff returned empty. Let me verify the state of those files and the harness contract.
Changes are committed in HEAD. Let me get the actual diff and the support/harness/test files.
Now let me verify the harness cleanup and the audit/replay semantics.
Let me confirm the SQL consumption/cancel logic the assertions are meant to mirror.
VEREDICTO: APROBAR

§ Alcance: flujo `http_flow_inventory` (nivel A), solo lectura de código/git, sin PG ni `.agents/reports`.
1. Siembra/limpieza OK: `http-flow-inventory.ts:70-92` inserta item, almacén `is_default=true`, receipt y receta v1 con aserciones (`receipt.status/balance`, `recipe.version`); la limpieza es el clúster desechable (`http-test-harness.ts` `local.stop()` → `exitCode=1` si falla). Sin fugas.
2. Aserciones prueban el hecho: tipo/almacén/cantidad/causa y `compensates_movement_id` (`:99-146`). Si el consumo se saltara, la SQL devuelve 0 filas y `assert.equal(length,1)`/saldo fallan. No se enmascara.
3. Replay correcto: `confirm` se captura una sola vez antes del envío y se reenvía idéntico (`http-flow-support.ts` diff `+ const confirm = {...}; ...return {…, confirm, …}`; consumo en `:119`).
4. Sin receta inerte real: `:150-159` prueba 0 consumos/0 movimientos/saldo igual, y el caso positivo previo demuestra que la ruta sí consume; no oculta fixture roto.

Hallazgos:
- P3 `http-flow-inventory.ts:71,104,111,138`: solo existe un almacén del branch, así que `warehouse_id === warehouseId` no distingue selección del *default* de "único almacén"; añadir un segundo almacén `is_default=false` para probar la resolución real.
- P3 `http-flow-inventory.ts:154`: el caso sin receta no verifica el `status`/`reason` del resultado de la función; 0 filas es correcto pero no fija el contrato (`no_recipe` vs `skipped`).

```text
$ git show --stat HEAD
 test(api): HTTP flow proves sale consumption and cancellation
 apps/api/src/http-flow.local.test.ts           |   3 +
 apps/api/src/operations/http-flow-inventory.ts | 165 +++++++++++++++++++++++++
 apps/api/src/operations/http-flow-support.ts   |  15 ++-
 3 files changed, 179 insertions(+), 4 deletions(-)
```
NO VERIFICADO: ejecución real de `test:http:local` (no la corrí; el brief prohíbe ejecutar PG); me apoyo en el diff/commit y en el código.