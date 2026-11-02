# review-shared-modifier-groups — hecha
Cambios: Revisión de sólo lectura de claude/menu-shared-modifier-groups-web-fb (40 archivos, +2833/-212 líneas).
Archivos: Ninguno modificado (sólo lectura).
Verificación: git diff --check (0 errores); inspección estática de contratos, SQL, dominio, API, mobile y web.
Riesgos/pendientes: La migración 20261101000200 contiene backfill y requiere autorización para aplicar; pendiente ampliar recuperación de fixtures en tenancy-fixture-recovery.ts.
Notas: Sin defectos P1 bloqueantes. Cumple AGENTS.md §9, §10, §11, §12, §13.

Hallazgos:
- **P2 — apps/api/src/operations/tenancy-fixture-recovery.ts:748**: `app.menu_product_modifier_groups` tiene FK compuestas con `ON DELETE RESTRICT` hacia `menu_modifier_groups` y `menu_products`. Al ejecutar recuperación de fixtures tras aplicar la migración, `deleteExactly` sobre esas tablas fallaría si no se limpian primero las asignaciones. Añadir sentencia de borrado previo para `app.menu_product_modifier_groups` por `restaurantIds`/`catalogIds`.
- **P3 — apps/web/src/app/app/menu/menu-catalog-editor.tsx:53**: el estado local `products` inicializa sin pasar por `withDerivedAssignments`. Aunque `parseMenuCatalogStateV1` ya normaliza `modifierGroupIds` en producción, inicializar con `withDerivedAssignments(state.catalog?.products ?? [], state.catalog?.modifierGroups ?? [])` previene desasignaciones accidentales si se pasa un catálogo mock desnormalizado.
- **P3 — apps/web/src/lib/menu-groups.ts:72**: `toggleGroupAssignment` asume `product.modifierGroupIds ?? []`. Si recibe un producto con la propiedad indefinida sin contexto de grupos, descarta asignaciones previas. Aceptar grupos opcionales para resolver asignaciones legadas por defecto.

Verificaciones:
1. Aislamiento (§10): FK compuestas en `app.menu_product_modifier_groups` incluyen `restaurant_id` y `catalog_id`. `confirm_capture_draft_v3` y `repeat_customer_order_into_capture` resuelven grupos mediante `assigned.restaurant_id = catalog_group.restaurant_id and assigned.catalog_id = catalog_group.catalog_id`.
2. Backfill e idempotencia (§11, §12): Backfill determinista con `on conflict do nothing` y verificación de conteo (`legacyGroups == assignments`). Trigger de compatibilidad `assign_menu_group_to_legacy_owner` asigna automáticamente inserciones legadas sin duplicados. Replay idempotente garantizado por `normalize_menu_catalog_payload`.
3. Seguridad y privilegios (§13): Funciones reemplazadas mantienen `security definer`, `set search_path = ''` y ownership `postgres`. Grants existentes preservados. Funciones nuevas revocan acceso a roles públicos.
4. Contrato y dominio (§7, §8): `MenuProductV1.modifierGroupIds` canónico con fallback; validación estricta de dueño único legado (`productId`); `validateVariants` unicidad por variante.
5. Dinero (§9): `fraction-pricing.ts` intacto; ningún cálculo monetario nuevo en clientes.
6. Web y Mobile (§14): `groupsForProduct`, `withLegacyOwners`, desasignación y limpieza de mitades al quitar grupos, duplicación sin clonación de grupos, targets de 44 px, textos en español, sin `any`, sin `alert/confirm/prompt`.
7. Invariantes SQL: `supabase/tests/menu_shared_modifier_groups_invariants.sql` encapsulado en `begin; ... rollback;` sin `commit;`.

Riesgo residual: La migración 20261101000200 contiene backfill de datos; requiere preflight y autorización humana para aplicación en base remota.

VEREDICTO: APROBAR
