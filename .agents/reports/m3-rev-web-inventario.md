I'll review the inventory module against the checklist.
VEREDICTO: APROBAR

Alcance revisado: los 7 archivos del commit `3f200338`; `git diff -- apps/web/src/app/app/app-nav.tsx apps/web/package.json` sale vacío porque ese cambio ya está commiteado (no hay diff pendiente que revisar).

- **P1:** ninguno.
- **P2:** el `fetch` del server action no lleva `AbortSignal`/timeout (actions.ts:279-288); si el API se cuelga, `saving` queda `true` y el diálogo no se puede cerrar porque `close` lo bloquea (inventory-workspace.tsx:464 y 568, Escape 415-420). El resto de módulos usan `AbortSignal.timeout(10_000)`.
- **P3:** unidades `g|ml|piece` duplicadas en cliente en vez de `INVENTORY_UNITS` (inventory-workspace.tsx:481 y 523-525); el fondo del diálogo no se bloquea ni se marca `inert` (441-451); `aria-controls` apunta al panel desmontado del tab inactivo (199, 270); el 401 se muestra como falta de rol en vez de re-login (actions.ts:293).

Cumple lo demás: sin `alert/confirm/prompt` ni UUID visibles (ids solo como `key`, líneas 260 y 293); sin aritmética de dinero/cantidades (solo formato/parseo de formulario, el servidor revalida); carga/vacío/error+«Reintentar»/éxito, foco atrapado y devuelto, Escape y targets ≥44 px (`min-h-11`); rutas GET/POST/PATCH y cuerpos coinciden con `items.controller.ts`/`items.service.ts` (`ITEM_*_KEYS`, `WAREHOUSE_*_KEYS`) y `restaurantId`/`branchId` salen del scope de cookie, no del cliente; `?tab=` estable y parseo no confiable cubierto (inventory-ui.test.ts:17-25).

```powershell
npx tsc --noEmit --project apps/web/tsconfig.json   # EXIT=0
npx eslint --max-warnings=0 --config eslint.config.mjs apps/web/src/app/app/inventario apps/web/src/lib/inventory-ui.ts apps/web/src/lib/inventory-ui.test.ts   # EXIT=0
node --experimental-strip-types --input-type=module -e "...import('./apps/web/src/lib/inventory-ui.ts')..."
{"tabs":["insumos","almacenes"],"dflt":"insumos","upper":false,"spaced":"almacenes","href":"/app/inventario?foo=bar&tab=almacenes","num0":"0","num12":"12"}
```

NO VERIFICADO: ejecución real de `inventory-ui.test.js` (exige compilar a `.test-dist`) y verificación visual en navegador.