# Brief z3-delivery-zones-settlements-api (Zonas por colonia: API y dominio, nivel A)

## Objetivo
Zonas por colonia: API y dominio. Smoke r2, ola 2.

## Fuente de verdad
Z3 de `docs/architecture/DELIVERY_ZONES_V2.md` (§5, §6, §8, §9.1, §9.3, §10): `packages/domain/src/delivery-zone.ts`, `delivery-quote.ts`, `apps/api/src/delivery-zones.ts`, shared-types y contract tests; búsqueda por prefijo, validación con motivo exacto, cuota manual.

## Hecho cuando
lint, typecheck y test de domain, shared-types y api en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Prohibido: git commit/push, aplicar migraciones en remoto, tocar archivos fuera del alcance. Informe de ≤15 líneas con bloque con comando y salida real; sin evidencia = NO VERIFICADO.

## Reintento 2
Dos corridas previas murieron a medias; el worktree ya tiene código de dominio y API en curso: CONTINÚA desde ahí, no reescribas. NO redirijas salida a `$env:TEMP` ni leas fuera del worktree (el motor lo rechaza y la corrida muere). Si necesitas guardar la salida de una prueba larga, escríbela dentro del worktree (p. ej. `.tmp-z3.log`, bórralo al final) o recórtala con `| Select-Object -Last 40`. Termina con el informe.
