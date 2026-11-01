# capture-ux-r1 · ticket recortado, efectivo preestablecido, instrucciones con autoguardado, atajos seguros

## Tarea
capture-ux-r1 · capa L1 `implementer-claude` · nivel C (`apps/web/src/app/app/capture/capture-ticket.tsx`, `capture-payment.tsx`, `capture-workspace.tsx`, `apps/web/src/lib/shortcut-dispatch.ts` y su test) · riesgo bajo. Rama `claude/capture-ux-r1` desde `main`. No tocar `apps/api`, `packages/*` ni SQL. Ningún cálculo nuevo en cliente: el servidor sigue calculando cambio y totales.

## Hallazgos de Emmanuel (2026-11-01, escritorio, /app/capture)
1. **Ticket recortado.** En el panel derecho «Pizza Original · Mitad A / Mitad B / Nota», la fila de controles (Editar · − 1 + · Editar nota · Quitar) desborda horizontalmente: se ve una barra de scroll y el precio y «Quitar» quedan cortados. Archivo: `capture-ticket.tsx` líneas 34–70.
2. **Efectivo: monto escrito vs. botón preestablecido.** Con un monto en «Otro monto», pulsar un botón de «¿Paga con?» (por ejemplo «Exacto» o $200) no borra el texto ni marca el botón; hay que pulsar dos veces. Archivo: `capture-payment.tsx` líneas 166–200 (`chooseTender`, `customTender`, `applyCustomTender`).
3. **Instrucciones de entrega se pierden.** Si se escriben indicaciones y no se pulsa «Guardar instrucciones» antes de tocar un botón de efectivo, se pierden. Archivo: `capture-workspace.tsx` líneas 1247–1253 y el handler alrededor de la línea 702.
4. **Atajos de una sola letra.** `N` crea captura, `R` reinicia, `/` enfoca búsqueda. Una letra sola es peligrosa mientras se escribe y además Emmanuel reporta que no funcionan. Archivo: `apps/web/src/lib/shortcut-dispatch.ts` y `capture-workspace.tsx` líneas 963–985.

## Cambios
1. Ticket: la fila de controles de cada línea pasa a `flex-wrap` con `gap-2`; el precio de la línea nunca se corta (`shrink-0`). «Quitar» puede bajar a una segunda fila a la derecha. Sin scroll horizontal en 390 px ni en el panel de escritorio (ancho actual ~360 px). No cambiar la jerarquía visual ni los `aria-label`.
2. Efectivo: `chooseTender(amount)` limpia `customTender` (cadena vacía) y `customTenderInvalid` antes de enviar; el botón queda `aria-pressed` con el monto elegido. Escribir en «Otro monto» quita la selección visual de los botones preestablecidos mientras el texto no coincida con uno de ellos (comparar en unidades menores con el parser que ya existe). Al aplicar el monto personalizado, si coincide con un preestablecido, ese botón queda marcado.
3. Instrucciones: autoguardado con debounce de 700 ms al escribir y guardado inmediato en `blur`; quitar el botón «Guardar instrucciones» y el `<form>` si sólo servía para eso. Conservar el feedback «Guardando… / Guardado» con `role="status"`. Si el guardado falla, mostrar el error y no perder el texto. Las sugerencias «Usadas antes por este cliente» siguen copiando al textarea y disparan el mismo autoguardado.
4. Atajos: en `shortcut-dispatch.ts` los atajos pasan a `Alt+N` (crear), `Alt+R` (reiniciar) y `Alt+/` ó `Ctrl+K` (búsqueda; elegir uno y documentarlo en el `aria-keyshortcuts`). `dispatchShortcut` exige `altKey` (o `ctrlKey` para búsqueda) y sigue ignorando cualquier evento dentro de campos editables salvo `Escape`. Actualizar `ariaKeyShortcut` para devolver la cadena ARIA correcta (`Alt+N`). Añadir casos al test existente: letra sola no dispara; `Alt+N` dispara; `Alt+N` dentro de un input no dispara. Verificar en el navegador que `Alt+N` crea una captura desde la bandeja (en Windows Alt solo abre el menú del navegador únicamente si no se hace `preventDefault`; ya se hace).

## Invariantes
Sin `any`, LF, sin `alert/confirm/prompt`, targets de 44 px, sin textos nuevos en inglés. No cambiar contratos ni server actions. No tocar `capture-menu.tsx`, `product-sheet.tsx` ni la sección de cliente/dirección (vendrá en `capture-customer-address-r1`).

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`)
- `pnpm --filter @super-restaurant/web lint`, `typecheck`, `test`, `build`.
- Navegador: si `http://localhost:8082` responde y existe `apps/web/playwright/.auth/user.json` en el checkout principal, cópialo al worktree y verifica con Playwright (`channel: "chrome"`) en 1366×800 y 390×844: ticket sin scroll horizontal, botón de efectivo marcado tras escribir otro monto, instrucciones persistentes tras recargar, `Alt+N` crea captura. Si no hay sesión o servidores, documéntalo como brecha y no la inventes.

## Formato de salida
Resumen, archivos, salida literal de las puertas, brecha de verificación, riesgos. Commit local `fix(web-capture): ...`. Sin merge ni push.
