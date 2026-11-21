# menu-product-actions — hecha
Cambios: menú ⋯ por producto (Duplicar/Archivar/Quitar; Desarchivar) accesible; «Archivados» colapsada al final; Quitar reutiliza `RemovalDialog`; tarjeta sin «Duplicar» ni «Activo».
Archivos: menu-catalog-editor.tsx; product-actions-menu.tsx (nuevo); lib/menu-archived.ts + .test.ts (nuevos); tsconfig.test.build.json; package.json.
Verificación:
```
$ corepack pnpm lint; echo EXIT=$?
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
EXIT=0
$ corepack pnpm typecheck; echo EXIT=$?
$ tsc --noEmit --project tsconfig.json
EXIT=0
$ corepack pnpm test > /tmp/sr-test.log 2>&1; echo EXIT=$?; grep -c "^not ok" /tmp/sr-test.log
EXIT=0
0
$ corepack pnpm build > /tmp/sr-build.log 2>&1; echo EXIT=$?
EXIT=0
```
Riesgos/pendientes: NO VERIFICADO: verificación visual en navegador real (sin navegador en este entorno).
Notas: Archivar fija `active=false` sin migración; Desarchivar reubica con `displayOrder` siguiente; targets 44 px; sin alert/confirm/prompt.
