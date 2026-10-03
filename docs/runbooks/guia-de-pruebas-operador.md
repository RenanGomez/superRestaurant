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
