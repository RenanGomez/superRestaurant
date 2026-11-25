# Revisión · m3-int-sale-to-stock (nivel A)

Solo lectura. No leas `.agents/reports/*` ni salgas del repo; no ejecutes PG. Responde en ≤ 15 líneas.

Lee:
- `apps/api/src/operations/http-flow-inventory.ts`
- `git diff -- apps/api/src/operations/http-flow-support.ts apps/api/src/http-flow.local.test.ts`

Contexto: el orquestador corrió `test:http:local -- --local-disposable-only` y el flujo nuevo `http_flow_inventory` pasó (8/8) con `sale_consumption=240`, saldo 4760, reverso y replay.

Comprueba:
1. Que el flujo siembra el almacén por defecto y la receta de forma que el consumo no quede saltado por accidente, y que limpia todo.
2. Que las aserciones prueban el hecho (movimientos, saldo, `cause`, compensación) y fallarían si el consumo no ocurriera.
3. Que el replay reenvía exactamente el mismo comando y no un body nuevo.
4. Que el caso sin receta es realmente inerte y no enmascara un fallo de fixture.

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos P1/P2/P3 con `archivo:línea`.
