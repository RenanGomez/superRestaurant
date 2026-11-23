# Brief capture-shortcuts-r2 (C3, nivel C)

## Objetivo
Que respondan los atajos de Captura: Alt+N, Alt+K/Ctrl+K, Escape y Alt+R (smoke cap-keys falló).

## Alcance
- Editar `apps/web/src/lib/shortcut-dispatch.ts` (+ `shortcut-dispatch.test.ts`) y la tabla de atajos de `apps/web/src/app/app/capture/capture-workspace.tsx` (~1024-1029, ubica por símbolo).
- Prohibido: otros archivos, git commit/push.

## Contexto mínimo
- Causa: `shortcut-dispatch.ts:46` descarta todo atajo, salvo Escape, si el foco está en un input. La tabla de CW sólo habilita `search` con borrador abierto; Escape y Alt+R sólo funcionan en captura confirmada o en conflicto; Alt+N sólo sin captura abierta.
- Cambios: atajos con Alt o Ctrl disparan también con foco en inputs; las letras solas siguen sin disparar (la «N» sola no está asignada por diseño). Alt+N crea captura nueva también con una abierta (con el flujo de confirmación existente si hay cambios). Ctrl+K y Alt+K enfocan la búsqueda de cliente (componente `capture-customer-search.tsx` de C2). Escape cierra combobox, diálogo u hoja abierta. Alt+R reinicia o vuelve a la lista si no hay nada pendiente. Usa `event.code` (`KeyN`) como respaldo de `event.key`. Leyenda visible de atajos (tooltip o pie).

## Hecho cuando
- Tests de `shortcut-dispatch` cubren: foco en input con Alt y con Ctrl, letra sola ignorada, Escape. lint, typecheck y test web en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Sin alert/confirm/prompt; targets de 44 px. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` una vez (tail -40). Cierra procesos que levantes. Informe en `.agents/reports/capture-shortcuts-r2.md` (≤15 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
