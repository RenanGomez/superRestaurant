**VEREDICTO: CORREGIR**

- **P2 — [capture-selection-plan.ts:337](<C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/packages/shared-types/src/capture-selection-plan.ts:337>):** la proyección sigue agregando `pizza` a la respuesta V1; el parser anterior exige claves exactas y rechazará esas líneas. Versionar o negociar la proyección y probar un cliente anterior.
- Primera ronda: se corrigieron en código la selección del mismo producto para ambas mitades, la contención y devolución del foco, el cálculo local V2, los IDs duplicados o solapados y la prioridad de la proyección del servidor.
- **NO VERIFICADO:** pruebas ejecutadas, navegador, aislamiento entre tenants y CodeGraph; revisión estática. AGENTS.md §10 no contiene una plantilla de informe.
- Verificación:
```text
git show HEAD:packages/shared-types/src/capture-selection-plan.ts | Select-String -Pattern 'const record = exactRecord\(value, projectionKeys\)' -Context 0,1
>   const record = exactRecord(value, projectionKeys) ?? exactRecord(value, [...projectionKeys, "halves"]);
    if (record === undefined) return undefined;
```