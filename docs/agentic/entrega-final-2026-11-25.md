# Entrega de la sesión autónoma — 2026-11-25

Sesión de orquestación solo-dsh ejecutando `docs/plans/plan-deepseek-fases-3-8.md`. El loop no se detuvo por las tres condiciones del plan (M7, todo BLOCKED, cuota): se detiene por fin de contexto del orquestador. El estado exacto para retomar está en `HANDOFF.md` y `docs/agentic/backlog.json`.

## 1. Qué quedó cerrado

### M1 (Fase 0–2) y M2 (Fase 3)
- M2 cerrado formalmente en `docs/agentic/m2-offline-signoff.md`, con puertas humanas explícitas.
- Ola 0 completa: líder de sync entre pestañas, purga/rotación del almacén cifrado, banner mobile probado, aserciones visuales §5.3, P3 de sync, registro de dispositivo por actor y cableado de suites.
- P1 reales heredados de #70 corregidos: ids de entidad con UUID válido, payloads honestos, registro de dispositivo antes del primer push y dispositivo por actor (cambio de turno en la misma tablet).

### M3 (Fase 4, inventario)
- ADR-013 aceptada (unidades enteras, ledger inmutable, costo promedio, consumo idempotente por venta) y mapa real de ganchos de venta (`aggregate->'items'`, sin `order_items` ni tabla de reembolsos).
- Dominio: `units`, `stock-ledger`, `costing`, `recipe-explosion` con 23+13+8+6 pruebas y exportados desde el índice.
- SQL: catálogo, ledger inmutable con reverso único (lock + índice parcial), recetas versionadas y compras/recepción. Verificador rollback-only del orquestador: 78–80 migraciones aplicadas desde cero, invariantes en verde.
- Contratos: DTOs y parsers exact-key con 37 pruebas (dinero como par, correcciones referenciadas, scope del saldo).
- API: insumos y almacenes con 14 pruebas (pendiente P1 de grants, abajo).

## 2. Abierto con evidencia (no bloquea retomar)

Ver `debt.md` § «M3 inventario — P1/P2 abiertos». Los P1 son:

1. Grants de `app_api` para las tablas de inventario (sin esto la API no escribe).
2. Idempotencia de `inventory_create_purchase_order`.
3. Pruebas de dinero/auditoría/proveedor ajeno en compras.

## 3. Puertas humanas

1. **Migraciones remotas** pendientes desde M2: `20261121000100`, `20261123000300`…`000600` y las de inventario `20261126000100`…`000400` (y la futura de consumo). Procedimiento en `docs/runbooks/`; comando exacto `pnpm --filter @super-restaurant/api verify:inventory-schema:rollback` para el probe y el flujo §19.6 para el apply.
2. **Proveedores reales** (PAC, pasarela, agregadores): todo M5 se construyó/construirá contra proveedores falsos.
3. **Dispositivo iOS/Android real**, exclusión de backup iOS, impresora Bluetooth física, capturas estéticas de §5.3.
4. **Deploy a producción**, dominios y secretos reales.

## 4. Cómo retomar

1. Leer `HANDOFF.md` (entradas 2026-11-25), `docs/agentic/status.md` y `docs/agentic/backlog.json`.
2. `git log --oneline -20` en `main` y `gh pr list`.
3. Siguiente tarea por prioridad: `m3-api-grants` (nuevo), `m3-sql-purchasing-fix`, `m3-sql-sale-consumption`, `m3-api-wire`, `m3-web-inventario`, `m3-int-sale-to-stock`, `m3-e2e-journey`; después M4 → M7 del plan.
4. Workers con `drain.ps1`; recordar: puertas dentro del directorio del paquete, sin rutas fuera del worktree, sin commit por el worker, `XDG_DATA_HOME` por run (ya parcheado en `agent.ps1`).

## 5. Métricas de la sesión

- PRs fusionados: #73, #74, #75, #76, #77, #78, #79, #80, #81, #82, #83, #84, #85, #86, #87, #88, #89.
- Abiertos al cierre: #90 (API insumos, P1 de grants), #91 (compras SQL, P1 de idempotencia).
- Patrón dominante: el worker completa el código pero agota turno sin informe (~40 % de corridas); el orquestador re-ejecutó puertas y fusionó con CI + revisión. Registrado en `DECISIONS_PENDING.md`.
