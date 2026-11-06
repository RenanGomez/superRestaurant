# menu-tabs-p3 · tres detalles de la revisión de menu-tabs-r2 (Nivel C)

Archivo único: `apps/web/src/app/app/menu/menu-catalog-editor.tsx`. No tocar nada más.

1. Los `role="tabpanel"` (cerca de las líneas 378, 429, 477 y 524) tienen `tabIndex={0}` con `focus-visible:outline-none`: el foco por teclado es invisible. Usa un anillo visible coherente con el resto del editor (p. ej. `focus-visible:ring-2` del mismo color que los demás controles).
2. Al montar sin `?tab=` y con pestaña guardada en `localStorage`, la pestaña por defecto parpadea (efecto en ~81-101). Evítalo sin causar hydration mismatch: p. ej. no pintar el contenido de los paneles hasta resolver la pestaña en el primer efecto (estado `resolved`), o mostrar el esqueleto de la pestaña mientras tanto. El render del servidor no debe leer `localStorage`.
3. Cerca de la línea 1067: el texto queda «Asignado a 0 productos. (sin asignar)». Con 0 escribe sólo «Sin asignar»; con 1 «Asignado a 1 producto»; con N «Asignado a N productos».

## Hecho cuando
`pnpm turbo run lint typecheck test build --filter=@super-restaurant/web` verde (si no puedes correrlo, dilo). Commit local `fix(web-menu): …`. Informe con bloque ``` de comando y salida real.
