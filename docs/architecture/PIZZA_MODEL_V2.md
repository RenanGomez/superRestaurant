# Modelo de pizza V2 (P3-0 corregida)

> Estado: **criterios propuestos APROBADOS por Emmanuel el 2026-11-20 («aprobado»)**. Decisiones de Emmanuel 2026-11-20 incorporadas (N de la mitad más cara; ingrediente repetido cobrado una vez por pizza; supuestos aprobados). P3-1…P3-5 bloqueadas hasta aprobación final. La versión previa con la revisión CORREGIR está en el historial de git.
>
> **Ronda 2 (B0, 2026-11-21):** manda el «Delta de la ronda 2» del final. Sustituye `baseGroupId` por `baseGroupIds`, `extraGroupIds` por `extraOptionIds` y unifica el bloque de `pizzaMode`. El resto del documento se conserva como historial.

**P3-0 · Especificación corregida, propuesta para revisión.** Las decisiones de Emmanuel del 20-11-2026 quedan incorporadas; los criterios señalados como *propuestos* necesitan aprobación antes de implementar. P3-1…P3-5 permanecen bloqueadas hasta aprobar la especificación.
**Catálogo:** extender aditivamente `MenuProductV1` con `pizzaMode`, `freeIngredientCount`, `baseGroupId`, `defaultIngredientOptionIds`, `customizeAtOrder` y `extraGroupIds`. N es entero no negativo por producto; el tipo comercial se deriva de una referencia estable a categoría. Validar modo, categoría, grupos, opciones y publicación dentro del scope. Quitar un producto publicado lo retira del catálogo y conserva historia por snapshots.
**Selección y compatibilidad:** representar versión, producto, tamaño, dos mitades, rol y alcance explícitos. Una especialidad permite retirar ingredientes sin descuento; un sustituto es una opción adicional cobrada. Los extras tienen precio propio y no consumen N. Preservar releases y `fraction` legados, incluida la semántica de `lockedIngredientOptionIds` vacío; no inferir especialidades, defaults ni desbloqueos.
**Precio:** comparar precios de pizza completa de ambas especialidades y usar el mayor. En dos personalizadas, usar la N de la mitad de mayor precio base; *propuesta para empate*: desempatar por UUID estable del producto. En selección mixta, *propuesta*: comparar precio completo de especialidad con base personalizada y aplicar la N de esta última solo a sus ingredientes. Estas reglas propuestas requieren aprobación.
**Identidad y cobro:** deduplicar por `optionId` dentro de la release antes de aplicar N; una opción en ambas mitades cuenta una y se cobra una vez. *Propuesta*: exigir mismo precio y moneda para esa opción en ambas referencias y rechazar conflictos; ordenar opciones por precio ascendente, `groupId`, `optionId` y asignar gratis las primeras N. Extras son roles distintos y no se fusionan silenciosamente con ingredientes incluidos. *Propuesta pendiente*: cargo excedente en una mitad = `ceil(precioMinor/2)`; en ambas = precio completo.
**Casos propuestos**, enteros menores, base 1000, N=2, A=100, B=200, C=300, D=401, sin impuestos: | selección | total |; | 0 | 1000 |; | A+B | 1000 |; | A+B+C | 1300 |; | A+B+C+D | 1701 |; | A ambas+B una | 1000, dos ingredientes |; | A+B gratis y C en una mitad | 1150 |; | A+B gratis y D en una mitad | 1201 |; | especialidades 1500/1800 | 1800 |; | personalizadas bases 1000/N=1 y 1200/N=2 con A+B+C | 1500 |. Aplicar descuentos e impuestos según política fiscal vigente y cantidad mediante el motor existente; congelar resultados sin `float`.
**Cambio versionado:** dominio y ambas funciones SQL, `replace_capture_selection_plan` y `confirm_capture_draft_v3`, deben aceptar explícitamente dos mitades personalizadas en la versión nueva; versiones desconocidas fallan cerradas. La versión legada conserva sus validaciones, rechazos, precios y snapshots. Confirmación revalida scope, publicación, referencias y versión transaccionalmente; dominio y SQL comparten vectores de paridad.
**Idempotencia:** definir identidad por operación, actor autorizado, restaurante, sucursal y clave; persistir huella del payload canónico y resultado atómicamente. Mismo actor/scope/clave y payload devuelve el resultado original; payload distinto produce conflicto sin mutación; solicitudes concurrentes iguales producen una sola confirmación y replays equivalentes. Actor o scope distinto nunca recibe el resultado ajeno y debe pasar autorización; probar ambos cruces y la carrera.
**Snapshot y pruebas:** congelar versión de regla y release, moneda, productos, tamaños y precios por mitad, N, ingredientes y roles, exclusiones, asignación gratuita, cargos redondeados, impuestos, descuentos y totales; KDS e impresión reciben instrucciones por mitad. Probar historia tras editar o retirar catálogo; referencias cruzadas de producto, grupo y opción entre restaurantes y sucursales; replay, conflicto y concurrencia; regresión legada, paridad SQL/dominio, impuestos, migración desde cero y versión previa.
**Entregas:** P3-1 contrato/dominio: `packages/shared-types/src/index.ts`, `packages/domain/src/menu.ts`, `packages/domain/src/fraction-pricing.ts` y pruebas; P3-2 persistencia: nueva migración en `supabase/migrations/` y pruebas en `supabase/tests/`; P3-3 API y snapshots: `apps/api/src/captures.ts`, `apps/api/src/menu-catalog-domain.ts` y pruebas; P3-4 editor/captura: `apps/web/src/app/app/menu/menu-catalog-editor.tsx`, `apps/web/src/app/app/capture/product-sheet.tsx`, `apps/mobile/src/order-draft.ts` y lectores afectados; P3-5 integración: KDS/impresión, pruebas de flujos y `docs/runbooks/guia-de-pruebas-operador.md`. Confirmar consumidores y archivos adicionales antes de editar.
**Migración:** nueva y aditiva; inventariar configuraciones ambiguas y migrar solo correspondencias deterministas; revisión manual del resto. Definir rollback compatible antes de aplicar y bloquear clientes incapaces de representar la versión nueva. La aplicación remota requiere autorización explícita. **NO VERIFICADO:** CodeGraph no aparece entre las herramientas disponibles; no se ejecutaron pruebas ni se verificaron los consumidores completos. El archivo solicitado `.agents/reports/pizza-model-spec-v2.md` no se creó porque el entorno y el alcance son de solo lectura.
**Verificación ejecutada:** §10 de AGENTS.md no contiene una plantilla de reporte:
```text
rg -n '^## 10\.' AGENTS.md
225:## 10. Multi-restaurante, sucursales y autorización
```
## Corrección de la segunda revisión (2026-11-20)

- **Snapshot obligatorio.** Cada línea congela, además de precios y ids: nombre del producto, nombre de cada ingrediente/opción elegida (por mitad cuando aplique), N gratis aplicado y la **estación** de preparación. Ningún dato de cocina o ticket se relee del catálogo vigente.
- **Pruebas exigidas.** (1) Editar o retirar un producto, ingrediente, opción o estación del catálogo no altera las líneas históricas ni su ticket. (2) Las instrucciones de cocina (KDS) de pedidos ya enviados se derivan del snapshot y sobreviven a esos cambios. (3) Aislamiento por restaurante/sucursal en la lectura del snapshot.
- Estado: sigue pendiente la aprobación final de Emmanuel de los criterios «propuestos»; P3-1…P3-5 bloqueadas hasta entonces.

## Revisión Sonnet (nivel A, 2026-11-20): CORREGIR — requisitos añadidos

Hoy el dominio rechaza dos mitades personalizadas (`fraction-pricing.ts` → `fraction_both_custom`, con prueba y verificador SQL); P3-1/P3-2 deben cambiar esa regla y sus pruebas a la vez.

**P1**
- **Migración SQL:** P3-2 copia íntegras, con `create or replace`, las últimas definiciones vigentes (`confirm_capture_draft_v3` en 20261102000100; `replace_capture_selection_plan` en 20261008000200). El paquete de contexto de P3-2 lista todas las migraciones que redefinen `confirm_capture_draft_v3`; copiar una definición vieja pierde ramas (nota de ítem, payment intent, grupos compartidos, ingredientes bloqueados).
- **Vectores de paridad:** cada caso de la tabla de ejemplos lleva su cálculo explícito y respeta «N de la mitad más cara». Fórmula única: cargo por mitad = `ceil` por ingrediente, nunca sobre la suma. Los vectores actuales («→1701», «→1201», «→1500») se rehacen con esa fórmula antes de P3-1.
- **Idempotencia:** la autoridad es el journal existente `capture_command_journal` (clave única `(restaurant_id, branch_id, actor, key)`) con `insert … on conflict`/advisory lock; sin mecanismo paralelo.

**P2**
- Snapshot versionado (`schemaVersion`); congela orden de asignación gratuita, identificador de la regla, N y estación por mitad cuando difieran.
- Prueba nombrada: un cliente atrasado que envíe la versión legada con dos mitades personalizadas recibe error explícito, no cobro erróneo.
- `save_menu_catalog` valida `defaultIngredientOptionIds`, `baseGroupId`, `extraGroupIds` por `restaurant_id` y `catalog_id`; campos nuevos con únicos/CHECK con alcance.
- Backfill: `pizzaMode` ausente = legado; no se migra ninguna mitad `fraction` existente.
- Los tres criterios «propuestos» fueron aprobados por Emmanuel el 2026-11-20.

**P3**
- Orden P3-1 → P3-2 (ambas nivel A, sin paralelizar) → P3-3 → P3-4/P3-5. Definir el código de error de «mismo ingrediente en ambas mitades con precios distintos». Retirar del documento el metatexto del revisor anterior.

## Vectores de paridad (borrador Codex, 2026-11-20)

Supuestos: centavos; `AB` = ingrediente en ambas mitades (se cobra una vez, completo si no es gratis); gratuitas por precio ascendente; empate de N por UUID menor y regla mixta son criterios **propuestos**. NO VERIFICADO contra dominio/SQL: P3-1 los convierte en pruebas y los ajusta si la implementación revela una contradicción.

| Caso y entradas | Cálculo paso a paso y total esperado |
|---|---|
| 1. Especialidades 1500/1800; N=0/0; sin ingredientes ni extras | Base `max(1500,1800)=1800`; total **1800**. |
| 2. Personalizadas 1000/1000; N=0/0; A:101 izquierda, B:103 derecha | Base 1000; ninguna gratis; `ceil(101/2)=51`, `ceil(103/2)=52`; total **1103**. |
| 3. Personalizadas 1000/1000; N=4/4; A:100 izquierda, B:200 derecha | Dos opciones únicas; ambas gratis; `1000+0=1000`; total **1000**. |
| 4. Personalizadas 1000/1000; N=2/2; A:100 AB, B:200 izquierda, C:300 derecha | Deduplicar A: 3 opciones; A y B gratis; `ceil(300/2)=150`; total **1150**. |
| 5. Personalizadas 1000/1000; N=2/2; A:100 y B:200 AB, D:401 izquierda | A y B gratis; `ceil(401/2)=201`; `1000+201`; total **1201**. |
| 6. Personalizadas 1000/N=1 y 1200/N=2; A:100, B:200 y C:300 AB | Base 1200 y N=2 de la más cara; A y B gratis; C completo 300; total **1500**. |
| 7. Personalizadas 1000/N=1 y 1000/N=2; UUID menor en N=1; A:100 y B:200 AB | Empate: UUID menor → N=1; A gratis; B completo 200; total **1200**. |
| 8. Especialidad 1500/N=0 y personalizada 1000/N=1; A:100 y B:201 en personalizada | Regla mixta propuesta: base 1500; A gratis; `ceil(201/2)=101`; total **1601**. |
| 9. Personalizadas 1000/1000; N=0/0; A:101 AB y extra E:75 AB | A deduplicado y completo 101; extra completo 75, sin consumir N; total **1176**. |
| 10. Personalizadas 1000/1000; N=1/1; A:100 izquierda y la misma opción A:101 derecha | Precios incompatibles para el mismo `optionId`: **error**, sin total. |

## Delta de la ronda 2 (B0, 2026-11-21)

Decisiones de Emmanuel del 2026-11-20 (ronda 2). Este delta **sustituye** los campos singulares y el bloque de modo de las secciones anteriores; la fórmula de precio y el snapshot de mitades no cambian.

### 1. Contrato (tipos)

`MenuProductV1` sigue siendo aditivo: `pizzaMode` ausente = producto legado y ningún campo V2 puede estar presente (falla cerrada, regla vigente).

```ts
export interface MenuProductV1 {
  /** Fuente única del modelo: receta marcada o personalización al tomar el pedido. */
  readonly pizzaMode?: "specialty" | "custom";
  /** N compartido por TODOS los grupos base; entero 0..40. */
  readonly freeIngredientCount?: number;
  /** NUEVO · grupos gratuitos hasta N. Sustituye a `baseGroupId`. */
  readonly baseGroupIds?: readonly string[];
  /** LEGADO de entrada: se normaliza a `[id]`; nunca se emite. */
  readonly baseGroupId?: string | null;
  /** Receta incluida en el precio; puede tomar opciones de cualquier grupo de `baseGroupIds`. */
  readonly defaultIngredientOptionIds?: readonly string[];
  /** Derivado: `true` si y solo si `pizzaMode === "custom"`. */
  readonly customizeAtOrder?: boolean;
  /** NUEVO · opciones sueltas, siempre cobradas, nunca consumen N. Sustituye a `extraGroupIds`. */
  readonly extraOptionIds?: readonly string[];
  /** LEGADO de entrada: se expande a las opciones activas de esos grupos; nunca se emite. */
  readonly extraGroupIds?: readonly string[];
}
```

Invariantes de validación (contrato, dominio y SQL comparten vectores):

- `baseGroupIds` es una lista de UUID distintos, subconjunto de `modifierGroupIds` (grupos asignados al producto). `pizzaMode: "custom"` exige al menos uno; `specialty` puede no tener ninguno si no declara receta.
- `freeIngredientCount` es un entero 0..40 y es **uno solo por producto**: se reparte entre todos los grupos base, no hay N por grupo.
- `defaultIngredientOptionIds` son UUID distintos y cada uno pertenece a la unión de opciones de `baseGroupIds`. En `custom` la receta queda vacía (el bloque unificado la desmarca); un producto legado `custom` con receta se conserva al leer y se limpia al guardar desde el editor, sin rechazo silencioso.
- `extraOptionIds` son UUID distintos, acotados por un tope nuevo `MENU_PIZZA_MAX_EXTRA_OPTIONS` (propuesto en B1a: 200, el orden de `MENU_PRODUCT_MAX_MODIFIER_GROUPS`), y cada uno pertenece a una opción de un grupo asignado al producto.
- `defaultIngredientOptionIds ∩ extraOptionIds = ∅`: una opción incluida en la receta no puede cobrarse como extra.
- El **mismo grupo** sí puede aparecer a la vez en `baseGroupIds` y aportar opciones a `extraOptionIds` (Emmanuel: «se podrá volver a elegir el mismo grupo»). Lo prohibido es que la **misma opción** se elija como ingrediente y como extra en la misma selección; ya lo rechaza `option_role_conflict` en `packages/domain/src/fraction-pricing.ts:857-861`.
- Un extra nunca consume N y se cobra siempre, aunque su grupo sea también base; el rol lo decide la lista en la que llega la opción (`ingredientOptionIds` o `extraOptionIds`), no el grupo.

Bloque unificado de `pizzaMode` (una sola decisión visible; desaparece el check independiente `customizeAtOrder`):

- «Especialidad» = receta marcada: `pizzaMode: "specialty"`, receta en `defaultIngredientOptionIds`, incluida en el precio.
- «Personalizar durante la orden» = receta desmarcada y en gris; los ingredientes se eligen al tomar el pedido: `pizzaMode: "custom"`, receta vacía.
- Salida canónica: `customizeAtOrder === (pizzaMode === "custom")`. Un `specialty + customizeAtOrder: true` ya persistido (permitía quitar ingredientes sin descuento y añadir extras) se conserva al leer; el editor lo muestra como «modelo anterior» y solo lo normaliza al guardar el bloque de forma deliberada, nunca al abrirlo.

### 2. Reglas de precio

La aritmética aprobada no cambia (`packages/domain/src/fraction-pricing.ts:670-680`); cambia de dónde salen las opciones:

- `base = max(precio de pizza completa de cada mitad)`.
- `N` = `freeIngredientCount` de la mitad personalizada más cara (empates: `productId` menor y luego `half-a`). Una sola N para todos los grupos base.
- Los ingredientes se deduplican por `optionId` **antes** de aplicar N; una opción en ambas mitades cuenta y se cobra una vez.
- Gratis: los primeros N por `(precio asc, groupId, optionId)`. Ordenar por `groupId` como desempate es lo que reparte N de forma determinista entre grupos base distintos.
- Ingrediente cobrado: `ceil(precio/2)` si está en una mitad, precio completo si está en ambas. Extras: misma fórmula, nunca gratis y nunca consumen N.
- Quitar un ingrediente de una especialidad busca la opción en cualquier grupo base y no descuenta.
- El cliente no calcula dinero: la captura solo arma ids y muestra el monto que devuelve el API.

Ejemplo «Pizza Italiana y chorizo» (base `unitPriceMinor` 15000 = $150; `freeIngredientCount` 4):
`baseGroupIds` = [Ingredientes de pizza, Vegetales]; «Ingredientes de pizza» ofrece pepperoni, champiñón, aceituna negra y pimiento verde; `extraOptionIds` = [Orilla de queso, Aderezo ranch].

- Pizza completa con pepperoni, champiñón, aceituna negra y pimiento verde (los 4 de «Ingredientes de pizza»): 4 únicos, N=4, todos gratis → **$150**. La misma N cubre 4 elegidos repartidos entre ambos grupos; el grupo de origen no altera el total.
- Un quinto ingrediente de «Vegetales» supera N: se cobra `ceil(precio/2)` si va en una mitad y completo si va en ambas; total $150 + ese cargo (precio de la opción en el catálogo).
- Orilla de queso (4000 en `supabase/tests/pizza_model_v2_invariants.sql:252`): extra siempre cobrado → pizza completa **$190**; en una sola mitad `ceil(4000/2)=2000` → **$170**.
- Aderezo ranch: se cobra a su precio de catálogo y nunca consume N. Precio: NO VERIFICADO (no hay dato en el repositorio).

### 3. Impacto en snapshot, KDS, tickets y mobile

- `PizzaHalfInputV2.ingredients[]` y `extras[]` ya llevan `groupId` por opción (`packages/domain/src/fraction-pricing.ts:689-716`), así que el reparto de N entre varios grupos base y los extras sueltos quedan congelados sin cambiar la forma.
- `PizzaHalvesPriceSnapshotV2` conserva `schemaVersion: 1` y `ruleVersion: "pizza-halves-v2"`: no cambian campos, fórmula ni totales. Si B1a necesita congelar `baseGroupIds` por mitad, sube `schemaVersion` a 2 y añade lector que falle cerrado; no se hace por defecto.
- `freeAssignmentOrder`, `freeIngredientCount`, `freeIngredientCountFraction`, `charges[]` (con `role`, `fractions`, `free`, `amount`) y `halves[]` (producto, nombre, estación, tamaño, N, removidos) siguen siendo la fuente de KDS, impresión y tickets; no se relee el catálogo. `order-totals.ts` y `persistence/order-persistence-codec.ts` no cambian.
- Unificación de `pizzaMode`: el snapshot ya distingue `kind: "specialty" | "custom"` por mitad; el flag derivado no añade campo. Una especialidad con removidos legados sigue congelando `removedIngredientOptionIds` y sin descuento.
- Mobile (`apps/mobile/src/order-draft.ts:520-524`) sigue fallando cerrado ante cualquier `pizzaMode` («se captura desde la web»); B1d solo adapta tipos (`baseGroupIds`, `extraOptionIds`). `packages/domain/src/order-repeat.ts:126` también falla cerrado; no se añade UI de pizza en mobile.

### 4. Compatibilidad legada

- `fraction.enabled` (sabores) sigue funcionando en captura y precio por la ruta vigente `pizza-halves-v1`/`resolveFractionPricing`; el editor solo permite **desactivarlo** (B2), nunca crear mitades por sabores en un producto V2 (el CHECK `menu_products_pizza_legacy_neutral` y la exclusión V2/fraction ya lo impiden).
- Parser de entrada acepta `baseGroupId` y lo normaliza a `baseGroupIds: [id]`; acepta `extraGroupIds` y lo expande a las opciones activas de cada grupo (misma oferta que el modelo viejo). La salida emite solo `baseGroupIds`/`extraOptionIds`; nunca ambas formas.
- Los planes `schemaVersion: 1` y los clientes atrasados quedan intactos. Una pizza V2 exige `schemaVersion: 2` y `ruleVersion: "pizza-halves-v2"`; una versión desconocida falla cerrada, y dos mitades personalizadas en la versión legada siguen rechazadas con `fraction_both_custom`.
- Estado de la migración `20261120000100_pizza_model_v2`: pendiente de confirmar en §0.3 del plan que no está aplicada en `supabase_migrations.schema_migrations`. Si no lo está, B1b la edita en sitio; si lo está, crea una migración nueva.

### 5. Persistencia SQL y deuda de P3-2

- `app.menu_products`: `base_group_id uuid` → `base_group_ids uuid[]` y `extra_group_ids uuid[]` → `extra_option_ids uuid[]`, con CHECK de cardinalidad, sin nulos, sin duplicados y tope de opciones; `default_ingredient_option_ids` se mantiene.
- `save_menu_catalog` valida por `restaurant_id`/`catalog_id`, además de lo actual (`supabase/migrations/20261120000100_pizza_model_v2.sql:1290-1328`):
  - cada `baseGroupIds[i]` está asignado al producto en esa misma release;
  - cada `extraOptionIds[i]` pertenece a una opción de un grupo asignado al producto (hoy solo se validan grupos extra y opciones de receta: deuda de P3-2);
  - cada `defaultIngredientOptionIds[i]` pertenece a **cualquiera** de `baseGroupIds` (hoy exige el único `base_group_id`);
  - `defaultIngredientOptionIds` y `extraOptionIds` no se cruzan y no hay duplicados.
- `menu_pizza_product_shape_valid`, `normalize_menu_pizza_product`, `build_menu_catalog_state`, `build_pizza_halves_input_v2`, `normalize_menu_catalog_payload` y `pizza_halves_price_v2` se actualizan a las listas; el parser SQL acepta `baseGroupId`/`extraGroupIds` legados y normaliza a las formas nuevas.
- `supabase/tests/pizza_model_v2_invariants.sql` cubre: dos grupos base, N repartido, opción duplicada base/extra rechazada, extra de un grupo que también es base, receta desde el segundo grupo base y round-trip del estado.

### 6. Archivos afectados (CodeGraph + búsqueda dirigida)

Producción:

- `packages/shared-types/src/index.ts` — `MenuProductV1`, `parseMenuProductV1`, `parseMenuProductPizzaV1`, `MENU_PIZZA_MAX_*`.
- `packages/domain/src/menu.ts` — `MenuProductCatalog`, `PIZZA_PRODUCT_FIELDS`, `normalizePizzaConfig`, `validatePizzaConfig`.
- `packages/domain/src/fraction-pricing.ts` — solo tipos/comentario; fórmula y snapshot intactos.
- `packages/domain/src/order-repeat.ts` — fail-closed por `pizzaMode`.
- `apps/api/src/capture-pizza-pricing.ts` — ingredientes desde varios grupos base, extras por opción, removidos en cualquier grupo base.
- `apps/api/src/capture-pizza-plan.ts` — parseo/normalización de la línea `pizza`.
- `apps/api/src/menu-catalog-domain.ts` — vista y issues V2.
- `apps/api/src/captures.ts`, `apps/api/src/capture-repeat-order-plan.ts` — fail-closed de líneas pizza.
- `apps/api/src/fraction-halves.ts`, `apps/api/src/persistence/order-persistence-codec.ts` — lectura del snapshot (sin cambio de forma).
- `apps/web/src/lib/menu-pizza.ts` — helpers de grupos base, receta y extras.
- `apps/web/src/lib/pizza-capture.ts` — setup de captura con varios grupos base y extras sueltos.
- `apps/web/src/app/app/menu/pizza-v2-editor.tsx` — bloque unificado; `apps/web/src/app/app/menu/menu-catalog-editor.tsx:732,784` — montaje y aviso de mitades legadas.
- `apps/web/src/app/app/capture/pizza-section.tsx`, `product-sheet.tsx`, `capture-workspace.tsx`, `apps/web/src/lib/capture-selection.ts`, `apps/web/src/lib/line-halves.ts`.
- `apps/mobile/src/order-draft.ts` — solo tipos.
- `supabase/migrations/20261120000100_pizza_model_v2.sql` — columnas, CHECK, parser, estado, precio y validaciones.

Pruebas: `packages/shared-types/src/menu-pizza-v2.runtime.test.ts`, `packages/domain/src/{menu-pizza-v2,order-repeat,order-totals-pizza-halves,pizza-halves-pricing}.test.ts`, `apps/api/src/{capture-pizza-plan,captures-pizza,menu-catalog-pizza,fraction-halves}.test.ts`, `apps/api/src/persistence/order-persistence-codec.test.ts`, `apps/web/src/lib/{menu-pizza,pizza-capture}.test.ts`, `supabase/tests/pizza_model_v2_invariants.sql`.

### 7. Orden de capas

`B1a` shared-types + domain (tipos, normalización, invariantes y unitarias: varios grupos base, N repartido, extras por opción, opción base/extra rechazada, parser legado) → `B1b` SQL (edición en sitio o migración nueva según §0.3, incluida la deuda de pertenencia de opciones) → `B1c` API (`capture-pizza-pricing.ts`, `capture-pizza-plan.ts`, `menu-catalog-domain.ts`, codec) y contract test → `B1d` mobile (solo tipos). `B2` (editor) arranca tras `B1a`; `B4` (captura) tras `B1c`. Nada de este delta toca la regla de precio ni el snapshot de mitades.
