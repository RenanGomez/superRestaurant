# review-shared-modifier-groups — revisión de sólo lectura (segunda familia) de la rama `claude/menu-shared-modifier-groups-web-fb`
Agente: Gemini   Nivel de rigor: A   Complejidad: Compleja

## Objetivo
Revisar `git diff main...claude/menu-shared-modifier-groups-web-fb` del repo (ejecuta ese comando desde la raíz; no edites nada) contra `.claude/packets/menu-shared-modifier-groups.md`, `.claude/packets/menu-shared-modifier-groups-web.md` y AGENTS.md §9 (dinero), §10 (aislamiento), §11 (compatibilidad), §12 (migraciones), §13.

## Archivos (sólo lectura)
- Todo el diff; en especial `supabase/migrations/20261101000200_menu_shared_modifier_groups.sql`, `supabase/tests/menu_shared_modifier_groups_invariants.sql`, `packages/shared-types/src/index.ts`, `packages/domain/src/menu.ts`, `packages/domain/src/configured-catalog.ts`, `apps/api/src/menu-catalog*.ts`, `apps/mobile/src/order-draft.ts`, `apps/web/src/lib/menu-groups.ts`, `apps/web/src/app/app/menu/menu-catalog-editor.tsx`.

## Tarea
1. Aislamiento: todas las FK de `app.menu_product_modifier_groups` incluyen `restaurant_id` y `catalog_id`; `confirm_capture_draft_v3` y `repeat_customer_order_into_capture` resuelven grupos sólo del mismo restaurante/catálogo.
2. Backfill: determinista, idempotente (`on conflict do nothing`), conteo antes/después, sin tocar snapshots de OrderItem; el trigger de compatibilidad no crea asignaciones duplicadas ni cruza restaurantes.
3. Funciones reemplazadas con `create or replace`: conservan `security definer`, `set search_path = ''`, owner y grants de la versión vigente (`20261101000100`, `20261008000200`).
4. Contrato/dominio: regla del dueño legado (si `productId` no nulo, ese producto lo lista y ningún otro); payload viejo deriva la lista; parser estricto; `validateVariants` único por variante.
5. Dinero: el precio de mitades no cambia (`fraction-pricing.ts`), ningún cálculo nuevo en web/mobile.
6. Web/mobile: `groupsForProduct` con fallback; `withLegacyOwners`; quitar grupo desasigna y vacía mitades; duplicar copia ids; sin `any`, sin alert/confirm/prompt, textos en español.
7. Invariantes SQL: empiezan en `begin;`, terminan en `rollback;`, sin `commit`.

## Restricciones
- No modificar archivos, no instalar, no red, no base de datos.

## Formato de salida
Hallazgos P1/P2/P3 con archivo:línea y propuesta concreta; cierre `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR`. Reporte §8 en `.agents/reports/review-shared-modifier-groups.md`, máximo 80 líneas.
