# Estado del loop

Actualizado: 2026-11-26 (sesión solo-dsh: preflight, Ola 1 compras + contratos HTTP, Ola 2 alertas)

- **M1/M2:** cerrados. M2 con puertas humanas en `docs/agentic/m2-offline-signoff.md` (migraciones remotas, dispositivo real, impresora, capturas).
- **M3 inventario:** dominio (#80-#84, #87), contratos (#88), SQL de catálogo (#81), ledger (#86), recetas (#89), compras (#91), consumo por venta y reverso (#97), recetas API (#100), API de insumos/almacenes (#90, #98), movimientos/transferencias/saldos + pantalla `/app/inventario` (#99), API de compras (#102), alertas/costeo (#106), pestañas Movimientos (#108), Recetas (#109), **Compras (#113)** y **Alertas/costos (#114)**; **contratos HTTP de inventario (#112)**. 88 migraciones desde cero en verde con el verificador rollback-only.
- **Porcentaje M3 (fusionado / total del hito):** ~97 %. API completa y probada por HTTP; UI con las seis pestañas. Faltan el pase visual real y el journey E2E.
- **Preflight 2026-11-26 (READ_ONLY):** `main` en `0916ab8d`; `lastRemote=20261126001100`; **sin candidatas** (única diferencia `20260908000100`, excluida por objetos preexistentes). Catálogo 69 tablas / 15 políticas / 159 funciones. No se aplicó ni editó nada.
- **Verificación de esta sesión:** `test:http:local` 10/10 con cleanup `stopped=true`; `verify:inventory-schema:rollback` 88 migraciones `ok`; web lint/typecheck/test (21/21)/build en 0; API typecheck/lint en 0.
- **Bloqueo:** el pase visual real está bloqueado por la sesión E2E caducada (`Invalid Refresh Token`), no por el código. Necesita login manual (`pnpm --filter @super-restaurant/web e2e:auth`) o `e2e-import-session.bat` con Chrome cerrado.
- **Decisiones nuevas:** (1) escrituras por funciones `app_private` SECURITY DEFINER, nunca grants directos a `app_api`; (2) consumo por venta con envoltorios `*_with_inventory` y almacén por defecto por sucursal; (3) `toWarehouseId` explícito en transferencias; (4) sin `imports` de módulos en `AppModule`; (5) el arnés HTTP de pruebas usa una transacción pg real.
- **Migraciones remotas (dev):** APLICADAS las 21 pendientes hasta `20261126001100` con el protocolo 19.6; postcheck `upToDate=true`. Informe: `docs/agentic/dev-migrations-2026-11-25.md`.
- **Retomada:** `HANDOFF.md` (entradas 2026-11-26) y `docs/plans/plan-dsh-cierre-m3-2026-11-25.md`.
