# web-menu-customers-labels

## Tarea
web-menu-customers-labels · capa: L2 (Codex) · riesgo: bajo · nivel C (`apps/web` páginas de menú y clientes). Sin cambios en `apps/api`, `packages/*` ni SQL. Lote `lote-feedback-20261001` (c) y (d): hallazgos #2 #5 #6 #7 #12.

## Objetivo
Que el menú y el directorio hablen español operativo: nada de «SKU»; un campo opcional nunca bloquea; etiquetas de teléfono y dirección se eligen de una lista; al validar una dirección se ve contra qué se validó; las tarjetas de producto sin foto muestran iniciales y color de categoría en lugar de un icono genérico.

## Hechos verificados (main 7047fbe)
- `apps/web/src/app/app/menu/menu-catalog-editor.tsx:231`: campo «SKU (opcional)». En dominio `sku?: string` es opcional (`packages/domain/src/product-variants.ts:35,48-52`). Emmanuel no pudo guardar sin SKU: localizar en el formulario o en `menu/actions.ts` qué lo exige (probable `required`, `pattern` o validación que trata `""` como inválido en vez de omitirlo) y corregir sólo en web; si resultara que lo exige el API, no tocarlo: reportarlo como hallazgo.
- Directorio: `CustomerPhoneInputV1.label` y `CustomerAddressFieldsV1.label` son `string` libre de hasta 40 caracteres (`packages/shared-types/src/customers.ts:14-16,23-35`). No hay enum: la UI puede ofrecer opciones predefinidas sin cambiar contrato.
- Validación de dirección: la UI muestra «validado» sin contexto. Investigar en `apps/web/src/app/app/customers/*` qué llama «Validar para esta sucursal» y qué devuelve el API (buscar en `apps/web/src/lib` el cliente de zonas/quote: `delivery-zones`, `RequestDeliveryQuoteCommandV1` en `packages/shared-types/src/delivery-zones.ts:104-109`); mostrar lo que el API ya devuelve (zona, cargo con `formatMinorUnits`, promesa/ventana) y, si sólo devuelve un booleano, mostrar «Cubierta por la zona X» con los datos de la lista de zonas de la sucursal que la web ya puede leer con `POST /delivery-zones/list`.
- Fotos: no existe Storage ni campo de imagen en el catálogo (decisión pendiente de ADR). Las tarjetas del menú táctil en captura (`apps/web/src/app/app/capture/*` tarjetas de producto) muestran un icono genérico.

## Criterios de aceptación (verificables)
- [ ] Menú: la etiqueta pasa a «Clave interna (opcional)» con ayuda «Código que usas en inventario o en tu impresora; puedes dejarlo vacío». Guardar con el campo vacío funciona (se envía sin `sku`, no `""`). Pruebas del helper de normalización si se añade.
- [ ] Clientes: etiqueta de teléfono como `<select>` con «Principal», «Secundario», «Trabajo», «Otro» y, al elegir «Otro», un campo de texto corto; lo que se envía al API sigue siendo el `label` de texto («Principal», etc.). Lo mismo para dirección con «Casa», «Trabajo», «Otro». Los registros existentes con etiquetas libres se muestran tal cual y se editan cayendo en «Otro».
- [ ] Validación de dirección: tras validar, el resultado muestra sucursal, zona, cargo de envío («$35.00») y, si existe, tiempo prometido; si no está cubierta, el motivo. El estado «validado» sin datos no vuelve a aparecer.
- [ ] Tarjetas de producto sin foto en el menú táctil de captura (`apps/web/src/app/app/capture/*`): bloque con las iniciales del nombre (hasta 2 letras) sobre un color estable derivado de la categoría (hash determinista a una paleta de 8 tokens del `globals.css`), sin icono genérico. Sólo el componente de tarjeta; no tocar `product-sheet.tsx` (lo edita otra tarea en paralelo).
- [ ] Sin `alert/confirm/prompt`; targets ≥44 px; 390×844 sin scroll horizontal; consola limpia.

## Invariantes
Contratos intactos; el servidor sigue validando; sin dinero calculado en cliente (el cargo se muestra tal cual lo devuelve el API).

## Fuera de alcance
Enum de etiquetas en contrato (se decidirá aparte), Storage e imágenes reales, `product-sheet.tsx`, caja, API, SQL.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```

## Formato de salida esperado
1. Resumen. 2. Archivos tocados. 3. Salida literal de los comandos. 4. Hallazgos (p. ej. si el API exige SKU) y dudas. Sin diffs. No hagas commit: el orquestador commitea tu worktree.
