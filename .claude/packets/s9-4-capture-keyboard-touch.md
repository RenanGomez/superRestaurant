## Tarea
s9-4-capture-keyboard-touch · capa: L2 · riesgo: bajo/moderado (UI web, sin contratos ni servidor)

## Objetivo
Implementar S9.4 "equivalencia táctil/teclado" en el Capture workspace web: atajos enseñables, foco visible, orden de tabulación lógico, targets táctiles ≥44px, `aria-keyshortcuts` y un panel "Atajos" colapsable, respetando `prefers-reduced-motion`.

## Criterios de aceptación (verificables)
- [ ] Nuevo `apps/web/src/lib/shortcut-dispatch.ts`: helper puro (sin React) que recibe `{ key, ctrlKey, metaKey, altKey, targetTag, targetIsEditable }` y una tabla de atajos y devuelve el id de acción o `undefined`. Nunca dispara cuando el foco está en `input`, `textarea`, `select` o contenteditable, salvo `Escape`. Exporta también `ariaKeyShortcut(id)` para poblar `aria-keyshortcuts`.
- [ ] Nuevo `apps/web/src/lib/shortcut-dispatch.test.ts` con `node --test` (mismo patrón que `apps/web/src/lib/capture-workspace.test.ts`): cubre N (nueva captura), `/` (foco búsqueda), Escape (volver a bandeja sólo cuando hay error `conflict` o capture confirmada; nunca resetea un borrador editable), no disparar en inputs, modificadores ignorados, teclas desconocidas.
- [ ] `capture-workspace.tsx`: un solo `useEffect` con listener `keydown` en `window` que llama al helper y despacha a los handlers existentes `create`, `reset` y al foco del input de búsqueda; respeta `busy`/`locked`; se limpia al desmontar. `aria-keyshortcuts` en los botones "Nueva captura telefónica", "Volver a la bandeja" y en el input de búsqueda.
- [ ] Panel "Atajos" colapsable (`<details>`/`<summary>` nativo, sin animación) al pie del workspace listando los atajos.
- [ ] Los `<input type="checkbox">` de transferencia y apropiación pasan de `min-h-5 min-w-5` a un contenedor `label` con `min-h-11` y área clicable completa; el checkbox conserva `min-h-5 min-w-5` visual.
- [ ] `<select name="mode">` e `<input name="query">` del formulario de búsqueda reciben `<label htmlFor>` visibles o `aria-label`.
- [ ] Ningún cambio en `CaptureWorkspaceParameters`, en `actions.ts`, en contratos ni en rutas.
- [ ] `pnpm --filter @super-restaurant/web lint`, `typecheck`, `test` y `build` en verde; salida literal pegada.

## Archivos de entrada
- C:\tmp\sr-wt\s9-4-capture-keyboard-touch\apps\web\src\app\app\capture\capture-workspace.tsx (633 líneas; constantes `button`/`input`/`panel` en 33-35; handlers 184-374; JSX 381-633). Lee por rangos.
- C:\tmp\sr-wt\s9-4-capture-keyboard-touch\apps\web\src\app\globals.css (1-48: tokens Tailwind v4 y `prefers-reduced-motion`).
- C:\tmp\sr-wt\s9-4-capture-keyboard-touch\apps\web\src\lib\capture-workspace.test.ts (1-35: patrón de pruebas).
- C:\tmp\sr-wt\s9-4-capture-keyboard-touch\apps\web\package.json (scripts) y tsconfig.test.build.json (cómo se compilan las pruebas).

## Resumen L3 del componente (generado por DeepSeek, verificado)

─── claude-code-deepseek-delegator
◆ delegated to OpenRouter (deepseek/deepseek-v4-flash · read)
## Resumen del componente `CaptureWorkspace`

### 1. Acciones de usuario (handler → elemento, en orden JSX)

| Handler | Elemento | Descripción |
|---------|----------|-------------|
| `retryPending` | `<button>` (dentro del mensaje de error) | Reintentar operación pendiente |
| `reset` | `<button>` (solo si error `conflict`) | Volver a la bandeja |
| `create` | `<button>` “Nueva captura telefónica” | Crear borrador |
| `recover` | `<button>` por cada `item` en la bandeja | Recuperar borrador |
| `setTakeoverDraftId` | `<select>` “Captura asignada” | Elegir captura para apropiación |
| `setTakeoverReason` | `<textarea>` “Motivo obligatorio” | Escribir motivo |
| `setTakeoverConfirmed` | `<input type="checkbox">` | Confirmar apropiación |
| `takeOverCapture` | `<button>` “Tomar control de la captura” | Ejecutar apropiación |
| `changeSource` | `<select>` “Origen” | Cambiar canal de origen |
| `changeFulfillment` | `<select>` “Cumplimiento” | Cambiar canal de cumplimiento |
| `setTransferTarget` | `<select>` “Operador destino” | Elegir operador para transferencia |
| `setTransferConfirmed` | `<input type="checkbox">` | Confirmar transferencia |
| `transferCapture` | `<button>` “Transferir de forma segura” | Ejecutar transferencia |
| `previewOrder` | `<button>` “Revisar para repetir” (por pedido) | Vista previa de repetición |
| `repeatOrder` | `<button>` “Preparar … líneas” | Repetir pedido |
| `setDeliveryInstructions` | `<button>` por sugerencia | Copiar sugerencia al textarea |
| `saveDeliveryInstructions` | `<form>` con submit | Guardar instrucciones de entrega |
| `search` | `<form>` con submit | Buscar cliente |
| `read` | `<button>` por candidato en resultados | Cargar detalle del cliente |
| `selectCustomer` | `<button>` por teléfono | Seleccionar contacto |
| `selectAddress` | `<button>` por dirección | Seleccionar dirección validada |
| `setSelectedShiftId` | `<select>` “Turno abierto” | Elegir turno |
| `setSelectedTableId` | `<select>` “Mesa” (solo `dine_in`) | Elegir mesa |
| `confirmCapture` | `<button>` “Convertir captura en orden” | Confirmar y crear orden |

### 2. Estados que bloquean acciones

- **`busy`** (true): todas las acciones deshabilitadas (incluye `disabled` en botones y selects).
- **`locked`** (derivado): `busy || capture?.status !== "draft" || capture?.attentionLeaseId === null || error === "denied" || error === "conflict"`. Se usa como `disabled={locked}` en la mayoría de elementos.
- **`canConfirm`** (derivado): requiere `confirmationContext !== undefined && selectedShiftId !== "" && fulfillmentChannel !== null && (fulfillmentChannel !== "dine_in" || selectedTableId !== "") && (fulfillmentChannel !== "delivery" || (customerSnapshot !== null && fulfillmentSnapshot !== null))`. El botón de confirmar se deshabilita si `!canConfirm`.
- **Condiciones locales adicionales**: botón de transferencia deshabilitado si `transferTarget === ""` o `!transferConfirmed`; botón de apropiación deshabilitado si `takeoverDraftId === ""` o `takeoverReason.trim().length === 0` o `!takeoverConfirmed`; botón de repetir deshabilitado si `repeatPreview.readyLineCount === 0`.

### 3. Elementos sin `label`/`aria` o con tamaño táctil insuficiente

- **Sin label asociado**:
  - `<select name="mode">` (búsqueda) – no tiene `<label>` con `htmlFor`.
  - `<input name="query">` (búsqueda) – no tiene `<label>`.
  - Botones de sugerencias (`<button>` en instrucciones) – no tienen `aria-label`.
  - Botones de resultados de búsqueda y de direcciones – no tienen `aria-label` descriptivo.
- **Tamaño táctil insuficiente**:
  - Los `<input type="checkbox">` tienen `min-h-5 min-w-5` (20px), muy por debajo del estándar 44×44px.
  - Los `<button>` y `<input>`/`<select>`/`<textarea>` usan `min-h-11` (44px), correcto.

### 4. Constantes de estilo

Definidas al inicio del archivo (no importadas):

```ts
const panel = "rounded-xl border border-border bg-surface p-4 sm:p-5";
const button = "min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const input = "min-h-11 rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
```

Se usan directamente en el JSX mediante template literals.

### 5. Riesgos de añadir un listener global de teclado

- **Conflictos con navegación nativa**: atajos como `Enter`, `Space`, `Tab` ya manejan formularios y botones. Un listener global podría interceptarlos y romper la accesibilidad (especialmente para lectores de pantalla).
- **Ignorar estados bloqueantes**: si el listener no verifica `busy` o `locked`, podría ejecutar acciones no permitidas (ej. confirmar mientras se está guardando).
- **Condiciones locales no triviales**: muchos botones tienen habilitación condicional (ej. `transferCapture` requiere `transferConfirmed`). Un atajo global tendría que replicar esas condiciones, aumentando la complejidad y riesgo de errores.
- **Foco y contexto**: el componente tiene múltiples secciones condicionales. Un atajo global podría actuar sobre elementos que no están visibles o que están deshabilitados, causando comportamientos inesperados.
- **Múltiples instancias**: si el componente se usa varias veces en la página, un listener global afectaría a todas, lo que rara vez es deseable.

**Recomendación**: en lugar de un listener global, usar atajos locales con `onKeyDown` en elementos específicos (ej. `Enter` en el campo de búsqueda) o delegar a la navegación por teclado nativa. Si se necesita un atajo global, limitarlo a teclas de función (F1-F12) y verificar siempre `busy`, `locked` y la visibilidad del elemento objetivo.

## Invariantes que NO deben cambiar
- Sin `alert()`, `confirm()` ni `prompt()`.
- Acciones destructivas (takeover, transfer, reset de borrador) mantienen su confirmación en la UI; ningún atajo las ejecuta directamente.
- Los atajos no se disparan mientras se escribe; `busy` y `locked` bloquean igual que los botones.
- `focus-visible:outline-2 focus-visible:outline-accent` y `min-h-11` se conservan.
- Sin cambios de servidor, contratos, persistencia ni `apps/mobile`.

## Fuera de alcance
- Favoritos, búsqueda de producto, cantidades y modo de alto volumen (S9.3/S9.4 posteriores).
- Cualquier cambio en `actions.ts`, shared-types o API.

## Verificación
- pnpm --filter @super-restaurant/web lint
- pnpm --filter @super-restaurant/web typecheck
- pnpm --filter @super-restaurant/web test
- pnpm --filter @super-restaurant/web build
- Pega la salida literal de los cuatro. La verificación en navegador (desktop y 390×844) la hará el orquestador.

## Formato de salida esperado
1. Resumen (3-6 líneas). 2. Archivos tocados. 3. Salida literal de los cuatro comandos. 4. Riesgos o dudas. Commits locales pequeños con conventional commits (`feat(web): ...`).
