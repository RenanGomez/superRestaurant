# r2-fixes — hecha
Cambios: «Total de productos» en barra/hoja (ítems sin entrega); conservar borradores sin prueba de vacío; cerrar la hoja móvil antes de editar/nota; producto z-50 con safe-area; diálogo de pedido con aria/foco atrapado/Escape/restauración; atajo de cliente cambia de paso en móvil.
Archivos: apps/web/src/app/app/capture/capture-ticket.tsx, capture-workspace.tsx, product-sheet.tsx, apps/web/src/lib/capture-workspace.ts, apps/web/src/lib/capture-workspace.test.ts
Verificación: `corepack pnpm lint` y `corepack pnpm typecheck` (EXIT:0, sin diagnóstico); `corepack pnpm test`:
```text
$ corepack pnpm test
ok 2 - drafts are kept unless the server explicitly reports zero lines
# tests 7
# pass 7
# fail 0
```
Riesgos/pendientes: sin navegador real ni breakpoints; foco, Escape y safe-area no verificados visualmente.
