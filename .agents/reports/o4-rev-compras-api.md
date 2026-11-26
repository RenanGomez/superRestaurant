VEREDICTO: APROBAR

Hallazgos:
- P2 — `apps/web/src/app/app/inventario/purchasing-panel.tsx:113,138,163`: los `useEffect` retornan sin cargar si `!canManage`, así que viewer/auditor (ya permitidos por la API) ven la pestaña Compras vacía; la pestaña no se oculta, se renderiza sin datos. Ajuste de UI pendiente, fuera del alcance de este PR y sin riesgo de seguridad.
- P3 — `supabase/migrations/20261126001400_inventory_purchasing_reads.sql:48,126,236`: la lista de roles de `catalog.read` es una copia manual de `rbac-policy.ts`; una divergencia futura falla cerrado (403) pero denegaría a un rol nuevo legítimo. Conviene un test de paridad rol↔matriz.
- P3 — `apps/api/src/inventory/purchasing.service.ts:304-316`: leer-antes-de-autorizar es defendible: el SQL filtra por membresía y devuelve 0 filas para orden ajena (→404, indistinguible de inexistente); solo un actor de la MISMA sucursal sin `catalog.read` (p.ej. kitchen) distingue 403 (existe) de 404 (no existe) por el `42501`. Impacto bajo; mínimo exposición intra-sucursal.
- `42501` inesperado del SQL se mapea a `authorization`→403 (`purchasing.service.ts:409`, cubierto en test:455), nunca 200/503: correcto.
- Pruebas nuevas no tautológicas: fallarían con el código previo (viewer/auditor solo tienen `catalog.read`, no `manage`); cubren viewer, auditor, viewer-sin-escrituras (create 0 consultas, update/receive 1) y ajeno 403. El cambio cashier→kitchen conserva el sentido "rol sin `catalog.read` denegado antes de la BD"; la denegación de escritura sigue cubierta por viewer.
- Flujo HTTP: el seed del viewer usa el manager y vive en la BD desechable `superrestaurant_http_inventory_api_<runId>` (DROP en `local-postgres.ts:173`); no requiere limpieza extra y añade 2 POST + 3 GET, coste bajo.

Verificación (evidencia real):
```
$ git show origin/harness/o4-compras-reads:apps/api/src/inventory/purchasing.service.ts | Select-String 'authorizeBranch\(principal, order|state === "42501"'
316: await this.authorizeBranch(principal, order.restaurantId, order.branchId, "catalog.read");
409: if (state === "42501") throw new PurchasingApplicationError("authorization");
$ ...purchasing.test.ts | Select-String '^test\("(read|write) isolation|^test\("listSuppliers: a kitchen'
189: test("listSuppliers: a kitchen role without catalog.read is denied before the database"...
358: test("read isolation: a viewer with only catalog.read lists suppliers, orders and a detail"...
380: test("write isolation: a viewer with only catalog.read cannot create or edit suppliers or orders"...
407: test("read isolation: a foreign principal is denied and never receives a foreign order"...
```

NO VERIFICADO: no ejecuté API typecheck/lint/test ni `test:http:local` (el orquestador reporta 9/9); no probé PostgreSQL real ni navegador.