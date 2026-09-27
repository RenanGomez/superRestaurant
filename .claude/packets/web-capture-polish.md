# web-capture-polish

## Tarea
web-capture-polish · capa: L1 (`implementer-claude`, porque Codex está sin cuota) · riesgo: bajo · nivel C (sólo `apps/web`).

## Objetivo
Cerrar las brechas de producto pequeñas que quedaron en `/app/capture` tras el menú táctil (`main` `306476f`), sin tocar API, contratos ni SQL.

## Criterios de aceptación
- [ ] **Copy de transferencia.** En la sección de transferencia de captura (`capture-workspace.tsx`, texto actual «El operador destino recibirá un lease nuevo…» y el mensaje «No hay otro operador activo elegible»), sustituir por lenguaje de operador: título «Pasar la captura a otro operador», ayuda «El otro operador la verá en su bandeja y podrá continuar donde la dejaste», y cuando no hay candidatos: «Nadie más de esta sucursal tiene sesión activa ahora. Puedes dejarla en espera y otro operador la retomará desde la bandeja.» con botón «Dejar en espera» junto al aviso.
- [ ] **Atajo `/` contextual.** Con el paso de menú visible (existe `data-testid="capture-menu-section"`), `/` enfoca el buscador de productos; si no, sigue enfocando la búsqueda de cliente. Implementar en `apps/web/src/lib/shortcut-dispatch.ts` como regla pura (p. ej. `focusTarget: "customer" | "menu"` según un flag `menuVisible` del estado) con prueba en `shortcut-dispatch.test.ts`; las pruebas existentes no deben cambiar de resultado salvo por el nuevo campo.
- [ ] **«Sin venta» honesto.** No existe operación de API para cerrar sin venta. No inventar. Mostrar en el ticket un botón secundario «Sin venta» deshabilitado con `title`/ayuda «Disponible en un próximo corte» sólo si eso aporta claridad; si estorba, no mostrar nada. Decide y explica.
- [ ] **Ticket móvil:** en 390×844 la barra inferior no debe tapar el botón «Convertir captura en orden»: añade padding inferior al contenedor cuando la barra está visible.
- [ ] Sin `alert/confirm/prompt`; targets ≥44 px; lint, typecheck, test y build de `@super-restaurant/web` verdes.

## Archivos
- `apps/web/src/app/app/capture/capture-workspace.tsx` (grande: usa rangos/CodeGraph, busca «Transferir», «lease», «assignmentCandidates»).
- `apps/web/src/app/app/capture/capture-ticket.tsx`, `capture-menu.tsx`.
- `apps/web/src/lib/shortcut-dispatch.ts` y su prueba.

## Invariantes
- No tocar `apps/api`, `packages/*`, `supabase/*`; contratos y server actions intactos.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```

## Entorno
Worktree `C:\tmp\sr-wt\web-capture-polish` (rama `claude/web-capture-polish` desde `main`). Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`; `pnpm install --prefer-offline`, construir `packages/domain` y `packages/shared-types`. Un commit por criterio. Informe: resumen, archivos, salida literal, interacción que reproduce cada criterio. Sin push.
