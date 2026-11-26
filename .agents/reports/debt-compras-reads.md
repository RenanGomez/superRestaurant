Now I understand the structure. Let me make the minimal service change.
All checks pass. Now cleaning up the verification scaffolding and generated artifacts.
Estado: DONE a nivel servicio/unitario; REVIEW para orquestador (brecha SQL de lectura).
Archivos: `apps/api/src/inventory/purchasing.service.ts`, `apps/api/src/inventory/purchasing.test.ts`. Reporte: `.agents/reports/debt-compras-reads.md`.
Cambio: `authorizeRestaurant`/`authorizeBranch` aceptan permiso (default `catalog.manage`); `listSuppliers`, `listPurchaseOrders` y `readPurchaseOrder` usan `catalog.read`; las 4 escrituras siguen `manage`.
`readPurchaseOrder`: autoriza el alcance de la orden devuelta (403 si llega la fila); el SQL ya filtra por membresía, así que el ajeno real da 404 sin filtrar existencia. SQL no tocado.
Pruebas: 26/26 — viewer/auditor leen; viewer no crea/edita ni crea/recibe orden (403); principal ajeno 403 y no obtiene orden ajena.
Verificación (binarios directos; `pnpm run` auto-dispara `pnpm install`, prohibido y en colisión `ERR_PNPM_EEXIST`/`EBUSY`):
```
> node node_modules/typescript/bin/tsc --noEmit --project apps/api/tsconfig.json
EXIT=0
> node ../../node_modules/eslint/bin/eslint.js --max-warnings=0 --config ../../eslint.config.mjs src
EXIT=0
> node ../../node_modules/typescript/bin/tsc --project tsconfig.test.build.json
TSC_EXIT=0
> node .test-dist/inventory/purchasing.test.js
# tests 26  # pass 26  # fail 0
```
Pendiente orquestador: migración nueva que relaje las 3 funciones de lectura SQL a `viewer`/`auditor` (hoy exigen `owner/admin/manager` y lanzan `42501`); `pg-verify`/E2E y Playwright; commit/merge.
NO VERIFICADO: PostgreSQL/E2E real (prohibido por el brief).