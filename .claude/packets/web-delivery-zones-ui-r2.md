## Tarea
web-delivery-zones-ui · ronda 2 · capa: L2 · riesgo: bajo

## Contexto
Revisión de `codex exec review --uncommitted` sobre tu diff. El P1 (rutas ausentes en la API) es falso respecto a `main`: el módulo `apps/api/src/delivery-zones.controller.ts` con `POST /delivery-zones/{list,upsert,quote}` ya está integrado; tu worktree parte de un commit anterior. No cambies las rutas. Corrige sólo el P2.

## Criterios de aceptación (verificables)
- [ ] `apps/web/src/app/app/capture/capture-workspace.tsx` ~305-307: una cotización en vuelo no debe mostrarse si el operador cambió de dirección o de borrador antes de recibirla. Compara el `addressSnapshotRef`/`fulfillmentSnapshotRef` de la respuesta con el snapshot de cumplimiento vigente al llegar, o invalida la petición con un token de secuencia por borrador; descarta silenciosamente la respuesta obsoleta.
- [ ] Prueba pura en `apps/web/src/lib/delivery-zones.test.ts` (o helper nuevo) que cubra: respuesta con ref distinto → descartada; ref igual → aceptada.
- [ ] `pnpm --filter @super-restaurant/web lint|typecheck|test|build` en verde, salida literal.

## Invariantes que NO deben cambiar
- Sin cambios en contratos, rutas, server actions ni en los atajos de teclado.

## Formato de salida esperado
Resumen de 3 líneas, archivos tocados, salida literal.
