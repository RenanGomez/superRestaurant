# capture-no-sale

## Tarea
capture-no-sale · capa: L1 (`implementer-claude`) · riesgo: alto · nivel A (SQL `app_private`, estado de captura, ruta nueva, contrato compartido consumido por web y API) con una parte final nivel C (botón en el ticket).

## Objetivo
Que el operador pueda cerrar un borrador de captura como «sin venta» con motivo obligatorio, desde el ticket de `/app/capture`, dejando el borrador en historial (nunca borrado) y fuera de la bandeja de recuperables. Todo lo necesario existe a medias: el contrato `CloseCaptureNoSaleCommandV1` (`packages/shared-types/src/commercial-capture.ts`, con `attentionLeaseId` y `reason`), el estado `no_sale` en `app.capture_drafts` (`20260916000100`), la operación `capture.no_sale` en el journal (`20260916000200`, motivo obligatorio) y `closeCaptureNoSale`/`capture.no_sale` en `packages/domain/src/capture-draft.ts`. Falta la función SQL, la ruta y la UI.

## Criterios de aceptación
- [ ] Migración candidata `supabase/migrations/20260929000100_capture_no_sale.sql` con `app_private.close_capture_no_sale(actor uuid, command jsonb)` siguiendo exactamente el patrón de `hold`/`confirm` (scope + membership, lease vigente y propiedad del actor, CAS por `expected_version`, idempotencia por `idempotency_key` + fingerprint con replay determinista, advisory lock, journal `capture.no_sale` con `reason` 1..500, transición `draft → no_sale`, `attention` liberada, plan de repetición/selección eliminado por el trigger existente al salir de `draft`). `revoke`/`grant execute` sólo a `app_api`, `owner to postgres`. Reproducible desde cero; verificada con el verificador local PG17 (`--local-disposable-only`, patrón de `run-capture-selection-plan-schema-verification.ts`) y con pruebas en `supabase/tests/` (transición válida, replay, CAS viejo, lease ajeno, captura ya confirmada → conflict, fuga de scope → denied, motivo vacío → rejected).
- [ ] `POST /api/v1/captures/no-sale` en `captures.controller.ts` + servicio en `captures.ts` con el mismo mapeo de errores que `hold`; pruebas unitarias/controlador.
- [ ] La bandeja (`tray`) no lista capturas `no_sale` (verifica que la función de bandeja ya filtre por `draft`; si no, ajústala en la misma migración con `create or replace`).
- [ ] Web: operación `noSale` en `apps/web/src/lib/capture-workspace.ts` + `actions.ts`; en `capture-ticket.tsx` botón secundario «Sin venta» (≥44 px) que abre una confirmación in-app (no `confirm()`) con campo de motivo obligatorio y botones «Volver»/«Confirmar»; al éxito vuelve a la bandeja con aviso «Registrado sin venta». Puertas web.
- [ ] `pnpm --filter @super-restaurant/shared-types|api|web` lint/typecheck/test/build verdes; CodeGraph/grep de consumidores de `CaptureDraftState`, `tray`.
- [ ] Sondas rollback-only: además, promueve a `apps/api/src/operations/run-migration-rollback-probe.ts` (script `probe:migration:rollback -- <ruta.sql>`) la sonda genérica descrita en HANDOFF (2026-09-27: BEGIN, sentencia por sentencia con `extractMigrationStatements`, primer fallo con índice/sqlState/mensaje, ROLLBACK incondicional, sin imprimir URL; lee `SCHEMA_VERIFICATION_DATABASE_URL` y `SCHEMA_VERIFICATION_CA_CERT_PATH`, exige `SCHEMA_VERIFICATION_CONFIRMATION=ROLLBACK_ONLY` y `SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF`). No la ejecutes contra remoto; sólo pruébala contra el PG local.

## Invariantes
- Cerrar una captura no elimina su historial; `no_sale` es terminal y auditado con actor, sucursal, dispositivo, occurredAt, motivo.
- Scope y membership en SQL y API; parsers exactos; sin dinero involucrado.
- No editar migraciones aplicadas (`20260928000100` ya está aplicada en remoto: cualquier cambio va en la nueva).

## Entorno
Worktree `C:\tmp\sr-wt\capture-no-sale` (rama `claude/capture-no-sale` desde `main`). Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`; PG17 en `.cache/postgres-local/pgsql` (copiar del repo principal si falta). Un commit por unidad (SQL → api → web → sonda). Informe parcial a los ~35 turnos si no terminas. Sin push, sin remoto.

## Formato de salida
Resumen y decisiones, archivos y commits, salida literal de puertas y verificador PG, riesgos.
