# Brief m3-web-inventario (nivel C · primera pantalla de inventario: insumos y almacenes)

## Objetivo
Añadir `/app/inventario` con dos pestañas (Insumos y Almacenes) que listan, crean y editan contra el API ya expuesto.

Tiempo estimado: 40 min. Único escritor de `apps/web/**` en esta tarea.

## Alcance
- Crea: `apps/web/src/app/app/inventario/page.tsx`, `apps/web/src/app/app/inventario/inventory-workspace.tsx` y, si hace falta lógica pura, `apps/web/src/lib/inventory-ui.ts` + `inventory-ui.test.ts`.
- Edita: `apps/web/src/app/app/app-nav.tsx` (entrada «Inventario» con icono coherente), `apps/web/package.json` (solo si añades la prueba a `scripts.test`).
- Prohibido: tocar `apps/api`, SQL, otras pantallas, dependencias; `alert/confirm/prompt`; calcular dinero o cantidades en el cliente. Sin commit/push.

## API disponible (no inventes rutas)
- `GET /api/v1/inventory/items?restaurantId=<uuid>` → `{ schemaVersion:1, restaurantId, items:[{id,restaurantId,sku,name,unitCode,purchaseUnitFactor,minQuantity,active}] }`
- `POST /api/v1/inventory/items` con `{restaurantId, sku?, name, unitCode:"g"|"ml"|"piece", purchaseUnitFactor, minQuantity, active}`
- `PATCH /api/v1/inventory/items/:id` con subconjunto `{name?, sku?, minQuantity?, active?, purchaseUnitFactor?}`
- `GET /api/v1/inventory/warehouses?restaurantId=<uuid>&branchId=<uuid>` → `{schemaVersion:1, restaurantId, branchId, warehouses:[...]}`
- `POST /api/v1/inventory/warehouses` con `{restaurantId, branchId, name, active}`
- `PATCH /api/v1/inventory/warehouses/:id` con `{name?, active?}`
- Auth: cookie/sesión del shell; usa el mismo patrón de Server Actions o fetch de servidor que `apps/web/src/app/app/delivery-zones/` y `menu/` (mira cómo obtienen `API_BASE_URL`, sucursal activa y token). Errores del API: 400 `INVENTORY_REQUEST_INVALID`, 403 `ACTION_NOT_AUTHORIZED`, 409 `INVENTORY_CONFLICT`, 503.

## Requisitos de pantalla
- Un solo `/app/inventario` con pestañas «Insumos» y «Almacenes» (URL `?tab=` para conservar la pestaña).
- Insumos: tabla/tarjetas con nombre, clave interna (opcional), unidad legible («gramos», «mililitros», «pieza»), factor de compra, mínimo y estado; buscador por nombre/clave; botón «Nuevo insumo»; edición en diálogo in-app (`role="dialog"`, Escape, foco contenido y devuelto al disparador).
- Almacenes: nombre, estado, «Predeterminado» si `isDefault` llegara en el contrato (hoy no viene: no lo inventes) y botón «Nuevo almacén».
- Estados explícitos: carga, vacío («Aún no hay insumos…»), error con «Reintentar», éxito breve tras guardar; mensajes en español de operador, sin UUIDs ni códigos internos.
- Sucursal/restaurante siempre del contexto del shell; nada de `<select>` de restaurante libre.
- Targets ≥ 44 px, foco visible, contraste, `prefers-reduced-motion`; sin overlays que tapen la operación.
- No calcules costo ni saldo: esta pantalla no los muestra todavía.

## Puertas (Node 24.19.0, dentro de `apps/web`)
```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
& $PNPM --filter @super-restaurant/web test
& $PNPM --filter @super-restaurant/web build
```

## Hecho cuando
Pantalla y pestañas funcionando contra los endpoints reales, nav actualizado, puertas web verdes con salida real, informe con archivos, decisiones de UX y `git status --short`. La verificación en navegador real la hace el orquestador. Aplica Ponytail y AGENTS §14.
