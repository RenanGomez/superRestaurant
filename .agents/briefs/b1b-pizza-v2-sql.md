# Brief b1b-pizza-v2-sql (Pizza v2 delta: SQL, nivel A)

## Objetivo
Pizza v2 delta: SQL. Smoke r2, ola 2.

## Fuente de verdad
Capa B1b de `docs/architecture/PIZZA_MODEL_V2.md` §5 y §7. Editar en sitio `supabase/migrations/20261120000100_pizza_model_v2.sql` y `supabase/tests/pizza_model_v2_invariants.sql` (la migración NO está aplicada en remoto; confirmado en HANDOFF 2026-11-20). Incluye pertenencia de opciones a grupos asignados en `save_menu_catalog` (deuda de P3-2). Debe seguir el contrato de B1a.

## Hecho cuando
Invariantes SQL cubren las reglas de B1a y la pertenencia a grupos. Si hay Postgres local, ejecútalo rollback-only; si no, NO VERIFICADO (lo corre el orquestador contra remoto rollback-only).

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Prohibido: git commit/push, aplicar migraciones en remoto, tocar archivos fuera del alcance. Informe de ≤15 líneas con bloque con comando y salida real; sin evidencia = NO VERIFICADO.
