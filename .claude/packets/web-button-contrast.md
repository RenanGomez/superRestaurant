# web-button-contrast · texto blanco sobre fondo blanco en botones seleccionados (toda la web)

## Tarea
web-button-contrast · capa L1 `implementer-claude` · **nivel C** (sólo `apps/web`) · riesgo bajo, transversal en estilos. Rama `claude/web-button-contrast` desde `main`.

## Hallazgo de Emmanuel (2026-10-10)
En Mesas, al tocar una mesa, el diálogo muestra los botones no seleccionados con letra negra y los **seleccionados con letra blanca sobre fondo blanco**. Pasa en muchas otras opciones, modales y botones de la web: el texto no contrasta con el fondo.

## Causa raíz confirmada por L0
Varios archivos componen variantes concatenando clases que se contradicen, p. ej. `apps/web/src/app/app/tables/tables-board.tsx:19-20`:
`const button = "... border-border bg-surface ..."; const primary = \`${button} border-accent bg-accent text-white\`;`
En Tailwind el orden de las clases en el atributo no decide: gana la regla que aparece después en la hoja generada. `bg-surface` le gana a `bg-accent`, así que el «primario» queda con fondo blanco y `text-white`. Mismo patrón (`\`${button} ...\``) en: `capture/capture-payment.tsx`, `capture/capture-ticket.tsx`, `capture/capture-workspace.tsx`, `capture/product-sheet.tsx`, `delivery-zones/delivery-zones-editor.tsx`, `orders/order-detail-panel.tsx`, `tables/tables-board.tsx`. Puede haber más formas del mismo error (ternarios que agregan `bg-*`/`text-*`/`border-*` encima de una base que ya los trae, `aria-pressed`, estados `selected`/`active`, chips, pestañas, tarjetas seleccionables).

## Cómo debe quedar
1. Un solo módulo de variantes, p. ej. `apps/web/src/lib/ui-classes.ts`: una base **sin** color de fondo, borde ni texto (tamaño, 44 px, foco, disabled) y variantes completas que no se pisan: `secondary` (fondo surface, texto `text`, borde `border`), `primary` (fondo accent, texto blanco, borde accent, hover accent-hover), `danger`, `ghost`, y `selected` para opciones elegidas (misma apariencia que primary o fondo accent con texto blanco). Sin dependencias nuevas (no agregar tailwind-merge/clsx).
2. Reemplazar todas las composiciones conflictivas de la web por esas variantes, incluidos botones seleccionados de mesero, cobro, tamaños, filtros, pestañas, etc. Respetar los estilos que ya funcionan; el cambio es de composición, no de rediseño.
3. Auditoría de contraste en todas las pantallas de `apps/web/src/app/**`: texto blanco sólo sobre `bg-accent`/`bg-accent-hover`/`bg-nav`/fondos oscuros; `text-accent` nunca sobre `bg-accent`; mensajes de éxito/error legibles; `disabled` sin bajar el texto por debajo de 3:1. Contraste mínimo 4.5:1 en texto normal (calcular con los valores OKLCH de `globals.css`; reportar los pares revisados).
4. Guarda de regresión: prueba (`node:test`, en la cadena `test` de web) que recorra `src/**/*.tsx|ts` y falle si una misma cadena de clases o plantilla contiene dos utilidades del mismo grupo en conflicto (`bg-surface` + `bg-accent`, dos `text-<color>`, dos `border-<color>`), o si se compone `\`${x} bg-...\`` sobre una base con fondo. Mantenerla simple y con lista explícita de colores del tema.

## Fuera de alcance / no tocar
- `apps/web/src/app/app/dining-zone.tsx` (otra tarea lo está reescribiendo; sus `button`/`primary` ya son cadenas separadas). En `tables/tables-board.tsx` no tocar el mapeo de forma de mesa (`rounded-full`/`rounded-lg`), sólo clases de botones y opciones.
- `app/app/menu/**` sólo si tiene el mismo bug; cambios mínimos.
- Sin API, SQL ni `packages/**`.

## Criterios de aceptación
- [ ] En el diálogo de mesa, «Yo», «Sin mesero» y el mesero elegido se leen (texto blanco sobre fondo accent cuando están elegidos; texto oscuro sobre fondo claro cuando no).
- [ ] Ninguna composición conflictiva en la web; la prueba de regresión pasa y falla si se reintroduce (demostrarlo con un caso negativo en la propia prueba).
- [ ] Tabla breve de pares texto/fondo revisados con su contraste.
- [ ] Puertas `pnpm --filter @super-restaurant/web lint`, `typecheck`, `test`, `build` con Node 24.19.0 (`C:\Users\Emmanuel G\AppData\Local\Programs\node24`; `node "<node24>\node_modules\corepack\dist\pnpm.js"` con la ruta entre comillas). Si el worktree no tiene node_modules: `pnpm install --frozen-lockfile --offline`; nunca borrar node_modules con Remove-Item -Recurse.

## Formato de salida
Resumen, lista de archivos y casos corregidos, tabla de contraste, salida literal de las puertas, riesgos. Commits convencionales; sin push.
