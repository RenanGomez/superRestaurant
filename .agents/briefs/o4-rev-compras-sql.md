# Brief o4-rev-compras-sql

NO escribas archivos fuera de tu informe `.agents/reports/o4-rev-compras-sql.md`. NO edites código, NO commitees, NO hagas push. NO ejecutes PostgreSQL ni Playwright. Trabaja en la raíz del repo y lee con `git show`.

## Objetivo
Revisión **foco SQL** de la rama `harness/o4-compras-reads` (PR #131, nivel A): migración `20261126001400_inventory_purchasing_reads.sql` e invariantes.

Tiempo estimado: 14 min

## Qué revisar
`git diff main...origin/harness/o4-compras-reads -- supabase/` y `git show origin/harness/o4-compras-reads:supabase/migrations/20261126001400_inventory_purchasing_reads.sql`, comparando con `git show main:supabase/migrations/20261126001000_inventory_purchasing_api.sql`.

## Qué comprobar
1. **Alcance mínimo**: solo se reemplazan `list_inventory_suppliers`, `list_inventory_purchase_orders` y `read_inventory_purchase_order`. Las escrituras (`create/update_inventory_supplier`, `read_inventory_supplier_for_manage`, `inventory_create_purchase_order`, `inventory_receive_purchase_order`) no cambian.
2. **Paridad exacta de cuerpos** salvo el gate de roles (el orquestador comparó por script y salió idéntico; verifícalo tú a mano).
3. **Lista de roles**: debe coincidir con `catalog.read` de `apps/api/src/auth/rbac-policy.ts` (owner, admin, manager, supervisor, cashier, waiter, viewer, auditor) y excluir courier/kitchen. ¿Hay algún rol de la matriz que falte o sobre? ¿Qué pasa si un rol futuro gana `catalog.read`?
4. **Privilegios**: `SECURITY DEFINER` + `set search_path = ''`, owner `postgres`, `revoke` a `public/anon/authenticated/service_role/app_api` y `grant` solo a `app_api`; nada de DML directo a `app`; sin `EXECUTE` para clientes.
5. **Alcance multi-tenant**: la autorización sigue exigiendo membresía activa del restaurante (y sucursal para órdenes) además del rol; un ajeno no debe ver filas aunque tenga rol.
6. **Invariantes** (`supabase/tests/inventory_purchasing_api_invariants.sql`): ¿las aserciones nuevas pueden fallar de verdad? ¿Cubren los seis roles de lectura y las dos negativas? ¿Se conservó la cobertura previa (escrituras denegadas, replay, totales)? ¿Alguna aserción se volvió vacua?
7. **Riesgo declarado**: duplicación de la matriz RBAC en SQL. ¿Basta el comentario o falta una prueba que falle si la matriz cambia?

## Reporte
`.agents/reports/o4-rev-compras-sql.md`, máximo 20 líneas:
1. `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
2. Hallazgos `P1`/`P2`/`P3` con `archivo:línea` y una frase de por qué.
3. Qué no pudiste verificar (el orquestador corrió `verify:inventory-schema:rollback` 91 migraciones ok y `test:http:local` 9/9).
