I'll review the code as instructed. Let me read the files and diff.
**m3-rev-web-recetas · nivel C — VEREDICTO: APROBAR** (0 P1; P2/P3 a `docs/agentic/debt.md`)

Revisado: `recipes-panel.tsx` (nuevo) y el commit `071a7bb6` (actions, inventory-workspace, inventory-ui + tests).
1. POST: OK. `actions.ts:168-180` envía `{lines,modifierId,notes,productId,restaurantId}` con el `restaurantId` del scope de cookie/sucursal; el contrato exacto está en `packages/shared-types/src/inventory.ts:549-605`, el API responde solo `{restaurantId,recipeId,productId,version,lines}` (`recipes.service.ts:87-93`) y el panel recarga desde el servidor con `versionsReload` (`recipes-panel.tsx:194-198`).
2. Editor: OK. `validateRecipeLineDrafts` exige ≥1 línea, cantidad entera ≥1, unidad válida y sin insumo repetido (`inventory-ui.ts:196-214`; casos en `inventory-ui.test.ts:207-215`); la unidad se toma del insumo al elegirlo (`recipes-panel.tsx:351-357`); botón deshabilitado con `saving` y error `role="alert"` dentro del modal (`:536,:551,:554`).
3. A11y: OK. Modal con `role="dialog"`, `aria-modal`, `aria-labelledby`, foco atrapado, Escape y retorno de foco (`inventory-modal.tsx:59-70`); activa/histórica se distinguen por texto «Activa»/«Histórica» (`inventory-ui.ts:222-224`), sin UUIDs ni `alert/confirm/prompt`.
4. `?tab=`: intacto. `INVENTORY_TABS`/`parseInventoryTab` incluyen `recetas` (`inventory-ui.ts:8-29`) y las pestañas previas siguen resolviéndose (`page.tsx:37-39`).

Hallazgos: **P2** `recipes-panel.tsx:313,335` — el bloque «Receta en edición» se renderiza también sin `canManage` (solo se ocultan los botones): un lector ve una copia deshabilitada y «Agrega al menos un insumo…»; envolver en `canManage &&`. **P2** proceso §19.5 — el commit no actualiza `docs/smoke/*` ni TODO/HANDOFF. **P3** `:140-141` un fallo de `readRecipe` de la versión activa escribe `versionsError` y simula que falló la lista; `:522-530` `setSaving(false)` tras `onPublished()` actualiza un diálogo ya desmontado; `:272` el título de la versión activa es `<strong>` y su `<section>` no tiene nombre accesible; `:381-383` frente a `:211` muestra la unidad del insumo pero publica `draft.unitCode`; publicar no lleva guarda de versión (última escritura gana, deuda de contrato).

Evidencia:
```
$ git show --name-only --format= 071a7bb6
apps/web/src/app/app/inventario/actions.ts
apps/web/src/app/app/inventario/inventory-workspace.tsx
apps/web/src/app/app/inventario/recipes-panel.tsx
apps/web/src/lib/inventory-ui.test.ts
apps/web/src/lib/inventory-ui.ts
```
NO VERIFICADO: lint, typecheck, unitarias y navegador real (el brief prohíbe ejecutar; solo usé lectura y `git show`/`Select-String`).