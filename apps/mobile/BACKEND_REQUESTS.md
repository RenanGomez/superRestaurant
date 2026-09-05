# Solicitudes al coordinador — apps/mobile

Solicitudes abiertas de este workstream frontend. Ninguna fue implementada,
simulada ni resuelta desde `apps/mobile`. Cada una detuvo únicamente la
capacidad afectada; el resto del entregable continuó.

Referencia: `docs/CLAUDE_FRONTEND_WORKSTREAM.md`, secciones 6, 7 y 8.2.

---

## SR-MOB-001 — Decisión de arquitectura: almacenamiento de sesión en el dispositivo

- **Capacidad requerida**: una decisión aprobada sobre dónde y cómo persistir la
  sesión de Supabase Auth en el dispositivo (adaptador de almacenamiento,
  cifrado, expiración, borrado en logout y en revocación).
- **Pantalla o caso de uso bloqueado**: continuidad de sesión entre aperturas de
  la aplicación. Hoy, al cerrar la app el operador debe volver a autenticarse.
- **Contrato o componente buscado**: `@supabase/supabase-js` exige un adaptador
  de almacenamiento para `persistSession`. En React Native las opciones usuales
  son `expo-secure-store`, `@react-native-async-storage/async-storage` o un
  adaptador propio; ninguna está aprobada por el mandato ni existe en el
  repositorio.
- **Evidencia de no disponibilidad**: `docs/CLAUDE_FRONTEND_WORKSTREAM.md` §8.2
  prohíbe inventar persistencia segura de refresh tokens y ordena mantener la
  sesión en memoria mientras no haya un adaptador aprobado. `packages/*` no
  contiene ningún adaptador de almacenamiento móvil.
- **Decisión aplicada mientras tanto**: `src/session.ts` fija
  `persistSession: false`, `autoRefreshToken: false` y
  `detectSessionInUrl: false`; nada se escribe en el dispositivo y la sesión
  muere con el proceso. Está cubierto por pruebas.
- **Datos mínimos que necesitaría la UI**: poder recuperar, al abrir la app, una
  sesión válida o la ausencia de sesión, sin exponer el refresh token al código
  de pantalla y con borrado garantizado al cerrar sesión o al revocarse el
  acceso.
- **Impacto si se difiere**: el operador vuelve a autenticarse en cada apertura y
  no existe renovación automática del access token; una jornada larga puede
  requerir reingreso. No hay riesgo de fuga de credenciales por diferirlo.
- **Decisión requerida**: elegir adaptador y política de cifrado/expiración, o
  confirmar por escrito que la sesión en memoria es aceptable para el piloto.

---

## SR-MOB-002 — Contrato compartido para la respuesta de `POST /api/v1/access/branch`

- **Capacidad requerida**: un parser versionado y compartido para la respuesta de
  revalidación de sucursal, equivalente a `parseBranchMembershipListV1`.
- **Pantalla o caso de uso bloqueado**: ninguna; la pantalla de selección de
  sucursal funciona. La solicitud es de consolidación de contrato.
- **Contrato o endpoint buscado**: `packages/shared-types` exporta
  `parseBranchScope` para la petición, pero no expone un parser para la
  respuesta `{ branchId, restaurantId, roles }` que devuelve
  `BranchAccessController`.
- **Evidencia de no disponibilidad**: `packages/shared-types/src/index.ts` no
  contiene ningún parser de esa respuesta; `apps/web/src/lib/branch-selection.ts`
  documenta explícitamente que mantiene el suyo local por esa razón.
- **Estado en este entregable**: `src/mobile-client.ts` valida la respuesta con
  un parser local estricto (UUID exactos, `roles` no vacío, sin duplicados y
  solo códigos de `MEMBERSHIP_ROLE_CODES`) y exige que el par devuelto sea
  idéntico al solicitado. No se modificó `packages/shared-types`.
- **Impacto si se difiere**: dos validaciones locales equivalentes (web y mobile)
  que pueden divergir si el servidor cambia la forma de la respuesta.
- **Decisión requerida**: si el coordinador publica el parser compartido, ambos
  clientes deben migrar a él en una unidad posterior.

---

## SR-MOB-003 — Turno operativo (shift) en el alcance móvil

- **Capacidad requerida**: contrato y endpoint para consultar el turno vigente de
  la sucursal y, si corresponde, seleccionarlo.
- **Pantalla o caso de uso bloqueado**: la selección de turno que pide la Fase 2
  del plan maestro (“login/sucursal/turno”). No se implementó ninguna pantalla ni
  representación de turno.
- **Contrato o endpoint buscado**: no existe `shift`/`turno` en
  `packages/shared-types` ni un endpoint equivalente en `apps/api`.
- **Evidencia de no disponibilidad**: los contratos versionados actuales cubren
  membresías, scope, layout de mesas, catálogo, órdenes, KDS y caja; ninguno
  modela turno. `docs/CLAUDE_FRONTEND_WORKSTREAM.md` §6 tampoco lo autoriza.
- **Datos mínimos que necesitaría la UI**: identificar el turno activo de la
  sucursal seleccionada y mostrar su estado; no se requiere mutarlo en este
  slice.
- **Impacto si se difiere**: ninguno para esta fundación de solo lectura. La
  toma de comanda posterior sí podría requerirlo si el dominio ata órdenes a un
  turno.
- **Decisión requerida**: confirmar si el turno forma parte del producto y, en
  ese caso, definir su contrato antes de la unidad de comanda móvil.

---

## SR-MOB-004 — Origen de API alcanzable desde un dispositivo físico

- **Capacidad requerida**: una política aprobada para que un dispositivo real
  alcance la API durante desarrollo y piloto.
- **Pantalla o caso de uso bloqueado**: uso de la app en un teléfono físico
  contra un entorno de desarrollo.
- **Contrato o endpoint buscado**: no aplica; es configuración/entorno.
- **Evidencia de la restricción**: `src/config.ts` acepta `https` en cualquier
  host y `http` únicamente en `127.0.0.1`/`localhost`, replicando la regla
  fail-closed de `apps/kds/src/config.ts`. Un teléfono en la red local no puede
  usar `127.0.0.1` ni un origen `http` de LAN.
- **Impacto si se difiere**: la verificación en dispositivo físico requiere un
  emulador con reenvío de puertos, un túnel TLS o un entorno remoto con TLS.
- **Decisión requerida**: definir el origen de API para dispositivos (túnel TLS,
  certificado de desarrollo o entorno remoto). No se relajará la validación de
  configuración sin esa decisión escrita.

---

## SR-MOB-005 — Entorno verificable para las pantallas autenticadas

- **Capacidad requerida**: una forma autorizada de ejecutar la app contra Auth y
  la API con datos sintéticos, para verificar visualmente sucursales, mesas y
  menú en un runtime real.
- **Pantalla o caso de uso bloqueado**: verificación visual de
  `BranchScreen`, `TablesScreen` y `MenuScreen`, y de la ausencia de fuga visual
  al cambiar de sucursal.
- **Contrato o endpoint buscado**: ninguno nuevo. Se necesita acceso ejecutable a
  las capacidades ya autorizadas (`/api/v1/access/*`, `/api/v1/dining/layout`,
  `/api/v1/catalog/menu`) y una sesión válida de Supabase Auth.
- **Evidencia de la restricción**: el mandato §10 prohíbe E2E remotas y crear
  usuarios o fixtures remotas; este workstream no tiene credenciales, no puede
  levantar `apps/api` (requiere conexión PostgreSQL privada y secretos) y
  `EXPO_PUBLIC_SUPABASE_URL` exige TLS, por lo que un doble local de Auth no es
  alcanzable desde el cliente sin relajar la validación de configuración.
- **Qué sí se verificó**: pantalla de configuración inválida, pantalla de acceso
  (estados vacío, escritura, foco, teclado y fallo de servicio) en 390×844 y en
  vista tablet, además de 36 pruebas automatizadas que cubren el aislamiento del
  par Restaurant/Branch, el cambio y la revocación de sucursal, los estados de
  carga/vacío/red/protocolo, la moneda explícita y la navegación.
- **Impacto si se difiere**: las tres pantallas autenticadas quedan verificadas
  por pruebas y no por observación directa; un defecto puramente visual en ellas
  podría pasar desapercibido.
- **Decisión requerida**: que el coordinador ejecute la app con su propio
  entorno, o que autorice expresamente un smoke acotado con usuario temporal,
  fixtures marcadas, cleanup obligatorio y recovery exclusivo, como se hizo para
  Web y KDS.
