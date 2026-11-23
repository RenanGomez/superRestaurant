# Plan · Correcciones del smoke 2026-11-05, ronda 2

Fuente: `smoke-2026-11-05 2.json` (raíz del repo): claves `r2-cap-ticket`, `r2-cap-keys`, `r2-cap-cust` y la nota de `menu-prod`. El resto de claves repite la ronda 1, que ya cubrió `docs/plans/smoke-2026-11-05-plan.md`. Redactado el 2026-11-20 por Opus (planificación, sin tocar código). Emmanuel respondió las preguntas de §6 en la misma sesión.

**Para quién es:** la sesión orquestadora, Claude **Sonnet** (L0). Sonnet no escribe código: arma briefs, encola, revisa diffs, integra y documenta. Implementan **dsh** (DeepSeek V4.1 Flash vía OpenCode Go) y **Codex** (cuenta B). Gemini no participa en este plan. Reglas: `AGENTS.md` §19.2-19.4, `.harness/ORCHESTRATOR.md` y `.harness/routing.md`. Léelos una vez.

---

## 0. Antes de lanzar nada (Sonnet)

1. Leer de `TODO.md` sólo la sección «Smoke 2026-11-05» y el primer bloque de `HANDOFF.md`. Añadir a TODO una sección «Smoke 2026-11-05 · ronda 2» con las tareas de abajo, todas en TODO, y en HANDOFF una línea que apunte a este archivo.
2. El árbol tiene muchos cambios sin commitear: harness y el trabajo de la ronda 1 (P3, Fase 4). **Antes de crear worktrees**, pregunta a Emmanuel si se commitea la ronda 1 en una rama local (`feat/smoke-r1`). Si un worktree nace de `main` sin esos cambios, las tareas parten de código viejo. Sin ese commit, trabaja sin `-Worktree` y con `-Files` disjuntos, y serializa todo lo que toque el mismo archivo.
3. Comprobar con una consulta **read-only** al remoto (AGENTS §3.1) que `20261120000100_pizza_model_v2` y `20261120000200_capture_selection_plan_probe_v2` **no** están en `supabase_migrations.schema_migrations`. Si no están aplicadas, la Fase B las **edita en sitio** (nunca se aplicaron ni se commitearon). Si alguna ya está aplicada, la Fase B crea una migración nueva y lo anota en HANDOFF.
4. Reparto de motores:

| Trabajo | Implementa | Revisa |
|---|---|---|
| Nivel C (UI) | dsh `-Write -Effort low`; reintento con `medium` y el mismo `-Id` | Codex `-Effort low`, una ronda (§19.3) |
| Nivel B | dsh `-Write -Effort medium` | Codex, máximo dos rondas |
| Nivel A (contratos, dominio, SQL) | Codex `-Effort medium` (`high` sólo en el reintento) | dsh más un subagente `reviewer` Sonnet (segunda familia) |
| Diagnóstico o especificación | Codex `-Effort medium` sin `-Write` (o dsh sin `-Write` si Codex no tiene cuota) | Sonnet lee el informe |

- Codex rompe acentos en textos no ASCII: en todo brief a Codex que cambie textos de UI, pedir escapes `á` o comprobar el diff.
- Archivos cuello de botella, siempre con un solo escritor y encadenados con `-After`: `capture/capture-workspace.tsx` (CW), `menu/menu-catalog-editor.tsx` y `customers/customer-editor.tsx`. Cita rangos de líneas en los briefs y recalcúlalos con `codegraph explore` antes de encolar cada eslabón.

---

## 1. Inventario → tareas

| Hallazgo (smoke r2) | Decisión de Emmanuel | Tarea |
|---|---|---|
| ticket 4: «Configurar pizza por mitades» y el check «Permitir mitades» del modelo viejo | El botón pasa a llamarse «Configurar especialidades». «Permitir mitades» (sabores) **sale del editor** | B2 |
| ticket 5: selector de ingredientes duplicado; varios grupos base | **Varios grupos base**. En una pizza armable hay que definir qué grupos son gratuitos (cuentan contra N) y cuáles se cobran siempre | B0, B1, B2 |
| ticket 6: «Gestionar grupos» es un enlace | Debe ser un botón completo | B2 |
| ticket 7: los extras se eligen por grupo | Se eligen **opciones sueltas** dentro de cada grupo de extras | B0, B1, B2 |
| ticket 8: ingredientes sin imagen y desordenados en móvil | Cada opción con su imagen (`MenuModifierOptionV1.imagePath` ya existe); lista vertical en móvil | B2, B3 |
| keys: Alt+N sólo sirve dentro de Captura | Alt+N **global**: desde cualquier página lleva a Captura con el buscador de cliente enfocado | K2 |
| keys: Alt+R choca con Radeon | Reiniciar pasa a **Alt+Shift+R**; Alt+R se elimina | K2 |
| keys: Escape no hace nada | Cierra lo que esté abierto, en orden: desplegable del buscador → hoja de producto → modal; si no hay nada abierto, quita el foco del campo | K2 |
| keys: N sola no hace nada | Correcto, se queda así | — |
| cust 1: el historial de Clientes no muestra la captura recién abierta | Sección «En captura» con los borradores abiertos del cliente y «Volver a la captura»; botón fijo de regreso si se llegó desde Captura | K3 |
| cust 2: validación de dirección opaca, exige ciudad, estado y país, y zonas por CP | Catálogo **SEPOMEX** sólo de Navojoa. La colonia se elige con autocompletado, el CP se rellena solo y ciudad, estado y país salen de la sucursal. Las zonas se definen **por colonia**. El rechazo dice el motivo | Z0-Z5 |
| cust 2b: «quitar» un cliente vuelve tras refrescar | Era **«Quitar» de un teléfono**: hoy sólo edita el estado local hasta «Guardar ficha» | K4 |
| cust 3: Captura abre «Nueva captura» vacía | El buscador de cliente y la barra canal/cumplimiento van **en la portada de Captura**. Domicilio exige cliente; Recoger pide nombre (teléfono opcional); Mostrador y Mesa no piden nada | K0, K1 |
| menu-prod (tamaños) | Ya cubierto por M1 en la ronda 1. Sólo confirmar en la verificación | — |

---

## 2. Fase K · Captura y clientes (nivel C, salvo lo que K0 suba a B)

**K0 `capture-landing-diag`** (Codex sin `-Write`, en paralelo con todo). Responder con archivo:línea:
- ¿El comando de creación de borrador (`create()` en CW, acción web y endpoint del API) acepta `customerId` y el canal al crearse, o se asignan después?
- ¿Existe en el contrato del borrador un campo de nombre para Recoger sin cliente del directorio?
- ¿La lista de borradores (`capture-drafts` del API) trae `customerId` y se puede filtrar por cliente?
- ¿Qué bloquea hoy confirmar un borrador sin cliente según el canal (dominio, API o SQL)?

Lo que falte se convierte en una tarea **B** de API (dsh `-Effort medium`, contract test) **antes** de K1/K3. Si la regla «Domicilio exige cliente» no está en el servidor, también va en esa tarea B: la UI no decide permisos.

**Carril CW** (dsh `-Write`, encadenado):

**K1 `capture-landing-customer-first`**: cust 3.
- En la portada de Captura (sin borrador abierto) van arriba el buscador de cliente (el combobox `capture-customer-search.tsx` de C2) y la barra de canal y cumplimiento. Se eliminan del interior de «Nueva captura».
- Con Domicilio: buscar → encontrado → botón «Nueva captura para <nombre>». No encontrado → alta rápida en la misma pantalla → botón «Nueva captura». No se crea ningún borrador sin cliente.
- Con Recoger: campo de nombre (y teléfono opcional) → «Nueva captura».
- Con Mostrador o Mesa: «Nueva captura» directa.
- La lista de borradores recuperables queda debajo.
- Hecho cuando: helper puro en `W/lib/capture-workspace.ts` (`canStartCapture(channel, customer, pickupName)`) con tests, y puertas web en verde.

**K2 `capture-shortcuts-r3`** (`-After K1`): keys.
- Alt+N global: listener en el layout de `/app` (`app/app/layout.tsx` o un componente cliente nuevo `app/app/global-shortcuts.tsx`). Fuera de Captura navega a `/app/capture?focus=customer`; dentro, enfoca el buscador. Si hay cambios sin guardar, usa la confirmación existente.
- Alt+Shift+R sustituye a Alt+R; eliminar Alt+R de la tabla de CW y de la leyenda.
- Escape: **diagnosticar primero** por qué no dispara (posibles causas: `stopPropagation` en el combobox o en la hoja, el listener en el elemento equivocado, o `shortcut-dispatch.ts` descartando Escape). Después, pila de capas: desplegable → hoja → modal → `blur()`.
- Actualizar la leyenda de atajos y `docs/runbooks/guia-de-pruebas-operador.md`.
- Hecho cuando: tests de `shortcut-dispatch` con Alt+Shift+R, Alt+N con foco en input y Escape con capas abiertas. Puertas web en verde.

**Carril Clientes** (dsh `-Write`, encadenado; en paralelo con el carril CW salvo K3, que necesita K0):

**K4 `customer-phone-remove-confirm`**: cust 2b. «Quitar» teléfono abre un modal propio («¿Quitar el teléfono X?»). Al confirmar, guarda la ficha de inmediato con la acción existente, sin crear otra. Si la ficha tiene otros cambios sin guardar, el modal lo avisa y guarda todo junto. No se puede quitar el último teléfono si el contrato exige uno. Tests del helper puro.

**K3 `customer-open-captures`** (`-After K4` y tras K0 o su tarea B):
- En la ficha del cliente, sobre «Historial reciente», sección «En captura» con sus borradores abiertos (canal, líneas, antigüedad) y «Volver a la captura» (`/app/capture?draftId=`).
- Si se llegó con `?from=capture&draftId=`, botón fijo «← Volver a la captura».
- C2 ya construye el enlace «Directorio» con `customerId`: añadirle `from` y `draftId`.

---

## 3. Fase B · Configuración de pizza, ronda 2 (nivel A en contrato, dominio y SQL; nivel C en UI)

Contexto: P3-1 a P3-5 (ronda 1) dejaron `pizzaMode`, `baseGroupId` (uno solo), `defaultIngredientOptionIds`, `customizeAtOrder`, `extraGroupIds` y `freeIngredientCount` en 24 archivos (shared-types, domain, api, web, mobile, SQL). La UI está en `apps/web/src/app/app/menu/pizza-v2-editor.tsx` y se monta desde `menu-catalog-editor.tsx:716-740`.

**B0 `pizza-model-v2-delta-spec`** (Codex sin `-Write`): actualizar `docs/architecture/PIZZA_MODEL_V2.md` con el delta.
- `baseGroupIds: string[]` sustituye a `baseGroupId`. Son los grupos **gratuitos hasta N**: sus opciones cuentan contra los ingredientes gratuitos, y los N gratuitos se reparten entre todos los grupos base con la misma regla de precio aprobada (los más baratos gratis, mitades según los criterios del 2026-11-20).
- `defaultIngredientOptionIds` puede tomar opciones de cualquier grupo base (receta de la especialidad, incluida en el precio).
- `extraOptionIds: string[]` sustituye o complementa a `extraGroupIds`. Son opciones sueltas, **siempre cobradas**, que nunca consumen N. Una opción no puede ser a la vez base y extra en el mismo producto; el mismo **grupo** sí puede aparecer en ambos lados (Emmanuel: «se podrá volver a elegir el mismo grupo»).
- «Personalizar durante la orden»: semántica exacta según la nota original de Emmanuel (desmarca la receta y la pone en gris; los ingredientes se eligen al tomar el pedido). **Recomendación a validar:** unificar `pizzaMode` en un solo bloque, donde personalizada = «Personalizar durante la orden» y especialidad = receta marcada. Si se unifica, cubrir el impacto en el snapshot y en mobile.
- Productos legados con `fraction.enabled` (sabores): siguen funcionando en captura; el editor sólo permite desactivarlos (B2).
- Compatibilidad: parser que acepte `baseGroupId` legado y lo normalice a `[id]` (sólo si hay datos o borradores locales con la forma vieja).
- Lista de archivos afectados, con CodeGraph sobre `baseGroupId|extraGroupIds|pizzaMode`.
- **Puerta:** Sonnet presenta el delta a Emmanuel en una pantalla, con un ejemplo: «Pizza Italiana y chorizo», $150, base = Ingredientes de pizza (pepperoni, champiñón, aceituna negra, pimiento verde) + Vegetales; extras = Orilla de queso y Aderezo ranch. Hacer **sólo** la pregunta de unificar o no `pizzaMode`; lo demás ya está decidido.

**B1 `pizza-model-v2-delta`** (Codex `-Effort medium`, `-After B0`), una tarea por capa encadenada:
1. `B1a` shared-types y domain, con unitarias: varios grupos base, N repartido entre grupos, extras por opción, opción duplicada base/extra rechazada, parser legado.
2. `B1b` SQL: editar en sitio `20261120000100_pizza_model_v2.sql` y `supabase/tests/pizza_model_v2_invariants.sql`, sólo si §0.3 confirmó que no están aplicadas (si no, migración nueva). Incluir la pertenencia de las opciones a los grupos asignados en `save_menu_catalog` (deuda de P3-2).
3. `B1c` API (`capture-pizza-pricing.ts`, `menu-catalog-domain.ts`, codec) y su contract test.
4. `B1d` mobile (`apps/mobile/src/order-draft.ts`): sólo adaptar los tipos.

Revisión de nivel A sobre B1a y B1b: dsh, más el subagente `reviewer` Sonnet. Sonnet corre el **verificador rollback-only remoto** de la migración completa (BEGIN → migración → invariantes → ROLLBACK, técnica de HANDOFF 2026-11-02), que P3-2 nunca ejecutó. **Aplicar en remoto requiere autorización explícita de Emmanuel**, con el procedimiento de la memoria `remote-migration-apply-procedure`.

**B2 `pizza-editor-r2`** (dsh `-Write`, `-After B1a`, nivel C; cadena sobre el editor), en `pizza-v2-editor.tsx` y lo mínimo de `menu-catalog-editor.tsx:716-740`:
- Quitar el check «Permitir mitades». Si el producto ya lo tiene activo, mostrar un aviso «Mitades por sabores (modelo anterior)» con el botón «Desactivar».
- Botón «Configurar especialidades» (antes «Configurar pizza por mitades») como botón completo, no enlace, e independiente de las mitades.
- «Gestionar grupos» como botón completo (mismas clases que los demás botones secundarios, 44 px).
- Sin un segundo selector de grupo dentro del bloque. Los grupos base se marcan de entre los grupos ya asignados con el desplegable de grupos del producto, rotulados «Gratuitos (cuentan contra N)». Debajo de cada grupo base, sus opciones con casilla e imagen para la receta. Antes de las casillas, la casilla «Personalizar durante la orden», que desmarca y pone en gris la receta.
- «Extras (siempre se cobran)»: por cada grupo asignado, sus opciones sueltas con casilla, imagen y precio.
- Hecho cuando: tests de `W/lib/menu-pizza.ts` (helpers de alternar base, receta y extra) y puertas web en verde.

**B3 `pizza-option-tiles`** (dsh `-Write`, en paralelo con B2 si se extrae a un archivo nuevo): componente `menu/option-check-tile.tsx`, con casilla, miniatura (`menuImagePublicUrl(option.imagePath)` o un placeholder), nombre y precio opcional. Rejilla desde `sm`; **lista vertical** por debajo de `sm`; target de 44 px. B2 lo consume. Si B3 termina antes, B2 lo usa; si no, B2 encadena `-After B3`.

**B4 `pizza-capture-r2`** (dsh `-Write`, `-After B1c`): `capture/pizza-section.tsx`, `W/lib/pizza-capture.ts` y `product-sheet.tsx`. Captura muestra los grupos base y los extras por opción con el mismo tile de B3. El contador «3 de 2 gratis · +$X» usa el monto **del API**; el cliente no calcula dinero.

---

## 4. Fase Z · Zonas de entrega por colonia (nivel A: esquema, RLS y cuota de envío)

Causa del problema: `DeliveryZonesService.matchAddress` (`apps/api/src/delivery-zones.ts:345-400`) y `packages/domain/src/delivery-zone.ts` cruzan la dirección **sólo** con `postalCode` y `locality` (ciudad). El formulario (`customers/customer-editor.tsx:343-356`) pide localidad, estado, país y CP, aunque el operador nunca los captura. La colonia (`neighborhood`) existe en la dirección, pero ninguna zona la usa.

**Z0 `sepomex-navojoa-data`** (Emmanuel + dsh):
- La descarga del catálogo SEPOMEX (Correos de México, «Consulta de códigos postales → descargar», Sonora, TXT o XLS) la hace **Emmanuel** y la deja en `data/sepomex/` (los agentes no descargan archivos externos ni pasan formularios web).
- dsh escribe `tools/sepomex/extract-navojoa.ts`, que filtra el municipio de Navojoa y produce `supabase/seed-data/navojoa-settlements.csv` (cp, colonia, tipo de asentamiento, municipio, estado) más una forma normalizada (minúsculas, sin acentos).
- Hecho cuando: el script es determinista, tiene test con una muestra y el conteo de filas va al reporte.

**Z1 `delivery-zones-by-settlement-spec`** (Codex sin `-Write`): `docs/architecture/DELIVERY_ZONES_V2.md`.
- Tabla de referencia de asentamientos: global, de sólo lectura para clientes, sin `restaurant_id` porque es dato público. Justificar el RLS.
- Relación zona ↔ asentamiento, con alcance de restaurante y sucursal.
- La dirección guarda `settlementId` además del texto de la colonia.
- Coincidencia: primero `settlementId`, luego la colonia normalizada, luego el CP como respaldo para datos legados.
- Respuesta de rechazo **con motivo**: «La colonia X no está en ninguna zona de la sucursal Y», «Colonia no reconocida en Navojoa» o «Falta la colonia».
- Ciudad, estado, país y CP se derivan de la sucursal y del catálogo.
- Backfill de direcciones existentes (coincidencia por nombre normalizado; las ambiguas quedan sin `settlementId` y se muestran para revisión).
- Impacto en la cuota de envío y su snapshot.
- **Puerta:** Sonnet presenta la especificación a Emmanuel.

**Z2 `delivery-zones-settlements-sql`** (Codex, `-After Z1` y Z0): migración nueva más seed, invariantes y aislamiento en `supabase/tests/`, y el verificador rollback-only remoto. Aplicar en remoto requiere autorización.

**Z3 `delivery-zones-settlements-api`** (Codex `-Effort medium`, `-After Z2`): domain `delivery-zone.ts` y `delivery-quote.ts`, API (`delivery-zones.ts` y la búsqueda de asentamientos por prefijo para el autocompletado) y contract tests. Nivel A por la cuota de envío.

**Z4 `delivery-zones-editor-ui`** (dsh, `-After Z3`): `/app/delivery-zones` define cada zona eligiendo colonias (buscador con multiselección y chips, más «seleccionar todas las de un CP»). El CP deja de ser el campo principal.

**Z5 `address-form-settlement`** (dsh, `-After Z3`; encadenada con el carril Clientes porque toca `customer-editor.tsx`, va después de K4):
- `AddressForm` pasa a tener calle y número, interior, colonia (combobox del catálogo con debounce de 500 ms; el CP se muestra de sólo lectura al elegir) y referencias.
- Se ocultan localidad, estado, país y CP.
- En Captura (`capture-customer.tsx`) se muestra el motivo exacto que devuelve Z3.

---

## 5. Orden de encolado

```
Ola 1 (en paralelo): K0 | K1 → K2 | K4 | B0 | Z0 | Z1
                     (puertas: Emmanuel aprueba B0 y Z1)
Ola 2:               tarea B que derive de K0 → K3
                     B1a → B1b → B1c → B1d | B3 → B2 (tras B1a) | B4 (tras B1c)
                     Z2 → Z3 → Z4 | Z5 (tras Z3 y K4)
Ola 3:               verificación (§6)
```

`queue.maxParallel` es 4: un solo `drain.ps1 -Wait` en background por ola.

---

## 6. Cierre de cada ola (Sonnet)

- Puertas globales una vez por ola, en Node 24 (memoria `node24-and-pnpm-shim`): `pnpm turbo run lint typecheck test build --force`. La salida real va al informe.
- Verificación en navegador, escritorio y 390×844: portada de Captura por canal, Alt+N desde Menú y Clientes, Alt+Shift+R, Escape con desplegable, hoja y modal, configuración de pizza con dos grupos base y extras por opción, quitar teléfono, y un domicilio en Navojoa validado por colonia. El login necesita la cuenta de Emmanuel (`tools\agentic\local-servers\e2e-auth.bat`). Sin login, la tarea queda en REVIEW con «sin verificación visual».
- Generar `docs/smoke/smoke-<fecha>.html` con el formato de `smoke-2026-11-05.html`, un ítem por tarea y los pasos exactos de lo que falló en r2.
- Pendientes heredados de la ronda 1, que van en el mismo smoke: revisión de código de P3-4 y P3-5 (nunca hecha), SQL de P3-2 sin ejecutar (lo cubre B1b) y la Fase 4 sin verificar en 390×844.
- TODO.md con cada tarea en REVIEW y su nota. HANDOFF.md con los motores, las rondas, el costo (tokens de Codex y cupo de dsh) y cada desvío a Claude con su motivo.
- Worktrees: borrarlos tras integrar con `.harness/bin/remove-worktree.ps1 -Id <id> -DeleteBranch`.
- Sin push, sin migraciones remotas y sin importar datos al remoto sin autorización explícita de Emmanuel.
