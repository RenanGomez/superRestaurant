## Tarea
web-menu-halves-product-ui (lote-smoke-20261007, Menú U3) · capa: L1 implementer-claude (Codex falla por entorno) · riesgo: moderado · nivel C (sólo `apps/web`; no tocar `apps/api`, `packages/**`, SQL)

## Objetivo
Llevar a la web lo que ya integró el servidor en main `027516c` (mitades configuradas en el producto y mitad armada ingrediente por ingrediente), y cerrar los P3 de la ronda anterior.

## Contexto (ya en main)
- `MenuProductV1.fraction?: MenuProductFractionV1 | null` (`packages/shared-types/src/index.ts` ~301-350): `{ enabled, flavorGroupId, extraGroupId, excludableIngredientIds }`; aplica a todos los tamaños y al producto sin tamaños. `variant.fraction` sigue existiendo como legado; el servidor rechaza un producto con `fraction` habilitada que además tenga un tamaño con `fraction` habilitada.
- `LineFractionV1` slot: `flavorOptionId: string | null`; `null` = mitad armada (sólo si hay `extraGroupId`); al menos una mitad debe tener sabor. El servidor cotiza y congela; la mitad armada se congela con `flavorName: "Armada"`.
- Reglas de Emmanuel (PROJECT_NOTES «Smoke 2026-10-07»): sabores = combinación fija a precio fijo; ingredientes = armar ingrediente por ingrediente; mitades = sabor+sabor o sabor+armada.

## Criterios de aceptación (verificables)
1. **Editor de menú** (`apps/web/src/app/app/menu/menu-catalog-editor.tsx`, `FractionEditor` ~340-400 y su uso ~303): «Permitir mitades» se muestra **una vez por producto** (no por tamaño), aunque el producto no tenga tamaños, y escribe `product.fraction`. Si un producto llega con config legada en tamaños (`variant.fraction` habilitada) y sin `product.fraction`, el editor la muestra como la del producto y, al guardar, la mueve a `product.fraction` y deshabilita la de los tamaños (para no chocar con el servidor). Si los tamaños tienen configs distintas, mostrar aviso «Los tamaños tienen mitades configuradas distinto; al guardar se usará la de <tamaño>» y no perder datos sin que lo vea.
   - Etiquetas: «Grupo de sabores» y «Grupo de ingredientes (para armar y extras, opcional)», con `FieldHint` explicando cada uno según las reglas.
   - Cuando un grupo ya está elegido en el otro select, no desaparece en silencio: se muestra deshabilitado con «(ya usado como ingredientes/sabores)»; si el select de sabores queda sin opciones elegibles, texto: «“<grupo>” ya está usado como ingredientes; crea un grupo de sabores en Modificadores.»
2. **Hoja de captura** (`apps/web/src/app/app/capture/product-sheet.tsx`, `apps/web/src/lib/line-halves.ts`): usa `product.fraction` (o, si falta, la legada del tamaño elegido); «Mitad y mitad» disponible también sin tamaños. Cada mitad permite elegir un sabor **o** «Armar con ingredientes» (sólo si hay grupo de ingredientes): la mitad armada elige ingredientes del grupo de ingredientes (multi, respetando máximos) y `flavorOptionId: null`. No permitir ambas mitades armadas (mensaje claro). El estimado sigue viniendo del servidor (`POST /captures/line-quote`); el cliente no calcula precios. Restaurar una línea con mitad armada (`flavorOptionId` null o `flavorName` «Armada») funciona (hoy `line-halves.ts:162-165` falla cerrado). Ticket/detalle muestran «Mitad A: Armada (ingredientes…)» donde hoy muestran el sabor (`print-documents.ts`, `order-detail-panel.tsx`, `capture-ticket.tsx` si aplica).
3. **P3 de la ronda anterior**: `components/field-hint.tsx` con nombre accesible por campo («Ayuda sobre <campo>») y sin contaminar el nombre del input (hint fuera del `<label>` o `aria-describedby` en el input); tooltip que no se salga por la derecha en 390 px; cierre con `pointerdown` fuera (iOS). `StationSelect`: «Otra estación…» vacía no deja un valor basura (vuelve al previo o bloquea publicar con mensaje). `RemovalDialog`: foco inicial en «Cancelar».
4. Pruebas unitarias para los helpers puros nuevos/cambiados (`line-halves.ts`, migración legada→producto en el editor si se extrae a `src/lib`).

## Archivos de entrada
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\menu\menu-catalog-editor.tsx (por rangos)
- ...\apps\web\src\app\app\capture\product-sheet.tsx, ...\apps\web\src\lib\line-halves.ts (+ test), ...\apps\web\src\lib\menu-variants.ts
- ...\apps\web\src\lib\print-documents.ts, ...\apps\web\src\app\app\orders\order-detail-panel.tsx, ...\apps\web\src\app\app\capture\capture-ticket.tsx
- ...\apps\web\src\components\field-hint.tsx
- ...\packages\shared-types\src\index.ts (sólo lectura, ~295-360 y parsers de fraction), ...\packages\shared-types\src\line-fraction.ts (sólo lectura)

## Invariantes
- el cliente no calcula dinero ni decide permisos; sin alert/confirm/prompt; targets ≥ 44 px; foco visible.

## Verificación
- pnpm --filter @super-restaurant/web lint / typecheck / test / build (Node 24 en %LOCALAPPDATA%\Programs\node24; si falta `dist` de packages, `pnpm --filter "./packages/*" build`)

## Formato de salida esperado
1. Resumen (3-6 líneas). 2. Archivos y commits (conventional, rama `claude/web-menu-halves-product-ui`, commits pequeños sobre la marcha). 3. Salida literal de verificaciones. 4. Riesgos.
