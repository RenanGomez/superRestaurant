# web-shell-nav-tables · ronda 2

Misma tarea (paquete `.claude/packets/web-shell-nav-tables.md`); tu ronda 1 está en `9620e9c`. `codex exec review --base main` devolvió dos P2 en `apps/web/src/app/app/dining-zone.tsx`:

1. **Posición local obsoleta tras revalidación (~línea 37).** Cuando `FocusRevalidate` refresca el layout del servidor, el estado local conserva coordenadas viejas para la misma mesa y puede guardarlas con la `version` nueva, pisando el movimiento de otro operador sin conflicto. Sincroniza la posición local cuando cambie `table.version` (o el layout entrante), conservando únicamente una edición local no guardada iniciada por el usuario; si hay edición local y la versión cambia, marca la mesa como «actualizada en servidor» y descarta o resalta la edición (elige lo más seguro: descartar la edición local y avisar en la tarjeta).
2. **Clamp con dimensiones editadas (~líneas 94-97).** Las coordenadas se limitan con el ancho/alto originales; al reducir la mesa a 2 columnas no se puede mover a la columna 22. Limita contra el ancho y alto actualmente escritos en el formulario. Cubre el caso con una prueba en `apps/web/src/lib/table-position.test.ts`.

Sin `alert/confirm/prompt`; sin cambiar el action de guardado. Pega la salida literal de:

```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```
No commitees. Salida: resumen, archivos, salida literal, dudas.
