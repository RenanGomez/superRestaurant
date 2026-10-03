# capture-tray-lease-api · bandeja de borradores con cliente y renovación de lease

## Tarea
capture-tray-lease-api · capa: L1 (`implementer-claude`) · riesgo: moderado · **nivel B** (API de lectura y una mutación no financiera; contrato nuevo consumido sólo por web). Sube a nivel A únicamente si hace falta SQL nuevo (entonces: migración candidata + sonda local + prueba SQL).

## Objetivo
Que la web pueda (1) mostrar en la bandeja de borradores recuperables el nombre y teléfono del cliente, el canal, la hora y el total si existe, en lugar de IDs; y (2) renovar el lease de atención de una captura mientras el operador trabaja, con un mensaje claro cuando otra estación la tomó. Son las dos brechas que Codex no pudo cerrar en `web-capture-feedback` por falta de datos del API (hallazgos #9 y #24 del lote `lote-feedback-20261001`).

## Hechos a verificar primero (CodeGraph sobre el checkout principal)
- Contrato de la bandeja de capturas (`CaptureWorkTrayResultV1` o el que use `apps/web/src/app/app/capture/capture-workspace.tsx` y `apps/web/src/lib/capture-workspace.ts`): qué campos trae hoy y qué SQL lo alimenta (`list_capture_work_tray` o similar en `supabase/migrations`).
- Dónde vive el cliente de un borrador (snapshot party en `capture_drafts`/`customer_fulfillment_snapshots`) y si el lector puede exponer nombre y teléfono respetando que la PII sólo se devuelve a actores con `customers.read` (regla ya aplicada en `/branch-orders/tray`).
- Lease: `attentionLeaseId`, duración, quién lo invalida y si existe alguna ruta de renovación/heartbeat (`captures/*lease*`, `take`, `release`).
- Total del borrador: existe la proyección V5 con totales del servidor (`readCaptureWorkspaceV5WithProjections`); no calcular en cliente.

## Criterios de aceptación
- [ ] Bandeja: la respuesta incluye por borrador `customer: { displayName, phone } | null` (sólo con `customers.read`; si no, `null`), `channel`, `updatedAt`, `totalMinor | null` y `currency`, además de lo que ya traía. Contrato aditivo (campo nuevo, versión V2 si el parser exacto de web lo exige) con parser; pruebas de reducción de PII por rol y de aislamiento por sucursal.
- [ ] Lease: `POST /captures/lease/renew` (o el nombre coherente con las rutas existentes) que renueve el lease del actor sobre su captura, idempotente, y devuelva `conflict` con código explícito (`CAPTURE_LEASE_TAKEN`) cuando otra estación la tiene; si el lease se representa en SQL con expiración, la renovación va por función SQL existente o nueva en migración candidata. Prueba de renovación, de conflicto y de aislamiento.
- [ ] Puertas: shared-types (test/typecheck/lint/build), api (test/typecheck/lint/build), web typecheck y build, mobile y kds typecheck. Commits por unidad; informe parcial a los ~35 turnos; **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\capture-tray-lease-api\apps\api\src\captures.ts y captures.controller.ts (lectura de bandeja, lease).
- C:\tmp\sr-wt\capture-tray-lease-api\packages\shared-types\src\captures*.ts (contratos de bandeja y lease).
- C:\tmp\sr-wt\capture-tray-lease-api\apps\web\src\lib\capture-workspace.ts (cómo consume la web).
- Migraciones de capturas en C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\supabase\migrations (grep `capture_work_tray`, `attention_lease`).

## Invariantes
PII sólo con `customers.read`; alcance Restaurant/Branch en SQL y API; totales del servidor; contratos aditivos; sin push ni remoto.

## Fuera de alcance
UI (la hace Codex en un paquete C posterior), dinero, KDS.

## Formato de salida
Resumen, archivos y hashes, resultado final de cada puerta (y de la sonda SQL si hubo migración), riesgos.
