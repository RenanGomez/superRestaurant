# web-customers-fixes · ronda 3

Misma tarea; tus rondas 1 y 2 están en `887cd98` y `d0647a3`. Nueva revisión `codex exec review --base main` devolvió dos P2 en `apps/web/src/app/app/customers/customer-editor.tsx`:

1. **Badge «Validada en …» con edición sin guardar (~línea 279).** Cuando el operador edita una dirección validada, `dirty` es true pero el pill sigue en verde. Mientras haya cambios sin guardar muestra un estado neutro «Cambios sin guardar · revalidar al guardar» y deshabilita «Validar para esta sucursal» hasta guardar. Al guardar, el estado vuelve a reflejar lo que diga el servidor.
2. **Conteo del resumen de pedidos recientes (~línea 237).** Muestra `items.length` como «N artículos». Suma `quantity` de las líneas para «artículos» o etiqueta como «líneas». Preferido: sumar cantidades. Extrae `countOrderArticles(items)` como helper puro en `apps/web/src/lib/customer-order-history.ts` con prueba `node:test` (línea con `quantity` 3 → 3; dos líneas 1 y 2 → 3; vacío → 0).

Sin `alert/confirm/prompt`; sin tocar server actions. Pega la salida literal de:

```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```
No commitees. Salida: resumen, archivos, salida literal, dudas.
