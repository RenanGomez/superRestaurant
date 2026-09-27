# Guía de pruebas del operador — estado al 2026-09-27

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
- Canvas de mesas con creación de mesa y guardado de layout. **Conocido:** arrastrar mesas no funciona; los iconos laterales no marcan la ruta activa.

### `/app/menu` · Catálogo
- Categorías, productos, precios en minor units, disponibilidad. Publicación de releases del catálogo.
- **Falta:** configurador de pizza (tamaños, mitades, extras, combos). El dominio S5.1 existe; no hay pantalla.

### `/app/customers` · Directorio
- Búsqueda por teléfono o nombre con sugerencias; alta rápida de cliente; teléfonos y direcciones con atestación de validez; historial y "repetir pedido" (desde Captura).
- **Conocidos:** seleccionar un cliente desde el desplegable no renderiza sus datos; "etiqueta" de dirección sin ejemplo (es el nombre corto: Casa, Oficina); "Validar para esta sucursal" no muestra efecto visible; el alta rápida no ofrece crear orden; columnas pedidas 60/40.

### `/app/capture` · Captura telefónica
Aquí nacen las órdenes. Flujo actual:
1. «Nueva captura telefónica» crea un borrador durable con folio.
2. Origen (teléfono, mostrador, WhatsApp…) y cumplimiento (domicilio, recoger, mesa).
3. Buscar cliente, elegir contacto y dirección: quedan congelados como snapshots.
4. Instrucciones de entrega con sugerencias del mismo cliente.
5. Pedidos recientes → «Revisar para repetir» → «Preparar N líneas».
6. «Cotizar entrega» (requiere la migración de zonas aplicada, ver §4).
7. Turno abierto (y mesa si aplica) → «Convertir captura en orden».
- Atajos: N nueva captura, / buscar, Esc volver; panel «Atajos» al pie.
- Bandeja de borradores recuperables; transferencia y apropiación supervisada entre operadores (el mensaje «No hay otro operador activo elegible» significa que nadie más de la sucursal tiene sesión).
- **Falta lo esencial:** elegir productos del menú dentro de la captura. Hoy sólo se agregan líneas vía "repetir pedido".

### `/app/caja` · Caja
- Apertura y cierre de caja por turno, pagos simples en efectivo o tarjeta manual sobre órdenes, movimientos auditados. Métodos `transfer`, anticipos y refunds: aún no.

### `/app/delivery-zones` · Zonas de entrega (gerente)
- Alta y edición de zonas por códigos postales o localidades con tarifa fija, CAS y motivo al desactivar.
- **No carga hasta aplicar la migración** `supabase/migrations/20260927000100_delivery_zones.sql` al proyecto remoto (ver §4).

### `/app/system-admin/restaurants` · Administración
- Alta de restaurantes y desactivación, sólo para el rol de sistema.

## 3. KDS y Mobile
- KDS: lista de órdenes por estación con recuperación por cursor y notificación en tiempo real; cancelaciones llegan como evento durable.
- Mobile: selección de sucursal y turno, mesas, toma de comanda por mesa, envío a cocina; verificado en harness de navegador, no en dispositivo real.

## 4. Migración pendiente de autorización
`20260927000100_delivery_zones.sql` es candidata. Antes de aplicarla: `pnpm --filter @super-restaurant/api run verify:delivery-zones-schema:rollback` con la configuración `SCHEMA_VERIFICATION_*` del runbook `customer-directory-verification.md`. Aplicarla requiere autorización explícita de Emmanuel y el procedimiento de staging/dry-run registrado en HANDOFF (S9.1b2).

## 5. Lo que no existe todavía
Configurador de pizza en UI, selección de productos en captura, S6.3 corrección de producción, S7.2+ programación y despacho, S8.3+ transferencia/anticipos/refunds, impresión Bluetooth real, offline, inventario, reportes, fiscal.
