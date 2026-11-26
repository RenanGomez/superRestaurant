I'll read the two files specified in the review brief.
I'll check the harness report template referenced by the prompt (§10) and gather read-only evidence for findings.
VEREDICTO: CORREGIR

**P1** `test:265` — `confirm_capture_draft_v3_with_inventory` solo se invoca con `p_order=null` → `'rejected'`; la ruta `applied`→consume (mig:352-378) nunca se ejecuta, así que el "gancho de venta" real queda sin probar. Añadir una confirmación válida y verificar sus movimientos.
**P1** `test:267` — igual `cancel_order_with_inventory`: solo `null`→`'conflict'`; no se prueba la orden cancelada completa (loop `mig:423-435` ni el match `cancellationAudit.eventId`). El brief (Q2) lo exige expresamente.
**P2** `test:235/238` — el "ceil" no está probado: recetas 200 y 120 son pares, `(q+1)/2 == q/2`; usar cantidad impar (p.ej. 121→61) para distinguir techo de piso (`mig:166`).
**P2** `test:149-160` — las mitades usan insumos distintos (half_a=flour, half_b=cheese); nunca se ejerce la agregación `sum() GROUP BY item_id` de dos mitades que comparten insumo (`mig:161-176`).
**P2** `test:308` — "actor de otra sucursal" no se prueba distinto: `foreign_actor` es de otro restaurante **y** sucursal; el eje *branch* con igual restaurante no se ejercita.
**P3** `test:339` — `inventory_consumptions WHERE restaurant_id=r2` = 0 es vacuo (no hay filas r2); el aislamiento de lectura sólo se prueba de verdad en `329-332`. Insertar una fila r2 y verificar invisibilidad.
**P3** `test:288-291` — el query de replay omite `compensates_movement_id is not null` (sí presente en `276-279`); inconsistente.
**P3** — no probados: skip por `p_warehouse_id NULL` (`mig:99-103`), `INVENTORY_ORDER_SCOPE_INVALID`, `INVENTORY_ORDER_ITEM_SCOPE_INVALID`, `INVENTORY_WAREHOUSE_INACTIVE` en consume (`mig:116`; sólo cubierto a nivel ledger) y fallback legacy `halves` sin `pizzaHalves` (`mig:34`).

Q3: `begin`/`rollback` + `auth.uid()` temporal se revierten; sin estado residual ni dependencia de orden salvo aplicar 20261126000500 (normal). ✓
Q4: `unique(restaurant,order,order_item,cause)` es superconjunto de `(order_item_id,cause)` y el ledger es idempotente: cumple ADR-013. ✓

*(Plan mode: solo lectura; no ejecuté tests ni PG.)*