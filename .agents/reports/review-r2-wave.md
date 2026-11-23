**CORREGIR**

- **P1** [capture-ticket.tsx:36](/C:/Users/Emmanuel%20G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/capture-ticket.tsx:36): `itemsTotalMinor` excluye la tarifa de entrega, pero se muestra como “Total”. Rotularlo “Total de productos” o usar el total del pedido devuelto por el API.
- **P1** [capture-workspace.tsx:1121](/C:/Users/Emmanuel%20G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/capture-workspace.tsx:1121): el filtro oculta borradores con cliente e importe no disponibles, aunque puedan contener datos. Conservarlos hasta contar con evidencia explícita de que están vacíos.
- **P2** [capture-ticket.tsx:62](/C:/Users/Emmanuel%20G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/capture-ticket.tsx:62): editar desde el pedido móvil deja la hoja `z-40` sobre el editor `z-20`. Cerrar la hoja antes de editar y probar edición y nota.
- **P2** [product-sheet.tsx:176](/C:/Users/Emmanuel%20G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/product-sheet.tsx:176): la navegación inferior `z-30` queda sobre el diálogo `z-20`. Elevar el diálogo y verificar safe-area.
- **P2** [capture-ticket.tsx:103](/C:/Users/Emmanuel%20G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/capture-ticket.tsx:103): el diálogo carece de nombre accesible y gestión de foco. Añadir etiqueta, foco inicial, confinamiento, Escape y restauración al cerrar.
- **P2** [capture-workspace.tsx:1065](/C:/Users/Emmanuel%20G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/capture-workspace.tsx:1065): el atajo de cliente intenta enfocar un campo oculto en otros pasos móviles. Cambiar primero al paso Cliente y luego enfocar.
- **NO VERIFICADO:** navegador, breakpoints, pruebas y consola; revisión estática solamente. Añadir regresiones para estos escenarios.
- **NO VERIFICADO:** plantilla solicitada; AGENTS.md §10 no contiene una. No se guardó el archivo: el entorno permite solo lectura.
```text
rg -n '## 10\.' AGENTS.md
225:## 10. Multi-restaurante, sucursales y autorización
```