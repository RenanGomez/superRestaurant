# web-order-add-items-now (arranque contra el API actual)

Ejecuta el paquete `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\.claude\packets\web-order-add-items.md` con esta única diferencia: el API todavía **no** acepta `note` ni `variantId` en `AddOrderItemCommandV1`, `ORDER_DETAIL_ACTIONS` aún no incluye `addItem` y `MenuProductV1.variants` no existe (llegarán en una rama paralela). No te detengas por eso:

- construye el comando sin `note` ni `variantId` (la hoja de armado puede ocultar el campo de nota en este modo o mostrar «La nota se habilita en la próxima versión»; elige ocultarlo);
- muestra «Agregar producto» cuando el detalle esté en `draft|open|partially_paid` y el actor pueda enviar a cocina o abrir (`hasAction(detail, "sendToKitchen") || hasAction(detail, "open") || hasAction(detail, "markReady")` como aproximación), con un helper puro `canAddItems(detail)` y prueba, dejando un comentario `// TODO addItem en availableActions` para cambiarlo por `hasAction(detail, "addItem")` cuando exista;
- deja el punto de extensión claro: una sola función `buildAddOrderItemCommand(...)` donde añadir `note` y `variantId` después.

Todo lo demás (criterios, toques, puertas, formato de salida, sin commit) igual que el paquete original.
