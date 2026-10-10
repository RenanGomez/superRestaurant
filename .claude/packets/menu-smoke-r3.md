## Tarea
menu-smoke-r3 (lote-smoke-20261007, Menú tercera ronda) · capa: L1 implementer-claude · riesgo: bajo-moderado · nivel C (web) + B (arranque del API, sin auth ni dinero)

## Objetivo
Cerrar los 4 hallazgos del smoke de Emmanuel del 2026-10-10 en el editor de menú.

## Criterios de aceptación (verificables)
1. **Asidero de arrastre** (`apps/web/src/app/app/menu/reorder-controls.tsx` y sus usos en `menu-catalog-editor.tsx`: categorías, productos, tamaños, grupos): el asidero va **a la izquierda**, como primer elemento de la fila/tarjeta que arrastra (no junto a los demás controles a la derecha). Sólo muestra el icono de 6 puntos (⋮⋮ o un SVG de 2×3 puntos), **sin texto visible «Arrastrar»**; conserva `aria-label`/`title` «Arrastrar para reordenar» y el área de 44 px. Subir/Bajar siguen disponibles como alternativa accesible (pueden quedar donde estén o junto al asidero, compactos). El indicador de destino y la cancelación siguen funcionando.
2. **Categorías como lista** (`menu-catalog-editor.tsx` ~170-190, la sección de categorías): una categoría por fila a todo el ancho (lista vertical), no grid de 2 columnas, en escritorio y móvil.
3. **Tooltips que no hacen wrap** (`apps/web/src/components/field-hint.tsx`, span `role="tooltip"`): en algunos contextos (p. ej. el «?» junto a «Activo») el cuadro sale angosto y el texto se desborda en una sola línea larga; probable herencia de `whitespace-nowrap`/flex del contenedor. El tooltip debe tener siempre ancho fijo legible (≈ 15-16 rem, máx. `calc(100vw - 16px)`), `whitespace-normal`, `break-words`/`overflow-wrap:anywhere`, y no encogerse por el contenedor. Revisa los usos de `Field`/`CheckField` dentro de contenedores `inline-flex`/`whitespace-nowrap` en todas las secciones.
4. **Fotos no suben (causa confirmada por L0)**: el log del API local muestra `PayloadTooLargeError: request entity too large` y la web registró `menu image upload rejected status=413`. `apps/api/src/main.ts` fija `app.useBodyParser("json", { limit: "3mb" })`, pero el arranque local (`tmp/start-local-api.mjs`, no versionado) crea la app por su cuenta sin ese límite (100 kb por defecto). Corrección durable: extrae la configuración común del app (body parser 3mb, prefijo `api/v1`, shutdown hooks) a una función exportada en `apps/api/src` (p. ej. `configureApiApp(app)` en `app-setup.ts`), úsala en `main.ts` y haz que `tmp/start-local-api.mjs` la importe desde `../apps/api/dist/...` (conservando que escuche en 127.0.0.1). Prueba unitaria que fije el límite (p. ej. que una petición JSON de ~2.5 MB a una ruta de prueba no da 413 y una de 4 MB sí, o al menos que `configureApiApp` registra el parser con 3mb). Revisa si otros arranques (smoke coordinators, `http-test-app.ts`) también necesitan la misma configuración.

## Archivos de entrada
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\menu\reorder-controls.tsx
- ...\apps\web\src\app\app\menu\menu-catalog-editor.tsx (por rangos)
- ...\apps\web\src\components\field-hint.tsx
- ...\apps\api\src\main.ts, ...\apps\api\src\http-test-app.ts (lectura)
- ...\tmp\start-local-api.mjs (no versionado; edítalo en el repo principal C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\tmp, no en el worktree)

## Invariantes
- no cambiar contratos ni validaciones de payload por ruta; el límite de transporte sigue acotado (3mb);
- sin alert/confirm/prompt; targets ≥ 44 px; foco visible.

## Verificación
- pnpm --filter @super-restaurant/web lint / typecheck / test / build
- pnpm --filter @super-restaurant/api lint / typecheck / test

## Formato de salida esperado
1. Resumen (3-6 líneas). 2. Archivos y commits (rama `claude/menu-smoke-r3`, commits pequeños). 3. Salida literal de verificaciones. 4. Riesgos.
