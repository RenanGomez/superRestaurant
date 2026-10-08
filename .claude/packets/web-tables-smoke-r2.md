# web-tables-smoke-r2 · segunda ronda del smoke de Mesas (2026-10-07)

## Tarea
web-tables-smoke-r2 · capa L1 `implementer-claude` (Codex falla por entorno: `helper_unknown_error: setup refresh had errors`) · **nivel C** para `apps/web` (sin API ni SQL) · riesgo moderado (rendimiento del shell). Rama `claude/web-tables-smoke-r2` desde `main`.

## Objetivo
Que Mesas sea rápida, que el plano operativo ocupe el ancho y que el editor de plano se use arrastrando (mover y redimensionar) con guardado automático, sin campos numéricos ni modales que no se cierran. Reglas de producto: PROJECT_NOTES «Veredicto de la prueba visual 2026-10-01» (claro, al alcance, dos o tres toques, nada sin etiqueta) y AGENTS §14.

## Hallazgos de Emmanuel → cómo deben quedar
1. **Página muy lenta.** Causas confirmadas por L0:
   - `apps/web/src/app/app/app-nav.tsx` usa `<a href>` → cada clic recarga el documento completo y vuelve a correr layout + página. Cambiar a `next/link` (`<Link prefetch>`), igual en los enlaces internos de `tables-board.tsx` y `page.tsx` (Ver cuenta, Editar plano, Volver a mesas).
   - Cada render del shell hace llamadas remotas en serie: `layout.tsx` (`getUser`, `getSession`, `canAccessSystemAdministration`, `listMemberships`) y luego `tables/page.tsx` repite `getSession` + `listMemberships` + `authorizeBranch`; además `src/proxy.ts` ya hace `getUser` + `verifyRemoteSession`. Deduplicar dentro del mismo request con `cache()` de React (helpers server-only, p. ej. `src/lib/request-context.ts`: `getRequestSession`, `getRequestMemberships`, `getRequestAuthorizedBranch`) y paralelizar con `Promise.all` lo independiente. No quitar ninguna verificación de autorización: el servidor sigue decidiendo; sólo se evita repetir la misma llamada en un request.
   - Medir antes/después (tiempo de `GET /app/tables` con `curl -w %{time_total}` o logs de `next dev`) y reportar números.
2. **Plano operativo con espacio gigante a la derecha** (`tables-board.tsx` + `src/lib/floor-plan.ts` `planCanvasStyle`): hoy `width: min(100%, 70vh*ratio)` deja el lienzo angosto. Debe llenar el ancho del contenedor (altura derivada por proporción, con tope razonable y scroll interno sólo si el salón es muy alto). Actualizar prueba de `floor-plan`.
3. **«Rendering» al volver a la pestaña** (es el indicador de `next dev` mientras corre `router.refresh()`): `focus-revalidate.tsx` refresca en cada `focus` y `visibilitychange` (dos veces por cambio de pestaña) y `TablesBoard` además relee tablero y meseros en ambos eventos. Debe quedar: un solo disparo por regreso (sólo `visibilitychange` a visible), con enfriamiento (no más de una vez cada 30 s y sólo si la pestaña estuvo oculta ≥ 15 s); en Mesas no usar `router.refresh()` (ya relee por server action) y conservar la lectura del tablero con el mismo enfriamiento. Helper puro con prueba (`shouldRevalidateOnReturn(hiddenAt, lastRunAt, now)`).
4. **Diálogo de mesa recortado desde abajo** (el `fixed inset-0` de `tables-board.tsx`): reproducir. Sospecha: altura en `vh/dvh` mal resuelta o un ancestro con `transform`/`overflow` que rompe `fixed`; montarlo con `createPortal` en `document.body` si hace falta. Debe verse entero en 1280×720, 1366×768 y 390×844, cabecera y botón principal visibles, scroll interno.
5. **Barra lateral azul** (`app-nav.tsx`): los iconos se ven azules y el ítem activo es un bloque azul. Debe quedar: iconos y etiquetas blancos en todos los estados (revisar por qué el color de enlace global gana sobre `!text-white`, p. ej. reglas de `a`/`svg` en `globals.css`), ítem activo con fondo neutro translúcido (`bg-white/15`) más una barra indicadora blanca a la izquierda, sin azul de acento. Contraste ≥ 4.5:1.
6. **Editor de plano: arrastrar no guarda** (`apps/web/src/app/app/dining-zone.tsx`, `/app/tables/edit`): hoy el arrastre sólo cambia un borrador local y hay que abrir «Editar» y «Guardar layout». Debe quedar: al soltar (pointerup) o tras mover con flechas (debounce 600 ms) se guarda automáticamente esa mesa con `updateDiningTableLayout` y su `expectedVersion`, mediante una server action que **devuelve** `{ ok, table | error }` (sin `redirect`), actualizando la versión local con la respuesta. Estado visible por mesa: «Guardando…», «Guardado», y en conflicto «La mesa cambió en otro dispositivo; se recargó» (revertir a la versión del servidor). Al volver a Mesas el plano ya refleja lo guardado. Idempotencia: un `eventId`/`idempotencyKey` por intento; un reintento tras error de red reusa el mismo intento.
7. **«Cambiar sucursal» dentro de Mesas** (`tables-board.tsx` y `CurrentBranchView` en `app/app/page.tsx`): quitarlo de ambas pantallas y ponerlo en la barra superior del shell (`app/app/layout.tsx`) junto a «Cerrar sesión», mostrando la sucursal activa (p. ej. «Sucursal Navojoa · Cambiar»). Sólo si el usuario tiene más de una membresía; con una sola, mostrar el nombre sin enlace.
8. **Columnas/filas/ancho/alto como campos numéricos sobran** (`dining-zone.tsx`): quitar los cuatro campos y «Guardar layout». Redimensionar arrastrando un asidero en la esquina inferior derecha de la mesa seleccionada (Pointer Events, en celdas enteras, ancho y alto 2..8, sin salir de 24×100), guardando igual que el punto 6. Alternativa accesible y táctil: con la mesa seleccionada, botones «Más ancha / Más angosta / Más alta / Más baja» de 44 px en el panel. Prueba del helper puro de redimensionado (clamp).
9. **Capacidad no debe depender del tamaño**: hoy ya es un dato independiente en la base; en la UI, mostrar «N personas» como dato propio de la mesa, editable (ver 11), nunca derivado del ancho/alto. (Unir mesas queda fuera de esta tarea; pendiente de decisión de Emmanuel.)
10. **«Nueva mesa» no se puede cerrar** (`CreateTableForm` es un `<details>`): convertirlo en diálogo con «Cancelar», botón cerrar, Esc y clic fuera; campos: Nombre, Capacidad, Forma (sin columna/fila/ancho/alto: la mesa nueva se coloca en el primer hueco libre del plano con 4×4, helper puro con prueba). La server action devuelve resultado en vez de redirigir; mensaje de error claro (nombre duplicado).
11. **No se puede cambiar la capacidad** (ni nombre ni forma): en el panel de la mesa seleccionada del editor, campos «Nombre», «Capacidad (personas)» y «Forma» con botón «Guardar datos». Llaman a una server action nueva `updateDiningTableDetailsAction` que usa una función nueva en `src/lib/dining-layout.ts` `updateDiningTableDetails(accessToken, apiBaseUrl, command)` contra **`PATCH {apiBaseUrl}/api/v1/dining/tables/details`** con cuerpo `{ schemaVersion: 1, scope: { restaurantId, branchId }, tableId, expectedVersion, eventId, idempotencyKey, deviceId, occurredAt, name, capacity, shape }` y respuesta `DiningTableV1` (parsear con `parseDiningTableV1`); 409 → conflicto, 403 → sin permiso. Ese endpoint lo implementa en paralelo otra tarea (`dining-table-details-api`); si aún no existe al probar, la UI debe mostrar «No se pudo guardar» sin romper nada. Validar en cliente nombre 1..60 y capacidad 1..50 (el servidor revalida).

## Criterios de aceptación
- [ ] Navegación entre secciones sin recarga completa (pestaña Red: sin documento nuevo); tiempo de `GET /app/tables` antes/después reportado.
- [ ] Volver a la pestaña no dispara «Rendering» salvo tras ≥ 15 s oculta y no más de una vez cada 30 s.
- [ ] Plano operativo a ancho completo; diálogo de mesa entero en 1280×720 y 390×844.
- [ ] Barra lateral sin azul: iconos blancos, activo con fondo neutro + barra blanca.
- [ ] Editor: arrastrar mueve y guarda solo; asidero de esquina redimensiona y guarda; sin campos numéricos; «Nueva mesa» se cierra con Cancelar/Esc/fuera; datos de mesa (nombre, capacidad, forma) editables.
- [ ] «Cambiar sucursal» sólo en la barra superior.
- [ ] Helpers puros con prueba: revalidación al regresar, escala del plano, redimensionado, primer hueco libre.
- [ ] Sin `alert/confirm/prompt`; targets 44 px; `reduced motion` respetado; consola limpia (ignorar avisos de Grammarly).

## Archivos de entrada
- `apps/web/src/app/app/app-nav.tsx` (50 líneas), `layout.tsx` (73), `focus-revalidate.tsx` (33), `page.tsx` (200; `CurrentBranchView` 87-114), `actions.ts` (151), `dining-zone.tsx` (193)
- `apps/web/src/app/app/tables/page.tsx` (28), `tables-board.tsx` (294), `tables/edit/page.tsx`
- `apps/web/src/lib/floor-plan.ts`, `table-position.ts`, `dining-layout.ts`, `memberships.ts`, `branch-selection.ts`, `supabase-server.ts`; `apps/web/src/proxy.ts` (sólo leer)
- Otros usuarios de `FocusRevalidate`: `app/app/orders/page.tsx`, `app/app/deliveries/page.tsx`.

## Invariantes
- Sin cambios en `apps/api`, `supabase/**` ni `packages/**`.
- El servidor revalida todo; ninguna verificación de membresía/autorización se elimina, sólo se deduplica por request.
- Posiciones guardadas en la cuadrícula 24×100 con ancho/alto 2..8; la presentación escala pero no altera coordenadas.
- Concurrencia por `expectedVersion`; un intento = un `eventId` + `idempotencyKey`.
- No tocar archivos del menú (`app/app/menu/**`): hay otra tarea en curso ahí.

## Verificación
- `pnpm --filter @super-restaurant/web lint`, `typecheck`, `test`, `build` (Node 24; ver memoria «Node 24 and the pnpm shim» si falla el shim).
- No hay login local de prueba: la verificación visual autenticada la hace L0/Emmanuel. Tú verificas build, pruebas y, si puedes, `/login` sin errores de consola.

## Formato de salida
Resumen por hallazgo (1-11), archivos tocados, números de rendimiento, salida literal de las puertas, riesgos. Commits convencionales en la rama; sin push.
