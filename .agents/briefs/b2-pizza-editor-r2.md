# Brief b2-pizza-editor-r2 (Editor de pizza ronda 2, nivel C)

## Objetivo
Editor de pizza ronda 2. Smoke r2, ola 2.

## Fuente de verdad
Plan `docs/plans/smoke-2026-11-05-r2-plan.md` B2 y `docs/architecture/PIZZA_MODEL_V2.md` delta. Archivos: `menu/pizza-v2-editor.tsx`, lo mínimo de `menu/menu-catalog-editor.tsx` (montaje ~716-740 y aviso de mitades legadas), `apps/web/src/lib/menu-pizza.ts` y tests. Consume el tile de B3. Sin check «Permitir mitades» (aviso «Mitades por sabores (modelo anterior)» con botón «Desactivar»), botones completos «Configurar especialidades» y «Gestionar grupos» de 44 px, grupos base marcados entre los grupos ya asignados («Gratuitos (cuentan contra N)»), casilla «Personalizar durante la orden», extras por opción «Extras (siempre se cobran)».

## Hecho cuando
Tests de menu-pizza.ts (alternar base, receta, extra) y puertas web en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Prohibido: git commit/push, aplicar migraciones en remoto, tocar archivos fuera del alcance. Informe de ≤15 líneas con bloque con comando y salida real; sin evidencia = NO VERIFICADO.
