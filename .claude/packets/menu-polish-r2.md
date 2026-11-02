# menu-polish-r2 · selector de color plegado, foto siempre por modal, alineación de inputs, duplicar producto, detalles del editor

Nivel C · Capa L2 Codex (`tools/agentic/codex-task.ps1 -Task menu-polish-r2 -Packet .claude/packets/menu-polish-r2.md -Effort medium`) · rama `codex/menu-polish-r2` desde `main` (≥ 4210207). Sólo `apps/web/src/app/app/menu/**`, `apps/web/src/lib/menu-*.ts` y sus tests. No tocar `apps/api`, `packages/*`, SQL ni `apps/web/src/app/app/capture/**`. Después de este paquete viene `menu-tabs-r2` (separar en pestañas) sobre el mismo archivo: no lo adelantes.

## Retroalimentación de Emmanuel (2026-11-01, segunda revisión en navegador, /app/menu)
1. **Color de categoría**: no mostrar las 8 muestras siempre. Un botón redondo con el color actual (o un anillo punteado si no hay color) que al tocarlo despliega las muestras en un popover; elegir una lo cierra. Quitar «Automático»: si no hay color elegido, se usa el automático sin decirlo. Mantener `aria-label` con el nombre del color y `aria-pressed`.
2. **Foto**: quitar el enlace «Fotos del menú» en categorías, productos y opciones. Tocar el círculo de la foto abre **siempre** el mismo diálogo (haya o no foto). Sin foto el botón principal dice «Cargar foto»; con foto, «Reemplazar». «Quitar» sólo quita la foto y deja el diálogo abierto (el botón pasa a «Cargar foto»). Botones centrados horizontalmente. Las listas «Fotos quitadas…» y «Fotos ya usadas en este menú» se conservan debajo. Aplica **igual** a categoría, producto y opción de modificador.
3. **Fila de categoría** (captura 2): el check «Activo», su «?» y el botón «×» deben quedar centrados verticalmente respecto al input del nombre.
4. **Duplicar producto**: falta el botón en la tarjeta de producto (hoy sólo lo tienen los grupos). Debe estar en la fila 3 junto a «+ Añadir tamaño», usando `duplicateProduct` + copia de foto que ya existen (`copyProduct`).
5. **Opciones del grupo de modificadores** (captura 5): los inputs de cada opción están desalineados porque el texto de ayuda bajo «Precio» empuja. Regla: en toda fila de inputs, las etiquetas van en una línea de altura fija y los inputs comparten la misma línea base; el texto auxiliar («$0.10», ayuda) ocupa una línea reservada de altura fija debajo (`min-h-4`) aunque esté vacío, para que nunca desplace a los vecinos. Anchos: nombre `minmax(0,1fr)`, precio `7.5rem`, máximo opcional `6rem`, foto `3rem`, acciones `auto`. A 390 px, una columna.
6. **Encabezado del grupo** (captura 7): «Duplicar» va a la izquierda de «Activo»; «Activo», «?», «Duplicar» y «×» forman un solo bloque alineado a la derecha sin hueco entre «×» y el borde ni entre «Duplicar» y «×». Mismo criterio que la fila de producto.
7. **Mitades** (captura 6): quitar la línea/borde que aparece encima de la sección «Mitades».
8. **Texto**: «Ingredientes que se pueden quitar» vuelve a llamarse «Ingredientes que se pueden agregar» (sólo la etiqueta y su ayuda; el dato es el mismo).
9. **Disciplina de alineación en todo el editor**: aplica la regla del punto 5 a todas las filas de inputs del editor (categoría, producto filas 1 a 3, tamaños, grupos, opciones). Usa un componente/clase común para «campo con etiqueta, input de 44 px y línea auxiliar reservada» en lugar de márgenes ad hoc. Los botones de acción de fila (Activo, ?, Duplicar, ×) se alinean al centro vertical del input con `items-center` en un contenedor de la misma altura.

## Invariantes
Sin `any`, LF, español, sin `alert/confirm/prompt`, targets ≥ 44 px, `prefers-reduced-motion` respetado, sin cambiar la forma del `draft` que envía `saveMenuCatalogAction`, borrador local intacto.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`; construye `packages/shared-types` y `packages/domain` antes del typecheck)
- `pnpm turbo run lint typecheck test build --filter=@super-restaurant/web`.
- Si `http://localhost:8082` responde y existe `apps/web/playwright/.auth/user.json` en el checkout principal, cópialo al worktree junto con `apps/web/.env.local`, levanta la web del worktree en otro puerto y toma capturas a 1366×800 y 390×844 de: fila de categoría con el selector plegado y desplegado, diálogo de foto sin foto y con foto, tarjeta de producto con «Duplicar», fila de opciones alineada; guárdalas en `apps/web/e2e-report/menu-polish-r2/` y borra `.env.local` y `user.json` al final. Si no hay sesión, documenta la brecha.

## Formato de salida
Resumen, archivos, salida literal de las puertas, capturas o brecha, riesgos. Commits locales `fix(web-menu): …`. Sin merge ni push.
