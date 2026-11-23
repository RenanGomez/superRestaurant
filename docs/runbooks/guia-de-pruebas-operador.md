# Guía única de pruebas del operador — superRestaurant

**Fecha:** 2026-11-23 · **Propósito:** permitir a Emmanuel probar y aprobar de una sola pasada todo lo que está en estado `REVIEW` en `TODO.md` (bloques D1–D7, T1–T4, retroalimentaciones de noviembre, Smoke r1/r2 y cierres recientes en `main`), organizado por flujo real de operación.

Cada prueba tiene **de 3 a 5 toques** y un **resultado esperado** verificable. Nada aquí se da por aprobado sin probarse en navegador; donde falte una migración en remoto o un dato previo se advierte explícitamente.

---

## 1. Cómo arrancar el entorno

### 1.1. Prerrequisitos (una sola vez)

1. **Node 24.19.0 y pnpm 11.19.0** instalados en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`. Si ejecutas comandos manuales en PowerShell, activa primero la versión correcta en esa ventana:
   ```powershell
   . .\tools\agentic\use-node24.ps1
   node -v   # v24.19.0
   pnpm -v   # 11.19.0
   ```
2. **Variables de entorno locales:**
   - `.env.adr010.local` en la raíz del repositorio (conexión PostgreSQL/Supabase del API).
   - `apps/web/.env.local` con `RECEIPT_COOKIE_SECRET` de al menos 32 caracteres aleatorios (sin esto el cobro se registra, pero el recibo durable muestra «Recibo no disponible»).
3. **Navegador limpio:** desactiva Grammarly u otras extensiones que inyectan controles sobre `http://localhost:8082`. Abre las herramientas de desarrollador (**F12 → Consola**) durante la prueba y anota cualquier error rojo.

### 1.2. Arranque rápido (API + Web)

1. Haz doble clic en `tools\agentic\local-servers\start-local.bat` (o ejecuta `tools\agentic\local-servers\start-local.bat nobuild` si ya compilaste el API y no hubo cambios de backend).
2. Espera el mensaje **`Listo: API y web responden.`** (tarda hasta 3 min si compila por primera vez). El script abre automáticamente `http://localhost:8082`.
3. **Usa siempre `http://localhost:8082`**, nunca `127.0.0.1:8082`, para que las cookies de sesión coincidan con `WEB_ORIGIN`.
4. **Comprobación rápida de salud:**
   - API vivo: `http://127.0.0.1:3000/api/v1/health` → HTTP `200` (`{"status":"ok",...}`).
   - API listo con base de datos: `http://127.0.0.1:3000/api/v1/ready` → HTTP `200`.
   - Web: `http://localhost:8082/login` → HTTP `200`.
5. **Para detener ambos servidores** al terminar: doble clic en `tools\agentic\local-servers\stop-local.bat`.

Si al iniciar sesión te rebota a `/login`, reinicia con `start-local.bat` sin `nobuild`.

### 1.3. Servicios adicionales (solo para los flujos que los usan)

| Servicio | Cómo arrancar (en PowerShell tras `. .\tools\agentic\use-node24.ps1`) | Cuándo se usa |
|---|---|---|
| **KDS (Cocina)** | Configura `apps/kds/.env` copiando `apps/kds/.env.example` (con `VITE_API_BASE_URL=http://127.0.0.1:3000`), luego ejecuta `pnpm --filter @super-restaurant/kds dev` y abre la URL que imprime Vite. | Flujo 6 (Cocina y KDS) |
| **Mobile (opcional)** | `pnpm --filter @super-restaurant/mobile start` (Expo Go / emulador; ver `docs/CLAUDE_FRONTEND_WORKSTREAM.md`). | Verificación móvil nativa aparte |
| **Sesión E2E (opcional)** | Con API y Web arriba, ejecuta `tools\agentic\local-servers\e2e-auth.bat` e inicia sesión una vez para renovar `apps/web/playwright/.auth/user.json`. | Sólo si corres Playwright |

### 1.4. Cuentas y datos mínimos

- **Cuenta principal (gerente/manager):** `emmanuel.rgomez@gmail.com` en **Vittorinos Pizza · Sucursal Navojoa**.
- **Segundo usuario repartidor (`courier`):** necesario únicamente para el Flujo 8.3 (abrir en ventana privada). Si no existe, marca el paso 8.3 como `OMITIDO`.
- **Zona de entrega:** antes de probar domicilio (Flujo 4), crea al menos una zona activa en `/app/delivery-zones` (Flujo 3.1), por ejemplo con el CP `85860` o colonias de Navojoa.

### 1.5. Aviso importante de migraciones en Supabase remoto

Según el último preflight de solo lectura, la base remota (`zwbyiefqeujstyzysydn`) tiene aplicadas las migraciones hasta `20261106000100_menu_size_presets.sql`. Si aún no se aplican las migraciones posteriores en el entorno remoto contra el que apunte tu `.env.adr010.local`, los siguientes pasos fallarán al guardar o consultar contra remoto (se señalan con **[Req. migración]** en cada flujo):

- `20261120000100` + `20261120000200` + `20261122000100` → **Pizza V2** (publicar `pizzaMode` y confirmar orden de pizza V2: Flujos 2.4 y 4.3).
- `20261121000100` → **Zonas por colonia SEPOMEX** (buscar colonias y guardar zonas/direcciones por colonia: Flujos 3.1 y 3.3).
- `20261123000100` → **Contacto de Recoger sin cliente y regla «Domicilio exige cliente»** (Flujos 4.1 y 4.2).
- `20261123000200` → **Capturas abiertas en la ficha del cliente** (Flujo 3.4).

Para verificar en solo lectura qué falta aplicar antes de empezar:
```powershell
node apps/api/dist/operations/run-migration-preflight.js
```

---

## 2. Flujo 1 — Acceso, navegación, atajos y PWA

### 1.1. Login, barra lateral fija, contraste y ayudas `?`
1. Entra a `http://localhost:8082/login` con tu cuenta de manager y confirma **Sucursal Navojoa**.
2. Recorre **Mesas → Menú → Caja → Órdenes → Entregas → Clientes → Captura → Zonas → Resumen** desde la barra lateral.
3. Pasa el cursor (o toca) un icono **`?`** junto a una etiqueta y luego navega campos con `Tab`.
4. Cambia de pestaña del navegador menos de 15 segundos y regresa.
- **Resultado esperado:** navegación sin recarga completa ni pantalla «Rendering»; la barra lateral se queda fija en escritorio con iconos/textos blancos, barra blanca izquierda en la sección activa y sin botones ilegibles (blanco sobre blanco); el `?` explica el campo y `Tab` no se detiene en el `?`. Si tienes más de una sucursal, «Cambiar sucursal» aparece arriba junto a «Cerrar sesión». Cero errores rojos en consola.

### 1.2. Atajos globales y aviso de cambios sin guardar
1. Abre `/app/customers`, inicia una dirección nueva y escribe una calle sin guardar.
2. Pulsa **`Alt+N`**.
3. En el diálogo in-app **«Hay cambios sin guardar»**, pulsa **`Esc`** (o «Quedarme») y luego vuelve a pulsar **`Alt+N` → «Salir»**.
4. Ya en `/app/capture`, prueba **`Ctrl+K`** / **`Alt+K`**, pulsa **`N`** sola y **`Alt+R`**, y luego **`Alt+Shift+R`** y **`Esc`**.
- **Resultado esperado:** `Alt+N` desde otra página con cambios sin guardar muestra un modal dentro de la app (nunca `confirm()` del navegador); al confirmar abre Captura con el buscador de cliente enfocado. `N` sola y `Alt+R` no hacen nada; `Alt+Shift+R` vuelve a la bandeja/reinicia; `Esc` cierra una capa a la vez (lista → hoja → diálogo) antes de quitar foco.

### 1.3. PWA instalable (manifest y Service Worker)
1. En Chrome sobre `http://localhost:8082/app/tables`, abre **F12 → Application → Manifest** y **Service Workers**.
2. Comprueba que el manifest carga con icono y que `sw.js` está activo.
3. Opcional: activa «Offline» en DevTools → Network y recarga la cáscara del sitio; luego vuelve a «No throttling».
- **Resultado esperado:** `/manifest.webmanifest` válido con iconos, Service Worker registrado sin errores en consola, sin cachear respuestas privadas del API ni mostrar overlays bloqueantes.

---

## 3. Flujo 2 — Menú, fotos, modificadores, tamaños y pizza V2

**Ruta:** `/app/menu`

### 2.1. Pestañas, orden de categorías, color e imagen
1. Cambia entre las pestañas **Categorías**, **Productos**, **Modificadores** y **Tamaños**.
2. En **Categorías**, arrastra una categoría por su asidero **`⋮⋮`** encima de otra (prueba cancelar una vez con **`Esc`**) y suéltala en su nueva posición.
3. Toca el círculo a la izquierda del nombre para subir una foto de categoría.
4. Abre la fila de colores pastel y elige un color para la categoría.
- **Resultado esperado:** las 4 pestañas conservan cambios sin recargar; al arrastrar aparece el hueco destino y ya no hay campo numérico «Orden» ni botones subir/bajar en categorías (las flechas de teclado en el asidero también reordenan); foto y color quedan visibles y luego tiñen la pestaña de esa categoría en `/app/capture`.

### 2.2. Producto, precios en pesos, fotos con encuadre y duplicado
1. En **Productos**, crea o edita un producto: escribe el precio en pesos (`130` o `130.50`, verificando que puedes borrar el cero) y deja vacía **«Clave interna (opcional)»**; elige **Unidad** y **Estación** desde sus listas.
2. Toca la foto del producto para abrir el modal: sube una imagen (incluso > 2 MB para verificar reducción automática), encuádrala en el diálogo de recorte y confirma.
3. Abre el menú **`⋮`** del producto y toca **«Duplicar»**.
4. Toca la foto de otro producto y elige una imagen desde **«Fotos ya usadas en este menú»** (o **«Fotos recientes»**).
- **Resultado esperado:** los precios se muestran como `$130.00` (nunca «u.m.» ni «ISO»); «Clave interna» opcional nunca bloquea; las secciones («Grupos de modificadores», «Permitir mitades», «Aplicar impuesto», «Tamaños») permanecen plegadas hasta activarse; «Duplicar» crea `(copia)` conservando foto y grupos asignados; la foto ajena se copia sin error y la tarjeta indica «Guardado» / «Cambios sin publicar».

### 2.3. Grupos de modificadores compartidos y tamaños
1. En la pestaña **Modificadores**, crea un grupo (p. ej. *Ingredientes*) con 2–3 opciones y precios en pesos; confirma que puedes asignarlo a dos productos distintos desde la pestaña **Productos**.
2. En un producto, abre **Tamaños** (o la pestaña **Tamaños**), agrega *Mediana* y *Grande* con precio en pesos (o usa un tamaño predefinido).
3. Agrega un tamaño vacío y pulsa **`✕`**; luego intenta quitar uno con nombre.
4. Edita cualquier campo, recarga la página (**F5**) antes de publicar y prueba **«Recuperar cambios sin publicar»**.
- **Resultado esperado:** el grupo compartido aparece en ambos productos; quitar un grupo asignado pide confirmación in-app; un tamaño sin nombre se borra al instante y uno con nombre pide confirmación abajo con el foco en «Cancelar»; al recargar se ofrece recuperar o descartar el borrador local, y el botón de publicar marca «Cambios sin publicar» hasta quedar en «Todo publicado».

### 2.4. Configuración de pizza por mitades V2 y publicación **[Req. migración `20261120000100` para publicar en remoto]**
1. En un producto de pizza (con o sin tamaños), activa el modo de pizza / **«Permitir mitades»** a nivel producto.
2. Configura **grupo de sabores/especialidades**, **grupo de ingredientes/extras** e **ingredientes gratis incluidos** (verifica que un grupo elegido en uno aparece deshabilitado en el otro como «ya usado como…»).
3. Pulsa **«Publicar nueva versión»** y recarga la página (**F5**).
- **Resultado esperado:** «Publicar» se bloquea solo mientras haya fotos subiendo; tras publicar y recargar, tamaños, fotos, grupos compartidos y configuración de mitades V2 persisten intactos sin error de conflicto.

---

## 4. Flujo 3 — Zonas de entrega y directorio de clientes

### 3.1. Crear zona de entrega por colonia SEPOMEX / CP **[Req. migración `20261121000100` para colonias]**
**Ruta:** `/app/delivery-zones`
1. Crea una zona nueva (p. ej. *Zona Centro*), escribe tarifa fija en pesos y tiempo estimado.
2. Agrega colonias buscando por nombre del catálogo SEPOMEX de Navojoa (prueba una repetida para ver el sufijo tipo *«Beltrones (ampliación)»*) y/o agrega el código postal `85860`.
3. Guarda la zona y recarga la página (**F5**).
- **Resultado esperado:** la zona se guarda y persiste al recargar; las colonias con nombre repetido se distinguen claramente. *(Nota conocida: tras recargar, las colonias guardadas pueden verse por identificador corto hasta volver a buscarlas.)*

### 3.2. Búsqueda tolerante, alta rápida y dirección simplificada
**Ruta:** `/app/customers`
1. En el buscador escribe al menos 4 dígitos de teléfono (p. ej. `6622751352`) o palabras del nombre en cualquier orden; haz clic en una fila de cliente para abrir su ficha (en escritorio a columnas 60/40).
2. Pulsa **«+ Nuevo cliente»**, crea un cliente con etiqueta de teléfono de la lista (*Principal*, *Trabajo*, *Otro*) y pulsa **«Ir a captura telefónica»** si deseas saltar directo.
3. En la ficha del cliente pulsa **«+ Nueva dirección»**, comprueba que **«Datos adicionales»** inicia colapsado y pulsa **«Cancelar»**.
- **Resultado esperado:** las sugerencias de término completan la búsqueda y las filas abren la ficha sin resultados viejos; «Cancelar» no guarda nada y tras guardar una dirección no queda un formulario vacío abierto.

### 3.3. Quitar teléfono con confirmación y validar dirección con colonia **[Req. migración `20261121000100` para colonia]**
**Ruta:** `/app/customers`
1. En un cliente con dos teléfonos, pulsa **Quitar** en uno y confirma en el diálogo in-app; luego intenta quitar el único teléfono restante.
2. Agrega una dirección con CP `85860` y una colonia dentro de tu zona; pulsa **«Validar para esta sucursal»**.
3. Prueba editar el CP o escribir una colonia fuera del catálogo SEPOMEX (texto libre) o fuera de zona.
- **Resultado esperado:** quitar teléfono pide confirmación dentro de la app (sin `confirm()` nativo) y persiste al recargar; al validar se muestra **«Zona … · Envío $X · hh:mm–hh:mm»** (o **«Fuera de cobertura»** con motivo si no aplica, y aviso de texto libre si la colonia está fuera de SEPOMEX); editar el CP limpia el resumen previo hasta revalidar.

### 3.4. Capturas abiertas del cliente y retomar sin reclamo automático **[Req. migración `20261123000200`]**
**Ruta:** `/app/customers` → `/app/capture?draftId=...`
1. Con un cliente que tenga un borrador abierto en `/app/capture`, abre su ficha en `/app/customers` y revisa la sección **«Capturas abiertas»**.
2. Pulsa **«Retomar»** en uno de los borradores listados.
3. Verifica en `/app/capture?draftId=...` que el borrador abre en modo consulta con el aviso *«No se reclama ni guarda ningún cambio hasta que pulses Retomar»*.
4. Pulsa el botón **«Retomar»** dentro de Captura.
- **Resultado esperado:** solo aparecen borradores abiertos de ese cliente en la sucursal activa; abrir el enlace no reclama el borrador automáticamente hasta pulsar **«Retomar»**.

---

## 5. Flujo 4 — Captura telefónica, para recoger y pizza mitad y mitad

**Ruta:** `/app/capture`

### 4.1. Portada cliente-primero, domicilio y regla «Domicilio exige cliente» **[Req. migración `20261123000100` para bloqueo servidor]**
1. Abre `/app/capture` sin borrador activo, selecciona cumplimiento **Domicilio** e intenta confirmar o avanzar sin elegir cliente.
2. Busca un cliente por teléfono (p. ej. `6622751352`) y selecciónalo en **un solo toque** (sin paso extra «Elegir teléfono»).
3. Bajo el cliente, pulsa **«Usar esta dirección»** (o usa **«Editar»** / **«Agregar dirección»** sin salir de Captura).
- **Resultado esperado:** Domicilio exige cliente y dirección en cobertura; la selección del cliente toma un toque; el estado de la dirección (zona, cargo y ventana, o «Fuera de cobertura») es visible de inmediato antes de cotizar.

### 4.2. Pedido «Para recoger» sin exigir cliente **[Req. migración `20261123000100`]**
1. En `/app/capture` crea un borrador con cumplimiento **Recoger**.
2. Escribe únicamente el **nombre y teléfono de contacto** de quien recoge (sin enlazar un cliente del directorio).
3. Agrega un producto simple, elige método de cobro y confirma la orden.
- **Resultado esperado:** el borrador guarda el contacto de Recoger, sobrevive a **F5** y permite convertir en orden sin obligar a dar de alta un cliente completo.

### 4.3. Menú táctil, estimado del servidor, nota a cocina y pizza V2 mitad y mitad **[Req. migración `20261120000100`/`0200`/`20261122000100` para pizza V2]**
1. Toca un producto sin modificadores (se agrega en 1 toque); luego toca uno con modificadores, agrega una **Nota para cocina** (≤ 200 caracteres) y pulsa **Agregar**.
2. Toca una pizza, elige tamaño (la tarjeta muestra «desde $X»), cambia a **«Mitad y mitad»** y elige sabores/ingredientes con los tiles táctiles (prueba también **«Armar con ingredientes»** en una sola mitad, un ingrediente en **ambas** mitades y quitar un ingrediente con **«Sin X»**).
3. Espera menos de 1 segundo para ver **«Estimado del servidor $X»** (y «Incluye IVA» si aplica) y pulsa **Agregar**.
4. Recarga la página (**F5**), luego cambia la cantidad (`+`/`−`) de otra línea distinta y abre **Editar** sobre la pizza.
- **Resultado esperado:** las categorías muestran su color e imagen; en pizza V2 un ingrediente repetido en ambas mitades se cobra una sola vez, quitar un ingrediente muestra «Sin X» sin bajar el precio, nunca deja armar ambas mitades a la vez en el flujo clásico, el total del ticket coincide con el servidor, el ticket no se corta horizontalmente y al recargar o cambiar otra línea la pizza conserva intactas sus mitades e ingredientes.

### 4.4. Entrega, cotización ASAP, cobro, confirmación y envío a cocina
1. En un borrador a **Domicilio**, escribe instrucciones de entrega (sin pulsar botón extra: se autoguardan) y pulsa **«Cotizar entrega»** sin elegir hora programada.
2. En **Cobro**, escribe `250` en «Otro monto» y luego toca **«Exacto»** (o un billete mayor al total con propina opcional); revisa subtotal, envío, total y **«Cambio: $X»** calculados por el servidor.
3. Cambia la cantidad de una línea tras fijar el cobro para comprobar el aviso **«Cambió el pedido: confirma de nuevo el cobro»**, vuelve a confirmar el cobro y pulsa **«Convertir captura en orden»**.
4. Justo al confirmarse, pulsa **«Enviar a cocina»** (1 toque) y vuelve a intentarlo una segunda vez; luego prueba **«Ver orden»** o **«Nueva captura»**.
- **Resultado esperado:** las instrucciones sobreviven a recargar; la cotización ASAP promete **30–45 min** (válida 15 min) y no vence al instante; «Exacto» limpia «Otro monto» en un toque; el turno abierto se toma automáticamente; «Enviar a cocina» responde «Enviada a cocina · N líneas» sin duplicar al segundo toque y manda la orden directo al KDS y a «Por asignar».

### 4.5. Bandeja de borradores, transferencia y cancelar sin venta
1. Crea un borrador vacío y vuelve a la bandeja (`Alt+Shift+R`): comprueba que los borradores vacíos no ensucian la lista.
2. Abre un borrador con cliente/productos, recarga (**F5**) y comprueba que mantiene folio, cliente, líneas y total; mientras trabajas el tiempo de atención se renueva solo (sin menciones a «lease»).
3. Abre el menú **«Más»** → **«Pasar la captura a otro operador»** (si no hay otro operador, usa **«Dejar en espera»**).
4. En otro borrador de prueba pulsa **«Cancelar»** (cierre sin venta), escribe un motivo obligatorio y confirma en el diálogo in-app.
- **Resultado esperado:** la bandeja muestra nombre, teléfono, canal, hora e «Ítems: $X.XX»; reanudar abre el detalle completo; el borrador cancelado desaparece de borradores activos y aparece después en `/app/orders` → pestaña **«Canceladas»**.

---

## 6. Flujo 5 — Mesas, cuentas múltiples y editor de plano

**Rutas:** `/app/tables` y `/app/tables/edit`

### 5.1. Abrir cuenta, nombre de cuenta, agregar producto y mesero
1. En `/app/tables` (plano a todo el ancho), toca una mesa libre; si no hay turno abierto, usa **«Abrir turno»**.
2. Opcionalmente asigna mesero y escribe el **nombre de la cuenta** («a nombre de quién»), y pulsa **«Abrir cuenta»**.
3. Desde el panel que se abre (sin un segundo botón redundante «Abrir cuenta»), agrega un producto con tamaño y nota y pulsa **«Enviar a cocina»**.
4. Vuelve a `/app/tables`, toca la mesa ocupada y cambia o quita el mesero desde la tarjeta de la cuenta.
- **Resultado esperado:** todo el diálogo de mesa se ve completo sin recortarse abajo; el flujo toma 3–4 toques; el nombre real de la mesa («Mesa 2») y el nombre de la cuenta acompañan al detalle, comanda y ticket.

### 5.2. Múltiples cuentas en la misma mesa
1. Toca una mesa que ya tenga una cuenta abierta.
2. Pulsa **«+ Nueva»** (a la derecha de las pestañas de cuentas) para abrir una segunda cuenta en la misma mesa.
3. Cambia entre ambas pestañas dentro del diálogo y regresa al plano.
- **Resultado esperado:** cada pestaña muestra su propio total; sobre la mesa en el plano aparece el contador de cuentas abiertas.

### 5.3. Editar plano en borrador, tamaño, datos y mesa nueva
1. En `/app/tables` (con rol de gestión), entra a **«Editar plano»** (`/app/tables/edit`).
2. Arrastra dos mesas a nuevas posiciones (verás borde punteado de borrador) y pulsa **«Guardar plano»** (prueba también mover y pulsar **«Cancelar»** para comprobar que revierte).
3. Selecciona una mesa, arrastra el asidero de la esquina o usa **«Más chica / Más grande»**, edita nombre (máx. 40), **capacidad** y **forma**, y pulsa **«Guardar datos»**.
4. Pulsa **«Nueva mesa»**, prueba cerrarla con **`Esc`** / **Cancelar**, y luego crea una mesa real y regresa a `/app/tables`.
- **Resultado esperado:** la rueda del ratón no queda atrapada en el lienzo; cambiar el tamaño no altera la capacidad; las formas (cuadrada/redonda/rectangular) se distinguen visualmente; la mesa nueva aparece en un hueco libre y todo persiste al volver a Mesas.

---

## 7. Flujo 6 — Órdenes activas, cocina (KDS), notificaciones, impresión y cancelación

**Rutas:** `/app/orders` y app **KDS** (URL de Vite)

### 6.1. Lista en paneles, filtros y acciones sobre líneas
1. Abre `/app/orders`, filtra por canal (Mesa / Domicilio / Para llevar) y comprueba las tarjetas: hora en zona del restaurante, nombre real de la mesa («Mesa 2», nunca UUID) y totales con envío y propina separados.
2. Toca una orden para abrir su detalle en el panel izquierdo (sin tapar la lista ni «Agregar producto» a la derecha) y pulsa **«Agregar producto»** si quieres añadir otra línea.
3. En una línea, prueba **«Marcar lista»**, **«Marcar entregada»** y **«Cancelar línea»** con motivo obligatorio.
- **Resultado esperado:** las acciones disponibles dependen de tu rol y estado de la orden; cada botón muestra estado y resultado; si recargas con «Agregar producto» abierto sobre una orden no editable, se cierra con aviso; una línea cancelada desaparece del KDS.

### 6.2. KDS por estación y notificación «platillo listo» en tiempo real
1. Abre la app **KDS** en otra pestaña/ventana, inicia sesión y elige la estación (p. ej. *Cocina*); recarga (**F5**) para confirmar que recuerda la estación.
2. Verifica las tarjetas agrupadas por orden: antigüedad en **verde / ámbar (10 min) / rojo (20 min)**, más viejas primero, etiqueta **«Nuevo»**, mitades de pizza por separado, notas destacadas y sonido opcional (apagado por defecto).
3. Pulsa **«Empezar todo»** y luego **«Listo todo»** en una orden mientras miras `/app/orders` en la otra pestaña.
- **Resultado esperado:** las líneas avanzan en serie sin conflictos de versión; `/app/orders` recibe el aviso de **platillo listo** sin recargar la página (sólo para la misma sucursal/estación).

### 6.3. Comanda y ticket imprimibles desde el navegador
1. En el detalle de una orden enviada a cocina (o justo tras «Enviar a cocina»), pulsa **«Imprimir comanda»** (o atajo **`P`**).
2. Cambia entre vista **80 mm** y **58 mm**, verifica una hoja por estación con solo líneas enviadas, nombre de mesa, mitades y notas, y pulsa **«Imprimir»**.
3. Tras cobrar en Caja (o desde el detalle de una orden cobrada), pulsa **«Imprimir ticket»**.
- **Resultado esperado:** abre vista previa limpia y el diálogo nativo de impresión del navegador; el ticket muestra restaurante, sucursal, folio corto (8 caracteres), fecha, líneas, IVA, envío, propina y pagos reales idénticos al recibo (sin hardware ESC/POS todavía).

### 6.4. Cancelar orden completa y pestaña «Canceladas»
1. En `/app/orders`, abre una orden con pago cobrado (con rol gerente/supervisor) y pulsa **«Cancelar orden»**, escribe motivo y confirma.
2. Intenta cancelar una orden cuya entrega esté **en ruta**.
3. Entra a la pestaña **«Canceladas»** y prueba **«Cargar más»**.
- **Resultado esperado:** con dinero cobrado avisa **«Queda pendiente devolver $X en caja»**; con entrega en ruta se bloquea con mensaje claro (409) indicando marcar la entrega primero; sus líneas salen del KDS; «Canceladas» muestra órdenes canceladas y capturas sin venta con motivo, nombre de quién canceló (sin exponer su correo), fecha y devolución pendiente.

---

## 8. Flujo 7 — Caja: cobro, cambio, transferencia, pagos divididos y corte

**Rutas:** `/app/caja` (Cobrar) y `/app/caja/corte` (Turno y corte)

### 7.1. Abrir caja y cobrar en efectivo con cambio y propina
1. Abre `/app/caja`; si no hay caja abierta, ingresa un fondo inicial en pesos (p. ej. `500`) y abre caja desde el formulario compacto.
2. En la lista de órdenes cobrables (sin teclear ningún UUID), elige la orden de mesa del Flujo 5.
3. Elige **Efectivo**, toca un monto rápido mayor al saldo (p. ej. `$200` o `$500`), opcionalmente agrega propina, revisa **«Cambio después de propina»** y pulsa **«Cobrar»**.
4. Recarga la página (**F5**).
- **Resultado esperado:** el cobro termina con éxito (sin falsos mensajes de error), muestra el recibo durable con cobrado, cambio, propina y saldo restante, sobrevive a **F5** y permite **«Imprimir ticket»**.

### 7.2. Dividir pago (efectivo + tarjeta externa) y desglose
1. Selecciona otra cuenta abierta en `/app/caja` y toca **«Dividir pago»**.
2. Baja el importe a la mitad, cobra en **Efectivo** y comprueba el aviso **«Faltan $X»** (saldo del servidor).
3. Cobra el saldo restante con **Tarjeta externa** ingresando terminal y referencia de 6+ caracteres.
4. Expande la tarjeta de pagos realizados en la cuenta.
- **Resultado esperado:** el saldo llega a `$0.00`, la orden queda pagada y el desglose muestra cada pago individual, su método y quién lo cobró.

### 7.3. Cobrar por transferencia con referencia en recibo
1. Selecciona una tercera cuenta en `/app/caja` y elige el método **Transferencia**.
2. Escribe una referencia opcional (p. ej. `SPEI-12345`), propina opcional y pulsa **«Cobrar»**.
3. Intenta cobrar por transferencia una orden de entrega que esté **en ruta** (debe bloquearse); luego pruébalo sobre una entrega ya marcada **Entregada** (debe liquidarla).
- **Resultado esperado:** Transferencia no pide «Recibido» ni calcula «Cambio»; el recibo muestra **«Transferencia · Ref. SPEI-12345»**; el efectivo esperado en caja no sube.

### 7.4. Corte X y cierre de caja (Corte Z operativo)
1. Abre **Turno y corte** (`/app/caja/corte`).
2. Revisa el **Corte X**: fondo inicial, ventas separadas por método (Efectivo, Tarjeta, Transferencias), propinas, efectivo esperado y lista de movimientos en español.
3. En cierre de caja, escribe un conteo diferente al esperado (en pesos) e intenta cerrar sin motivo; luego escribe un motivo, marca la casilla **«Este cierre es definitivo»** tocando toda la fila y cierra caja.
- **Resultado esperado:** el cierre exige motivo obligatorio cuando hay diferencia, no muestra «u.m.» ni «ISO», y registra el corte de forma inmutable.

---

## 9. Flujo 8 — Entregas y vista del repartidor

**Ruta:** `/app/deliveries`

### 8.1. «Por asignar» (con prepagadas), despacho y liquidación de efectivo
1. Abre `/app/deliveries` y localiza en **«Por asignar»** la orden telefónica a domicilio del Flujo 4 (y, si creaste una prepagada con tarjeta/transferencia, verifica que aparece con etiqueta **«Pagada»**). Si hay más de una página, prueba **«Cargar más»**.
2. Toca un repartidor para asignarla (2 toques) y comprueba que desaparece de «Por asignar» sin quedar duplicada en dos columnas.
3. Pulsa **«Salió»** y luego **«Entregada»**.
4. Pulsa **«Liquidar»**, verifica que el recibido viene precargado desde la intención de cobro y muestra el cambio del servidor, y confirma.
- **Resultado esperado:** las entregas liquidadas en efectivo registran el cobro completo y el cambio en caja; una entrega con intención de tarjeta o transferencia remite a `/app/caja` (sólo se liquida efectivo aquí).

### 8.2. Incidencia «No se pudo» y reasignación
1. En otra entrega despachada, pulsa **«No se pudo»**, ingresa motivo y confirma.
2. Verifica que permanece en su columna de fallidas (no duplicada en «Por asignar») y reasígnala a un repartidor.
- **Resultado esperado:** motivo guardado y transición limpia sin duplicados en pantalla.

### 8.3. Vista aislada del repartidor (`courier`)
1. Abre una ventana privada del navegador e inicia sesión con el segundo usuario que tenga rol **`courier`** en Navojoa.
2. Entra a `/app/deliveries` y toca **«Ver pedido»** en una entrega asignada a este repartidor.
3. Comprueba el texto de cobro (con efectivo vs. con tarjeta/transferencia) y confirma que no aparecen entregas de otros repartidores ni líneas canceladas.
- **Resultado esperado:** sólo ve sus propias entregas; «Ver pedido» muestra líneas vigentes (con tamaño/mitades y notas), dirección, instrucciones y **«Cobrar en efectivo $X»** (o **«Pago pendiente en Caja»** sin monto destacado si es tarjeta/transferencia). Intentar abrir una entrega ajena devuelve acceso denegado.

---

## 10. Flujo 9 — Resumen del día

**Ruta:** `/app/reports/day` (requiere permiso `reports.read`)

### 9.1. Cuadre de ventas, entregas, cancelaciones y turnos
1. Abre `/app/reports/day`: debe cargar la fecha de **hoy** en la zona horaria del restaurante (`America/Hermosillo`).
2. Compara las tarjetas superiores (ventas, propinas, envíos, canceladas) y las tablas por canal, por método de pago y por turno de caja (fondo, esperado, contado, diferencia) contra tu Corte X/Z del Flujo 7.4.
3. Cambia la fecha a un día sin operación (p. ej. mañana o una semana atrás).
- **Resultado esperado:** los montos cuadran exactamente con los pagos capturados y cancelaciones del día; un día sin ventas muestra ceros limpios sin error.

---

## 11. Flujo 10 — Verificación móvil (`390×844`)

En DevTools (**F12 → Toggle Device Toolbar → `390 × 844`**):

1. **Barra inferior:** comprueba los 4 accesos directos (**Mesas**, **Captura**, **Órdenes**, **Caja**) y el botón **«Más»** que abre el resto de secciones y cierra con `Esc` o `✕`.
2. **Captura móvil (Fase 4 R2):** abre `/app/capture`, recorre el carrusel de categorías, abre la hoja de producto (las dos mitades de pizza se apilan verticalmente con tiles ≥ 44 px), sigue los pasos **Pedido → Cliente → Entrega** y toca la barra flotante **«Total de productos»** para confirmar sin que la barra tape **«Convertir captura en orden»**.
3. **Mesas, Órdenes, Caja y Entregas:** abre un diálogo de mesa, el detalle de una orden (una vista a la vez), el panel de cobro en `/app/caja` y una tarjeta en `/app/deliveries`; abre un tooltip **`?`** y toca fuera para cerrarlo.
- **Resultado esperado:** cero desbordamiento horizontal, todos los diálogos caben completos en pantalla, targets táctiles ≥ 44 px, tooltips dentro del viewport y consola limpia.

---

## 12. Ítems técnicos en `REVIEW` (verificación automatizada opcional)

Estos ítems de `TODO.md` no tienen pantalla propia; se validan por comando local (en PowerShell tras `. .\tools\agentic\use-node24.ps1`):

| Ítem en `TODO.md` | Qué valida | Comando exacto |
|---|---|---|
| `migration-preflight-scripts` | Preflight y postcheck read-only contra Supabase sin mutar nada | `pnpm --filter @super-restaurant/api preflight:migrations` |
| `api-http-postgres-tests` · `api-http-flow-iteration-2` · `tech-block-20261006` | Flujo HTTP completo (7/7: catálogo, caja, cambio, entregas, mitades, tarjeta+transferencia, cancelación, resumen del día) contra PG 17 local desechable | `pnpm --filter @super-restaurant/api test:http:local -- --local-disposable-only` |
| `m1-pg-verify-clean` | Suite de invariantes SQL y migraciones desde cero sin tolerancias | Job `pg-verify` en CI (o `pnpm --filter @super-restaurant/api verify:pizza-model-v2-schema:rollback`) |
| `P0 orquestación` | Harness multiagente y scripts en `.claude/` / `tools/agentic/` | Revisión documental / uso operativo en el repo |

---

## 13. Trazabilidad completa (`TODO.md` `REVIEW` → Flujo) y cómo reportar

Cuando marques un flujo como **OK**, las tareas asociadas de esta tabla pueden pasar a `DONE` en `TODO.md`:

| Flujo | Ítems en `REVIEW` en `TODO.md` cubiertos |
|---|---|
| **Flujo 1** (Acceso, nav, atajos, PWA) | `web-shell-nav-tables`, `shell-sidebar-perf`, `field-hint-tab`, `capture-shortcuts-r2`, `K2`, `shell-mobile-nav`, `lote-smoke-20261007` (barra lateral, contraste, tooltips), `m2-web-pwa-shell` |
| **Flujo 2** (Menú y pizza V2) | `D7`, `menu-categories-r1`, `menu-products-ui-r1`, `menu-category-appearance`, `menu-shared-modifier-groups`, `menu-photo-copy`, `menu-polish-r2`, `menu-locked-ingredients`, `menu-hide-locked-ingredients`, `menu-sizes-inline`, `menu-product-actions`, `menu-photos-recent`, `menu-photo-crop`, `m1-menu-tabs-r2`, `P3-1..P3-5`, `B2`, `B3`, `lote-smoke-20261007` (menú r1/r2 y mitades producto) |
| **Flujo 3** (Zonas y clientes) | `web-customers-fixes`, `P2 directorio D3`, `delivery-zones-match`, `Diagnóstico D1/D2`, `K4`, `Z4`, `Z5`, `m1-k0b2-customer-open-captures`, `m1-k3-customer-captures` |
| **Flujo 4** (Captura telefónica y recoger) | `D1`, `api-capture-lines`, `web-capture-menu-tactil`, `capture-line-price-quote`, `capture-halves-ids-projection`, `order-item-note`, `capture-payment-intent`, `delivery-quote-asap-expiry`, `web-capture-confirm-send-kitchen`, `capture-no-sale`, `web-capture-polish`, `P2 bandeja de captura`, `capture-ux-r1`, `capture-customer-address-r1`, `capture-drafts-tidy`, `capture-customer-search`, `capture-menu-category-images`, `capture-address-state`, `K1`, `B4`, `m1-k0b-pickup-contact` |
| **Flujo 5** (Mesas y plano) | `D2`, `web-shell-nav-tables`, `tables-orders-r1`, `tables-accounts-r2`, `order-account-name`, `tables-tabs-count`, `lote-smoke-20261007` (mesas r1–r4) |
| **Flujo 6** (Órdenes, KDS, impresión, cancelación) | `D3`, `T1`, `T2`, `T4`, `web-active-orders`, `web-order-actions`, `orders-tray-table-id`, `tech-block-20261006`, `lote-smoke-20261007` (órdenes en paneles), `m1-kitchen-ready-notify` |
| **Flujo 7** (Caja y corte) | `D4`, `D5`, `T1` (ticket), `cash-transfer-method`, `cash-transfer-receipt-reference`, `caja-split-payments`, `lote-smoke-20261007` (caja separada en Cobrar / Corte) |
| **Flujo 8** (Entregas y repartidor) | `D6`, `deliveries-unassigned-tray`, `web-deliveries-load-more`, `courier-order-detail`, `small-debts-20261006` |
| **Flujo 9** (Resumen del día) | `T3`, `tech-block-20261006` |
| **Flujo 10** (Móvil 390×844) | `Fase 4 R2-1..R2-3`, `shell-mobile-nav`, verificación responsive de `D1–D7` y `T1–T4` |
| **Sección 12** (Técnicos) | `m1-pg-verify-clean`, `api-http-postgres-tests`, `api-http-flow-iteration-2`, `migration-preflight-scripts`, `P0 orquestación` |

### Cómo reportar tu resultado

Responde con una línea por bloque probado (puedes pegar capturas solo en los `FALLA`):

```text
Flujo 1.1: OK
Flujo 2.4: OMITIDO — falta migración 20261120000100 en remoto
Flujo 4.3: FALLA — al editar la pizza mitad y mitad se borró el ingrediente de ambas; esperaba verlo marcado
```
