# capture-customer-search — hecha
Cambios: nuevo combobox accesible (`role=combobox`, listbox, flechas/Enter/Escape, cierre al elegir, debounce 500 ms) en Captura que reutiliza `getCustomerAutocompleteRequest`/`getCustomerDirectorySuggestions` y la acción `customerDirectoryAction`; sin coincidencias ofrece «Crear cliente rápido con <teléfono/nombre>» con la misma operación `profile` y, al guardar, selecciona el cliente en la captura. «Directorio» añade `?customerId=<id>`; Clientes valida el UUID y abre esa ficha.
Archivos: apps/web/src/app/app/capture/capture-customer-search.tsx (nuevo), apps/web/src/lib/customer-quick-create.ts (+test), capture-workspace.tsx (bloque de búsqueda y enlace), customers/page.tsx, customer-editor.tsx, package.json y tsconfig.test.build.json (registro del test).
Helper puro: `normalizeCustomerSearchQuery` (teléfono solo dígitos; nombre/dirección con espacios colapsados) y `shouldOfferCustomerQuickCreate` (teléfono ≥4 dígitos, nombre ≥2 caracteres, dirección no).
Verificación (desde apps/web):
```
$ corepack pnpm lint        → $ eslint --max-warnings=0 --config ../../eslint.config.mjs src   (sin salida)
$ corepack pnpm typecheck   → $ tsc --noEmit --project tsconfig.json                          (sin salida)
$ corepack pnpm test        → ok 2 - shouldOfferCustomerQuickCreate only offers a seedable phone or name
                              # fail 0 ; EXIT:0
```
Riesgo/pendiente: NO VERIFICADO en navegador real (no se levantó servidor). Otro agente editaba capture-workspace.tsx y otros archivos en paralelo; las puertas corrieron sobre el árbol combinado y quedaron verdes.
