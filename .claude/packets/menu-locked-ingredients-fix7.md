# menu-locked-ingredients-fix7 · las invariantes fallan al crear la captura de prueba (`LOCKED_INGREDIENTS_CAPTURE_CREATE_FAILED`, línea 235)

Nivel A · Codex (`tools/agentic/codex-task.ps1 -Task menu-locked-ingredients-fix7 -Packet .claude/packets/menu-locked-ingredients-fix7.md -Base codex/menu-locked-ingredients-fix6 -Effort medium`). Sólo `supabase/tests/menu_locked_ingredients_invariants.sql`. La migración ya pasa en remoto (incluido `save_menu_catalog` con payload nuevo): **no la toques**. El orquestador hace el commit si el sandbox no puede.

## Fallo observado (ejecución remota con rollback)
`P0001 LOCKED_INGREDIENTS_CAPTURE_CREATE_FAILED` — `inline_code_block line 235 at RAISE`. Es decir, la llamada a la función de creación de captura del fixture devolvió algo distinto de lo esperado y el bloque lanza su excepción propia sin mostrar el estado devuelto.

## Tarea
1. Localiza la llamada que precede al `raise` de la línea ~235 (creación del borrador de captura: `create_capture_draft`/`open_capture_draft` o equivalente, y la posterior `replace_capture_selection_plan`). Compara **argumento por argumento** (orden, tipos, `schemaVersion`, `scope`, `channel`, `fulfillment`, `deviceId`, `eventId`, `idempotencyKey`, `occurredAt`, versión esperada, `leaseSeconds`, etc.) con la misma llamada en `supabase/tests/catalog_halves_product_level_invariants.sql` y en `supabase/tests/menu_shared_modifier_groups_invariants.sql`, que sí funcionan contra la base, y con la firma vigente de la función en la última migración que la define (grep `create or replace function app_private.<nombre>`).
2. Comprueba también los prerequisitos que esas funciones validan: membresía activa del actor en la sucursal (`app.memberships` con rol permitido), turno operativo abierto (`operational_shifts.status = 'open'`), catálogo publicado/activo para la sucursal (versión y `catalog_id` coherentes con lo que guardó `save_menu_catalog` en el propio bloque), restaurante con `time_zone`.
3. Cambia todos los `raise exception '…_FAILED'` del archivo para que incluyan el estado devuelto: `raise exception 'LOCKED_INGREDIENTS_CAPTURE_CREATE_FAILED: %', result;` (o `status`/`state`), de modo que la siguiente ejecución remota muestre la causa real.
4. Mantén `begin;`/`rollback;`, sin `commit`. Commit `test(db): fix capture fixture call and surface statuses in locked ingredients invariants`.

## Salida
Qué argumento o prerequisito faltaba; hash o motivo de no commitear.
