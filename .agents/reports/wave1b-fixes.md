# wave1b-fixes — hecha
Cambios: alta rápida reutiliza el comando completo (mismo contactId e idempotency key) entre reintentos vía `buildCustomerQuickCreateCommand` con test; búsqueda invalida el resultado al cambiar la consulta y muestra error; recorte de foto invalida con flag al cancelar/desmontar y lo comprueba antes de `onConfirm`; retirada la línea en blanco final.
Archivos: apps/web/src/app/app/capture/capture-customer-search.tsx, apps/web/src/app/app/menu/photo-crop-dialog.tsx, apps/web/src/lib/customer-quick-create.ts, apps/web/src/lib/customer-quick-create.test.ts, apps/web/src/lib/menu-draft-storage.ts
Verificación:
```
$ corepack pnpm lint        # $ eslint --max-warnings=0 --config ../../eslint.config.mjs src (exit 0)
$ corepack pnpm typecheck   # $ tsc --noEmit --project tsconfig.json (exit 0)
$ corepack pnpm test        # test_exit=0; 54 bloques "# fail 0"; "ok 3 - a quick-create retry keeps the full command and edits start a fresh attempt"
$ git diff --check -- apps/web; echo $?   # check_exit=0 (sin salida)
```
Riesgos/pendientes: NO VERIFICADO: navegador/visual, fuera de las puertas de este brief.
