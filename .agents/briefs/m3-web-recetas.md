# Brief m3-web-recetas (nivel C · pestaña Recetas en /app/inventario)

## Objetivo
Añadir la pestaña «Recetas» a `/app/inventario`: elegir un producto del menú, editar sus líneas de insumo y publicar una versión, además de listar versiones activas e históricas.

Tiempo estimado: 40 min. Escritor único de `apps/web/src/app/app/inventario/**` y `apps/web/src/lib/inventory-ui.*`.

## API disponible
- `GET /api/v1/inventory/recipes?restaurantId&productId&includeInactive?` → versiones `{recipeId, productId, modifierId, version, active, notes, createdAt}`.
- `GET /api/v1/inventory/recipes/:id?restaurantId` → versión con `lines[{itemId, quantity, unitCode}]`.
- `POST /api/v1/inventory/recipes` con `{restaurantId, productId, modifierId:null, notes:null, lines:[{itemId, quantity, unitCode}]}` (≈ `catalog.manage`).
- Catálogo del menú: usa el endpoint de productos ya usado por el editor de menú (`apps/web/src/app/app/menu/`), para el selector de producto.
- Insumos y almacenes: los ya cargados en la pantalla de inventario.

## Requisitos
- Pestaña «Recetas» con `?tab=recetas`: selector de producto (buscable), lista de sus versiones (activa resaltada, históricas colapsadas) y editor de líneas (insumo, cantidad entera positiva, unidad del insumo).
- «Publicar versión» abre un diálogo in-app (`role="dialog"`, Escape, foco contenido/devuelto): exige al menos una línea, sin insumos repetidos y con cantidades > 0; muestra un resumen de lo que se publica; el botón se deshabilita al guardar y el error se pinta dentro.
- Tras publicar, la nueva versión aparece activa y la anterior como histórica (recarga desde el servidor; no inventes la respuesta).
- Estados: carga, producto sin recetas («Este producto aún no tiene receta»), error con «Reintentar», éxito breve; sin `alert/confirm/prompt`; sin UUIDs visibles; targets ≥ 44 px; timeout de 10 s en el fetch.
- Sin cálculo de costos en cliente (el costeo vive en `/inventory/product-costs`; no lo añadas aquí).
- Pruebas puras en `apps/web/src/lib/inventory-ui.test.ts` (validación de líneas, duplicados, etiqueta de versión activa).

## Puertas (Node 24.19.0)
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
Pestaña funcional, diálogo accesible, pruebas y puertas web verdes con salida real; informe con archivos, decisiones y `git status --short`. La verificación visual la hace el orquestador. Aplica Ponytail y AGENTS §14.
