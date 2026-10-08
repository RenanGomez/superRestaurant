## Tarea
web-menu-smoke-fixes (lote-smoke-20261007, Menú puntos 0, 1, 2, 5, 6) · capa: L2 Codex · riesgo: moderado · nivel C (sólo `apps/web`; no tocar `apps/api`, `packages/**`, SQL)

## Objetivo
Corregir los hallazgos del smoke de Emmanuel en el editor de menú y añadir ayudas (tooltips) a las etiquetas de todos los formularios de la web.

## Criterios de aceptación (verificables)
0. **Arrastrar para reordenar** (`apps/web/src/app/app/menu/reorder-controls.tsx`): hoy el asidero ⋮⋮ sólo actúa al soltar y no hay ninguna señal visual, Emmanuel percibe que no se puede arrastrar. Durante el arrastre (pointermove con captura): la fila de origen se ve levantada (opacidad/sombra), la fila destino bajo el puntero muestra un indicador de inserción (línea o borde de acento) y el cursor es `grabbing`; al soltar se reordena; Escape o pointercancel cancela. El asidero debe verse claramente como agarre (texto/aria «Arrastrar para reordenar» como `title` y etiqueta visible en ≥ sm si cabe). Mantener Subir/Bajar 44 px. Respeta `prefers-reduced-motion`. Prueba unitaria del helper puro que calcule el índice destino si extraes uno.
1. **Tooltips en todas las etiquetas**: crea un componente compartido (p. ej. `apps/web/src/components/field-hint.tsx` o donde viva la UI compartida de la web; busca primero si ya existe algo equivalente) que muestre un icono «?»/«i» junto a la etiqueta con una explicación en español al pasar el mouse **y** al enfocar con teclado y al tocar en táctil (no sólo `title`), con `aria-describedby`. Aplícalo a los campos de: menú (categoría, producto, nombre, precio, estación, unidad, impuesto/IVA, clave interna/SKU, activo, tamaños, grupos de modificadores: mínimo, máximo, cantidad máxima por opción, opciones, foto), clientes, zonas de entrega, caja (apertura, movimientos, cierre/corte), mesas, captura, órdenes, reportes y administración. Textos cortos que expliquen qué es y para qué sirve. Ej. Estación: «Pantalla de cocina (KDS) donde aparece este producto al enviarlo a preparar; p. ej. cocina, barra, pizzas.» **Excepción**: no toques el componente `FractionEditor` de `menu-catalog-editor.tsx` (líneas ~340-400); lo reescribe otra tarea.
2. **Unidad como lista** (`menu-catalog-editor.tsx` línea ~272): reemplaza el texto libre por un `<select>` con: pieza (pz), porción, orden, rebanada, paquete, g, kg, ml, L. El valor guardado sigue siendo texto (`product.unit`, máx 32); el default actual es `"pieza"`. Si el catálogo trae un valor fuera de la lista, se muestra como opción adicional seleccionada (no se pierde).
   **Estación** (línea ~271): reemplaza el texto libre por un `<select>` con las estaciones ya usadas en el catálogo (valores distintos de `stationId`, más `general`) y una opción «Otra estación…» que abre un campo de texto para crear una nueva (mismo límite 64). Revisa cómo `apps/kds` obtiene sus estaciones para que los valores coincidan.
5. **Quitar tamaño no funciona**: tras «+ Añadir tamaño», pulsar ✕ (RemoveButton → `onRemove({ kind: "variant", ... })` → `confirmRemoval` en ~líneas 118-138) no lo elimina. Reproduce (prueba de componente o lógica), encuentra la causa (p. ej. diálogo de confirmación no visible/fuera de pantalla, `groupId` indefinido, estado obsoleto) y corrígela. Un tamaño recién añadido y aún sin nombre puede quitarse sin confirmación. Prueba que lo fije.
6. **Error al subir foto** (producto y opciones de modificadores): Emmanuel ve sólo «No se pudo subir la foto.» sin causa. El bucket `catalog-images` existe (público, 2 MB, jpeg/png/webp; verificado por L0). En `apps/web/src/app/app/menu/actions.ts` `uploadMenuImageAction`: nunca debe lanzar (envolver `getAuthorizedContext`, parse y fetch; respetar redirects de Next re-lanzándolos sólo si son `NEXT_REDIRECT`); cuando la respuesta no sea OK y no traiga `code`, incluir el estado HTTP en el mensaje («No se pudo subir la foto (HTTP 413).»); registrar en el servidor con `console.error` el estado y el código (sin token, sin base64). Mapear los códigos conocidos a español: `MENU_CATALOG_IMAGE_REQUEST_REJECTED` → «La imagen no es válida (formato o tamaño).», `ACTION_NOT_AUTHORIZED` → «No tienes permiso para cambiar fotos del menú.», `MENU_CATALOG_IMAGE_UNAVAILABLE` → «El almacenamiento de fotos no respondió; inténtalo de nuevo.». En el cliente (`menu-catalog-editor.tsx` ~470-480) el mensaje de catch debe distinguir errores de red/servidor. Además: si la imagen supera 2 MB, en lugar de rechazarla, redúcela en el navegador (canvas → JPEG/WebP calidad 0.85, lado mayor ≤ 1600 px) antes de subir; si aún excede, mensaje claro. Pruebas unitarias para el mapeo de errores y para la decisión de reducir.

## Archivos de entrada
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\menu\menu-catalog-editor.tsx (611 líneas; editar por rangos)
- ...\apps\web\src\app\app\menu\reorder-controls.tsx
- ...\apps\web\src\app\app\menu\actions.ts (líneas 25-70)
- ...\apps\web\src\lib\menu-images.ts, ...\apps\web\src\lib\menu-reorder.ts
- ...\apps\api\src\menu-catalog-images.controller.ts (sólo lectura: códigos de error)
- Formularios del resto de `apps/web/src/app/app/**` para los tooltips.

## Invariantes que NO deben cambiar
- ningún cálculo de dinero o permisos en el cliente; sin `alert/confirm/prompt`;
- targets táctiles ≥ 44 px, foco visible, etiquetas accesibles;
- no tocar `apps/api`, `packages/**`, `supabase/**`, ni `FractionEditor`.

## Fuera de alcance
- Configuración de mitades (otra tarea), contratos, backend.

## Verificación
- pnpm --filter @super-restaurant/web lint
- pnpm --filter @super-restaurant/web typecheck
- pnpm --filter @super-restaurant/web test
- pnpm --filter @super-restaurant/web build

## Formato de salida esperado
1. Resumen (3-6 líneas) por punto 0/1/2/5/6, incluyendo la causa raíz encontrada en 5 y 6.
2. Archivos tocados; commits conventional en la rama del worktree.
3. Salida literal de las verificaciones.
4. Riesgos o dudas.
