# Brief wave1b-fixes (fix de la revisión de la Ola 1b, nivel C)

## Objetivo
Corregir 4 hallazgos de Codex (informe en la cola, `.harness/queue/review-wave1b.json`, resumido aquí):
1. `apps/web/src/app/app/capture/capture-customer-search.tsx` ~190: cada reintento genera otro `contactId` con la misma clave de idempotencia; conserva el comando completo (mismo contactId e idempotency key) entre reintentos del mismo intento y añade test del caso (extrae a `lib/` si hace falta).
2. mismo archivo ~64: al cambiar de consulta A→B→A reaparece el resultado viejo mientras se busca, y si la búsqueda falla sigue seleccionable. Invalida el resultado al cambiar la consulta y muestra el error.
3. `apps/web/src/app/app/menu/photo-crop-dialog.tsx` ~181: cancelar/desmontar durante el procesamiento no impide que la operación asíncrona llame `onConfirm` y suba la foto. Invalida con un token/flag al cancelar o desmontar y compruébalo antes de confirmar.
4. `apps/web/src/lib/menu-draft-storage.ts`: quita la línea en blanco sobrante al final (git diff --check limpio).

## Alcance
Solo esos archivos (+ tests de `lib/`). Prohibido: API, SQL, git commit/push.

## Hecho cuando
lint, typecheck, test web en verde con salida real; `git diff --check -- apps/web` limpio.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/wave1b-fixes.md` (≤12 líneas) con bloque ``` con comando y salida real.
