# Estado del loop

Actualizado: 2026-11-26 (cierre de M3: pase visual real, journey E2E, almacén predeterminado y
ledger crudo cerrado)

- **M1/M2:** cerrados. M2 con puertas humanas en `docs/agentic/m2-offline-signoff.md` (migraciones
  remotas, dispositivo real, impresora, capturas).
- **M3 inventario: ~100 %.** Dominio, contratos, SQL, API (insumos, almacenes, movimientos,
  transferencias, saldos, recetas, compras, alertas/costeo), seis pestañas de `/app/inventario`,
  **almacén predeterminado por sucursal (#125)**, **ledger crudo cerrado a `app_api` (#122)**,
  **pase visual real 12/12 (#124)** y **journey E2E de inventario en verde (#123)**.
- **Porcentaje M3 (fusionado / total del hito):** ~100 %. Queda deuda P3 documentada, no bloqueante.
- **Puertas de esta ola:** `verify:inventory-schema:rollback` **90** migraciones desde cero `ok`;
  `test:http:local` 9/9; shared-types 49/49; API y web typecheck/lint/test en 0;
  `E2E_VISUAL=1` → **12/12** combinaciones con capturas en `docs/agentic/visual-verify-2026-11-26/`;
  journey 13 **1 test verde (1.7 min)** contra el stack local.
- **Migraciones remotas (dev):** aplicadas `20261126001200` y `20261126001300` con el protocolo
  §19.6 (sonda rollback-only 7 y 27 sentencias, respaldo schema-only, dry-run exacto, postcheck con
  `EXECUTE` correcto, segundo dry-run `upToDate`). `lastRemote=20261126001300`.
  Informe: `docs/agentic/dev-migrations-2026-11-26.md`.
- **Revisiones de la ola:** #122 APROBAR (SQL) + APROBAR (API tras el fix del P2); #124 APROBAR;
  #125 APROBAR (SQL) + APROBAR (API/UI con dos P2 corregidos); #123 APROBAR tras corregir 2 P2 y 1 P3.
- **Decisiones nuevas:** (1) el pase visual mide el hit area real de `::before/::after`; (2)
  `isDefault` es obligatorio en el contrato del almacén (API y web se despliegan juntos); (3) los
  worktrees de dsh viven en `.harness/worktrees` porque su sandbox no sale del repositorio; (4) el
  `storageState` se renueva con `tools/agentic/local-servers/refresh-e2e-session.mjs`.
- **Deuda:** `docs/agentic/debt.md` (P3 de auditor visual, UI de almacenes, `recipeVersionId` nulo en
  movimientos, receta no despublicable y fixtura estable del journey).
- **Siguiente ola:** `docs/plans/plan-2026-11-26-siguiente.md` §3 (deuda que muerde: verificadores
  históricos, revisiones de M2, lecturas de compras con `catalog.read`, `deviceId`) y después M4.
