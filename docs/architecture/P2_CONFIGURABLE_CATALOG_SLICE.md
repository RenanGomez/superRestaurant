# P2 S5 — Catálogo configurable y pizza

Estado: diseño listo para revisión; implementación productiva `IN_PROGRESS`.

Fecha: 2026-09-25.

## 1. Objetivo y límites

Este corte convierte el catálogo V1 existente en la única base para variantes, plantillas, dependencias, defaults, combos, agotados y pizzas por fracciones. No crea un segundo catálogo ni cambia todavía contratos, esquema, API o UI.

Debe permitir que una configuración válida:

- se construya sólo con una release de catálogo versionada;
- sea inequívoca para precio, cocina, KDS, ticket e historia;
- distinga cantidad de producto, cantidad de opción y alcance de una opción;
- rechace requisitos pendientes, incompatibilidades y agotados antes de confirmar;
- se congele como snapshot completo al crear la línea de Order;
- pueda repetirse únicamente después de reconciliarla contra el catálogo vigente.

Quedan fuera de este primer corte las políticas de cambio/cancelación post-cocina, inventario de receta, promociones, impuestos nuevos, UI final y cualquier aplicación remota de esquema.

## 2. Autoridad existente que se extiende

CodeGraph confirma estas autoridades actuales:

- `packages/domain/src/menu.ts`: release coherente, producto, allowlist de grupos y creación del snapshot de precio;
- `packages/domain/src/modifiers.ts`: límites de grupo/opción, cantidades y snapshots de modificadores;
- `packages/domain/src/order-totals.ts`: cálculo monetario exacto desde snapshots;
- `packages/shared-types`: contrato `MenuCatalogV1` consumido por API, web y mobile;
- migraciones de menú: release normalizada e inmutable publicada de forma atómica;
- Order/KDS: consumen snapshots históricos y nunca deben releer el catálogo para una venta confirmada.

S5 deberá evolucionar esas mismas fronteras mediante contratos V2 aditivos. V1 permanece legible hasta una migración explícita; no se agregan campos opcionales ambiguos a V1.

## 3. Modelo V2 propuesto

Una release V2 contiene identidades inmutables y ordenadas para:

1. categorías;
2. productos comerciales;
3. variantes de producto;
4. plantillas de grupos de elección;
5. grupos instanciados por variante;
6. opciones y defaults;
7. restricciones entre selecciones;
8. definiciones de combo y sus componentes;
9. disponibilidad por Branch, canal y ventana;
10. políticas versionadas que afecten precio o receta.

### 3.1 Producto y variante

El producto aporta identidad comercial. La variante aporta los hechos que pueden cambiar por tamaño o presentación:

- nombre/SKU de variante;
- precio base y moneda;
- unidad de venta;
- estación y versión de receta;
- grupos permitidos y orden de captura;
- capacidad de fracciones;
- política de precio de fracciones por referencia explícita;
- disponibilidad base.

Una línea nueva siempre elige una variante. Una release no puede publicar dos variantes con la misma identidad, ni una variante que apunte a grupos o políticas de otra release/Restaurant.

### 3.2 Plantillas y grupos instanciados

Una plantilla reusable define vocabulario y opciones —por ejemplo masa, orilla o bebida— pero no autoridad de precio por sí sola. La instancia ligada a una variante congela:

- mínimo y máximo por suma de cantidades;
- opciones permitidas;
- cantidades máximas por opción;
- defaults explícitos;
- alcance permitido (`whole`, `fraction` o ambos);
- sobreprecio vigente para esa variante;
- si una opción incluida puede excluirse;
- orden de presentación y texto para cocina.

Esto evita que editar una plantilla cambie releases históricas o que un precio se deduzca desde una plantilla mutable.

### 3.3 Dependencias y exclusiones

Las restricciones se publican como hechos dirigidos de la misma release:

- `requires`: seleccionar A exige B;
- `excludes`: seleccionar A impide B;
- `enables`: B no puede elegirse hasta seleccionar A;
- `requires_group`: A exige completar un grupo concreto.

La publicación debe rechazar referencias inexistentes, autorreferencias, duplicados, ciclos de `requires` y contradicciones directas (`requires` + `excludes`). El resolutor no elimina selecciones silenciosamente: devuelve issues ordenados y preserva el borrador para que el operador corrija.

### 3.4 Defaults

Los defaults forman parte de la instancia versionada. Deben:

- satisfacer mínimos/máximos y caps;
- estar activos y disponibles para la variante;
- no violar restricciones;
- distinguir ingrediente incluido de extra cobrado;
- aplicarse sólo al abrir una configuración nueva, nunca sobre una edición o repetición ya seleccionada.

“Sin cebolla” no es una nota: es la exclusión explícita de una opción incluida, con alcance `whole` o de fracción.

### 3.5 Fracciones

El contrato debe representar, sin texto libre:

- número de fracciones permitido por la variante;
- identidad y posición estable de cada fracción;
- sabor/producto base por fracción;
- opciones, extras y exclusiones con alcance `whole` o una fracción explícita;
- snapshot de la política de precio usada y sus operandos;
- resumen canónico para cocina.

No se fijará un máximo, geometría ni fórmula de precio hasta resolver las decisiones de la sección 7. El dominio no puede asumir que “mitad” siempre significa promedio o precio mayor.

### 3.6 Combos

Un combo contiene componentes ordenados con mínimo/máximo, catálogo de productos/variantes permitidos y sustituciones autorizadas. Cada componente se configura con las mismas reglas que una línea normal. Un faltante o sustitución no autorizada bloquea la confirmación; nunca se descarta un componente ni se elige un reemplazo automáticamente.

### 3.7 Disponibilidad y agotados

La disponibilidad se evalúa en servidor con Restaurant, Branch, canal, instante y release. Una opción puede estar:

- disponible;
- fuera de horario/canal;
- agotada temporalmente;
- retirada de la release vigente.

El cliente recibe razón estable y opciones todavía válidas. La disponibilidad nunca modifica una Order confirmada; genera incidencia/cambio compensatorio en el flujo posterior.

## 4. Selección, resolución y snapshot

La frontera de dominio V2 se divide en tres pasos:

1. `validateConfiguredCatalogRelease`: valida y desprende la release completa;
2. `resolveProductConfiguration`: recibe variante, selecciones y contexto autoritativo, y devuelve configuración válida o issues exactos;
3. `materializeConfiguredOrderItemSnapshot`: aplica la política monetaria ya configurada y congela precio, nombres, alcances, restricciones satisfechas, estación y receta.

La API y clientes nunca calculan una configuración parcialmente distinta. El servidor repite los tres pasos al confirmar; `expectedCatalogVersion`, idempotency key y versión de Capture/Order protegen contra drift y doble envío.

El snapshot histórico debe conservar al menos:

- release, producto y variante;
- precio base y moneda;
- grupos/opciones con nombres y cantidades;
- defaults incluidos, exclusiones y extras;
- fracción o alcance completo de cada elección;
- regla de precio de fracciones y resultado desglosado;
- impuestos/descuentos aplicados por las autoridades existentes;
- estación y receta/versiones;
- resumen estructurado de cocina, no sólo una frase renderizada.

## 5. Entrega vertical por subcortes

| Corte | Resultado | Evidencia mínima |
|---|---|---|
| S5.0 | Decisiones y contrato de release/selección V2 | revisión humana, parsers runtime y pruebas hostiles |
| S5.1 | Dominio de variantes, plantillas, defaults y restricciones | unitarias, propiedades combinatorias, dinero exacto |
| S5.2 | Persistencia/publicación atómica y disponibilidad | PostgreSQL rollback-only, aislamiento, catálogo exacto |
| S5.3 | API y editor de catálogo | Auth/RBAC, contract tests, concurrencia/idempotencia |
| S5.4 | Configurador Capture web/tablet/mobile | navegador/dispositivo, teclado/táctil, recuperación |
| S5.5 | Materialización Order y salida KDS/ticket | integración PostgreSQL, E2E RP-07/RP-08/RP-09 |

Ningún subcorte permite llamar “pizza configurable” al producto hasta completar S5.5.

## 6. Criterios de aceptación trazables

### RP-07 — Pizza por mitades

- pizza grande con especialidad A/B;
- “sin cebolla” sólo en una mitad;
- extra queso en toda la pizza;
- total reproducible con la política aprobada;
- snapshot y KDS expresan cada alcance sin ambigüedad.

### RP-08 — Masa/orilla incompatible

- cambiar tamaño o masa conserva selecciones no afectadas;
- la incompatibilidad se explica con IDs/razones estables;
- sólo se ofrecen opciones autorizadas;
- no se confirma ni envía a cocina mientras exista el issue.

### RP-09 — Combo con bebida agotada

- el componente obligatorio permanece visible;
- se muestran únicamente sustituciones autorizadas y su diferencia de precio;
- sin sustitución válida, la confirmación queda bloqueada;
- reintento/reload conserva la selección sin duplicar componentes.

## 7. Decisiones humanas obligatorias antes de S5.1/S5.2

Estas decisiones no se infieren del plan ni del catálogo actual:

1. Política inicial de precio para mitades/fracciones: mayor precio, promedio, suma proporcional o tabla explícita.
2. Fracciones permitidas en v1 de Vittorinos: sólo entera/mitades, también cuartos u otra geometría.
3. Cómo se cobra un extra `whole` frente al mismo extra aplicado a una fracción.
4. Si excluir un ingrediente incluido reduce precio o sólo cambia receta.
5. Sustituciones de combos: equivalencia sin costo, sobreprecio por opción o tabla explícita.
6. Si especialidades por fracción son productos, recetas o sabores dentro de un producto pizza.
7. Límites operativos por tamaño para ingredientes/extras y quién puede hacer override.
8. Fuente autoritativa y alcance de agotados temporales: variante, opción, ingrediente/receta o estación.

Hasta resolverlas, se pueden preparar parsers e invariantes estructurales, pero no persistir una fórmula monetaria ni afirmar totales correctos.

## 8. Riesgos y verificación

- Dinero: todo importe usa `Money`/minor units; ninguna fórmula usa `Number` fraccionario.
- Aislamiento: todas las identidades pertenecen a Restaurant y disponibilidad a Branch cuando aplica.
- Historia: una release publicada y un snapshot confirmado son inmutables.
- Combinatoria: límites de tamaño y ciclos se prueban con casos generativos/acotados.
- Seguridad: catálogo se publica sólo mediante Nest; clientes no escriben tablas ni eligen precios.
- Compatibilidad: lectores V1 siguen funcionando hasta la migración V2; no se edita una migración aplicada.
- UI: estados incompleto, incompatible, agotado, drift y conflicto son explícitos y recuperables.

