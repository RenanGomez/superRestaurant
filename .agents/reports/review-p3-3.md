**CORREGIR**

- **P2 — [captures.ts:1047](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/api/src/captures.ts:1047>):** V2 omite el probe de idempotencia; si el catálogo cambia después de aplicar el plan, un reintento legítimo recibe conflicto antes de llegar al replay de SQL. **Fix:** ampliar el probe para V2 y ejecutarlo antes de leer o valorar el catálogo; probar el reintento tras cambiarlo.
- **P2 — [captures-pizza.test.ts:244](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/api/src/captures-pizza.test.ts:244>):** la prueba toma `pizzaHalves` del resultado como valor esperado, por lo que no detecta divergencias dentro de ese snapshot frente a SQL. **Fix:** comparar contra una expectativa independiente y agregar paridad real API↔PostgreSQL.
- **NO VERIFICADO:** paridad ejecutada con PostgreSQL; esta revisión fue de lectura. CodeGraph no estaba disponible.
- **Plantilla:** AGENTS.md §10 no contiene una plantilla de reporte; contiene reglas de aislamiento y autorización.
- **Verificación:** búsqueda de los puntos citados:
```text
rg -n 'sizeName: variant|sizeName.*, coalesce|command.plan.schemaVersion === 1|catalogVersion !== command.plan.catalogVersion|pizzaHalves: halves' apps/api/src/capture-pizza-pricing.ts apps/api/src/captures.ts apps/api/src/captures-pizza.test.ts supabase/migrations/20261120000100_pizza_model_v2.sql
apps/api/src/captures-pizza.test.ts:244:    pizzaHalves: halves, // pizza_result, whole
apps/api/src/captures.ts:1047:    if (command.plan.schemaVersion === 1) {
apps/api/src/captures.ts:1065:    if (catalog.catalogVersion !== command.plan.catalogVersion) throw new CaptureApplicationError("conflict");
```