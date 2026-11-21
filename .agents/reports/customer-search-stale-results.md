# customer-search-stale-results — hecha
Cambio: `run("search")` guarda el resultado con su `{mode, query}` (`CustomerSearchSnapshot`), lo publica sólo si coincide con `searchMode`/`searchQuery` actuales y descarta respuestas con token de petición obsoleto; cambiar entrada, modo o aceptar sugerencia limpia el snapshot y sube `searchRequestSequence`. El JSX usa `visibleSearchResult`; debounce y `?customerId=` intactos.
Archivos: apps/web/src/app/app/customers/customer-editor.tsx, apps/web/src/lib/customer-directory.ts (+ test).
Verificación (desde apps/web):
```
$ corepack pnpm test → ok 8 - a submitted search only shows results for the query that produced them
                        ok 9 - a late response for an outdated submitted query is discarded
                        # fail 0 ... EXIT=0
$ corepack pnpm exec eslint --max-warnings=0 --config ../../eslint.config.mjs src/app/app/customers/customer-editor.tsx src/lib/customer-directory.ts src/lib/customer-directory.test.ts → LINT_EXIT=0
$ corepack pnpm lint → 2 errors en menu-catalog-editor.tsx (archivo ajeno, no tocado en esta tarea)
$ corepack pnpm typecheck → 2 errors TS2304 en menu-catalog-editor.tsx; ninguno en mis archivos
```
Riesgo/pendiente: NO VERIFICADO en navegador real. Puertas globales lint/typecheck no verdes por ediciones paralelas en `menu-catalog-editor.tsx`; alcance tocado limpio.
