# Brief z4-delivery-zones-editor-ui (Editor de zonas por colonia, nivel C)

## Objetivo
Editor de zonas por colonia. Smoke r2, ola 2.

## Fuente de verdad
Z4 de `docs/architecture/DELIVERY_ZONES_V2.md` §10: `/app/delivery-zones` define cada zona eligiendo colonias (buscador con multiselección y chips, «seleccionar todas las de un CP»). El CP deja de ser el campo principal.

## Hecho cuando
Puertas web en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Prohibido: git commit/push, aplicar migraciones en remoto, tocar archivos fuera del alcance. Informe de ≤15 líneas con bloque con comando y salida real; sin evidencia = NO VERIFICADO.

## Reintento
La corrida previa murió sin cambios. Z5 ya tocó `apps/web/src/app/app/delivery-zones/delivery-zones-editor.tsx` (y `apps/web/src/lib/delivery-zones.ts`) y está en tu worktree: léelo y extiéndelo, no lo reescribas. No leas ni escribas fuera del worktree (el motor lo rechaza); guarda salidas largas con `| Select-Object -Last 40`. Termina con el informe.
