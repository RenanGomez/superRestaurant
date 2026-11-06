# menu-tabs-r2 · separar el editor del menú en pestañas: Categorías · Productos · Modificadores · Tamaños

Nivel C · Capa L2 (Codex o Gemini con `-Write`) · rama desde `main` **después** de integrar `menu-polish-r2`. Archivos: `apps/web/src/app/app/menu/**`, `apps/web/src/lib/menu-*.ts` y tests. No tocar `apps/api`, `packages/*`, SQL ni `apps/web/src/app/app/capture/**`.

## Pedido de Emmanuel (2026-11-01)
Separar el menú en pestañas:
1. **Categorías**: todo lo relacionado con ellas (nombre, color, foto, activo, orden).
2. **Productos**: tarjetas de producto; en la casilla «Grupos de modificadores» se asignan grupos existentes (multiselección), no se crean.
3. **Modificadores**: aquí se configuran los ingredientes individuales (opciones con su precio) y los grupos de ingredientes/modificadores. Los grupos pueden fungir como especialidades (sin cambios de contrato en este paquete; sólo la organización de la pantalla y un texto de ayuda que lo diga).
4. **Tamaños** (nombre provisional, elegir uno intuitivo, p. ej. «Tamaños y presets»): por ahora muestra los tamaños que hoy viven en cada producto, agrupados y con un aviso «Pronto podrás definir tamaños una sola vez y elegirlos en cada producto». La configuración reutilizable real viene en el paquete A `menu-size-presets`.

## Cambios
- Barra de pestañas accesible (`role="tablist"`, `role="tab"` con `aria-selected`, `aria-controls`, flechas izquierda/derecha para moverse, 44 px), pestaña activa en la URL (`?tab=categorias|productos|modificadores|tamanos`) y recordada en `localStorage` en `try/catch`.
- El estado del borrador sigue siendo uno solo: cambiar de pestaña no pierde cambios; el indicador «Cambios sin publicar» y el botón «Publicar» quedan fijos fuera de las pestañas (encabezado).
- `DragReorderList` sigue en Categorías y Productos. En Productos, agrupación por categoría como hoy.
- La pestaña Modificadores lista los grupos con su contador «Asignado a N productos» y un filtro por nombre; «+ Agregar grupo» vive aquí. Desde la tarjeta de producto, un enlace «Gestionar grupos» lleva a esta pestaña.
- Textos en español, sin `any`, LF, sin `alert/confirm/prompt`, `prefers-reduced-motion`.

## Verificación (Node 24, pnpm vía corepack)
- `pnpm turbo run lint typecheck test build --filter=@super-restaurant/web`.
- Test del helper puro que parsea/serializa la pestaña de la URL.
- Navegador con sesión si existe (`apps/web/playwright/.auth/user.json`): las cuatro pestañas en 1366×800 y 390×844, consola limpia, cambiar de pestaña con un cambio pendiente no lo pierde. Capturas en `apps/web/e2e-report/menu-tabs-r2/`. Si no, brecha.

## Formato de salida
Resumen, archivos, salida literal de puertas, capturas o brecha, riesgos. Commits locales `feat(web-menu): …`. Sin merge ni push.

## Añadido 2026-11-02 (retroalimentación de Emmanuel, captura de la tarjeta de producto)
- Fila 1 del producto: «Duplicar» va junto al check «Activo», en el bloque de acciones de la derecha (Duplicar, Activo, ?, ×), no en la fila 3.
- Anchos: «Precio» y «Unidad» están exagerados; precio 7.5rem, unidad 9rem; «Clave interna» 10rem, «Estación» 12rem; el nombre del producto toma el resto (minmax(0,1fr)). Misma regla de línea auxiliar reservada que en menu-polish-r2. A 390 px una columna.
- Confirmar que la etiqueta «Ingredientes que se pueden agregar» y la ausencia de línea sobre «Mitades» siguen tras los cambios de menu-locked-ingredients.

## Notas del orquestador (2026-11-05)
- Base: `main` actual (menu-polish-r2 y menu-locked-ingredients ya integrados).
- Haz commit local en tu rama al terminar (si el sandbox no puede, dilo y el orquestador lo hará).
- El reporte debe incluir un bloque ``` con el comando de puertas y su salida real.
