# web-customers-fixes · ronda 4

Rondas previas: `887cd98`, `d0647a3`, `0135f35`. Nueva revisión: un P2 en `apps/web/src/app/app/customers/customer-editor.tsx` (~115-118): `acceptSuggestion` ahora abre la ficha del cliente al aceptar un término, lo que rompe la búsqueda multi-término documentada en `PLAN_MODERNIZACION_POS_RESTAURANTE.md:483` («Morena 84»).

Decisión del orquestador (concilia el plan con el bug reportado por Emmanuel «seleccionar un cliente del desplegable no renderiza sus datos»): son dos interacciones distintas y deben verse distintas.

1. **Sugerencias de término** (nombre, número, parte de dirección, las que ya devolvía el autocompletado): al aceptarlas insertan el término en el buscador, conservan el foco y mantienen abierto el desplegable para seguir acotando. No abren ficha. Visual: chips o filas con icono de búsqueda y prefijo «Buscar:».
2. **Resultados de cliente** (coincidencias concretas con `customerId`): filas con nombre, teléfono y dirección breve; al hacer clic o Enter abren la ficha e historial (el comportamiento que corregiste en la ronda 1). Visual: fila con icono de persona.

Ambos grupos pueden convivir en el mismo desplegable con un encabezado por grupo («Completar búsqueda» / «Clientes»); el teclado navega ambos con flechas. Si el API sólo devuelve términos y el listado de resultados llega por otra vía, usa esa vía para el segundo grupo sin cambiar contratos.

Sin `alert/confirm/prompt`; sin cambiar server actions. Si extraes un helper puro que clasifique sugerencias, prueba `node:test`. Pega la salida literal de:

```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```
No commitees. Salida: resumen, archivos, salida literal, dudas.
