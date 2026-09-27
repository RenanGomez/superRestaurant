# web-shell-nav-tables

## Tarea
web-shell-nav-tables · capa: L2 (Codex) · riesgo: bajo · nivel C (producto: sólo `apps/web`, sin API ni SQL)

## Objetivo
Dos defectos reportados por Emmanuel el 2026-09-27 en la consola web: (1) los iconos de la barra lateral no marcan la ruta activa; (2) en `/app` no se pueden arrastrar las mesas del plano.

## Criterios de aceptación (verificables)
- [ ] **Ruta activa.** En `apps/web/src/app/app/layout.tsx` (o el componente de navegación que extraigas como client component pequeño) el enlace cuya ruta coincide con `usePathname()` lleva `aria-current="page"` y un estilo activo visible con los tokens existentes (fondo `accent` suave o borde, contraste suficiente). Coincidencia por prefijo para subrutas (`/app/customers/...`), pero `/app` sólo activo en exacto. El layout sigue siendo server component salvo el fragmento de navegación.
- [ ] **Arrastre de mesas.** En el canvas de `apps/web/src/app/app/page.tsx` las mesas se mueven con Pointer Events (`onPointerDown/Move/Up` + `setPointerCapture`), funcionan con ratón y táctil, respetan los límites del canvas, actualizan la posición en el estado local y el botón «Guardar layout» envía las coordenadas resultantes por el action existente sin cambiar su contrato. Diagnostica la causa real de que hoy no funcione (handlers no conectados, `touch-action`, `preventDefault` ausente, estado no controlado, etc.) y explícala. Sin arrastre no se dispara «guardar» automáticamente.
- [ ] Accesibilidad mínima del arrastre: cada mesa es focusable y se mueve con flechas (paso 8 px) como alternativa al puntero.
- [ ] Sin `alert()/confirm()/prompt()`; targets ≥44 px; `prefers-reduced-motion` respetado si añades transiciones.
- [ ] Lint, typecheck, test y build de `@super-restaurant/web` en verde. Si extraes un helper puro (p. ej. `clampTablePosition`), con pruebas `node:test` en `apps/web/src/lib`.

## Archivos de entrada
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\layout.tsx` (93 líneas): barra lateral y enlaces.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\page.tsx` (233): `CurrentBranchView`, canvas de mesas y guardado de layout.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\actions.ts` (151): actions de layout; no cambiar contratos.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\globals.css` (1-40): tokens.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\lib\shortcut-dispatch.test.ts`: patrón de pruebas.
- PROJECT_NOTES.md «Decisión durable: mesas y geometría de layout v1» (línea ~410): geometría y unidades del layout; respétala.

## Invariantes que NO deben cambiar
- Contrato `DiningLayoutV1` y el action de guardado quedan intactos; el servidor sigue validando el layout.
- No tocar `apps/api`, `packages/*`, `supabase/*`, `apps/web/src/app/app/capture/**` ni `apps/web/src/app/app/customers/**` (otras tareas escriben ahí en paralelo).
- Gating por rol (`canManage`) se conserva: quien no puede gestionar no arrastra.

## Fuera de alcance
- Nuevas zonas, formas de mesa, snapping a rejilla, rediseño de la barra lateral.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```
La verificación en navegador la hace el orquestador; indica qué interacción reproduce cada corrección.

## Formato de salida esperado
1. Resumen (3-6 líneas) con causa raíz del arrastre roto.
2. Archivos tocados.
3. Salida literal de verificación.
4. Riesgos o dudas.
No pegues diffs completos.
