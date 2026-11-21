# Brief capture-drafts-tidy (C1, nivel C)

## Objetivo
Limpiar los borradores en Captura y arreglar la reanudación. Puntos 5, 8, 9 y 10 del smoke.

## Alcance
- Editar: `apps/web/src/app/app/capture/capture-workspace.tsx` (CW) y, si extraes helper, `apps/web/src/lib/capture-workspace.ts` + su test `capture-workspace.test.ts`.
- Prohibido: otros archivos, `apps/api`, SQL, git commit/push, cambiar el momento en que se crea el borrador (`create()`, CW ~579-585).
- Los rangos de línea son aproximados: ubica por símbolo.

## Contexto mínimo
1. Quitar folio, versión e ID del encabezado (CW ~1053-1055) y de las tarjetas de borradores recuperables (CW ~1082-1097, usan `shortCaptureDraftId`). Llevar folio y versión a una línea discreta (texto pequeño, gris) al **final** de la sección «Captura telefónica». En la tarjeta recuperable: cliente, teléfono, canal, cantidad de líneas y antigüedad, con lo que el item YA traiga. Si el item no trae cliente o líneas, no inventes nada: reporta qué campos faltan (pasarán a una tarea B `capture-draft-list-summary`).
2. Al reanudar un borrador: `recover()` (CW ~612) llama a `refreshWorkspace` (CW ~595-607), que nunca ejecuta `run("detail", {customerId})`; por eso `customer` queda `undefined` y `CaptureCustomerCard` (CW ~1157) no se pinta. Tras `refreshWorkspace`, si el snapshot tiene `customerId`, ejecutar `run("detail", {customerId})` para que reaparezcan cliente y direcciones.
3. No listar como recuperables los borradores sin cliente ni líneas. Si la lista no expone esos datos, repórtalo; no cambies API.

## Hecho cuando
- lint, typecheck y test de `@super-restaurant/web` en verde; test unitario del helper que decide si un borrador «vale la pena» (si lo extraes a `lib/capture-workspace.ts`).

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Sin alert/confirm/prompt; targets táctiles de 44 px. Corre las puertas desde `apps/web` con `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test` una vez al final (filtra con tail -40). Si levantas un servidor/proceso, ciérralo antes del informe. Informe en `.agents/reports/capture-drafts-tidy.md` (≤15 líneas) con un bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
