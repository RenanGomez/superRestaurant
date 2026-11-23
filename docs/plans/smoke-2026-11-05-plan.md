# Plan · Correcciones del smoke 2026-11-05

Fuente: `smoke-2026-11-05.json` (raíz del repo, notas de Emmanuel del 2026-11-20). Plan redactado el 2026-11-19 por Opus en la sesión de planificación. No se modificó código.

**Para quién es este documento:** la sesión orquestadora (Claude **Sonnet**, L0). Sonnet no escribe código: arma los briefs, encola, revisa diffs, integra y documenta. **dsh** (DeepSeek V4.1 Flash vía OpenCode Go) y **Codex** (cuenta B) implementan. Reglas vigentes: `AGENTS.md` (§19.2 niveles, §19.3 rondas, §19.4 prioridad de motores), `.harness/ORCHESTRATOR.md`, `.harness/routing.md`. Lee esos tres una vez y no los vuelvas a abrir.

---

## 0. Antes de lanzar nada (Sonnet)

1. Leer `TODO.md` (sólo la tabla «Día operable» y las secciones de retroalimentación) y el primer bloque de `HANDOFF.md`.
2. El árbol tiene cambios sin commitear del harness (`.harness/**`, `.claude/settings.json`, `.gitignore`). No son de este plan. No los toques; tampoco los commitees sin preguntar a Emmanuel. Las tareas de este plan sólo tocan `apps/**` y `packages/**`, que están limpios, así que `-Worktree` es seguro.
3. Registrar en `TODO.md` una sección «Smoke 2026-11-05» con las tareas de abajo, todas TODO. En `HANDOFF.md`, una línea que apunte a este archivo.
4. Hacer a Emmanuel las preguntas de §6 **antes** de la Fase 3. Las fases 1, 2 y 4 no dependen de esas respuestas: arrancan ya.

### Reparto de motores para este plan

| Trabajo | Implementa | Revisa |
|---|---|---|
| Nivel C (UI web) | dsh `-Write -Effort low`; reintento con `-Effort medium` y el mismo `-Id` | Codex `-Effort low`, una sola ronda (§19.3) |
| Diagnóstico (bugs sin causa confirmada) | Codex `-Effort medium`, sin `-Write` | Sonnet lee el informe |
| Nivel B | dsh `-Write -Effort medium` | Codex, máximo dos rondas |
| Nivel A (modelo de pizza) | Codex `-Effort medium` (`high` sólo en un reintento) | dsh revisa, más un subagente `reviewer` Sonnet como segunda familia |

- Gemini no forma parte de este plan. Si Codex está sin cuota, el fallback `codex→dsh` de `config.json` actúa solo. Anótalo en HANDOFF.
- **Codex rompe acentos al escribir texto no ASCII.** Todo brief a Codex que cambie textos de UI debe pedir escapes `á` o comprobar el diff. Para dsh no hace falta.
- Cada brief incluye la línea de Ponytail y la cláusula de limpieza de `routing.md`.

### Archivos cuello de botella: un solo escritor a la vez

- `apps/web/src/app/app/capture/capture-workspace.tsx` (93 KB): todas las tareas que lo tocan van **encadenadas** con `-After`.
- `apps/web/src/app/app/menu/menu-catalog-editor.tsx` (98 KB): igual.
- En los briefs, cita siempre el **rango de líneas**, nunca «lee el archivo». Esas líneas pueden moverse cuando se integre la tarea anterior de la cadena: antes de encolar la siguiente, recalcula los rangos con `codegraph explore "<símbolo>"`.

---

## 1. Inventario del smoke → tareas

| Sección del smoke | Resultado | Hallazgo | Tarea |
|---|---|---|---|
| prep-start, prep-e2e, cap-cash, cap-instr, menu-drag, menu-groups, menu-draft | ok | — | Pasar a DONE en TODO las tareas que cubren (con aprobación de Emmanuel ya dada en el smoke) |
| cap-ticket | ok con notas | La vista móvil (390 px) queda angosta por la barra lateral; Emmanuel pide un rework estilo Uber Eats | R1, R2 |
| cap-ticket | | Las pestañas de categoría de Captura sólo muestran el color, sin la imagen | C5 |
| cap-ticket | | «Sabores» debe poder dejarse sin sabor (pizza personalizada) y hay que replantear el modelo de pizza | Fase 3 |
| cap-keys | **fail** | No responden N, Alt+N, Alt+K, Escape ni Alt+R | C3 |
| cap-cust | **fail** | 12 puntos | C1, C2, C4, C6, D1, D2 |
| menu-cat | ok con notas | Recorte y zoom de foto; la lista de fotos recientes se atrasa una foto; unificar listas; falta indicar el guardado | M3, M4 |
| menu-dup | ok con notas | Menú de tres puntos (Duplicar, Archivar, Quitar), sección «Archivados» y modal de confirmación | M2 |
| menu-prod | sin estado | Quitar la pestaña «Tamaños» y sus presets: cada producto define sus tamaños | M1 |
| menu-locked | ok | Quitar la opción «Ingredientes que no se pueden quitar» (pasa a otra fase) | M0 |

Causas ya localizadas (mapeo de código de solo lectura del 2026-11-19; `W` = `apps/web/src`, `CW` = `W/app/app/capture/capture-workspace.tsx`):

- **Atajos:** `W/lib/shortcut-dispatch.ts:46` descarta todo atajo, salvo Escape, si el foco está en un input. Además, la tabla de atajos (CW:1024-1029) sólo habilita `search` cuando hay un borrador abierto: Escape y Alt+R sólo funcionan en una captura confirmada o en conflicto, y Alt+N sólo funciona sin captura abierta. La «N» sola **no está asignada por diseño** desde `capture-ux-r1` (una letra sola no dispara nada). Hay que decírselo a Emmanuel.
- **Reanudar un borrador pierde las direcciones:** `recover()` (CW:612) llama a `refreshWorkspace` (CW:595-607), que nunca ejecuta `run("detail", {customerId})`. Por eso `customer` queda `undefined` y `CaptureCustomerCard` (CW:1157) no se pinta.
- **Estado «inválida» que no se limpia:** el estado local `note` de `capture-customer.tsx:~155` está indexado por `addressId` y sólo se limpia en «Editar», `saveAddress` o `refresh`.
- **Los «?» reciben el foco con Tab:** el botón de `W/components/field-hint.tsx:50` no tiene `tabIndex={-1}`.
- **Búsqueda de cliente en Captura:** CW:1146-1160 es un formulario con submit y resultados inline, sin debounce. El autocompletado con debounce de 250 ms sólo existe en `customers/customer-editor.tsx:~70-90`, mediante `getCustomerDirectorySuggestions` (`W/lib/customer-directory.ts:59`).
- **Borradores:** el folio y la versión se pintan en CW:1053-1055. Las tarjetas recuperables (CW:1082-1097) muestran `shortCaptureDraftId`. El borrador se crea en el servidor al pulsar «Nueva captura» (`create()`, CW:579-585).
- **Botón «Directorio»:** CW:1424 y `capture-customer.tsx:171` enlazan a `/app/customers` sin parámetros.
- **Teléfono:** el SQL `search_customer_directory` (`supabase/migrations/20260920000100…sql:31-34,75-76`) busca la subcadena `strpos(normalized_value, key)`. Por esa regla, 6622751352 no debería devolver 6622900622. Sospechosos: un segundo teléfono de Carolina, un `normalized_value` mal formado o el filtro web `includes` de `W/lib/customer-directory.ts:87`.
- **Cobertura:** `W/app/app/delivery-match-action.ts` llama a `DeliveryZonesService.matchAddress` (`apps/api/src/delivery-zones.ts:345-400`), que decide **sólo con `{postalCode, locality}`**. HANDOFF ya tenía pendiente «CP 85860 en Zonas». El punto 11 («ya ninguna dirección es válida») puede ser una regresión o una zona mal configurada.
- **Fotos del menú:** `MenuPhoto` está en menu-catalog-editor.tsx:1141-1306 y `UsedPhotos` en :1409. `retainImagePaths` (`W/lib/menu-used-images.ts:25-28`) sólo agrega rutas, y la lista se alimenta con un efecto (:206-209) que va un render atrasado. No existe recorte ni foco de imagen.
- **Producto:** `MenuProductV1.active` ya existe (`packages/shared-types/src/index.ts:385`), así que Archivar puede ser `active=false` sin migración. Las acciones están en menu-catalog-editor.tsx:686-700, y ya existe un diálogo de confirmación para Quitar (~:594).
- **Tamaños:** la pestaña `tamanos` está en `W/lib/menu-tabs.ts:6-13` y en editor:548-575. El selector por variante está en :758-762. En SQL, `size_preset_id` es nullable, **pero cuando la variante tiene preset el SQL sobrescribe su nombre con el del preset**.
- **Ingredientes bloqueados:** la UI está en editor:856-902. Ojo con la regla vigente «lista vacía legada ⇒ todo bloqueado» (HANDOFF 2026-11-05).
- **Barra lateral:** `W/app/app/app-nav.tsx:32` es un riel fijo de `w-[76px]` por debajo de `lg` y nunca se oculta.
- **Modelo de pizza:** no existen ni el tipo de producto ni el conteo de ingredientes gratuitos. Hoy la pizza se define por `fraction.enabled` más los grupos. El precio lo calcula `app_private.replace_capture_selection_plan` (versión vigente en `20261008000200_catalog_halves_product_level.sql:1077`); en dominio, `createMenuProductPriceSnapshot` (`packages/domain/src/menu.ts:175`).

---

## 2. Fase 1 · Captura y shell (nivel C; arranca ya)

Hay dos carriles en paralelo, más un diagnóstico.

### Carril A: cadena sobre `capture-workspace.tsx` (dsh `-Write -Worktree`, encadenada con `-After`)

**C1 `capture-drafts-tidy`**: puntos 5, 8, 9 y 10 del smoke.
- Quitar folio, versión e ID del encabezado (CW:1053-1055) y de las tarjetas recuperables (CW:1082-1097). Llevar folio y versión a una línea discreta al **final** de la sección «Captura telefónica». En la tarjeta: cliente, teléfono, canal, cantidad de líneas y antigüedad (lo que ya traiga el item). Si el item no trae cliente o líneas, la tarea reporta qué campos faltan y no inventa nada: eso pasa a la tarea B `capture-draft-list-summary`.
- Al reanudar un borrador, tras `refreshWorkspace`, si el snapshot tiene `customerId` ejecutar `run("detail", {customerId})` para que reaparezcan el cliente y sus direcciones.
- Borradores vacíos (punto 8): no listar como recuperables los que no tienen cliente ni líneas. Si la lista no expone esos datos, la tarea B los añade. **No** cambiar en esta tarea el momento en que se crea el borrador.
- Hecho cuando: puertas web en verde, más un test unitario del helper que decide si un borrador «vale la pena» (si se extrae a `W/lib/capture-workspace.ts`).

**C2 `capture-customer-search`** (`-After C1`): puntos 1, 6 y 12.
- Extraer la búsqueda a un componente nuevo, `W/app/app/capture/capture-customer-search.tsx`. En CW sólo se reemplaza el bloque 1146-1160.
- Combobox accesible (`role="combobox"`, listbox flotante, flechas, Enter, Escape) con debounce de **500 ms**, reutilizando `getCustomerDirectorySuggestions`. La lista se cierra al elegir.
- Sin resultados: la opción «Crear cliente rápido con <teléfono/nombre>» abre en la misma pantalla el alta rápida que ya existe en Clientes. Reutiliza la acción existente, no crees una nueva. Al guardar, el cliente queda seleccionado en la captura.
- «Directorio» (CW:1424) abre `/app/customers?customerId=<id>` cuando hay cliente. `customers/page.tsx` y `customer-editor.tsx` deben aceptar ese parámetro y abrir el cliente.
- Hecho cuando: puertas web en verde, más tests de los helpers puros (normalizar la consulta y decidir si se ofrece el alta rápida).

**C3 `capture-shortcuts-r2`** (`-After C2`): cap-keys.
- En `shortcut-dispatch.ts`, los atajos con Alt o Ctrl disparan también con el foco en inputs; las letras solas siguen sin disparar.
- Revisar la tabla de CW:1024-1029:
  - Alt+N crea una captura nueva también con una abierta (con el flujo de confirmación existente si hay cambios).
  - Ctrl+K y Alt+K enfocan la búsqueda de cliente.
  - Escape cierra el combobox, el diálogo o la hoja abierta.
  - Alt+R reinicia o vuelve a la lista si no hay nada pendiente.
- Usar `event.code` (`KeyN`) como respaldo de `event.key`.
- Leyenda visible de atajos (tooltip o pie).
- Hecho cuando: tests de `shortcut-dispatch` cubren foco en input con Alt y Ctrl, letra sola ignorada y Escape. Puertas web en verde.

### Carril B: archivos disjuntos (dsh `-Write`, en paralelo con el carril A)

**C4 `field-hint-tab`**: punto 3. `tabIndex={-1}` en el botón de `field-hint.tsx`; la ayuda sigue accesible con el ratón y por `aria-describedby` si existe. Trivial: lo revisa Sonnet con `git diff`.

**C5 `capture-menu-category-images`**: cap-ticket 1. En `capture-menu.tsx:13-23,62-69`, pintar `entry.category.imagePath` con `menuImagePublicUrl` (como en :86) sobre el color. Si no hay imagen, queda el color. Target de 44 px y `alt` vacío decorativo, con el nombre como texto.

**C6 `capture-address-state`**: puntos 4 y 7 (parte UI). En `capture-customer.tsx`:
- Limpiar `note[addressId]` cuando cambia la `version` o el contenido de la dirección.
- Mostrar el **motivo** del bloqueo: «CP 85860 sin zona en Navojoa» en vez de un «Fuera de cobertura» genérico, usando lo que ya devuelva `matchDeliveryAddress`. Si la respuesta no trae ese motivo, reportarlo y no inventarlo.
- El enlace «Abrir el cliente en Directorio» de :171 lleva `?customerId=` (coordinar con C2: el parámetro lo lee la página de Clientes que toca C2; C6 sólo construye el enlace).

**R1 `shell-mobile-nav`**: cap-ticket (barra lateral). En `app-nav.tsx` y `app/app/layout.tsx`: por debajo de `sm`, ocultar el riel y usar una barra inferior fija con las 4-5 secciones principales más «Más» (hoja con el resto). Debe respetar `safe-area-inset-bottom` y targets de 44 px. Desde `sm` se conserva el comportamiento actual.

### Diagnóstico (en paralelo, sin `-Write`)

**D1 `customer-phone-search-diag`** (Codex `-Effort medium`): punto 2. Reproducir con un test de `W/lib/customer-directory.ts` (filtro de la línea 87) y leer el SQL. Sonnet, como orquestador, puede correr **una consulta read-only** (AGENTS §3.1) a `app.customer_phones` de esos dos clientes, con el script del runbook remoto, sin escribir nada. Entregable: la causa y un fix propuesto. El fix es nivel B si toca SQL (migración nueva y sonda rollback-only) y nivel C si es sólo el filtro web.

**D2 `delivery-coverage-diag`** (Codex `-Effort medium`): puntos 7 y 11. Leer `apps/api/src/delivery-zones.ts:345-400` y la configuración de zonas (read-only), y explicar por qué ninguna dirección resulta cubierta. Distinguir entre datos (la zona no incluye el CP o la localidad no coincide por acentos o mayúsculas) y código (la comparación). Entregable: causa, fix y la parte que le toca a Emmanuel (por ejemplo, agregar el CP en /app/delivery-zones).

Al terminar la ola: integrar las ramas `harness/<id>` en orden (C1→C2→C3, luego C4, C5, C6, R1), correr una vez las puertas globales y abrir con D1 y D2 las tareas de corrección que salgan.

---

## 3. Fase 2 · Editor de menú (nivel C; cadena única sobre `menu-catalog-editor.tsx`)

Arranca en paralelo con la Fase 1: son archivos distintos. Todo con dsh `-Write -Worktree`, encadenado:

**M0 `menu-hide-locked-ingredients`**: menu-locked.
- Quitar de la UI el bloque «Ingredientes que no se pueden quitar» (editor:856-902).
- **No** borrar ni vaciar `lockedIngredientOptionIds`: el editor conserva lo que venga del servidor.
- **Antes de integrar**, comprobar en captura (`product-sheet.tsx`, `W/lib/line-halves.ts`) qué pasa con un producto cuya lista está vacía o es legada, por la regla «lista vacía legada ⇒ todo bloqueado». Si con la UI oculta el operador ya no puede quitar ingredientes que antes sí podía, **parar** y escalar a Sonnet: invertir la regla es una migración de nivel A que requiere autorización de Emmanuel.

**M1 `menu-sizes-inline`** (`-After M0`): menu-prod.
- Quitar la pestaña `tamanos` (`menu-tabs.ts`, editor:548-575) y el selector de preset por variante (:758-762). Cada variante edita su nombre libremente, como en «Personalizado».
- **Invariante:** al guardar, toda variante sale con `sizePresetId: null`. Si no, el SQL sobrescribe el nombre con el del preset. Los presets quedan en la base sin uso; no hay migración.
- Migrar el borrador local (`menu-draft-storage.ts`): un borrador viejo con `sizePresets` debe cargar sin error. Test de esa migración.
- Hecho cuando: test de que `sizePresetId` sale null en el payload de guardado, más las puertas web.

**M2 `menu-product-actions`** (`-After M1`): menu-dup.
- Botón ⋯ en la posición actual de «Quitar», con menú accesible (flechas y Escape) y las opciones Duplicar, Archivar y Quitar. Se eliminan de la tarjeta el botón Duplicar y la casilla «Activo».
- Archivar pone `active=false`. Los archivados salen de su categoría y van a una sección «Archivados» al final, **colapsada por defecto**. En esa sección, el ⋯ ofrece «Desarchivar».
- Quitar abre un modal propio de la página (reutilizar el diálogo de ~:594, sin `confirm()`) y elimina el producto del borrador.
- Revisar que `ACTIVE_HINT` y los textos que hablan de «Activo» queden coherentes.

**M3 `menu-photos-recent`** (`-After M2`): menu-cat puntos 2 y 3.
- Una sola lista «Fotos recientes». Corregir el desfase: la ruta nueva debe aparecer en el mismo render del `onChange`. Derivar la lista en `useMemo` a partir de lo retenido más lo actual, sin efecto atrasado. Test en `menu-used-images.test.ts` que reproduzca la secuencia del smoke: subir A, reemplazar por B, subir C.
- Indicador visible «Guardado en el borrador ✓» tras cada cambio de foto, junto al botón «Listo» del modal, para que se entienda que el cambio ya se guardó.

**M4 `menu-photo-crop`** (`-After M3`): menu-cat punto 1.
- Al subir o reemplazar una foto, diálogo de encuadre con zoom (slider y rueda), arrastre para mover y un marco del aspecto que usa la tarjeta.
- El recorte se hace **en el cliente**, con canvas, antes de subir; reutilizar `W/lib/menu-image-resize.ts`. Así no se toca esquema ni API, y desaparece la tarea A `menu-photo-focus` de TODO: márcala CANCELLED, reemplazada por M4.
- El componente nuevo va en `W/app/app/menu/photo-crop-dialog.tsx` y la integración en el editor debe ser mínima. Teclado: flechas para mover y `+`/`-` para el zoom. Respetar `prefers-reduced-motion`.
- La lógica pura de cálculo del rectángulo de recorte va en `W/lib/` con tests.

---

## 4. Fase 3 · Modelo de pizza: personalizada vs. especialidad (nivel A)

**No iniciar la implementación sin las respuestas de §6 y sin la aprobación de la especificación.** Sustituye a `menu-specialties` (P3) de TODO y cierra su bloqueo.

Requisitos de Emmanuel (resumidos de cap-ticket):
1. Los productos son pizza, boneless, papas, bebidas o postres.
2. Una pizza es **personalizada** o **especialidad**.
3. La personalizada incluye N ingredientes gratuitos, configurable por producto (mínimo 2 por defecto). Cada ingrediente por encima de N se cobra. En mitad y mitad, N sigue siendo el mismo para toda la pizza.
4. Configuración del producto:
   - **Grupo de modificadores base**: al elegirlo, aparecen debajo sus ingredientes, se permitan mitades o no.
   - **«Grupo de ingredientes para especialidad»**, que sustituye a «ingredientes que no se pueden quitar»: se marcan los ingredientes que la especialidad trae por defecto, incluidos en el precio. Antes de las casillas va «Personalizar durante la orden»: al marcarla se desmarcan todas y se ponen en gris, porque se eligen al tomar la orden.
   - **«Grupo de ingredientes extra»**: casillas para elegir grupos que siempre se cobran (puede repetirse el grupo base, más orillas, aderezos…).
   - Ejemplo: «Pizza Italiana y chorizo», $150, base = Ingredientes de pizza con pepperoni, champiñón, aceituna negra y pimiento verde (sin costo), extras = orillas y aderezos.
5. En captura, «Sabores» debe permitir **no elegir sabor** (pizza personalizada).

### Pasos

**P3-0 `pizza-model-spec`** (Codex `-Effort medium`, sin `-Write`): redactar `docs/architecture/PIZZA_MODEL_V2.md`.
- Contenido:
  - Campos nuevos en `MenuProductV1`: por ejemplo `pizzaMode: "custom" | "specialty" | null`, `freeIngredientCount`, `baseGroupId(s)`, `defaultIngredientOptionIds`, `customizeAtOrder` y `extraGroupIds`. Debe reutilizar `modifierGroupIds` y `fraction`, no duplicarlos.
  - Compatibilidad con los grupos de sabores actuales y con `lockedIngredientOptionIds`.
  - Algoritmo de precio con mitades y orden de aplicación (§9).
  - Snapshot de `OrderItem`.
  - Cambios en `replace_capture_selection_plan` y `confirm_capture_draft_v3`.
  - Impacto en `apps/mobile/src/order-draft.ts:377-400`.
  - Migración y backfill, pruebas de invariantes y riesgos.
- Entradas: `.claude/packets/menu-modifier-model-v2-research.md`, `packages/shared-types/src/index.ts` (rangos 328-420 y 1122-1215), `packages/domain/src/menu.ts` y `20261008000200…sql` (rango de :1077).
- Sonnet revisa la especificación y se la presenta a Emmanuel. **Puerta: aprobación de Emmanuel.**

**P3-1 `pizza-model-contracts`** (Codex): shared-types y domain (validación, cálculo puro de ingredientes cobrables y precio de mitades) con unitarias exhaustivas: 0, N, N+1 y N+k ingredientes, mitades con ingredientes repetidos y redondeo.

**P3-2 `pizza-model-sql`** (Codex, `-After P3-1`): una migración nueva (nunca editar una aplicada), funciones de precio y confirmación, invariantes en `supabase/tests/`, aislamiento por restaurante e idempotencia. Sonnet corre la **sonda rollback-only remota** (técnica de HANDOFF 2026-11-02: BEGIN → migración → invariantes → ROLLBACK). **Aplicar en remoto requiere autorización explícita de Emmanuel**, con el runbook de la memoria `remote-migration-apply-procedure`.

**P3-3 `pizza-model-api`** (dsh `-Effort medium`, `-After P3-2`): `apps/api/src/menu-catalog*.ts`, contract tests.

**P3-4 `pizza-model-editor-ui`** (dsh, `-After P3-1`, puede correr en paralelo con P3-2 y P3-3; va encadenada **después** de M4 por el editor): la configuración descrita en el punto 4.

**P3-5 `pizza-model-capture-ui`** (dsh, `-After P3-3`): en `product-sheet.tsx`, especialidad con sus ingredientes por defecto, personalizada con contador «3 de 2 gratis · +$X» (el monto **lo devuelve el API**, el cliente no calcula dinero) y «Sin sabor».

Revisión de nivel A: dsh, más un subagente `reviewer` Sonnet, más Codex `review` sobre P3-1 y P3-2. A partir de la tercera ronda, lo pendiente pasa a deuda en HANDOFF (§19.3).

---

## 5. Fase 4 · Rework móvil estilo Uber Eats (nivel C, después de R1)

**R2-0 `mobile-capture-spec`** (Codex sin `-Write`): wireframe en texto (`docs/architecture/MOBILE_CAPTURE_UX.md`) de Captura a 390×844.
- Categorías con imagen en carrusel horizontal y productos en tarjetas grandes con foto.
- Hoja inferior de producto, carrito flotante con total (el total lo calcula el API), cliente y entrega como pasos.
- Debe reutilizar los componentes de C5 y la hoja de producto existente.
- **Puerta:** Emmanuel aprueba el boceto.

**R2-n:** tareas dsh de 1 a 3 archivos que salgan del boceto. No arrancar antes de integrar la Fase 1, que toca los mismos archivos de captura.

---

## 6. Preguntas para Emmanuel (Sonnet las hace al empezar; bloquean sólo la Fase 3 y R2)

1. **Mitad y mitad entre dos especialidades:** ¿se cobra el precio de la más cara, el promedio o un precio fijo del producto?
2. **Precio de cada ingrediente extra:** ¿el precio propio de la opción del grupo, como hoy, o una tarifa única por tamaño?
3. **Ingredientes gratuitos:** ¿el número N es por producto o por tamaño (chica 2, grande 3…)?
4. **Mitades en la personalizada:** un ingrediente que va sólo en una mitad, ¿cuenta como 1 o como ½ contra N?
5. **Especialidad sin un ingrediente de los que trae:** ¿se permite quitarlo? ¿Se descuenta algo o se puede cambiar por otro sin costo? (Los «bloqueados» se movieron a otra fase.)
6. **Tipo de producto** (pizza, boneless, papas, bebidas, postres): ¿basta con la categoría, o el producto necesita un campo de tipo? Recomendación: no agregar el campo, porque el comportamiento de pizza sale de la configuración.
7. **Quitar un producto ya publicado:** confirmar que se borra del catálogo. El historial de órdenes no se pierde porque guarda snapshots.
8. **Zonas:** ¿la zona de Navojoa debe cubrir el CP 85860? (Pendiente desde el 2026-11-01; puede ser la causa de los puntos 7 y 11.)
9. **Atajos:** la «N» sola no se asignó a propósito, para no disparar acciones al escribir. ¿Se queda así?

---

## 7. Cierre de cada ola (Sonnet)

- Puertas globales una vez por ola, en Node 24 (memoria `node24-and-pnpm-shim`): `pnpm turbo run lint typecheck test build --force`. La salida real va al informe.
- Verificación visual: el login exige la cuenta de Emmanuel. Si `apps/web/playwright/.auth/user.json` no sirve, pedirle `tools\agentic\local-servers\e2e-auth.bat`. Si no está disponible, dejar la tarea en REVIEW con «sin verificación visual».
- Generar `docs/smoke/smoke-<fecha>.html` con el mismo formato que `smoke-2026-11-05.html`, con un ítem por tarea integrada y los pasos exactos para repetir lo que falló (cap-keys, cap-cust 1-12, menu-cat, menu-dup y menu-prod).
- TODO.md: cada tarea en REVIEW con su nota. HANDOFF.md: motores usados, rondas y costo (tokens de Codex y cupo de dsh), y desvíos a Claude con su motivo.
- Worktrees: borrarlos tras integrar, sólo con `.harness/bin/remove-worktree.ps1 -Id <id> -DeleteBranch` (memoria `worktree-cleanup-on-windows`).
- Sin push ni migraciones remotas sin autorización explícita de Emmanuel.

## 8. Orden de encolado sugerido

```
Ola 1 (en paralelo):  C1 → C2 → C3   |  C4, C5, C6, R1  |  D1, D2  |  M0 → M1 → M2 → M3 → M4
                      (tras las respuestas de §6) P3-0
Ola 2:                correcciones derivadas de D1/D2 · P3-1 → P3-2 → P3-3 → P3-5 · P3-4 (tras M4 y P3-1)
Ola 3:                R2-0 → R2-n
```

`queue.maxParallel` es 4: drain va sirviendo las cadenas en orden. Un solo `drain.ps1 -Wait` en background por ola.
