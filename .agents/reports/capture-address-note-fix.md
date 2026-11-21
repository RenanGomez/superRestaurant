# capture-address-note-fix — hecha
Cambios: la nota de cada fila se renderiza desde `rowNote` (la misma nota validada por firma version+contenido que decide el estado), no desde `noteFor`; se extrajo `noteBox`, reutilizado por `noteFor`. Una dirección editada ya no muestra el mensaje de la nota anterior.
Archivos: apps/web/src/app/app/capture/capture-customer.tsx
Verificación (desde apps/web):
```
$ corepack pnpm lint → $ eslint --max-warnings=0 --config ../../eslint.config.mjs src → LINT_EXIT=0
$ corepack pnpm typecheck → $ tsc --noEmit --project tsconfig.json → TC_EXIT=0
$ corepack pnpm test → # tests 11 # pass 11 # fail 0 … # tests 7 # pass 7 # fail 0 → TEST_EXIT=0
```
Riesgos: ninguno. No se tocó el enlace a Directorio ni `field-hint.tsx`.
