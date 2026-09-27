# Paquete de contexto: S5.1 Precios por fracciones de pizza

## Tarea
s5-1-fraction-pricing · capa: L1 (implementer-claude) · riesgo: alto (dinero)

## Objetivo
Implementar S5.1 pricing rules como funciones de dominio puro en `packages/domain`, capturando las 8 decisiones aprobadas por Emmanuel el 2026-09-26: política max-price, geometría entera/mitades, cobro de extras diferenciado por alcance con redondeo hacia arriba, exclusiones sin cambio de precio, sustituciones de combo, especialidades como sabores, límite 5 extras con override de gerente, y autoridad de agotados por Branch. Producir snapshot congelado por línea (nombre, base, fracción breakdown, extras con fracción y monto cobrado, exclusiones sin delta, sustituciones con surcharge, total en Money minor units) usable por OrderItem sin re-lectura de catálogo.

## Criterios de aceptación (verificables)

- [ ] Función dominio puro `resolveFractionPricing(variant, selections, context) → OrderItemPriceSnapshot | ResolutionIssues` rechaza fracciones >2 (solo whole/halves v1) y devuelve snapshot con linajes de precio exactos en minor units sin float
- [ ] Precio fracción = max(selectedFractionPrices), probado con 3+ combinaciones (mitad A=$10, mitad B=$15 → $15)
- [ ] Extra whole cobrado 100%; mismo extra en mitad 50% redondeado HACIA ARRIBA: 1 menor → 1, 3 → 2 (vía `multiplyRatio(1n, 2n, "ceil")`)
- [ ] Exclusión de incluida no reduce línea; snapshot extra/exclusiones tiene `.quantity = 0` o marca explícita sin delta amountMinor
- [ ] Combo substitución gratis dentro grupo; surcharge explícito $X fuera grupo; snapshot preserva groupId y delta
- [ ] Especialidades no crean producto separado; snapshot refiere opción/receta dentro de `variantId` único
- [ ] Máximo 5 extras per fracción; exceso rechaza o requiere `overrideReason: string` solo si actor es manager
- [ ] Agotados: opción/variante marcada `active=false` por Branch supervisor bloquea; no hay por estación en v1
- [ ] Snapshot OrderItemPriceSnapshot inmutable (Object.freeze), incluye `catalogVersion`, `modifiers[]` congelado, `fractionBreakdown?: { fraction, amount }`
- [ ] Reivindicación: historical snapshot nunca se re-precisa desde catálogo; snapshot almacenado es autoridad inmutable

## Archivos de entrada

- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\domain\src\money.ts (líneas 1–147): Money.multiplyRatio, rounding modes, BigInt arithmetic
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\domain\src\order-totals.ts (líneas 1–70): ModifierPriceSnapshot, OrderItemPriceSnapshot, TaxSnapshot estructura
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\shared-types\src\configured-catalog.ts (líneas 1–400): ConfiguredVariantGroupV2, ConfiguredVariantOptionV2, ConfiguredProductVariantV2, schemas v2
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\docs\architecture\P2_CONFIGURABLE_CATALOG_SLICE.md (líneas 205–214): 8 decisiones aprobadas §7.1
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\domain\src\configured-catalog.ts (líneas 16–181): ValidatedConfiguredCatalogRelease, validateConfiguredCatalogRelease

## Símbolos relevantes

| Archivo | Símbolo | Por qué importa |
|---|---|---|
| money.ts | `Money.multiplyRatio(num, den, "ceil")` | Implementar 50% redondeo hacia arriba sin float |
| order-totals.ts | `OrderItemPriceSnapshot`, `ModifierPriceSnapshot` | Contrato snapshot congelado; fielding de fracción/cantidad/precio |
| configured-catalog.ts | `ValidatedConfiguredCatalogRelease` | Autoridad de validación V2; catálogo descongelado para lectura, no para preciso histórico |
| shared-types/configured-catalog.ts | `ConfiguredVariantOptionV2`, `ConfiguredVariantGroupV2` | Esquema opción/precio/cantidad; sin fracción todavía en struct (asunto S5.1) |

## Invariantes que NO deben cambiar

- Dinero: minor units integer + ISO currency code; nunca float ni conversiones implícitas
- Money.equals(other) y comparisons siempre usan BigInt internamente, nunca Number
- Snapshot histórico congelado: ningún módulo puede releer catálogo para preciar una Order/OrderItem anterior
- Alcance Restaurant/Branch: variant validada pertenece a restaurant exacto; availability por Branch
- V1 MenuCatalogStateV1 sigue funcionando hasta migración explícita V2; no se agregan campos opcionales ambiguos a V1
- Catálogo release es inmutable una vez publicado; cambios usan nueva version/release
- Manager override: requiere ambos `actorId + overrideReason` auditados; un solo override sin razón falla
- Fracciones v1: geometría fija whole/halves; cuartos u otra quedan para decisión futura

## Fuera de alcance

- Persistencia de release V2, publicación atómica, migración desde V1 (S5.2)
- API, editor de catálogo Nest (S5.3)
- UI configurador Capture (S5.4)
- Materialización Order, salida KDS/ticket (S5.5)
- Disponibilidad por horario/canal, inventario de receta, promociones, CFDI
- Inventario físico, contabilidad de costos, receta algorítmica

## Verificación

```bash
# Lint, typecheck, test de domain y shared-types
pnpm --filter @super-restaurant/domain test
pnpm --filter @super-restaurant/domain lint
pnpm --filter @super-restaurant/domain typecheck

pnpm --filter @super-restaurant/shared-types lint
pnpm --filter @super-restaurant/shared-types typecheck

# Build API para verificar integración
pnpm --filter @super-restaurant/api typecheck
pnpm --filter @super-restaurant/api lint

# CodeGraph: verificar que no quedan referencias rotas post-cambio
# (ejecutar fuera de paquete: codegraph explore "resolveFractionPricing OrderItemPriceSnapshot")
```

## Formato de salida esperado

1. Resumen de cambios en domain (3–6 líneas): archivos tocados, qué funciones se agregan
2. Lista de archivos tocados con línea de introducción (ej: "packages/domain/src/fraction-pricing.ts (nueva)")
3. Salida literal exacta de `pnpm --filter @super-restaurant/domain test` (suite completa verde o detalle fallos)
4. Salida de `pnpm --filter @super-restaurant/domain typecheck` y `lint`
5. Riesgos abiertos: si monetario fallara en redondeo, si snapshot no fuera realmente inmutable, si manager override faltara auditoría

---

## Contexto adicional: Decisiones aprobadas §7.1 (2026-09-26)

Citar textualmente de `docs/architecture/P2_CONFIGURABLE_CATALOG_SLICE.md`:

> 1. Precio de mitades y fracciones: se cobra el mayor precio entre las fracciones seleccionadas.
> 2. Fracciones permitidas en v1: entera y mitades; sin cuartos ni otra geometría.
> 3. Un extra `whole` se cobra completo; el mismo extra aplicado a una mitad se cobra al 50 % redondeado hacia arriba al centavo (minor unit).
> 4. Excluir un ingrediente incluido no reduce el precio; sólo cambia la receta.
> 5. Sustituciones en combos: equivalencia sin costo dentro del mismo grupo; fuera del grupo, sobreprecio explícito por opción.
> 6. Las especialidades por fracción son sabores dentro del producto pizza, no productos independientes.
> 7. Límite operativo: máximo 5 ingredientes extra por fracción; override sólo por gerente con motivo auditado.
> 8. Agotados temporales: la autoridad es la opción o variante marcada por el supervisor en la Branch; sin autoridad por estación en v1.

---

**Riesgo sugerido:** alto (dinero, redondeo, congelación de snapshot)  
**Capa sugerida:** L1 (implementer-claude)
