# api-capture-lines · subunidad 1: contrato

## Tarea
api-capture-lines-1-contract · capa: L1 (`implementer-claude`) · riesgo: moderado · nivel A (contrato compartido consumido por web y API). Subunidad 1 de 4 del paquete padre `.claude/packets/api-capture-lines.md` (léelo para el objetivo global; aquí sólo se implementa el contrato).

## Objetivo
Añadir a `packages/shared-types` los tipos y parsers exactos del plan de selección de líneas desde catálogo y del comando que lo reemplaza sobre un borrador de captura. Nada más: sin API, sin SQL, sin web.

## Criterios de aceptación (verificables)
- [ ] En `packages/shared-types/src/commercial-capture.ts` (o un archivo hermano `capture-selection-plan.ts` reexportado desde `index.ts`, si `commercial-capture.ts` ya supera 900 líneas):
  - `CAPTURE_SELECTION_PLAN_SCHEMA_VERSION = 1`.
  - `CaptureSelectionModifierSelectionV1 { optionId: uuid; quantity: int 1..100 }`.
  - `CaptureSelectionModifierGroupV1 { groupId: uuid; selections: readonly CaptureSelectionModifierSelectionV1[] (0..50, optionId sin duplicados) }`.
  - `CaptureSelectionLineV1 { lineId: uuid; productId: uuid; quantity: int 1..1000; modifierGroups: readonly CaptureSelectionModifierGroupV1[] (0..50, groupId sin duplicados); note: string|null (boundedText 1..200) }`.
  - `CaptureSelectionPlanV1 { schemaVersion: 1; catalogVersion: uuid; lines: readonly CaptureSelectionLineV1[] (0..200, lineId sin duplicados) }` (0 líneas = vaciar el plan).
  - `ReplaceCaptureSelectionPlanCommandV1 extends CaptureVersionedMutationInputV1 { attentionLeaseId: uuid; plan: CaptureSelectionPlanV1 }` con las mismas claves comunes que `parseConfirmCaptureDraftCommandV2` usa (`VERSIONED_KEYS`, `parseMutationInput`).
  - Parsers `parseCaptureSelectionPlanV1(value: unknown)` y `parseReplaceCaptureSelectionPlanCommandV1(value: unknown)` con `exactRecord`/`own`/`uuid`/`integer`/`boundedText` del mismo archivo: rechazan claves extra o faltantes, prototipos no planos, duplicados, `quantity` no entero; devuelven objetos congelados (`Object.freeze` profundo como el resto del archivo).
  - Proyección de lectura para el workspace: `CaptureSelectionPlanProjectionV1 { schemaVersion: 1; catalogVersion: uuid; currency: string(3); subtotalMinor: int ≥0; lineCount: int ≥0; lines: readonly { lineId; productId; productName: string; quantity; unitPriceMinor: int ≥0; lineTotalMinor: int ≥0; note: string|null; modifiers: readonly { groupId; optionId; name: string; quantity; unitPriceMinor: int ≥0 }[] }[] }` con `parseCaptureSelectionPlanProjectionV1`. Todos los importes son enteros en minor units; ningún float.
- [ ] Exportar todo desde `packages/shared-types/src/index.ts` siguiendo el patrón existente.
- [ ] Pruebas `node:test` en el archivo de pruebas correspondiente (`commercial-capture.test.ts` o nuevo): acepta el caso válido mínimo y el máximo; rechaza clave extra, `lineId` duplicado, `groupId` duplicado, `optionId` duplicado, `quantity` 0, `quantity` 1.5, `note` vacía o con control chars, `catalogVersion` no uuid, `schemaVersion` 2, prototipo `Object.create({})`, `subtotalMinor` negativo o float.
- [ ] `pnpm --filter @super-restaurant/shared-types test|typecheck|lint` verdes y `pnpm --filter @super-restaurant/api typecheck` + `pnpm --filter @super-restaurant/web typecheck` sin cambios (el contrato es aditivo).

## Archivos de entrada
- `C:\tmp\sr-wt\api-capture-lines\packages\shared-types\src\commercial-capture.ts`: helpers `exactRecord`(872-888), `own`(890), `uuid`(915), `integer`(919), `boundedText`(929), `timestamp`(940); `ConfirmCaptureDraftCommandV2` (125-131) y `parseConfirmCaptureDraftCommandV2` (434-465) como patrón de comando versionado; `VERSIONED_KEYS`, `parseMutationInput`, `CaptureVersionedMutationInputV1` (búscalos con CodeGraph).
- `C:\tmp\sr-wt\api-capture-lines\apps\api\src\capture-repeat-order-plan.ts` (17-33, 105-140): forma de `modifierGroups`/`selections` que el API ya consume; el nuevo contrato debe ser estructuralmente compatible con `createMenuProductPriceSnapshot(domainCatalog, {...}, line.modifierGroups)`.
- Pruebas existentes de `commercial-capture` como patrón.

## Invariantes que NO deben cambiar
- Parsers exactos que rechazan, nunca corrigen; nada de `any`; objetos congelados.
- No modificar contratos existentes ni sus parsers; sólo añadir.
- Dinero como enteros en minor units; nunca precios enviados por el cliente en el comando (el comando lleva ids y cantidades; los importes sólo existen en la proyección de lectura).

## Fuera de alcance
- Endpoint, servicio, SQL, web, materialización de Order (subunidades 2-4).

## Verificación
```bash
pnpm --filter @super-restaurant/shared-types test
pnpm --filter @super-restaurant/shared-types typecheck
pnpm --filter @super-restaurant/shared-types lint
pnpm --filter @super-restaurant/shared-types build
pnpm --filter @super-restaurant/api typecheck
pnpm --filter @super-restaurant/web typecheck
```

## Entorno
Worktree `C:\tmp\sr-wt\api-capture-lines`, rama `claude/api-capture-lines`. Node 24 y pnpm 11 en `%LOCALAPPDATA%\Programs\node24` (anteponer al PATH). `pnpm install --prefer-offline` si falta `node_modules`. Un commit `feat(shared-types): add capture selection plan contract`. Sin push.

## Formato de salida esperado
1. Resumen (3-6 líneas) y forma final exportada (lista de nombres).
2. Archivos tocados y commit.
3. Salida literal de los comandos.
4. Dudas (p. ej. límites elegidos).
