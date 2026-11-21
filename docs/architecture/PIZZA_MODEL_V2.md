# Modelo de pizza V2 (P3-0 corregida)

> Estado: **criterios propuestos APROBADOS por Emmanuel el 2026-11-20 («aprobado»)**. Decisiones de Emmanuel 2026-11-20 incorporadas (N de la mitad más cara; ingrediente repetido cobrado una vez por pizza; supuestos aprobados). P3-1…P3-5 bloqueadas hasta aprobación final. La versión previa con la revisión CORREGIR está en el historial de git.

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
