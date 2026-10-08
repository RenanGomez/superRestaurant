## Tarea
web-field-hints-complete (lote-smoke-20261007, Menú punto 1, cierre) · capa: L2 Codex · riesgo: bajo · nivel C (sólo `apps/web`)

## Objetivo
Terminar el punto 1 de Emmanuel («tooltips en todas las secciones»): poner ayudas en el editor de mesas y dejar todas las ayudas con el patrón accesible `Field`/`CheckField`.

## Criterios de aceptación (verificables)
1. **Editor de mesas** (`apps/web/src/app/app/dining-zone.tsx` y los diálogos/paneles de mesa que use, p. ej. «Nueva mesa», panel de datos de la mesa, «Más ancha / Más alta…»): cada campo (nombre, capacidad, forma, ancho, alto, zona, mesero si aplica) tiene ayuda con `Field`/`CheckField` de `apps/web/src/components/field-hint.tsx`. Textos en español, cortos: qué es y para qué sirve (ej. Capacidad: «Cuántas personas caben; se usa para sugerir mesa, no limita la cuenta.»). No cambies la lógica de autoguardado, arrastre ni redimensión.
2. **Migrar `LabelText` a `Field`/`CheckField`** en: caja/page.tsx, caja/payment-panel.tsx, capture/capture-payment.tsx, capture/capture-workspace.tsx, customers/customer-editor.tsx, deliveries/page.tsx, delivery-zones/delivery-zones-editor.tsx, orders/order-detail-panel.tsx, reports/day/page.tsx, system-admin/restaurants/page.tsx (y cualquier uso que quede en menu-catalog-editor.tsx). Resultado: el botón de ayuda queda fuera del `<label>`, el nombre accesible del input es sólo su etiqueta y la ayuda llega por `aria-describedby`. Si tras migrar `LabelText` no tiene usos, elimínalo.
3. Revisa que ninguna sección con formulario quede sin ayudas (barre `apps/web/src/app/app/**` buscando `<label`/`<input`/`<select`/`<textarea` sin ayuda) y añade las que falten.
4. Prueba unitaria o de render mínima si existe infraestructura; si no, no inventes una nueva.

## Archivos de entrada
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\components\field-hint.tsx (patrón: `Field`, `CheckField`, `FieldHint`)
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\menu\menu-catalog-editor.tsx (ejemplo de uso de `Field`)
- los archivos listados arriba

## Invariantes
- sin cambios de lógica ni de datos; targets ≥ 44 px; sin alert/confirm/prompt; no tocar `apps/api`, `packages/**`, SQL.

## Verificación
- pnpm --filter @super-restaurant/web lint
- pnpm --filter @super-restaurant/web typecheck
- pnpm --filter @super-restaurant/web test
- pnpm --filter @super-restaurant/web build

## Formato de salida esperado
1. Resumen (3-6 líneas). 2. Archivos tocados; commits conventional. 3. Salida literal de las verificaciones. 4. Riesgos.
