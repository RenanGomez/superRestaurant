VEREDICTO: APROBAR
0 P1; 2 P2 y 2 P3 a deuda (no habilitan un verde falso de inventario).
P2 apps/web/e2e/journeys/journey-13-inventario.spec.ts:63 — `halvesPlan` llama `effectiveHalvesSetup(product, undefined)`; el setup legacy por tamaño (conservado por 20261008000200 para productos con tamaños de configuración distinta) nunca produce `fraction`, así que el camino de mitades no se ejerce. Pasar el variantId elegido (como product-sheet.tsx:135).
P2 ...:338 — turno ausente lanza `Error`; el criterio 1 lo lista como skip y `requireActiveShift` (journey-test.ts:186-192) ya hace `test.skip`. Usar el helper.
P2 ...:250-251,400-406 + fixtures/journey-api.ts:615-618 — la restauración re-publica solo `lines`; `notes` está en el summary (shared-types/src/inventory.ts:91) pero `RecipeVersionV1` no lo expone (inventory.ts:78-85) y `publishInventoryRecipe` no lo envía: una receta previa con notas queda sin ellas. Filtrar candidatos con `notes === null` o conservarlas; sin receta previa solo hay `console.warn` (402), sin documentar.
P3 ...:470,544 — `toContainText(formatInventoryNumber(...))` evalúa todo el `<tr>`; el nombre del insumo contiene los dígitos del runId, así que puede pasar sin que la celda de saldo sea la correcta. Anclar la celda de cantidad exacta.
Verificación:
```powershell
git grep -n 'effectiveHalvesSetup(product as never\|No hay turno operativo abierto\|restaurar la receta previa\|toContainText(formatInventoryNumber' harness/m3-e2e-journey -- apps/web/e2e/journeys/journey-13-inventario.spec.ts
harness/m3-e2e-journey:apps/web/e2e/journeys/journey-13-inventario.spec.ts:63:  const setup = effectiveHalvesSetup(product as never, undefined);
harness/m3-e2e-journey:apps/web/e2e/journeys/journey-13-inventario.spec.ts:338:    throw new Error(`No hay turno operativo abierto para el run ${runId}; ábrelo en Caja antes de correr el journey`);
harness/m3-e2e-journey:apps/web/e2e/journeys/journey-13-inventario.spec.ts:400:  cleanup.add("restaurar la receta previa del producto del journey 13", async () => {
harness/m3-e2e-journey:apps/web/e2e/journeys/journey-13-inventario.spec.ts:470:  await expect(balanceAfterSale).toContainText(formatInventoryNumber(afterSale));
harness/m3-e2e-journey:apps/web/e2e/journeys/journey-13-inventario.spec.ts:544:  await expect(balanceAfterCancel).toContainText(formatInventoryNumber(restored));
```