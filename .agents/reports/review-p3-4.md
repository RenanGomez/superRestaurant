**VEREDICTO: CORREGIR**

- **P2 — [pizza-section.tsx:26](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/pizza-section.tsx:26>):** se excluye el mismo producto de la mitad B; no se puede pedir una pizza con ingredientes distintos por mitad si solo existe una pizza armable. **Fix:** permitir el mismo producto y probar selecciones distintas por mitad.
- **P2 — [product-sheet.tsx:198](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/product-sheet.tsx:198>):** el diálogo declara `aria-modal`, pero no contiene el foco al navegar con Tab. **Fix:** usar un diálogo accesible con contención y devolución del foco; probar teclado.
- **P3 — [product-sheet.tsx:161](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/app/app/capture/product-sheet.tsx:161>):** calcula estimaciones locales también para pizza V2, aunque luego las descarta. **Fix:** omitir esos cálculos para pizza V2.
- **NO VERIFICADO:** ejecución de pruebas, navegador, restauración real tras recargar y CodeGraph; revisión estática de solo lectura.
- **Plantilla:** AGENTS.md §10 contiene reglas de aislamiento, no una plantilla de reporte.
- **Verificación:**
```text
rg -n 'secondCandidates|wholeEstimateMinor|wholeUnitMinor|aria-modal|closeRef.current' apps/web/src/app/app/capture/pizza-section.tsx apps/web/src/app/app/capture/product-sheet.tsx
apps/web/src/app/app/capture/product-sheet.tsx:87:  useEffect(() => { closeRef.current?.focus(); }, []);
apps/web/src/app/app/capture/product-sheet.tsx:161:  const wholeEstimateMinor = estimateSelectionMinor(product, listedGroups, selections, quantity, variantId);
apps/web/src/app/app/capture/product-sheet.tsx:198:    role="dialog" aria-modal="true" aria-labelledby="product-sheet-title"
apps/web/src/app/app/capture/pizza-section.tsx:26:  const secondCandidates = otherProducts.filter((candidate) => candidate.productId !== product.productId && matchingVariantId(candidate, sizeName) !== undefined);
```