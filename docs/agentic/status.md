# Estado del loop

Actualizado: 2026-11-25 (ola M3 inventario: API y primera pantalla)

- **M1/M2:** cerrados. M2 con puertas humanas en `docs/agentic/m2-offline-signoff.md` (migraciones remotas, dispositivo real, impresora, capturas).
- **M3 inventario:** dominio (#80-#84, #87), contratos (#88), SQL de catálogo (#81), ledger (#86), recetas (#89), compras (#91), consumo por venta y reverso (#97), recetas API (#100), API de insumos/almacenes (#90, #98), movimientos/transferencias/saldos + pantalla `/app/inventario` (#99) y API de compras (#102). 87 migraciones desde cero en verde con el verificador rollback-only.
- **Porcentaje M3 (fusionado / total del hito):** ~87 %. La API y el consumo por venta están completos y probados de punta a punta; faltan alertas/costeo, pruebas HTTP contractuales, pestañas de UI y la verificación visual real.
- **Decisiones nuevas:** (1) catálogo de inventario por funciones `app_private` SECURITY DEFINER, no grants directos a `app_api` (rompían `app-api-recovery` y abrían lectura cross-tenant); (2) consumo por venta con envoltorios `*_with_inventory` y almacén por defecto por sucursal; (3) `toWarehouseId` explícito en transferencias; (4) sin `imports` de módulos en `AppModule`.
- **Bloqueado:** nada por permisos de sesión. Pendiente de decisión/acción humana: migraciones remotas (`20261121000100`, `20261123000300…0600`, `2026112600*`) y proveedores reales.
- **Retomada:** `HANDOFF.md` (entradas 2026-11-25) y `.agents/briefs/m3-api-purchasing.md`.
