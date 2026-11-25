# Revisión 2 · m3-api-grants (nivel A, foco API/contrato)

Revisa el cambio SIN modificarlo. No ejecutes PostgreSQL ni la suite; el orquestador ya corrió typecheck, lint, tests y `verify:inventory-schema:rollback` en verde. No hagas commit ni push.

## Qué revisar
- `git diff -- apps/api/src/inventory/items.service.ts apps/api/src/inventory/items.test.ts`
- `git diff -- packages/shared-types/src/inventory.ts packages/shared-types/src/inventory.runtime.test.ts`
- `apps/api/src/inventory/items.controller.ts` (solo lectura) para confirmar el mapeo HTTP de `InventoryApplicationErrorCode`.

## Contexto
- P1 de PR #90: la API no podía escribir por falta de grants (se corrige en la migración `20261126000600`, fuera de este foco).
- P2: solo `23505` se mapeaba a conflicto y el resto caía en 503; el límite de `name` del parser (200) no coincidía con el CHECK de la tabla (160).

## Preguntas concretas
1. ¿`23503` como `conflict` y `23514` como `request` producen códigos HTTP y mensajes coherentes con el controlador y con el resto del API (sin filtrar detalles SQL)?
2. ¿El refactor de `isUniqueViolation` a `sqlState` conserva el comportamiento previo y no rompe otros llamadores?
3. ¿El parser a 160 queda alineado con la tabla y con los mensajes/validaciones existentes? ¿Falta alinear algún otro punto (por ejemplo validación de entrada del controlador)?
4. ¿Las pruebas nuevas realmente cubren el cambio y fallarían sin él?
5. ¿Algún efecto colateral en contratos compartidos consumidos por web/mobile?

## Salida
Informe corto: veredicto `APROBAR` o `CORREGIR`, y hallazgos numerados P1/P2/P3 con archivo:línea y corrección propuesta. Sin reescribir el código.
