# Estado del loop

Actualizado: 2026-11-26 00:20Z (ola M3 inventario API/UI + migraciones remotas aplicadas)

- **M1/M2:** cerrados. M2 con puertas humanas en `docs/agentic/m2-offline-signoff.md` (migraciones remotas, dispositivo real, impresora, capturas).
- **M3 inventario:** dominio (#80-#84, #87), contratos (#88), SQL de catálogo (#81), ledger (#86), recetas (#89), compras (#91), consumo por venta y reverso (#97), recetas API (#100), API de insumos/almacenes (#90, #98), movimientos/transferencias/saldos + pantalla `/app/inventario` (#99) y API de compras (#102). 87 migraciones desde cero en verde con el verificador rollback-only.
- **Porcentaje M3 (fusionado / total del hito):** ~92 %. API completa y probada; UI con insumos, almacenes, movimientos y recetas; faltan compras/alertas en la UI, pruebas HTTP contractuales y verificación visual real.
- **Decisiones nuevas:** (1) catálogo de inventario por funciones `app_private` SECURITY DEFINER, no grants directos a `app_api` (rompían `app-api-recovery` y abrían lectura cross-tenant); (2) consumo por venta con envoltorios `*_with_inventory` y almacén por defecto por sucursal; (3) `toWarehouseId` explícito en transferencias; (4) sin `imports` de módulos en `AppModule`.
- **Migraciones remotas (dev):** APLICADAS las 21 pendientes hasta `20261126001100` (13 + 8 al fusionarse la ola M3) con el protocolo 19.6; postcheck `upToDate=true`. Informe: `docs/agentic/dev-migrations-2026-11-25.md`. Queda fuera `20260908000100` (objetos ya existentes sin fila de historial).
- **Bloqueado:** nada por permisos de sesión. Pendiente de decisión/acción humana: proveedores reales y reconciliación de `20260908000100`.
- **Retomada:** `HANDOFF.md` (entradas 2026-11-25) y `.agents/briefs/m3-api-purchasing.md`.
