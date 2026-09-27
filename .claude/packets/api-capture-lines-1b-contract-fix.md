# api-capture-lines · subunidad 1b: correcciones del contrato tras revisión

## Tarea
api-capture-lines-1b-contract-fix · capa: L1 (`implementer-claude`) · riesgo: moderado · nivel A. Corrige el commit `b78c820` (`packages/shared-types/src/capture-selection-plan.ts`) según `codex exec review`.

## Hallazgos a corregir
1. **[P1] Identidad de variante.** El catálogo configurado (S5, `packages/shared-types/src/configured-catalog.ts`: `ConfiguredProductVariantV2.variantId`, `ResolveConfiguredProductSelectionV2` exige `variantId`) no puede representarse con sólo `productId`. Decisión del orquestador: el plan de selección se valida hoy contra `MenuCatalogV1` (lo que consume `confirm_capture_draft_v3`), pero el contrato debe ser compatible hacia adelante. Añade a `CaptureSelectionLineV1` y a `CaptureSelectionPlanProjectionLineV1` el campo `variantId: string | null` (uuid o `null`; `null` significa producto sin variantes del catálogo legado). El parser lo exige presente (clave obligatoria, valor nullable), igual que `tableId` en `parseConfirmCaptureDraftCommandV2`.
2. **[P2] Arrays.** `denseArray` + `for...of` permite que un iterador personalizado o un accessor cambien el número de elementos o lancen. Copia y valida los elementos propios antes de parsear, con el mismo patrón `exactArray`/`parsedArray` de `configured-catalog.ts` (líneas 445-470): comprobar prototipo `Array.prototype`, `length` entero seguro dentro del máximo, claves sólo índices, descriptores de datos enumerables. Aplica a `lines`, `modifierGroups`, `selections` y `modifiers` de la proyección.

## Criterios de aceptación
- [ ] Pruebas nuevas en `capture-selection-plan.runtime.test.ts`: `variantId` ausente → rechaza; `variantId: null` → acepta; `variantId` uuid → acepta y se conserva; array con iterador personalizado que produce menos elementos → rechaza (o parsea exactamente los elementos propios; el resultado debe ser determinista y documentado en la prueba); array con getter que lanza → devuelve `undefined` sin propagar la excepción; array con hueco (`[ , x]`) → rechaza.
- [ ] `pnpm --filter @super-restaurant/shared-types test|typecheck|lint|build`, `pnpm --filter @super-restaurant/api typecheck`, `pnpm --filter @super-restaurant/web typecheck` en verde (construye `packages/domain` antes si falta `dist`).
- [ ] Un commit `fix(shared-types): add variantId and exact array parsing to capture selection plan`. Sin push.
- [ ] No tocar SQL ni API. Si la subunidad 2 ya dejó la migración, no la edites: el JSON guardado es opaco para SQL salvo el conteo de líneas.

## Entorno
Worktree `C:\tmp\sr-wt\api-capture-lines`, rama `claude/api-capture-lines`. Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`.

## Formato de salida
Resumen, archivos y commit, salida literal de los comandos, dudas.
