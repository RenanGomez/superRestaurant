**VEREDICTO: CORREGIR**

- **P2 — [capture-selection-plan.ts:336](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/packages/shared-types/src/capture-selection-plan.ts:336>):** añadir `pizza` a la respuesta V1 rompe a clientes anteriores: su parser exige claves exactas y rechaza la línea. Versionar o negociar la proyección y probar un cliente anterior.
- **P2 — [capture-selection-plan.ts:376](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/packages/shared-types/src/capture-selection-plan.ts:376>):** el parser de proyección acepta IDs duplicados y solapados entre roles, aunque el parser de entrada los rechaza. Unificar invariantes y añadir pruebas negativas.
- **P2 — [line-halves.ts:268](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/apps/web/src/lib/line-halves.ts:268>):** el mapa local prevalece sobre la proyección del servidor; una selección local desactualizada puede restaurarse y enviarse en una edición posterior. Priorizar la respuesta confirmada y probar ese caso.
- **NO VERIFICADO:** ejecución de pruebas, aislamiento entre restaurantes y sucursales, navegador y CodeGraph; revisión estática de solo lectura.
- **Plantilla:** AGENTS.md §10 contiene reglas de aislamiento, no una plantilla de informe.
- **Verificación:**
```text
git show HEAD:packages/shared-types/src/capture-selection-plan.ts | Select-String -Pattern 'const record = exactRecord\(value, projectionKeys\)' -Context 0,1
>   const record = exactRecord(value, projectionKeys) ?? exactRecord(value, [...projectionKeys, "halves"]);
    if (record === undefined) return undefined;
```