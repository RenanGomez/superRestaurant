# web-menu-halves-ui · mitad y mitad en el editor y en la hoja de armado (D7b UI)

## Tarea
web-menu-halves-ui · capa: L2 (Codex) o L1 por desviación · riesgo: bajo · nivel C (`apps/web`: editor de menú, hoja de armado, ticket, detalle). Ritmo: configuración en el editor, operación en la hoja (Entera / Mitad y mitad en un toque, dos sabores en dos toques). Base: `main` con `catalog-halves-api` integrado (verificar `fraction` en `MenuProductVariantV1` y `fraction` en la línea de selección/`AddOrderItemCommandV1`, `geometry` y `fractionBreakdown` en el detalle; si faltan, detente e informa).

## Objetivo
Que el administrador marque en un tamaño «Permitir mitades» eligiendo el grupo de sabores, el de extras y los ingredientes excluibles, y que el operador arme una pizza «Mitad y mitad» eligiendo dos sabores (y extras o exclusiones por mitad) viendo el estimado con la regla del servidor (mayor precio entre mitades, extras de media al 50 %); el ticket y cocina ven «Mitad A: … / Mitad B: …».

## Criterios de aceptación
- [ ] Editor: en cada tamaño, interruptor «Permitir mitades» que despliega «Grupo de sabores», «Grupo de extras» (listas de los grupos del producto) e «Ingredientes que se pueden quitar» (chips); se guarda en `fraction` del tamaño. Toques: interruptor → sabores → extras (3).
- [ ] Hoja de armado: si el tamaño elegido admite mitades, segmento «Entera / Mitad y mitad»; con mitades, dos columnas «Mitad A» y «Mitad B» con los sabores como botones grandes, extras y exclusiones por mitad; «Agregar» deshabilitado hasta tener los dos sabores («Elige los dos sabores»); el estimado aplica la regla aprobada sólo como texto «Estimado» (mayor sabor + extras, media al 50 % redondeando arriba) reutilizando, si existe, un helper puro compartido; la línea enviada lleva `fraction`; al editar, se preselecciona.
- [ ] Ticket de captura, detalle de orden y KDS (`apps/kds`) muestran «Mitad A: <sabor>» / «Mitad B: <sabor>» con sus extras y exclusiones debajo; sin fracción, nada cambia.
- [ ] Helpers puros con prueba: validación de dos sabores, estimado de mitades, etiquetas por mitad.
- [ ] Sin `alert/confirm/prompt`; targets ≥44 px; 390×844 (las dos mitades se apilan); consola limpia.

## Invariantes
Precio final del servidor; estimado sólo visual; contratos intactos; no tocar caja, tables, deliveries.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint && pnpm --filter @super-restaurant/web typecheck && pnpm --filter @super-restaurant/web test && pnpm --filter @super-restaurant/web build
pnpm --filter @super-restaurant/kds typecheck && pnpm --filter @super-restaurant/kds test
```

## Formato de salida esperado
Resumen (toques), archivos tocados, salida literal, riesgos.
