# menu-size-presets-ui-fix2 · cierre de hallazgos (Nivel C)

Archivo: `apps/web/src/app/app/menu/menu-catalog-editor.tsx` (y `apps/web/src/lib/menu-fields.ts` sólo si hace falta). Nada más.

1. **Acentos rotos**: la constante `presetError` tiene `?` en lugar de letras acentuadas («tama?os», «?nicos», «vac?os», «est?», «act?valo»). Escribe: «Revisa los nombres de tamaños: deben ser únicos y no estar vacíos.» y «Un tamaño inactivo está en uso; actívalo o cambia las variantes antes de publicar.» Tu shell corrompe no-ASCII al escribir: usa escapes `\u00f1`, `\u00fa`, `\u00ed`, `\u00e1` dentro de los strings TS. Revisa con `git diff HEAD~2 | grep "^+"` que no quede ningún `?` entre letras.
2. Diálogo de quitar preset (`role="alertdialog"`): `aria-describedby` apuntando al `<p>` (usa `useId`), Escape cierra con `cancelPresetRemoval`, y el botón «Cancelar» usa `cancelPresetRemoval`; al confirmar, el foco vuelve a un lugar existente (el botón «Agregar tamaño» o la lista).
3. Plural del texto del diálogo: 0 → «Ningún producto usa este tamaño.»; 1 → «1 producto afectado conservará su nombre como tamaño personalizado.»; N → «N productos afectados conservarán su nombre como tamaño personalizado.»

## Hecho cuando
Commit local `fix(web-menu): …` si el sandbox lo permite; si no, dilo.
