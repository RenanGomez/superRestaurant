## Estado
done — `/app/inventario` con pestañas Insumos/Almacenes, alta y edición contra el API, nav actualizado y puertas web verdes.
## Qué hice
- Pestañas con `?tab=`, búsqueda por nombre/clave, diálogos `role="dialog"` con Escape/foco atrapado y devuelto, estados carga/vacío/error+Reintentar/éxito; sin costo/saldo y sin «Predeterminado» (no viene en el contrato).
## Archivos tocados
- `apps/web/src/app/app/inventario/{page.tsx,actions.ts,inventory-workspace.tsx}`, `apps/web/src/lib/inventory-ui.ts(+test)`, `app-nav.tsx`, `package.json`; `git status --short`: ` M apps/web/package.json`, ` M apps/web/src/app/app/app-nav.tsx`, `?? apps/web/src/app/app/inventario/`, `?? apps/web/src/lib/inventory-ui.test.ts`, `?? apps/web/src/lib/inventory-ui.ts`.
## Verificación
```
$ pnpm --filter @super-restaurant/web lint → $ eslint --max-warnings=0 --config ../../eslint.config.mjs src; $ pnpm --filter @super-restaurant/web typecheck → $ tsc --noEmit --project tsconfig.json
$ pnpm --filter @super-restaurant/web test → ✔ inventory tabs are stable and parse untrusted values (2.0019ms) … ℹ tests 7 ℹ pass 7 ℹ fail 0; $ pnpm --filter @super-restaurant/web build → ✓ Compiled successfully in 17.6s ƒ /app/inventario
```
## Riesgos / dudas
- `typecheck` requirió `pnpm --filter @super-restaurant/sync-engine build` (su `dist` estaba desactualizado, ignorado por git); falta verificación visual en navegador real (orquestador).
## Notas propuestas
- En el contrato actual los insumos son de restaurante y los almacenes de sucursal; la pantalla no muestra «Predeterminado» porque `isDefault` no existe aún.