# field-hint-tab — hecha
Cambios: `FieldHint` ya no entra en el orden de tabulación. Ayuda intacta con ratón, tap y `aria-describedby`; el tooltip por foco de teclado deja de abrirse, que es el efecto pedido.
Archivos: apps/web/src/components/field-hint.tsx (+1)
Verificación (desde `apps/web`):
```
$ corepack pnpm lint 2>&1 | tail -40
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
$ corepack pnpm typecheck 2>&1 | tail -40
$ tsc --noEmit --project tsconfig.json
```
Riesgos/pendientes: NO VERIFICADO en navegador real (el brief no lo exige para nivel C de 1 línea); sin commit/push.
Notas: `tabIndex={-1}` mantiene el botón enfocable por clic/programático, así que `onFocus`/`onBlur`/Escape siguen funcionando.
