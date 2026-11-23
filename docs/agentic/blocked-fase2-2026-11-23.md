# Ítems `BLOCKED` de Fase 2 en `TODO.md` (Ola 0.2)

- **Fecha:** 2026-11-23 (America/Phoenix)
- **Tarea:** Ola 0.2 (`agy`, lectura/documentación, Nivel D según `AGENTS.md` §19.2)
- **Corte inspeccionado:** `main` (`aec8f285`)
- **Fuentes verificadas:** `TODO.md`, `HANDOFF.md`, `PROJECT_NOTES.md`, `AGENTS.md` (§3.1, §19.2–§19.6), `docs/PLAN_MODERNIZACION_POS_RESTAURANTE.md` (§8.8.2, §14), `docs/agentic/visual-verify-r2.md`, `docs/runbooks/guia-de-pruebas-operador.md`, `.github/workflows/ci.yml`, `apps/api/src/operations/capture-continuity-protected-smoke-coordinator.ts`, `apps/web/src/app/app/capture/capture-workspace.tsx` y `apps/web/e2e/journeys/`.

---

## 1. Resumen ejecutivo

En `TODO.md` existen **exactamente dos ítems `BLOCKED` de Fase 2 (`P2`)**: **`P2 pedido D4`** (`TODO.md:98`) y **`P2 pedido D5`** (`TODO.md:100`). Ambos tienen **código, SQL, API y UI ya implementados e integrados en `main`** (con migraciones aplicadas en Supabase remoto desde 2026-09-25 e invariantes SQL verdes en `pg-verify`), y permanecen `BLOCKED` únicamente por falta de **evidencia visual autenticada en navegador** tras agotarse el último `runId` del arnés remoto.

| Ítem (`TODO.md`) | Causa real del bloqueo | Decisión requerida | Recomendación conservadora (1 línea) | Qué desbloquea |
|---|---|---|---|---|
| **D4 · Instrucciones de entrega en Capture/Order** (`TODO.md:98`) | Falta evidencia visual en navegador tras consumirse el último `runId` remoto (2026-09-26); sin cobertura aún en `http-flow` ni en `e2e/journeys/`. | Elegir cómo obtener la evidencia visual/E2E (local/Playwright vs. nuevo `runId` remoto) y ratificar mantener `legacyAddressInstructions` deprecado en v1.0. | Pasar D4 a `REVIEW`, conservar `legacyAddressInstructions` como compatibilidad de solo lectura en v1.0 y cerrar su evidencia visual con Playwright local + guía única sin nuevas fixtures remotas. | Saca D4 de `BLOCKED`, avanza el cierre de `TODO.md:252` (directorio/snapshots) y alimenta Ola 1.6 (`guia-de-pruebas-operador.md`). |
| **D5 · Pedidos recientes y “repetir pedido”** (`TODO.md:100`) | Falta evidencia visual en navegador del flujo historial → preview con warnings/bloqueos → preparar → confirmar tras consumirse el `runId` remoto; sin cobertura en `http-flow`, `e2e/journeys/` ni guía del operador. | Elegir dónde ejecutar el flujo con divergencias de catálogo (producto retirado, precio cambiado, opción inválida) sin contaminar el catálogo real en remoto. | Pasar D5 a `REVIEW` y probar las divergencias de catálogo en PG17 local desechable + Playwright local, sin mutar el catálogo ni crear fixtures en Supabase remoto. | Saca el último `BLOCKED` de Fase 2, habilita cerrar `TODO.md:252` (historial/repetición) y fija el caso faltante para Ola 1.4 y Ola 1.6. |

> **Nota sobre la política vigente (`AGENTS.md` §19.6, 2026-11-23):** la autonomía total eliminó la espera de aprobación humana para lanzar corridas verificables, pero **no** exime de evidencia visual real (escritorio y `390×844`, consola y red limpias) ni del protocolo de seguridad para no contaminar datos reales. Además, `apps/web/playwright/.auth/user.json` está expirado (`docs/agentic/visual-verify-r2.md` §1.2), por lo que la vía local/controlada evita depender del arnés remoto fallido.

---

## 2. Detalle de los 2 ítems `BLOCKED` de Fase 2

### 2.1. `BLOCKED · P2 pedido D4` (`TODO.md:98`) — Instrucciones de entrega fuera de Customer Address hacia Capture/Order

#### Estado real verificado en `main`
- **Implementado y en CI:** contratos V2, comando CAS/idempotente `POST /captures/delivery-instructions`, sugerencias opt-in `POST /captures/delivery-instructions/suggestions` (mismo `Customer`/`Branch`, ventana 180 días, deduplicado, máximo 5), `OrderFulfillmentSnapshotV2` (`deliveryInstructions` congeladas + `legacyAddressInstructions` solo como compatibilidad deprecada), UI con autoguardado y lista opt-in en `apps/web/src/app/app/capture/capture-workspace.tsx:1483-1509` (reforzado con autoguardado serializado en `2d158c12`), visualización en detalle del repartidor (`apps/web/src/app/app/deliveries/courier-order-detail.tsx:108`), migraciones aplicadas en `zwbyiefqeujstyzysydn` e invariante `supabase/tests/capture_delivery_order_invariants.sql` ejecutado en CI (`pg-verify`).
- **Brecha exacta:** no se ha completado la inspección visual autenticada en navegador de: (1) sugerencias opt-in del cliente sin autoaplicación, (2) guardado/recarga de instrucciones en Capture, y (3) confirmación `Capture → Order` conservando el snapshot sin mutar la dirección. Ni `apps/api/src/http-flow.local.test.ts` ni `apps/web/e2e/journeys/` cubren todavía `deliveryInstructions` o `listSuggestions`.
- **Por qué se bloqueó:** el último `runId` remoto (`db9bea02-e698-43c5-9802-2cd0738c53a4`) del coordinador `apps/api/src/operations/capture-continuity-protected-smoke-coordinator.ts` falló en el baseline HTTP antes del lease (recovery confirmó residuo `0/0/0`) y lanzar otro `runId` remoto requería autorización humana explícita antes del 2026-11-23.

#### Decisión que necesita
1. **Canal de verificación visual/E2E:** decidir si la evidencia visual pendiente se obtiene en entorno local/Playwright (sin crear nuevas fixtures en Supabase remoto) o reparando y relanzando un nuevo `runId` del arnés remoto `REMOTE_CAPTURE_CONTINUITY_BROWSER_SMOKE`.
2. **Compatibilidad Address V1:** confirmar si `legacyAddressInstructions` permanece como campo deprecado de solo lectura durante v1.0 (sin migración destructiva).

#### Opciones
- **Opción 1 (Local + Playwright / guía única — conservadora):** mover D4 a `REVIEW`, mantener `legacyAddressInstructions` deprecado en v1.0, añadir el caso D4 a `http-flow.local.test.ts` (PG17 local) y validar en navegador real (escritorio y `390×844`, consola limpia) mediante Playwright local o la guía única del operador al renovar `e2e-auth`. **Ventaja:** cero riesgo sobre Supabase remoto ni retrabajo en el coordinador legacy. **Costo:** requiere sesión `e2e-auth` vigente o suite Playwright contra API+PG17 local.
- **Opción 2 (Relanzar arnés remoto con nuevo `runId`):** diagnosticar el fallo del baseline HTTP en `capture-continuity-protected-smoke-coordinator.ts`, verificar que su `prepareCustomerJourney` (`confirm` `schemaVersion: 2`, línea 500) sea compatible con los requisitos posteriores de cotización/plan V5, correr un `runId` nuevo sobre `zwbyiefqeujstyzysydn` y comprobar recovery `0/0/0`. **Ventaja:** reutiliza el protocolo 2×2 con Auth real. **Riesgo:** retrabajo en un arnés de septiembre y creación de fixtures en remoto.
- **Opción 3 (Solo guía humana de smoke sin prueba automatizada adicional):** mover D4 a `REVIEW` y delegar toda la validación visual a la prueba manual única de Emmanuel en `docs/runbooks/guia-de-pruebas-operador.md`, apoyándose en las pruebas SQL/unitarias ya en CI. **Ventaja:** velocidad inmediata. **Riesgo:** sin regresión automatizada HTTP/Playwright para sugerencias opt-in.

#### Recomendación conservadora (1 línea)
Pasar D4 a `REVIEW`, conservar `legacyAddressInstructions` como compatibilidad de solo lectura en v1.0 y cerrar su evidencia visual con Playwright local + guía única sin nuevas fixtures remotas.

#### Qué desbloquea
- **Estado en `TODO.md`:** saca `P2 pedido D4` (`TODO.md:98`) de `BLOCKED` hacia `REVIEW`, dejándolo listo para pasar a `DONE` bajo `AGENTS.md` §19.6 en cuanto pase la verificación visual (escritorio + `390×844`, consola limpia).
- **Cierre de Fase 2 (`TODO.md:252` y Plan §8.8.2 / §14):** completa la verificación del requisito «instrucciones de entrega en Capture/Order con historial sugerido opt-in y snapshot inmutable».
- **Ola 1.6 (`docs/runbooks/guia-de-pruebas-operador.md`):** incorpora el paso faltante de sugerencias opt-in y verificación del snapshot confirmado (actualmente la guía solo cubre el autoguardado básico en el punto de captura).

---

### 2.2. `BLOCKED · P2 pedido D5` (`TODO.md:100`) — Pedidos recientes y “repetir pedido” contra el catálogo vigente

#### Estado real verificado en `main`
- **Implementado y en CI:** reconciliador puro `buildRepeatOrderPlan` (incluyendo soporte de tamaños/variantes `variant_required` en `2153a55c`/`e1a10ca8`/`0851a906`/`3871eca1`), endpoints `GET /customers/:customerId/orders/recent` (límite 20), `GET /customers/:customerId/orders/:orderId/repeat-preview`, `POST /customers/:customerId/orders/:orderId/repeat`, confirmación atómica `confirm_capture_draft_v3`, UI de historial reciente, vista previa con líneas `ready`/`blocked` y warnings de precio, preparación y rehidratación tras recargar en `apps/web/src/app/app/capture/capture-workspace.tsx:1382-1413`, migraciones aplicadas en remoto y 4 suites SQL corriendo en CI `pg-verify` (`customer_order_history_invariants.sql`, `capture_repeat_order_invariants.sql`, `capture_repeat_order_workspace_invariants.sql`, `capture_repeat_order_confirmation_invariants.sql`).
- **Brecha exacta:** no existe evidencia visual autenticada en navegador del recorrido completo (historial → vista previa con producto retirado, precio cambiado y opción inválida → preparar líneas `ready` → recargar y ver plan rehidratado → confirmar). Tampoco está cubierto en `apps/api/src/http-flow.local.test.ts`, en `apps/web/e2e/journeys/` ni en `docs/runbooks/guia-de-pruebas-operador.md`.
- **Por qué se bloqueó:** exactamente el mismo motivo histórico que D4 — último `runId` remoto consumido con recovery `0/0/0` el 2026-09-25/26 — agravado por una restricción operativa propia de D5: probar divergencias reales de catálogo (retirar un producto o cambiar su precio entre la orden histórica y la repetición) no debe mutar el catálogo real de la sucursal en Supabase remoto.

#### Decisión que necesita
Definir **en qué entorno y con qué profundidad demostrar en navegador real las divergencias de catálogo al repetir pedido** (producto retirado, precio cambiado, opción inválida y `variant_required`) sin alterar el catálogo operativo de Navojoa en el proyecto remoto.

#### Opciones
- **Opción 1 (PG17 local desechable + Playwright local — conservadora):** mover D5 a `REVIEW`, añadir un flujo determinista en `http-flow.local.test.ts` y una spec Playwright contra API+PG17 local desechable que publique catálogo v1 → confirme orden → publique catálogo v2 (con 1 producto retirado, 1 precio cambiado y 1 opción inválida) → verifique preview, badges/alertas en escritorio y `390×844`, preparación `ready`, recarga y confirmación; añadir además el caso feliz de repetir pedido a la guía única del operador (Ola 1.6). **Ventaja:** 100 % determinista, cubre todos los casos negativos exigidos por `TODO.md:100` y no toca el catálogo remoto. **Costo:** 1 tarea acotada de pruebas en Ola 1.4.
- **Opción 2 (Relanzar arnés remoto con nuevo `runId`):** reparar `capture-continuity-protected-smoke-coordinator.ts` (baseline HTTP y compatibilidad con `confirm` actual) y ampliar su fixture temporal para publicar una segunda versión de catálogo en el restaurante desechable remoto, inspeccionar en navegador y verificar recovery `0/0/0`. **Ventaja:** prueba contra Supabase Auth remoto real. **Riesgo:** mayor complejidad del arnés remoto y riesgo de fixtures si falla antes del cleanup.
- **Opción 3 (Validar solo caso feliz en smoke humano y dar divergencias por cubiertas con dominio/SQL):** mover D5 a `REVIEW`, probar manualmente solo «ver pedidos recientes → vista previa → preparar → confirmar» con catálogo sin cambios y aceptar los invariantes de dominio/SQL para productos retirados y cambios de precio. **Ventaja:** no requiere sembrar v2 de catálogo en UI. **Riesgo:** no verifica visualmente el render de líneas bloqueadas y warnings de precio (`capture-workspace.tsx:1389-1403`).

#### Recomendación conservadora (1 línea)
Pasar D5 a `REVIEW` y probar las divergencias de catálogo (retirado, precio cambiado, opción inválida) en PG17 local desechable + Playwright local, sin mutar el catálogo ni crear fixtures en Supabase remoto.

#### Qué desbloquea
- **Estado en `TODO.md`:** elimina el segundo y último `BLOCKED` vigente de Fase 2 (`TODO.md:100`), habilitando su cierre a `DONE` bajo §19.6 sin riesgo sobre datos reales.
- **Cierre de Fase 2 (`TODO.md:252` y Plan §8.8.2):** cierra la brecha de verificación del flujo de historial operativo y repetición segura contra catálogo vigente.
- **Ola 1.4 y Ola 1.6:** define el caso concreto de prueba HTTP/Playwright local que falta para D5 y añade el flujo «Repetir pedido» a `docs/runbooks/guia-de-pruebas-operador.md` (hoy completamente ausente).

---

## 3. Aclaración sobre otros `BLOCKED` residuales en `TODO.md` (no son los 2 de Fase 2)

Para evitar confusiones al actualizar `TODO.md` tras la Ola 0, se verificaron las otras dos líneas que aún contienen `**BLOCKED`:

1. **`TODO.md:126` (`BLOCKED · A — menu-specialties (P3)`):** corresponde a prioridad `P3` (retroalimentación 2026-11-01), ya fue re-registrada como `TODO · A` con supuestos adoptados en `TODO.md:139` y quedó fuera del alcance congelado de v1.0 (`docs/plans/mvp-cierre-2026-11-22.md` §5; el modelo de pizza quedó cubierto por Pizza V2).
2. **`TODO.md:171` (`BLOCKED · A — z2b-rebase-confirm-on-pizza-v2`):** corresponde a la sección histórica «Smoke r2 · estado y pendientes (2026-11-21)»; el defecto SQL `42703` ya fue corregido e integrado a `main` en PR #7 (`ef214099`, migración `20261122000100_fix_confirm_capture_pizza_v2.sql`) y `pg-verify` quedó limpio en PR #19 (`8e6b04c0`). Solo falta limpiar la línea obsoleta en `TODO.md` cuando el orquestador sincronice el tablero.
