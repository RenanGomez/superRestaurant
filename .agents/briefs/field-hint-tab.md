# Brief field-hint-tab (C4, nivel C)

## Objetivo
Que los botones «?» de ayuda no reciban foco con Tab.

## Alcance
- Editar SOLO `apps/web/src/components/field-hint.tsx` (botón ~línea 50).
- Prohibido: otros archivos, git commit/push.

## Contexto mínimo
Añade `tabIndex={-1}` al botón. La ayuda sigue accesible con el ratón y por `aria-describedby` si ya existe; no la quites.

## Hecho cuando
- lint y typecheck de `@super-restaurant/web` en verde; diff de 1-3 líneas.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint` y `typecheck` (tail -40). Informe en `.agents/reports/field-hint-tab.md` (≤10 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
