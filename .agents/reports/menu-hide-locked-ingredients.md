# SUB-001 — hecha
Cambios: quitado el bloque «Ingredientes que no se pueden quitar» del editor de mitades (checkboxes y leyenda); `lockedIngredientOptionIds` se conserva tal cual y sólo se poda al cambiar de grupo de ingredientes.
Archivos: apps/web/src/app/app/menu/menu-catalog-editor.tsx
Verificación: `corepack pnpm lint` / `typecheck` / `test` en apps/web → pasa (EXIT=0, 51 resúmenes `# fail 0`).
Riesgos/pendientes: con UI oculta ya no se puede configurar el bloqueo desde el editor; el servidor sigue rechazando `lockedIngredientOptionIds` hasta aplicar `20261102000100` (ver HANDOFF).
Notas: regla legada analizada en `product-sheet.tsx:110-116` y `line-halves.ts:233-244`: lista vacía/ausente ⇒ **todo removible** en captura (nunca menos), así que ocultar la UI no quita capacidad al operador; la regla «lista vacía ⇒ todo bloqueado» vive en la migración no aplicada, no en la web. No se tocó ninguna regla.

```
$ corepack pnpm test > log; echo EXIT=$?; grep -c "^# fail 0" log
EXIT=0
51
$ corepack pnpm lint
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
$ corepack pnpm typecheck
$ tsc --noEmit --project tsconfig.json
```
