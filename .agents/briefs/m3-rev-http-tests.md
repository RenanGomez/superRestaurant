# Revisión · m3-api-http-tests (nivel B)

No leas `.agents/reports/*`, no salgas del repo y no ejecutes PostgreSQL. Responde en ≤ 14 líneas.

Diff: main...harness/m3-api-http-tests

Lee (el checkout actual está en la rama de web, así que usa `git show`):
- `git show harness/m3-api-http-tests:apps/api/src/operations/http-flow-inventory-api.ts`
- `git show harness/m3-api-http-tests:apps/api/src/operations/http-test-app.ts`
- `git show harness/m3-api-http-tests:apps/api/src/operations/http-test-harness.ts`
- `git show harness/m3-api-http-tests:apps/api/src/http-flow.local.test.ts`
- como referencia de patrón: `apps/api/src/operations/http-flow-inventory.ts`

Comprueba:
1. Las aserciones son reales y no tautológicas: cada bloque compara status y código concretos, y los totales se contrastan con `quantity * unitCostMinor`, no con una constante ciega.
2. Aislamiento: el actor de otro restaurante no obtiene datos del restaurante A y la aserción no depende del orden de las filas.
3. Idempotencia: se prueba replay idéntico (`replayed:true`, sin duplicar filas) y clave divergente (`409`), y el conteo se hace contra la tabla real.
4. El cambio del arnés (`transaction` con BEGIN/COMMIT/ROLLBACK y PATCH) no deja conexiones sin liberar, no anida transacciones de forma insegura y no altera el comportamiento de los flujos existentes.
5. El flujo no depende de estado entre bloques, no usa ids fijos y limpia su cluster (el arnés lo hace).
6. Nada de dinero en floats, ni asserts sobre campos no devueltos por el servicio.

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos con `archivo:línea`. Marca P1/P2/P3.
