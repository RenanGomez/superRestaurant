# web-customers-fixes

## Tarea
web-customers-fixes · capa: L2 (Codex) · riesgo: bajo · nivel C (producto: sólo `apps/web`, sin API ni SQL)

## Objetivo
Corregir en la pantalla `/app/customers` los defectos que Emmanuel reportó al probarla el 2026-09-27, respetando el sistema visual existente (tokens de `apps/web/src/app/globals.css`, clases `panel/button/input` que ya usa el editor). Referencia de tono visual: `docs/prototypes/captura-telefonica-menu-tactil.html` (sección Cliente).

## Criterios de aceptación (verificables)
- [ ] **Selección desde el desplegable renderiza los datos.** Al elegir una sugerencia de la búsqueda por teléfono/nombre, el panel del cliente muestra nombre, teléfonos, direcciones e historial sin necesidad de un segundo clic ni recarga. Diagnostica la causa real (estado no actualizado, `key` faltante, `startTransition`, respuesta del action no aplicada, etc.) y corrígela; no la parches con un `setTimeout`.
- [ ] **Etiqueta de dirección con ejemplo.** El campo «Etiqueta» lleva `placeholder="Casa, Oficina, Casa de mamá"` y un texto de ayuda breve («Nombre corto para reconocer la dirección»).
- [ ] **«Validar para esta sucursal» muestra efecto visible.** Tras el action, la dirección muestra un pill de estado («Validada en {sucursal}» / «Sin validar aquí») y un mensaje de éxito o error en la propia tarjeta; el botón pasa a estado deshabilitado/«Validada» cuando ya lo está. Estados de carga y error explícitos.
- [ ] **Proporción 60/40.** En ≥1024 px la columna de búsqueda/lista ocupa ~60 % y el detalle/edición ~40 % (grid `3fr 2fr` o equivalente); en 390×844 una sola columna sin scroll horizontal.
- [ ] **Alta rápida ofrece continuar a captura.** Tras guardar un cliente nuevo aparece un enlace/botón «Ir a captura telefónica» que navega a `/app/capture` (sin parámetros nuevos ni cambios en capture; la preselección del cliente en captura llega en otra tarea).
- [ ] Sin `alert()/confirm()/prompt()`; targets ≥44 px; foco visible; textos en español.
- [ ] Lint, typecheck, test y build de `@super-restaurant/web` en verde. Si añades helpers puros en `apps/web/src/lib`, con pruebas `node:test`.

## Archivos de entrada
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\customers\customer-editor.tsx` (237 líneas): componente principal; aquí está el bug de selección y los campos.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\customers\actions.ts` (37): server action `customerDirectoryAction`; no cambies su contrato con el API.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\customers\page.tsx` (34): layout y gating por rol.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\globals.css` (1-40): tokens.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\capture\capture-workspace.tsx` (líneas 30-60 solamente): clases utilitarias `panel/button/input` a reutilizar.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\lib\shortcut-dispatch.test.ts`: patrón de pruebas `node:test`.

## Invariantes que NO deben cambiar
- El cliente no decide permisos ni calcula nada financiero; los actions y sus parsers de `@super-restaurant/shared-types` quedan intactos.
- No tocar `apps/api`, `packages/*`, `supabase/*` ni `apps/web/src/app/app/capture/**` (otra tarea escribe ahí en paralelo).
- Scope Restaurant/Branch sigue viniendo del servidor (cookie revalidada); no añadir estado global nuevo.

## Fuera de alcance
- Preselección de cliente en `/app/capture`; búsqueda nueva; cambios de API; rediseño completo de la pantalla.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```
La verificación en navegador real la hace el orquestador; describe en tu salida qué interacción exacta reproduce cada corrección.

## Formato de salida esperado
1. Resumen de cambios (3-6 líneas), con la causa raíz del bug de selección.
2. Lista de archivos tocados.
3. Salida literal de los comandos de verificación.
4. Riesgos o dudas abiertas.
No pegues diffs completos.
