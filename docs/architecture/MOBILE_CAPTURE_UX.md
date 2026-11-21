# Captura móvil 390×844 (propuesta R2-0)

> Estado: **boceto pendiente de aprobación de Emmanuel**. R2-n no arranca hasta aprobarlo.

**R2-0 · Boceto propuesto para 390×844.** Pendiente de aprobación de Emmanuel; R2-n empieza después de integrar R1.
**Menú:** `Sucursal / conexión` → `Buscar producto` → `[foto Categoría] [foto Categoría] →` → tarjetas grandes `[FOTO · nombre · precio]` en desplazamiento vertical → barra flotante `[cantidad · total API · Ver pedido]`.
**Producto:** tocar tarjeta abre hoja inferior: `[Cerrar]`, foto, nombre, variantes y modificadores, nota, `− cantidad +`, precio cotizado y `[Agregar]`; cerrar devuelve al menú conservando la selección previa.
**Pedido → Cliente → Entrega:** `Ver pedido` abre líneas editables y total; `Continuar` abre búsqueda/selección de cliente; después, entrega y dirección cuando corresponda. `Atrás` conserva lo capturado; el pedido permite volver al menú.
**Estados:** carga con indicador y acciones pendientes deshabilitadas; catálogo o búsqueda vacíos con mensaje y opción de cambiar búsqueda; fallo con explicación y reintento; imagen ausente con color e iniciales; producto agotado deshabilitado. Ante error de guardado, conservar la selección y mostrar el resultado antes de reintentar.
**Interacción:** todos los controles, incluidos cerrar, cantidad y categorías, tendrán área táctil mínima de 44×44 px; etiquetas, foco visible, navegación por teclado y espacio para la barra inferior.
**R2-1:** `apps/web/src/app/app/capture/capture-menu.tsx` — carrusel horizontal con imágenes y respaldo; tarjetas grandes con foto, búsqueda, categoría activa y estados vacíos visibles.
**R2-2:** `apps/web/src/app/app/capture/product-sheet.tsx` — hoja inferior adaptable, contenido desplazable, controles de 44 px, cotización y errores visibles; reutilizar selección existente.
**R2-3:** `apps/web/src/app/app/capture/capture-ticket.tsx`, `apps/web/src/app/app/capture/capture-workspace.tsx` y `apps/web/src/app/app/capture/capture-customer.tsx` — barra flotante y pasos de pedido, cliente y entrega, con navegación reversible. El total debe venir del API: **NO VERIFICADO:** que la proyección actual exponga un total distinto del subtotal; resolver el contrato antes de mostrarlo como total.
**Verificación:** lectura solamente; no se ejecutaron pruebas ni verificación visual. La sección 10 de AGENTS.md trata aislamiento y autorización, y no contiene una plantilla de reporte.
```text
rg -n -A 8 '## 10\.' AGENTS.md
225:## 10. Multi-restaurante, sucursales y autorización
```
