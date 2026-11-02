# Guía de pruebas del operador — estado al 2026-09-28

Objetivo: que Emmanuel pueda ejercitar todo lo que ya existe en la consola web antes de aprobar el rediseño. Cada sección dice qué hay, cómo probarlo y qué está incompleto. Nada aquí es una promesa de producto: es el inventario real.

## 1. Servicios locales

| Servicio | Cómo arranca | URL | Log |
|---|---|---|---|
| API NestJS | `powershell -NoProfile -ExecutionPolicy Bypass -File tmp\start-authorized-local-api.ps1 3000` (lee `.env.adr010.local` y `apps/web/.env.local`; nunca imprime secretos) | http://127.0.0.1:3000/api/v1/health → `{"status":"ok"}` | `tmp/local-api-*.out.log` |
| Web Next.js | `pnpm --filter @super-restaurant/web dev --hostname localhost --port 8082` (Node 24 y pnpm 11 en `%LOCALAPPDATA%\Programs\node24`) | http://localhost:8082/login (usar `localhost`, no `127.0.0.1`) | `tmp/local-web-*.out.log` |
| KDS | `pnpm --filter @super-restaurant/kds dev` (Vite; configurar `VITE_*` según `apps/kds/src/config.ts`) | la URL que imprime Vite | consola |
| Mobile | `pnpm --filter @super-restaurant/mobile start` (Expo; ver `docs/CLAUDE_FRONTEND_WORKSTREAM.md`) | Expo Go o emulador | consola |

Si el login vuelve a rebotar a `/login`: el API está viejo respecto a `apps/web/.env.local`; reiniciarlo. Si `/app` no renderiza: reiniciar el servidor web (grafo de módulos viejo).

## 2. Pantallas web existentes y qué probar

### `/login`
Correo y contraseña de Supabase. Error genérico ante credenciales inválidas. Tras entrar, `/app`.

### `/app` · Mesas y selección de sucursal
- Selector Restaurant/Sucursal; la preferencia se guarda en cookie no autoritativa y el servidor la revalida.
- Canvas de mesas con creación, arrastre por puntero o flechas (celda entera) y edición en panel lateral; «Guardar layout» envía la posición. La barra lateral marca la ruta activa. (Corregido el 2026-09-27, REVIEW.)

### `/app/menu` · Catálogo
- Categorías, productos, precios en minor units, disponibilidad. Publicación de releases del catálogo.
- **Falta:** configurador de pizza (tamaños, mitades, extras, combos). El dominio S5.1 existe; no hay pantalla.

### `/app/customers` · Directorio
- Búsqueda por teléfono o nombre con sugerencias; alta rápida de cliente; teléfonos y direcciones con atestación de validez; historial y "repetir pedido" (desde Captura).
- Corregido el 2026-09-27 (REVIEW): elegir un cliente abre su ficha e historial; etiqueta con ejemplo; «Validar para esta sucursal» muestra pill y mensaje; alta rápida con «Ir a captura telefónica»; columnas 60/40.

### `/app/capture` · Captura telefónica
Aquí nacen las órdenes. Flujo actual (rediseñado el 2026-09-27/28 según el prototipo aprobado):
1. «Nueva captura telefónica» crea un borrador durable con folio. Atajos: N nueva, / buscar (cliente o productos según el paso), Esc volver, F2 cobro.
2. Origen (teléfono, mostrador, WhatsApp…) y cumplimiento (domicilio, recoger, mostrador, mesa).
3. Cliente por teléfono: las sugerencias de término completan la búsqueda y las filas de cliente abren la ficha; contacto y dirección quedan congelados.
4. **Menú táctil**: categorías (rail lateral en escritorio, chips en teléfono), tarjetas con contador, buscador; tocar un producto sin modificadores lo agrega; con modificadores abre la hoja de armado (grupos obligatorios/opcionales, nota para cocina ≤200). El ticket (lateral en escritorio, barra inferior + hoja en teléfono) muestra líneas, ±, quitar, botón «Nota» por línea y totales **calculados por el servidor**. Si el menú cambió, aparece «El menú cambió; vuelve a cargar».
5. Instrucciones de entrega con sugerencias del mismo cliente; pedidos recientes → «Revisar para repetir» → «Preparar N líneas».
6. «Cotizar entrega» (domicilio): la cotización se **persiste en el servidor** y sobrevive a recargas; cambiar la dirección o la hora programada la invalida y bloquea confirmar hasta recotizar; expirada o fuera de cobertura también bloquea.
7. **Cobro**: método (efectivo contra entrega o en mostrador, tarjeta con terminal manual, transferencia pendiente de evidencia), atajos de monto y «Otro monto» (se aplica con Enter/Aplicar/blur), propina aparte; subtotal, envío, total y cambio vienen del servidor. Si cambian líneas, cumplimiento o cotización tras fijar el cobro, aparece «Cambió el pedido: confirma de nuevo el cobro».
8. Turno abierto (y mesa si aplica) → «Convertir captura en orden»: la Order congela líneas con nota, cargo de envío e intención de pago; no crea Payment ni movimiento de caja.
- Bandeja de borradores recuperables; «Pasar la captura a otro operador» (si nadie más tiene sesión, «Dejar en espera»); **«Sin venta»** con motivo obligatorio cierra el borrador sin borrarlo.
- **Conocidos/pendientes:** variantes y mitades de pizza (S5) no se ofrecen aún; mobile no captura nota ni cobro; la verificación visual de todo lo anterior está pendiente (REVIEW).

### `/app/caja` · Caja
- Apertura y cierre de caja por turno, pagos simples en efectivo o tarjeta manual sobre órdenes, movimientos auditados. Métodos `transfer`, anticipos y refunds: aún no.

### `/app/delivery-zones` · Zonas de entrega (gerente)
- Alta y edición de zonas por códigos postales o localidades con tarifa fija, CAS y motivo al desactivar.
- Migración `20260927000100` aplicada el 2026-09-27: la página ya carga.

### `/app/system-admin/restaurants` · Administración
- Alta de restaurantes y desactivación, sólo para el rol de sistema.

## 3. KDS y Mobile
- KDS: lista de órdenes por estación con recuperación por cursor y notificación en tiempo real; cancelaciones llegan como evento durable.
- Mobile: selección de sucursal y turno, mesas, toma de comanda por mesa, envío a cocina; verificado en harness de navegador, no en dispositivo real.

## 4. Migraciones
Aplicadas al proyecto remoto con autorización permanente de Emmanuel (2026-09-27/28): `20260927000100` zonas, `20260928000100` líneas de captura, `20260929000100` sin venta, `20260930000100` nota de línea, `20261001000100` cotización congelada, intención de pago y cargo de envío. Procedimiento en `docs/runbooks/migration-apply.md`. Tras cada apply se reinicia el API local con `tmp/start-authorized-local-api.ps1 3000`.

## 5. Lo que no existe todavía
Configurador de pizza/variantes en UI (S5 productivo), S6.3 corrección de producción, S7.2+ despacho y repartidor, S8.3+ captura real de pagos (checkout con envío ya calcula el saldo), anticipos y refunds, impresión Bluetooth real, offline, inventario, reportes, fiscal.

## 6. Qué probar el 2026-10-03 (lote de corrección tras tus 25 notas)

Servicios: API en `http://localhost:3000` (health `/api/v1/health`), web en `http://localhost:8082`. Probar en escritorio y en 390×844 con la consola abierta; anotar cualquier mensaje rojo.

1. **Menú** (`/app/menu`): el precio se escribe en pesos («130» o «130.50») y se ve «$130.00»; el cero se puede borrar; «Clave interna (opcional)» no bloquea; botón «Foto» en producto y en opción (JPG/PNG/WebP ≤ 2 MB), estado «Subiendo…», miniatura, «Quitar foto»; «Publicar nueva versión» se bloquea con «Esperando fotos…» mientras sube.
2. **Clientes** (`/app/customers`): etiqueta de teléfono y de dirección como lista con «Otro»; al validar una dirección se muestra «Dirección revisada para <sucursal>» con los datos revisados (zona y cargo se confirman al cotizar en captura; pendiente).
3. **Captura** (`/app/capture`): pasos Cliente → Menú → Entrega → Cobro → Confirmar; tarjetas con foto o iniciales por categoría; en la hoja de armado «Estimado: $X.XX» en vivo y control «− n +» para ingredientes repetibles; «Editar» una línea armada; guardar instrucciones, elegir método y montos muestran «Guardando…» y «Guardado» o el error; con efectivo ≥ total aparece «Cambio: $X.XX»; «Convertir captura en orden» sin elegir turno («Turno: …» o «No hay turno abierto»); borradores con nombre y teléfono del cliente, canal, hora e «Ítems: $X.XX»; «Guardar para después» y «Cancelar» con motivo; «Transferir» bajo «Más»; el aviso de lease dice «Otra estación tomó esta captura» o «Se venció tu tiempo de atención» con «Retomar», y mientras trabajas se renueva solo.
4. **Órdenes** (`/app/orders`): «Detalle» → «Enviar a cocina», «Marcar lista/entregada», «Cancelar línea» con motivo; cada acción responde; el diálogo atrapa el foco y cierra con Escape.
5. **Mesas** (`/app/tables`): plano con libre/ocupada; tocar mesa libre → «Abrir cuenta» (dos toques); «Sin turno abierto» con «Abrir turno»; mesa ocupada → cuentas con total, «Ver cuenta», «Asignarme», «Abrir otra cuenta»; «Editar plano» sólo para gestión.
6. **Caja** (`/app/caja`): fondo y conteo en pesos, sin «ISO» ni «u.m.»; «Cargar cuenta» es una lista de órdenes cobrables con «Cobrar», sin UUID.

## 7. Qué probar el 2026-10-05 (día operable: caja, entregas, tamaños, agregar a cuenta)

Antes: añadir `RECEIPT_COOKIE_SECRET=<32+ caracteres aleatorios>` a `apps/web/.env.local` y reiniciar el web dev (sin eso el recibo dice «Recibo no disponible», el cobro sí se registra).

1. **Caja** (`/app/caja`): abrir caja en pesos; «Cargar cuenta» desde la lista; Efectivo → «$200» → ver «Cambio después de propina» → propina opcional → «Cobrar» (3-4 toques); recibo con cobrado, cambio, propina y saldo que sobrevive a recargar; «Cobrar parcial» editando el importe y segundo cobro con Tarjeta externa (terminal y referencia ≥ 6); Corte X con fondo, ventas por método, propinas, esperado y lista de movimientos en español; cerrar caja con conteo distinto → exige motivo.
2. **Entregas** (`/app/deliveries`): con un usuario con rol `courier` en la sucursal (asignarlo en Accesos), «Por asignar» → tocar repartidor (2 toques) → «Salió» → «Entregada» → «Liquidar» con recibido precargado desde la intención y cambio del servidor; «No se pudo» con motivo y reasignar; una orden con intención de tarjeta remite a Caja; entrar como repartidor y ver sólo lo suyo.
3. **Tamaños** (`/app/menu` y `/app/capture`): en un producto «Añadir tamaño» → nombre → precio (×2), publicar; en captura la tarjeta dice «desde $X», la hoja exige tamaño antes de Agregar, el ticket muestra «Pizza · Grande»; repetir un pedido anterior de ese producto muestra la línea bloqueada «requiere tamaño».
4. **Mesas** (`/app/tables`): mesa libre → «Abrir cuenta» → «Agregar producto» → producto (con tamaño y nota) → Agregar (4 toques); la línea aparece en la cuenta; «Enviar a cocina».
5. Todo en escritorio y 390×844 con consola abierta.

## 8. Qué probar el 2026-10-05 (tarde): mitad y mitad de pizza

1. **Editor** (`/app/menu`): en un producto con tamaños, activar «Permitir mitades» en un tamaño → elegir «Grupo de sabores» → «Grupo de extras» (3 toques); opcionalmente marcar ingredientes que se pueden quitar; publicar. Si el grupo de sabores no existe o no pertenece al producto, debe verse el error, no un guardado silencioso.
2. **Hoja de armado** (`/app/capture`): elegir el tamaño con mitades → «Mitad y mitad» → sabor de la Mitad A → sabor de la Mitad B → Agregar (5 toques). «Agregar» debe decir «Elige los dos sabores» hasta tener ambos. El estimado debe ser el sabor más caro más cada extra de media pizza al 50 % redondeado arriba; el precio del ticket es el del servidor y debe coincidir.
3. **Ticket y detalle**: la línea muestra «Mitad A: <sabor>» / «Mitad B: <sabor>» con extras y exclusiones debajo; al editar la línea los sabores vienen preseleccionados; cambiar la cantidad de otra línea no convierte la pizza partida en entera (si el menú cambió, aparece «No se pudo conservar la división…» y no se envía nada).
4. **Cocina** (KDS): el ticket lista cada mitad por separado con sus extras.
5. En 390×844 las dos mitades se apilan; consola limpia.
6. **Transferencia en caja** (`/app/caja`): cargar una cuenta → «Transferencia» → referencia opcional → «Cobrar» (3 toques). Sin «Recibido» ni «Cambio»; propina opcional; el recibo dice «Transferencia»; el corte X muestra «Transferencias» aparte y el efectivo esperado no cambia. Una transferencia sobre una entrega en ruta debe rechazarse con un mensaje claro; sobre una entrega ya entregada la liquida.
7. **Por asignar** (`/app/deliveries`): una orden de entrega prepagada (tarjeta o transferencia) aparece en «Por asignar» con «Pagada»; al asignarla desaparece de la lista; una entrega «No se pudo» sigue en su columna, no en «Por asignar».
8. **Zona al validar** (`/app/customers` y captura): «Validar para esta sucursal» muestra «Zona … · Envío $X · hh:mm-hh:mm» o «Fuera de cobertura» sin bloquear el guardado; al editar el código postal el resumen desaparece hasta volver a validar. En el paso de entrega de la captura el mismo resumen aparece antes de «Cotizar entrega».
9. **Estimado del servidor** (hoja de armado): al elegir tamaño y extras aparece «Estimado del servidor $X» (y «Incluye IVA» si aplica) en menos de un segundo; mientras llega se ve «Estimado»; «Agregar» nunca se bloquea y el precio del ticket coincide con el estimado del servidor.
10. **Ver pedido como repartidor** (`/app/deliveries` con sesión `courier`): cada entrega asignada tiene «Ver pedido» (1 toque) con líneas, notas, dirección e instrucciones; con intención de efectivo dice «Cobrar en efectivo $X»; con tarjeta o transferencia dice «Pago pendiente en Caja» sin monto destacado; una línea cancelada no aparece; una entrega de otro repartidor no se puede abrir.
11. **Enviar a cocina tras confirmar** (captura): «Convertir captura en orden» → aparece «Enviar a cocina» (1 toque) → mensaje «Enviada a cocina · N líneas»; un segundo toque no duplica; el KDS y «Por asignar» ya muestran la orden sin pasar por /app/orders; «Nueva captura» (N) limpia la pantalla.

## 9. Qué probar el 2026-10-06: bloque «turno completo»

1. **Imprimir comanda** (detalle de orden o tras «Enviar a cocina»): vista previa a 80 mm con una hoja por estación, sólo líneas enviadas, mitades y notas; «Imprimir» abre el diálogo del navegador. **Imprimir ticket** (caja tras cobrar o detalle): encabezado con restaurante y sucursal, líneas, IVA, envío, propina por pago, recibido y cambio iguales al recibo.
2. **Cancelar orden** (`/app/orders` → detalle): «Cancelar orden» sólo para gerente/supervisor; motivo obligatorio; con dinero cobrado aparece «Queda pendiente devolver $X en caja»; con entrega en ruta se bloquea con «Primero marca la entrega…»; las líneas en cocina desaparecen del KDS. Pestaña **«Canceladas»**: órdenes y capturas con motivo, quién, cuándo y devolución pendiente; «Cargar más».
3. **Resumen del día** (`/app/reports/day`, roles con `reports.read`): hoy por defecto; tarjetas de ventas, propinas, envíos y canceladas; tablas por canal, por método y turnos con fondo, esperado, contado y diferencia; cambiar de fecha; día vacío en ceros.
4. **KDS**: tarjetas por orden con tiempo en verde/ámbar/rojo (10 y 20 min), más viejas primero y listas al final; «Empezar todo» / «Listo todo» marcan todas las líneas; la estación elegida se recuerda al recargar; «Nuevo» en tickets recientes; sonido opcional apagado por defecto.
5. **Cotización ASAP**: una captura a domicilio sin hora programada se confirma y promete entre 30 y 45 minutos; dime si prefieres otros tiempos.

## 10. Qué probar el 2026-10-08: Mesas, segunda ronda

En `http://localhost:8082` (desactiva Grammarly en localhost):

1. Cambia entre Mesas, Órdenes, Caja y Menú desde la barra lateral: no debe recargarse la página entera y debe sentirse más rápido.
2. Cambia de pestaña menos de 15 s y regresa: no debe aparecer «Rendering». Tras más de 15 s oculta puede actualizarse una vez.
3. Mesas: el plano ocupa todo el ancho; al tocar una mesa el diálogo se ve completo (cabecera y «Abrir cuenta») en tu pantalla y a 390×844.
4. Barra lateral: iconos y textos blancos; la sección activa con fondo claro translúcido y una barra blanca a la izquierda, sin azul.
5. «Cambiar sucursal» ya no está en Mesas: aparece arriba, junto a «Cerrar sesión» (sólo si tienes más de una sucursal).
6. Editar plano: arrastra una mesa y suéltala → «Guardando…» → «Guardado». Vuelve a Mesas: está donde la dejaste.
7. Selecciona una mesa y arrastra el asidero de la esquina inferior derecha (o usa «Más ancha / Más alta…»): cambia de tamaño y se guarda solo.
8. En el panel de la mesa cambia nombre (máx. 40), capacidad y forma → «Guardar datos». La capacidad no cambia al cambiar el tamaño.
9. «Nueva mesa»: se cierra con Cancelar, con ✕, con Esc y tocando fuera; al crear, la mesa aparece en un hueco libre.

## 11. Qué probar el 2026-10-08: Menú, segunda ronda

En `http://localhost:8082/app/menu` (migración `20261008000200` aplicada y API/web reiniciados el 2026-10-08). Si una pizza que tenía mitades distintas por tamaño aparece sin mitades, vuelve a configurarla en el producto.

1. Arrastra una categoría, un producto, un tamaño o un grupo por el asidero ⋮⋮: la fila se levanta, aparece una línea donde caerá y se mueve al soltar. Esc cancela.
2. Pasa el mouse (o toca) el «?» junto a cualquier etiqueta, en Menú y en las demás secciones: explica el campo. En 390×844 no se sale de la pantalla y se cierra tocando fuera.
3. Unidad y Estación son listas. «Otra estación…» permite escribir una nueva; si la dejas vacía vuelve a la anterior.
4. «+ Añadir tamaño» y luego ✕: un tamaño sin nombre se quita al instante; uno con nombre pide confirmación abajo, con el foco en «Cancelar».
5. Sube una foto a un producto y a una opción de modificador. Si falla, el mensaje dice la causa (permiso, formato, almacenamiento o código HTTP). Una foto de más de 2 MB se reduce sola antes de subirse.
6. «Permitir mitades» aparece una vez por producto, aunque no tenga tamaños. Elige «Grupo de sabores» e «Grupo de ingredientes»: un grupo usado en uno aparece deshabilitado en el otro con «(ya usado como …)».
7. Publica el menú con una pizza con mitades y vuelve a cargar: sigue configurada (sin error de conflicto).
8. Captura → pizza → «Mitad y mitad»: Mitad A con un sabor, Mitad B con «Armar con ingredientes» y 2 ingredientes. El estimado del servidor aparece; no deja armar las dos mitades.
9. Agrega la línea, ábrela de nuevo para editar: conserva la mitad armada.
10. Ticket y detalle de la orden muestran «Mitad B: Armada (ingrediente, ingrediente)»; el KDS muestra la mitad «Armada».
11. Editor de mesas («Editar plano»): nombre, capacidad, forma y tamaño tienen «?»; en «Nueva mesa» también. Caja, Entregas, Reporte del día y Administración cargan sin error y sus «?» funcionan; la casilla «Este cierre es definitivo» se marca tocando toda la fila.

## 12. Ruta de aceptación del «día operable» — 2026-10-23

Consolida §7 a §11 en un solo turno, en el orden en que lo viviría el operador. Cada paso dice qué fila de `TODO.md` acepta (D1–D7, T1–T4). Marca cada paso como **OK**, **FALLA** (con lo que viste) u **OMITIDO**; con eso el orquestador pasa la fila a DONE o abre la corrección. Tiempo estimado: 60 a 90 minutos.

**Antes de empezar**
- Doble clic en `tools\agentic\local-servers\start-local.bat` y esperar «Listo: API y web responden». Entrar en `http://localhost:8082` con `emmanuel.rgomez@gmail.com` (manager) y confirmar la sucursal Navojoa.
- KDS: `pnpm --filter @super-restaurant/kds dev` con un `apps/kds/.env` según `apps/kds/.env.example`; abrir la URL que imprime Vite en otra pestaña, estación «Cocina».
- Un segundo usuario con rol `courier` en la sucursal (Accesos). Si no existe, el paso 7 queda OMITIDO y D6 no se acepta.
- Consola del navegador abierta (F12) todo el tiempo; cualquier mensaje rojo se anota con el paso.
- Desactivar Grammarly u otras extensiones en localhost. Repetir los pasos 2, 4, 5 y 6 a 390×844 (modo responsive) al final.

**Paso 1 · Menú listo (D7, §8.1, §11)**
1. `/app/menu`: arrastra una categoría y un producto por el asidero ⋮⋮; Esc cancela. Sube una foto a un producto y a una opción de modificador: miniatura visible, «Quitar foto» funciona. *Acepta: fotos y reordenamiento.*
2. En una pizza: «+ Añadir tamaño» Chica y Grande con precio; en Grande «Permitir mitades» con grupo de sabores y grupo de ingredientes. «Publicar nueva versión»; recarga: todo sigue igual. *Acepta: tamaños y mitades (D7).*

**Paso 2 · Pedido telefónico completo (D1, D7, §7.3, §8.2–8.3, §8.8–8.9, §8.11)**
3. `/app/capture` → N (nueva) → origen Teléfono, cumplimiento Domicilio → buscar cliente por teléfono (o alta rápida con dirección) → «Validar para esta sucursal» muestra zona, envío y ventana, o «Fuera de cobertura».
4. Menú táctil: una pizza Grande «Mitad y mitad» con dos sabores (Agregar se habilita sólo con ambos), un producto con nota a cocina, un producto sin modificadores (se agrega al toque). El «Estimado del servidor» aparece en menos de un segundo y el ticket coincide.
5. Instrucciones de entrega → «Cotizar entrega» (promesa 30–45 min ASAP) → Cobro: Efectivo contra entrega con «Recibido» mayor al total → «Cambio: $X» del servidor. Cambia una línea después: aparece «Cambió el pedido: confirma de nuevo el cobro».
6. «Convertir captura en orden» → «Enviar a cocina» → «Enviada a cocina · N líneas»; un segundo toque no duplica. El KDS muestra la orden con las dos mitades por separado y la nota. *Acepta: D1 completo y D3 (envío).*

**Paso 3 · Pedido de mesa (D2, §7.4, §10)**
7. `/app/tables`: el plano ocupa todo el ancho; mesa libre → elegir mesero → «Abrir cuenta» → «Agregar producto» → producto con tamaño y nota → Agregar; la línea aparece en la cuenta; «Enviar a cocina». Mesa ocupada → «Ver cuenta», «Cambiar mesero».
8. «Editar plano»: mover dos mesas → «Guardar plano»; cambiar tamaño con el asidero y nombre/capacidad/forma → «Guardar datos»; «Nueva mesa» aparece en un hueco libre; volver a Mesas conserva todo. *Acepta: D2 y el editor.*

**Paso 4 · Cocina y seguimiento (D3, T4, §9.4)**
9. KDS: tarjetas por orden, tiempo en verde/ámbar/rojo (10 y 20 min), más viejas primero; «Empezar todo» / «Listo todo»; la estación se recuerda al recargar; «Nuevo» en tickets recientes.
10. `/app/orders` → detalle: «Marcar lista», «Marcar entregada», «Cancelar línea» con motivo; la línea cancelada desaparece del KDS. *Acepta: D3 y T4.*

**Paso 5 · Impresión y cancelación (T1, T2, §9.1–9.2)**
11. Detalle de orden → «Imprimir comanda»: vista previa 80 mm, una hoja por estación, sólo líneas enviadas, mitades y notas; «Imprimir» abre el diálogo del navegador. *Acepta: T1 comanda.*
12. Otra orden de prueba → «Cancelar orden» (sólo gerente/supervisor) con motivo; con dinero cobrado dice «Queda pendiente devolver $X en caja»; con entrega en ruta se bloquea. Pestaña «Canceladas»: motivo, quién, cuándo; «Cargar más». *Acepta: T2.*

**Paso 6 · Caja (D4, D5, T1 ticket, §7.1, §8.6)**
13. `/app/caja`: abrir caja con fondo en pesos. «Cargar cuenta» → la orden de mesa → Efectivo «$200» → propina opcional → «Cobrar»; recibo con cobrado, cambio, propina y saldo, y sobrevive a recargar. «Imprimir ticket»: encabezado, líneas, IVA, propina, recibido y cambio iguales al recibo.
14. Otra cuenta: «Cobrar parcial» editando el importe → segundo cobro con Tarjeta externa (terminal y referencia de 6 o más) → saldo en cero. Una tercera con Transferencia: sin «Recibido» ni «Cambio», recibo «Transferencia».
15. Corte X: fondo, ventas por método con «Transferencias» aparte, propinas, esperado y movimientos en español. Cerrar caja con un conteo distinto al esperado → exige motivo; casilla «Este cierre es definitivo» se marca tocando la fila. *Acepta: D4 y D5.*

**Paso 7 · Entregas (D6, §7.2, §8.7, §8.10)**
16. `/app/deliveries`: la orden telefónica del paso 2 está en «Por asignar» → tocar repartidor → «Salió» → «Entregada» → «Liquidar» con el recibido precargado y el cambio del servidor. Una orden prepagada aparece con «Pagada» y desaparece al asignarla. «No se pudo» con motivo y reasignar.
17. Entrar como el usuario `courier` (otra ventana privada): sólo ve lo suyo; «Ver pedido» muestra líneas, notas, dirección y «Cobrar en efectivo $X». *Acepta: D6.*

**Paso 8 · Resumen del día (T3, §9.3)**
18. `/app/reports/day`: hoy por defecto; tarjetas de ventas, propinas, envíos y canceladas; tablas por canal, por método y por turno con fondo, esperado, contado y diferencia; otra fecha vacía en ceros. Los números deben cuadrar con el corte del paso 15. *Acepta: T3.*

**Paso 9 · Móvil y cierre**
19. Repetir 3–6, 7, 13 y 16 a 390×844: nada se sale de pantalla, los diálogos se ven completos, las dos mitades se apilan.
20. Recorrer una vez la barra lateral completa: ninguna pantalla muestra error ni mensaje rojo en consola.

**Cómo reportar**: una línea por paso, «Paso N: OK» o «Paso N: FALLA — qué hiciste, qué esperabas, qué viste», con captura si es visual. Lo que esté OK pasa a DONE en `TODO.md`; cada FALLA se convierte en un paquete de corrección.

## 13. Smoke de la retroalimentación del 2026-11-01 (cambios recientes y pendientes)

Complementa la ruta completa de §12. Marca cada punto como **OK**, **FALLA** (qué hiciste, qué esperabas, qué viste) u **OMITIDO**.

**Antes de empezar**
- `start-local.bat` sin `nobuild` (recompila la API con los contratos nuevos). Entrar con `emmanuel.rgomez@gmail.com`, sucursal Navojoa, consola abierta (F12).
- Migración `20261101000200` (grupos compartidos): si no está aplicada, el paso 2.6 «Publicar nueva versión» fallará; eso es esperado hasta aplicarla.
- `tools\agentic\local-servers\e2e-auth.bat` para renovar la sesión del arnés E2E.

**1. Captura** (`/app/capture`)
1. Ticket: agrega una pizza mitad y mitad con nota; la fila Editar · − 1 + · Editar nota · Quitar se ve completa, sin barra horizontal, y el precio no se corta. Repetir a 390×844.
2. Efectivo: escribe «250» en «Otro monto» y toca «Exacto»; el campo se vacía y «Exacto» queda marcado con un solo toque. Escribe un monto que no coincida con ningún botón: ninguno queda marcado.
3. Instrucciones de entrega: escribe algo y, sin pulsar nada, toca un botón de efectivo; recarga la página: el texto sigue ahí. Ya no existe «Guardar instrucciones».
4. Atajos: `N` sola no hace nada; `Alt+N` crea captura; `Ctrl+K` enfoca la búsqueda; `Escape` o `Alt+R` reinicia.
5. Cliente: busca `6622751352`; un toque selecciona al cliente (sin paso «Elegir teléfono»); debajo aparece su dirección con estado. «Usar esta dirección» la valida y la deja marcada, o dice «Fuera de cobertura» si la zona no cubre el CP 85860 (revisar Zonas). «Editar» y «Agregar dirección» funcionan sin salir de la captura. El paso 5 tiene «Ir a la dirección» y permite confirmar cuando la dirección está en cobertura.

**2. Menú** (`/app/menu`)
1. Categorías: arrastra la tercera sobre la segunda; aparece un hueco y la segunda baja; soltar aplica, `Escape` o clic derecho cancelan, soltar en el origen no cambia nada. Asidero angosto, sin botones subir/bajar. Flechas de teclado con el asidero enfocado reordenan.
2. Categoría: el círculo a la izquierda del nombre abre el selector de foto; la foto se ve en el círculo. Fila de muestras de color: elegir una tiñe la tarjeta y la pestaña de esa categoría en `/app/capture`.
3. Producto: tarjeta en tres filas; «Grupos de modificadores», «Permitir mitades», «Aplicar impuesto» y «+ Añadir tamaño» abren su sección sólo al activarse. Tocar la foto sin foto abre el selector; con foto abre el diálogo con «Reemplazar», «Quitar», «Cancelar» y las listas «Fotos quitadas de este producto» y «Fotos ya usadas en este menú» (elegir una ajena la copia al producto).
4. «Duplicar» crea «(copia)» con la misma foto y los mismos grupos asignados, sin clonar grupos.
5. Grupos de modificadores: sección propia para crear, editar, duplicar y quitar; en el producto, la casilla abre un desplegable multiselección (`Escape` y clic fuera cierran). Un grupo asignado a dos productos aparece en ambos en la captura. Quitar un grupo asignado pide confirmación y lo desasigna de todos.
6. Autoguardado: edita algo y recarga; aparece «Recuperar cambios sin publicar» / «Descartar». Junto a «Publicar» se lee «Cambios sin publicar» con anillo pulsante; tras publicar, «Todo publicado». (Requiere la migración aplicada.)

**3. Mesas y órdenes**
1. `/app/tables`: mesa libre → «Abrir cuenta» → la app llega a Órdenes con «Agregar producto» abierto y **sin** un segundo «Abrir cuenta».
2. `/app/orders`: las tarjetas, el detalle, la comanda y el ticket dicen «Mesa 2» (nombre real), nunca «Mesa» a secas ni un UUID. Pestaña «Canceladas» intacta.

**4. Pendiente de Emmanuel** (no se puede probar todavía)
- Nombre opcional de la cuenta de mesa («a nombre de quién»): paquete B sin iniciar.
- Posición y zoom de la foto: paquete A sin iniciar.
- Ingredientes «que no se pueden quitar» (P2) y «especialidades» como sabores de mitades (P3): P2 arranca cuando Codex recupere cuota; P3 espera dos decisiones: regla de precio de mitades con dos especialidades y destino de los grupos de sabores actuales.
- Dos cuentas de prueba en borrador abiertas hoy en Mesa 2 y Mesa 5: cancelarlas o usarlas.
