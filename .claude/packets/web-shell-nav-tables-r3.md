# web-shell-nav-tables · ronda 3

Rondas previas: `9620e9c`, `0b721c5`. Nueva revisión: dos P2 en `apps/web/src/app/app/dining-zone.tsx`:

1. **Movimiento por teclado que no persiste (~118-120).** Con celdas de ~21 px, una flecha mueve 8 px y `savedTablePosition` redondea de vuelta al entero original: «Guardar layout» reporta éxito y la mesa vuelve a su sitio. Haz que el teclado mueva exactamente una celda de la cuadrícula (1 unidad entera de 24×100) por pulsación (Shift+flecha = 4 celdas), de modo que la vista previa coincida siempre con lo que se guardará. Ajusta la prueba en `apps/web/src/lib/table-position.test.ts`.
2. **Tarjetas compactas desbordan la celda (~132-135).** Una mesa 2×2 ocupa ~41 px de alto, pero la tarjeta tiene mínimo 44 px y un botón «Editar» de 44 px dentro. Solución: la tarjeta de mesa dentro del plano se dibuja compacta (sólo nombre y capacidad, sin controles, `min-height` según la celda) y el control «Editar» y los campos de edición viven fuera del plano, en un panel lateral/inferior que muestra la mesa seleccionada (seleccionar = clic/tap/Enter en la mesa). Así los targets de 44 px están en el panel, no dentro de la cuadrícula. Arrastre y flechas siguen actuando sobre la mesa seleccionada.

Sin `alert/confirm/prompt`; sin cambiar el action. Pega la salida literal de:

```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```
No commitees. Salida: resumen, archivos, salida literal, dudas.
