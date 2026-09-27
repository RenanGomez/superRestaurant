# web-customers-fixes · ronda 2

Continúa la misma tarea (paquete `.claude/packets/web-customers-fixes.md`). Tu trabajo ya está commiteado en `887cd98` sobre `codex/web-customers-fixes`. La revisión `codex exec review --base main` devolvió dos P2 que debes corregir en `apps/web/src/app/app/customers/customer-editor.tsx`:

1. **Historial no reintentable (líneas ~64-68).** El mensaje de error del historial dice que se reintente, pero volver a elegir el mismo cliente no relanza la carga. Añade un botón «Reintentar» (≥44 px) que vuelva a invocar la acción de historial para el `customerId` actual, con estado de carga explícito.
2. **Órdenes del cliente anterior visibles (líneas ~212-216).** Al cambiar de ficha, el panel muestra brevemente el historial del cliente previo. Limpia el historial (y su error) de forma síncrona al cambiar `customerId` antes de lanzar la carga nueva, y descarta respuestas tardías cuyo `customerId` ya no coincide con el seleccionado (guarda el id de la petición y compáralo al resolver).

Criterios: sin `alert/confirm/prompt`; sin cambiar el contrato de las server actions; pruebas `node:test` si extraes un helper puro (por ejemplo, un reductor de estado del historial que ignore respuestas obsoletas). Verifica y pega la salida literal de:

```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```

No intentes commitear (el orquestador lo hace). Salida: resumen, archivos tocados, salida literal, dudas.
