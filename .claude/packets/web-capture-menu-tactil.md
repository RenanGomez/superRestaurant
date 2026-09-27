# web-capture-menu-tactil

## Tarea
web-capture-menu-tactil · capa: L2 (Codex) · riesgo: moderado · nivel C (producto: sólo `apps/web`; el API y los contratos ya existen en `main`). Prerrequisito integrado: rama `api-capture-lines` (contrato `CaptureSelectionPlanV1`, `CaptureWorkspaceV4`, `POST /api/v1/captures/selection-plan`, operación `selectionPlan` en `requestCapture`).

## Objetivo
Rediseñar `/app/capture` para que el operador arme el pedido desde el catálogo real con un menú táctil, siguiendo el prototipo aprobado por Emmanuel `docs/prototypes/captura-telefonica-menu-tactil.html` (ábrelo y reprodúcelo con los componentes y tokens de la web). El flujo existente (bandeja, origen/cumplimiento, cliente/dirección, instrucciones, repetir pedido, cotizar entrega, convertir en orden) se conserva; se añade el paso «Menú» y el ticket fijo con líneas y totales devueltos por el servidor.

## Contrato (no modificar; sólo consumir)
- Catálogo: `getMenuCatalog(token, apiBaseUrl, scope)` en `apps/web/src/lib/menu-catalog.ts` → `MenuCatalogStateV1.catalog: MenuCatalogV1 | null` con `catalogVersion`, `currency`, `categories[{id,name,active,displayOrder}]`, `products[{id,categoryId,name,active,displayOrder,unit,unitPriceMinor,tax}]`, `modifierGroups[{id,productId,active,minimumQuantity,maximumQuantity,options[{id,name,active,unitPriceMinor}]}]`. Cárgalo en `page.tsx` (server) y pásalo al workspace como prop, igual que `confirmationContext`.
- Plan de selección (lo que la UI ENVÍA, sólo ids y cantidades): `CaptureSelectionPlanV1 { schemaVersion:1, catalogVersion, lines[{ lineId: uuid generado con crypto.randomUUID(), productId, variantId: null, quantity 1..1000, modifierGroups[{groupId, selections[{optionId, quantity}]}], note: string|null }] }` dentro de `ReplaceCaptureSelectionPlanCommandV1` (mismas claves comunes que `fulfillment`: `captureDraftId`, `expectedVersion`, `attentionLeaseId`, `idempotencyKey`, `eventId`, `deviceId`, `occurredAt`, scope). Se manda el plan COMPLETO en cada cambio (agregar, cambiar cantidad, quitar); 0 líneas = vaciar.
- Respuesta (lo que la UI MUESTRA): `CaptureWorkspaceV4` con `selectionProjection { currency, subtotalMinor, lineCount, lines[{ lineId, productName, quantity, unitPriceMinor, lineTotalMinor, note, modifiers[{name, quantity, unitPriceMinor}] }] } | null`. El ticket pinta exclusivamente estos importes; el cliente nunca suma.
- Operación: `captureWorkspaceAction("selectionPlan", command)` (ya enrutada en `actions.ts` y `lib/capture-workspace.ts`). La lectura `workspace` devuelve V4 con la proyección para recuperar al recargar.
- Errores: `conflict` (409) con catálogo desactualizado → mostrar «El menú cambió; vuelve a cargar» y recargar catálogo + workspace; `variantId` siempre `null` (variantes/fracciones no soportadas en este corte: no ofrecer mitades).

## Criterios de aceptación (verificables)
- [ ] Paso «Menú» dentro del workspace: categorías activas ordenadas por `displayOrder` (rail lateral en ≥1024 px, chips horizontales en móvil), tarjetas de producto (nombre, precio `es-MX` desde `unitPriceMinor`, contador de unidades en el pedido), buscador `/`, productos inactivos marcados «Agotado» y no seleccionables.
- [ ] Tocar un producto sin grupos de modificadores lo agrega directo (cantidad 1; otro toque suma 1). Con grupos: hoja in-app (sin `window.prompt`) con cada grupo, `minimumQuantity/maximumQuantity` validados en cliente sólo para UX (el servidor revalida), SIN campo de nota (envía siempre `note: null`; el API rechaza notas con 409 `CAPTURE_SELECTION_NOTE_UNSUPPORTED` hasta que Order las modele), control ± y botón «Agregar · $importe» que muestra el precio devuelto tras guardar (mientras no hay respuesta, muestra «Calculando…»; nunca sumas locales).
- [ ] Ticket fijo (lateral en escritorio, barra inferior + hoja en 390×844) con líneas de `selectionProjection`, ± por línea, quitar línea, subtotal y total; «Dejar en espera» y «Sin venta» existentes se conservan.
- [ ] Cada mutación envía el plan completo con `expectedVersion` actual y `idempotencyKey` nuevo; en `unavailable` reintenta una vez con la misma key (patrón de `delivery-zones`); estados de carga/error explícitos por acción; sin doble envío (deshabilitar controles mientras hay petición en vuelo).
- [ ] Al recargar, la proyección se recupera del workspace V4 y el ticket se repinta sin acción del operador.
- [ ] «Convertir captura en orden» queda habilitado cuando hay ≥1 línea o plan de repetición, más turno abierto (y mesa si aplica), como hoy.
- [ ] Bugs del 2026-09-27 que tocan esta pantalla: texto de transferencia claro («Nadie más de la sucursal tiene sesión activa» + qué hacer); atajo N/Esc/F2 conservados.
- [ ] Sin `alert/confirm/prompt`; targets ≥44 px; foco visible; `prefers-reduced-motion`; tokens de `globals.css`.
- [ ] Helpers puros en `apps/web/src/lib` con `node:test`: `buildSelectionPlan(lines, catalogVersion)` (construye el comando desde el estado local, `note: null` siempre), `applyLineChange(plan, change)` (agregar/±/quitar, fusiona líneas con mismo producto y misma selección de modificadores), `groupProductsByCategory(catalog)`, `validateModifierSelection(group, selections)`.
- [ ] `pnpm --filter @super-restaurant/web lint|typecheck|test|build` verdes. Verificación en navegador por el orquestador/Emmanuel en escritorio y 390×844.

## Archivos de entrada
- `C:\tmp\sr-wt\web-capture-menu-tactil\docs\prototypes\captura-telefonica-menu-tactil.html`: referencia visual aprobada (estructura, jerarquía, hoja de armado, ticket).
- `apps\web\src\app\app\capture\capture-workspace.tsx` (~741 líneas): estado y secciones actuales; extrae el menú y el ticket a componentes hermanos (`capture-menu.tsx`, `capture-ticket.tsx`, `product-sheet.tsx`) para no crecer el archivo; lee sólo los rangos que necesites.
- `apps\web\src\app\app\capture\page.tsx`, `actions.ts`; `apps\web\src\lib\capture-workspace.ts` (operación `selectionPlan`, `parseCaptureWorkspaceV4`); `apps\web\src\lib\menu-catalog.ts`.
- `packages\shared-types\src\capture-selection-plan.ts` (tipos y parsers; sólo importar).
- `apps\web\src\app\app\delivery-zones\*` como patrón de reintento idempotente y errores; `apps\web\src\lib\shortcut-dispatch.test.ts` como patrón de pruebas.

## Invariantes
- El cliente no calcula dinero ni decide permisos; contratos y `apps/api` intactos; no tocar `packages/*` ni `supabase/*`.
- Scope Restaurant/Branch viene del servidor; el `catalogVersion` que se envía es el del catálogo cargado.
- Flujos existentes (repetir pedido, cotizar, confirmar, transferencia) siguen funcionando.

## Fuera de alcance
- Mitades/fracciones/variantes (S5.1 UI), descuentos, propinas, cobro (S8 UI), pizza configurador.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```
Describe en la salida qué interacción exacta reproduce cada criterio para la verificación visual.

## Formato de salida
Resumen (3-6 líneas), archivos tocados, salida literal, riesgos/dudas. No commitees; el orquestador lo hace.
