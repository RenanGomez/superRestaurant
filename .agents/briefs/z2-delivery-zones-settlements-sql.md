# Brief z2-delivery-zones-settlements-sql (Zonas por colonia: SQL, nivel A)

## Objetivo
Zonas por colonia: SQL. Smoke r2, ola 2.

## Fuente de verdad
Implementa Z2 de `docs/architecture/DELIVERY_ZONES_V2.md` (§3, §4, §7, §9.2, §10): migración NUEVA con catálogo global de asentamientos, relación zona↔asentamiento, settlementId en dirección, cuota manual con autorización y auditoría; seed desde `supabase/seed-data/navojoa-settlements.csv` (usa `etiqueta`); invariantes y aislamiento en `supabase/tests/`.

## Hecho cuando
Migración reproducible y tests SQL escritos; ejecución rollback-only si hay Postgres local, si no NO VERIFICADO.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Prohibido: git commit/push, aplicar migraciones en remoto, tocar archivos fuera del alcance. Informe de ≤15 líneas con bloque con comando y salida real; sin evidencia = NO VERIFICADO.

## Reintento
Una corrida previa dejó `supabase/migrations/20261121000100_delivery_zones_settlements.sql` (1454 líneas) sin terminar y sin seed ni invariantes. Revísala y CONTINÚA desde ella (no la reescribas). Escribe solo dentro del worktree (nada en carpetas temporales, no generes scripts Python fuera del repo; usa Edit/Write directo). Entrega migración, seed e invariantes completos y el informe.
