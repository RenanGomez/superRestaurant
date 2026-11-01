# menu-shared-modifier-groups-web · terminar la capa web de los grupos de modificadores compartidos

Nivel A (capa web del paquete `menu-shared-modifier-groups`) · Capa L2 Codex (`tools/agentic/codex-task.ps1 -Task menu-shared-modifier-groups-web -Packet .claude/packets/menu-shared-modifier-groups-web.md -Base claude/menu-shared-modifier-groups -Effort high`) · rama de trabajo: la del worktree que crea el lanzador, desde `claude/menu-shared-modifier-groups` (que ya contiene contratos+dominio, SQL+invariantes+verificador, API y mobile, más un commit `wip(menu-web)` con la capa web a medias).

## Lee primero
1. `.claude/packets/menu-shared-modifier-groups.md` (paquete completo) y `.claude/packets/menu-modifier-model-v2-research.md`.
2. `git log main..HEAD --stat` y `git show HEAD` para ver el `wip(menu-web)`: `apps/web/src/lib/menu-groups.ts` (+test), `menu-removal.ts`, `menu-duplicate.ts`, `line-halves.ts`, `menu-catalog-editor.tsx`, `capture-menu.tsx`, `capture-workspace.tsx`, `apps/web/package.json`.
3. El contrato ya integrado en esa rama: `MenuProductV1.modifierGroupIds` (canónico) y `MenuModifierGroupV1.productId: string | null` (legado), parsers en `packages/shared-types/src/index.ts`; `packages/domain/src/menu.ts` valida la relación por `modifierGroupIds`.
4. `AGENTS.md` §7, §9, §14, §19.2.

## Objetivo de esta capa
- `/app/menu` tiene una sección propia «Grupos de modificadores» (crear, editar nombre/mín/máx/opciones con foto, duplicar, quitar). Quitar un grupo asignado a productos pide confirmación con el `RemovalDialog` existente y lo desasigna de todos.
- En la tarjeta de producto, la casilla «Grupos de modificadores» abre un desplegable multiselección (lista de casillas, targets de 44 px, `aria-checked`, búsqueda si hay más de 8 grupos) con los grupos del catálogo; el producto guarda `modifierGroupIds`. Los grupos legados con `productId` se muestran preseleccionados en ese producto.
- «Duplicar producto» copia `modifierGroupIds`, no crea grupos nuevos.
- `product-sheet.tsx`, `line-halves.ts`, `menu-fraction.ts`, `capture-selection.ts` y `capture-menu.tsx` resuelven los grupos de un producto con un único helper `groupsForProduct(product, groups)` (en `apps/web/src/lib/menu-groups.ts`): `modifierGroupIds` si existe, si no, grupos con `productId === product.productId`.
- Mitades: el selector «Grupo de sabores» y «Grupo de ingredientes» de la fracción ofrecen sólo los grupos asignados al producto.
- El `draft` enviado a `saveMenuCatalogAction` incluye `modifierGroupIds` por producto y conserva `productId` en los grupos sólo cuando ya existía (legado); los grupos nuevos nacen con `productId: null`.
- Borrador local (`menu-draft-storage.ts`) acepta borradores antiguos sin `modifierGroupIds`.

## Invariantes
Sin `any`; LF (respeta CRLF donde ya exista); textos en español; sin `alert/confirm/prompt`; targets ≥ 44 px; ningún cálculo de dinero en cliente; no tocar `apps/api`, `packages/*`, SQL ni `apps/mobile` (ya están hechos en la rama); no tocar `capture-customer.tsx`.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`; construye `packages/shared-types` y `packages/domain` antes del typecheck)
- `pnpm turbo run lint typecheck test build --filter=@super-restaurant/web` en verde, incluidos `menu-groups.test.ts`, `menu-removal.test.ts`, `menu-duplicate.test.ts`, `line-halves*.test.ts`, `capture-selection.test.ts`, `menu-fraction.test.ts`.
- Añade tests para `groupsForProduct` (canónico, legado, ambos, vacío) y para la desasignación al quitar un grupo.
- Navegador: sin sesión Playwright; documenta la brecha.

## Formato de salida
Resumen, archivos, salida literal de las puertas, brecha, riesgos, decisiones. Commits locales `feat(menu-web): …` sobre la rama del worktree. Sin merge ni push.

## Traspaso del implementador anterior (commit `2c2d010`, sólo typecheck ejecutado; lint/test/build de web NO se corrieron)
Pendiente concreto:
- `menu-groups.test.ts` y `menu-removal.test.ts`: los tests nuevos (`duplicateGroup`, `withDerivedAssignments`, `unassignGroup`) están declarados antes de las constantes auxiliares; moverlos al final y correrlos.
- `menu-draft-storage.ts` + test: el parser de borradores no conoce `modifierGroupIds`; el editor compensa con `withDerivedAssignments`. Añadir tests: borrador viejo se recupera; borrador nuevo conserva las listas.
- Fixtures con `productId` en `capture-selection.test.ts`, `line-halves.test.ts`, `capture-workspace.test.ts`, `capture-quote.test.ts`, `order-detail.test.ts`, `menu-catalog.test.ts`: el parser rechaza un grupo con dueño legado que el producto no lista → añadir `modifierGroupIds` a esos productos.
- `menu-fraction.ts`: test de que migrar mitades legadas no deja referencia a un grupo no asignado. `menu-variants.ts`: recibe el `Set` de ids asignados; test. `product-sheet.tsx`, `capture-selection.ts`: confirmar que no filtran por `productId`. `order-detail-panel.tsx`: si sus grupos salen de `catalog.modifierGroups.filter(productId)`, pasar a `groupsForProduct`.
- Verificación visual pendiente (sin sesión): sección «Grupos de modificadores», desplegable (`role="menu"`, `menuitemcheckbox` con `aria-checked`, 44 px, Escape y clic fuera cierran), duplicar grupo, quitar grupo asignado con `RemovalDialog`.
Decisiones ya tomadas (respetarlas):
1. `MenuProductV1.modifierGroupIds` canónico; `MenuModifierGroupV1.productId` dueño legado opcional (`null` si compartido). Regla: si `productId` no es nulo, ese producto debe listarlo y ningún otro; payload viejo deriva la lista por `displayOrder`, `groupId`.
2. `withLegacyOwners` al guardar: `productId` sólo si exactamente un producto lo ofrece; `null` si compartido o sin asignar (móviles viejos siguen leyendo `productId`).
3. Quitar un grupo lo borra del catálogo, de todas las listas y vacía las mitades que apuntaban a él. Quitar producto/categoría ya no borra grupos.
4. `duplicateProduct(product, newId)` copia ids de grupo y no clona grupos; su firma cambió (ya no recibe ni devuelve `groups`).
5. Tipo de remoción `groups` ahora desasigna sin borrar; sólo lo usan la librería y sus tests.
6. SQL ya hecho en la rama: migración `20261101000200_menu_shared_modifier_groups.sql`, tabla `app.menu_product_modifier_groups`, trigger de compatibilidad para inserts con `product_id`, `confirm_capture_draft_v3` y `repeat_customer_order_into_capture` reescritas; prueba estática en `apps/api/src/schema-contract.test.ts`.
7. Dominio: `ModifierGroupCatalog.productId` opcional/nullable; `validateVariants` exige `groupId` único sólo dentro de cada variante.
