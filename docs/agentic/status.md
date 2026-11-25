# Estado del loop

Actualizado: 2026-11-25 (siguiente ola M3)

- **M1/M2:** cerrados. M2 con puertas humanas en `docs/agentic/m2-offline-signoff.md` (migraciones remotas, dispositivo real, impresora, capturas).
- **M3 inventario:** dominio (#80-#84, #87), contratos (#88), SQL de catálogo (#81), ledger (#86), recetas (#89), API de insumos y almacenes (#90, funciones `app_private`), compras con idempotencia y auditoría (#91) y consumo por venta/reverso (`m3-sql-sale-consumption`, en revisión). 83 migraciones desde cero en verde con el verificador rollback-only.
- **Porcentaje M3 (fusionado / total del hito):** ~65 %. Faltan API de movimientos/recetas/compras/alertas, `m3-api-wire`, pruebas HTTP, UI de inventario, integración venta→stock y journey E2E.
- **Decisiones nuevas:** (1) la API de catálogo de inventario escribe por funciones `app_private` SECURITY DEFINER, no con grants directos a `app_api` (rompían `app-api-recovery` y abrían lectura cross-tenant); (2) el consumo por venta se expone por envoltorios `confirm_capture_draft_v3_with_inventory`/`cancel_order_with_inventory` para no editar funciones ya migradas; (3) `inventory_record_movement` conserva su EXECUTE hasta que existan wrappers por operación.
- **Bloqueado:** nada por permisos de sesión. Pendiente de decisión/acción humana: migraciones remotas (`20261121000100`, `20261123000300…0600`, `2026112600*`) y proveedores reales.
- **Retomada:** `docs/agentic/entrega-final-2026-11-25.md` §4 y `HANDOFF.md`.
