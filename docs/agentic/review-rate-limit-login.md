# Revisi├│n de seguridad Nivel A ΓÇö PR #50 (`ao/rate-limit-login`)

- **PR revisado:** `RenanGomez/superRestaurant#50` ΓÇö `fix(api): endurecer limites de tasa del login (m1-sec-rate-limit)`
- **Rama / Commit cabeza:** `ao/rate-limit-login` @ `3a1a47eb8eb3cab6c04086eb27db0a0ad217f8d5` (base `main` @ `90bab930d33eba53aae8668feb5dd95cc8ceabf1`)
- **Fecha:** 2026-11-23 (America/Phoenix)
- **Nivel de rigor:** **A ┬╖ Cr├¡tico** (`AGENTS.md ┬º13`, `┬º19.2`, `┬º19.6`) ΓÇö solo lectura sobre el PR (sin edici├│n de c├│digo fuente ni mutaciones al PR).
- **Archivos del PR auditados:** `apps/api/src/auth/authentication.ts`, `apps/api/src/config.ts`, `apps/api/src/auth/authentication.test.ts`, `apps/api/src/config.test.ts`, `HANDOFF.md` (m├ís contexto verificado en `apps/api/src/{app.module,app-setup,main,payments.controller,operational-shifts.controller,realtime.gateway}.ts`, `apps/api/tsconfig.json`, `apps/web/src/app/login/actions.ts`, `apps/web/src/lib/login-error.ts`).
- **Estado CI del PR al revisar:** `Verify` pass, `PostgreSQL verification` pass, `Playwright smoke` pass.

## VEREDICTO: RECHAZAR

Existen **5 hallazgos P1 bloqueantes** (adem├ís de 5 P2 y 5 P3). Seg├║n `AGENTS.md ┬º19.6`, un cambio de Nivel A requiere **cero hallazgos P1 abiertos** antes de integrarse.

---

## Matriz de cumplimiento (`AGENTS.md ┬º13` y criterios del encargo)

| Criterio | Estado | Referencia |
|---|---|---|
| L├¡mites por IP y por cuenta | **NO CUMPLE** | `P1-4`, `P1-2`, `P2-2` |
| Sin enumeraci├│n de usuarios | **CUMPLE** (en borde HTTP API) | Respuestas `401 { code: "AUTHENTICATION_REQUIRED" }` y `429 { code: "RATE_LIMITED" }` uniformes |
| Sin fuga de secretos en logs | **CUMPLE** (con brecha de cobertura de test) | `P2-5` (`authentication.ts` no loguea; `app-setup.ts:49` solo emite metadatos de ruta/estado) |
| Configuraci├│n con defaults seguros | **NO CUMPLE** | `P1-2`, `P2-1`, `P2-3` |
| Tests de lockout / ventana / reset | **NO CUMPLE** | `P1-5` |
| Sin bypass por cabeceras spoofeadas (`X-Forwarded-For`) | **NO CUMPLE** (cuando `trustForwardedFor=true`) | `P1-3` |
| Login v├ílido no bloqueado por intentos ajenos de forma abusable | **NO CUMPLE** | `P1-1` |

---

## Hallazgos P1 (bloqueantes)

### P1-1 ┬╖ Bloqueo abusable de usuarios/logins v├ílidos por intentos fallidos ajenos (proxy/NAT compartido) y falsos 429 bajo concurrencia v├ílida
- **Ubicaci├│n:** `apps/api/src/auth/authentication.ts:126-141`, `apps/api/src/config.ts:20-25`
- **Descripci├│n:**
  1. **DoS cruzado contra usuarios v├ílidos:** `SupabaseAuthGuard` es `APP_GUARD` global sobre todas las rutas protegidas y consume la cubeta de IP (`this.loginRequests.consume(ipKey, ...)`, `authentication.ts:128`) **antes** de verificar el bearer token. Una vez agotados `loginMax` intentos fallidos (incluso peticiones sin cabecera `Authorization`), cualquier petici├│n leg├¡tima posterior con un token 100 % v├ílido desde la misma IP recibe `429` en `:128` sin llegar jam├ís a `verifyAccessToken()` ni a `refund(ipKey)` (`:140`).
     - Con el default `trustForwardedFor: false` (`config.ts:24`) detr├ís de cualquier reverse proxy / load balancer, `request.socket.remoteAddress` es la IP ├║nica del proxy para **todos los restaurantes**: un atacante an├│nimo enviando 60 peticiones sin token por minuto tumba el API completo para todos los operadores autenticados.
     - Incluso con `trustForwardedFor: true`, en una sucursal de restaurante m├║ltiples POS/tablets/KDS comparten el mismo NAT de salida ΓÇöy las Server Actions/SSR de `apps/web` llaman al API desde la IP del servidor Next.jsΓÇö, por lo que un dispositivo con sesi├│n expirada o un atacante local bloquea a todos los usuarios v├ílidos compartiendo esa IP.
  2. **Auto-bloqueo por concurrencia v├ílida y fuga de `ipKey`:** como `consume(ipKey)` (`:128`) y `consume(tokenKey)` (`:134`) descuentan cuota antes del `await this.verifier.verifyAccessToken(accessToken)` (`:138`, llamada de red a Supabase Auth), si llegan m├ís de `loginMax` peticiones **v├ílidas simult├íneas** (p. ej. con `RATE_LIMIT_LOGIN_MAX=5` ΓÇöoverride probado en `config.test.ts:67`ΓÇö y 6 `fetch` en paralelo al cargar una pantalla, o tr├ífico concurrente desde Next.js SSR), las peticiones v├ílidas en vuelo reciben `429` con cero fallos reales. Adem├ís, si `:134` (`tokenKey`) devuelve `429`, el slot ya consumido en `ipKey` (`:128`) **no se reembolsa**, fugando cuota de IP hasta expirar la ventana.
- **Acci├│n requerida:** no descontar cuota de fallos de forma especulativa para tr├ífico v├ílido en vuelo ni permitir que fallos ajenos en una IP compartida/proxy bloqueen sesiones autenticadas v├ílidas (separar el l├¡mite de fallos registrados en `catch` / peticiones sin bearer v├ílido, acotar concurrencia no autenticada de forma independiente, y dise├▒ar una pol├¡tica compatible con proxy/NAT de sucursal).

### P1-2 ┬╖ Bypass total del l├¡mite por auto-evicci├│n FIFO en `RateLimitStore` compartido entre `ip|` y `token|`
- **Ubicaci├│n:** `apps/api/src/auth/authentication.ts:38-46, 52-55, 114, 127-134`, `apps/api/src/config.ts:44-46`
- **Descripci├│n:**
  - `this.loginRequests` (`authentication.ts:114`) almacena tanto claves `ip|<clientIp>` como claves `token|<hash>` en el **mismo** `Map` con evicci├│n FIFO por orden de inserci├│n (`this.entries.keys().next().value`, `:41`).
  - Cada intento fallido con un bearer token distinto inserta una nueva clave `token|...`, mientras la clave `ip|...` permanece en la cabeza (m├ís antigua) del `Map`.
  - **Bypass desde una sola IP:** `readRateLimitPolicy` acepta `RATE_LIMIT_LOGIN_MAX` hasta `10_000` (`config.ts:44`) y `RATE_LIMIT_MAX_KEYS` desde `100` (`config.ts:46`) sin validar relaci├│n entre ambos. Con cualquier configuraci├│n donde `loginMax >= maxTrackedKeys` (p. ej. `100` y `100`), una ├║nica IP enviando 100 tokens inv├ílidos distintos inserta `ip|A` + 99 claves `token|*`, y al insertar `token|100` en el intento 100 **evicta su propia clave `ip|A`**, reiniciando su contador a 0 indefinidamente.
  - **Bypass con defaults (`loginMax=60`, `maxTrackedKeys=10_000`):** tr├ífico distribuido (~167 IPs ├ù 60 tokens ├║nicos) genera ~10 000 claves `token|` que expulsan entradas `ip|` bloqueadas cuya ventana a├║n no ha expirado. Agravante: `refund()` (`authentication.ts:52-55`) deja entradas con `count: 0` viviendo en el `Map` toda la ventana, por lo que el propio tr├ífico leg├¡timo consume capacidad y acelera la expulsi├│n de bloqueos activos.
- **Acci├│n requerida:** aislar en instancias `RateLimitStore` separadas las claves de IP y las de credencial/cuenta (evitando que claves de alta cardinalidad expulsen IPs), eliminar la entrada en `refund()` cuando `count === 0` (o no crear entradas en ├⌐xito), y reforzar las cotas/invariantes en `readRateLimitPolicy`.

### P1-3 ┬╖ Bypass de `X-Forwarded-For` cuando `RATE_LIMIT_TRUST_FORWARDED_FOR=true` (sin allowlist de proxy confiable, fallback al IP del proxy con header >1 024 B y sin canonicalizaci├│n IP)
- **Ubicaci├│n:** `apps/api/src/auth/authentication.ts:188-199`, `apps/api/src/config.ts:17, 47`
- **Descripci├│n:**
  1. **Sin verificaci├│n de proxy confiable:** cuando `trustForwardedFor=true`, `resolveClientIp` acepta `x-forwarded-for` sin comprobar si `request.socket.remoteAddress` pertenece a una lista configurada de proxies confiables (IP/CIDR). Si el API es alcanzable directamente (red interna, puerto expuesto o despliegue mal aislado), cualquier cliente rota `X-Forwarded-For` y evade el l├¡mite al 100 %. Tampoco contempla cadenas con m├ís de un proxy (`trustedProxyHops`).
  2. **Bypass/duplicaci├│n de cuota mediante header >1 024 bytes (`authentication.ts:191`):** detr├ís de un proxy leg├¡timo (`10.0.0.5`), cuando un atacante agota `loginMax` intentos desde su IP real (`198.51.100.9`), puede enviar `X-Forwarded-For` con >1 024 bytes de relleno; el proxy agrega `, 198.51.100.9` al final, `forwarded.length <= 1_024` falla y `resolveClientIp` cae al fallback `socket.remoteAddress` (`10.0.0.5`). Esto otorga al atacante **otra cuota completa de `loginMax` intentos** por cada IP de salida del proxy/LB y contamina la cubeta del proxy.
  3. **Sin canonicalizaci├│n IPv4/IPv6:** `isIP(lastHop)` acepta m├║ltiples representaciones de la misma direcci├│n (`::ffff:203.0.113.7` vs `203.0.113.7`, `2001:db8::1` vs `2001:0db8:0:0:0:0:0:1` vs `2001:DB8::1`), produciendo cubetas `ip|` distintas para el mismo origen (y en IPv6 un atacante con un `/64` puede rotar la parte de host trivialmente).
- **Acci├│n requerida:** exigir allowlist expl├¡cita de proxies confiables (IP/CIDR) para honrar `x-forwarded-for`, leer el ├║ltimo salto desde el final sin hacer fallback a `socket.remoteAddress` cuando un atacante infla la cabecera (o rechazar/truncar desde el final de forma segura), y canonicalizar IPv4/IPv4-mapped/IPv6 (agrupando IPv6 por `/64`).

### P1-4 ┬╖ Ausencia de l├¡mite por cuenta (`email`/`userId`) y cobertura faltante del login por contrase├▒a; `tokenKey` contradice su comentario
- **Ubicaci├│n:** `apps/api/src/auth/authentication.ts:131-134, 141`, `HANDOFF.md:8` (ref. `apps/web/src/app/login/actions.ts:15-31`)
- **Descripci├│n:**
  - El segundo l├¡mite (`tokenKey = token|${tokenFingerprint(accessToken)}`, `:133-134`) agrupa ├║nicamente repeticiones exactas del mismo string de bearer token inv├ílido. No limita por cuenta: intentos con tokens distintos o JWTs manipulados para la misma cuenta generan hashes distintos y jam├ís disparan `tokenKey`.
  - El comentario de `:131-132` (*"stops a single stolen token from being sprayed across many source addresses"*) es incorrecto: un token robado v├ílido ejecuta `refund(tokenKey)` en `:141` y nunca agota esa cuota.
  - El inicio de sesi├│n por contrase├▒a ejecutado en servidor en `apps/web/src/app/login/actions.ts:24` (`supabase.auth.signInWithPassword`) no recibe ning├║n l├¡mite por IP de cliente ni por cuenta (`email`) en este PR, y al ejecutarse en el servidor Next.js concentra el tr├ífico de login web bajo la IP de salida del servidor frente a Supabase Auth.
- **Acci├│n requerida:** definir e implementar el l├¡mite real por IP y por cuenta (hash de identificador/email normalizado) en el borde de login con contrase├▒a (como m├¡nimo en `apps/web/src/app/login/actions.ts` o proxy/edge documentado y verificado) y corregir tanto la sem├íntica como la documentaci├│n de `tokenKey` en `apps/api`.

### P1-5 ┬╖ Sin pruebas de expiraci├│n de ventana, reset tras lockout, concurrencia v├ílida ni integraci├│n HTTP del l├¡mite de login
- **Ubicaci├│n:** `apps/api/src/auth/authentication.ts:113-114`, `apps/api/src/auth/authentication.test.ts:254-352, 363-435`
- **Descripci├│n:**
  - `SupabaseAuthGuard` fija `Date.now` directamente en los `RateLimitStore` (`authentication.ts:113-114`) sin inyecci├│n de reloj. Aunque `RateLimitStore` tiene una prueba aislada previa (`authentication.test.ts:184-194`), **ninguna prueba sobre `SupabaseAuthGuard`** verifica:
    1. expiraci├│n de `loginWindowMs` y reset efectivo del lockout (por IP y por credencial);
    2. evoluci├│n de `Retry-After` a lo largo de la ventana;
    3. comportamiento bajo concurrencia v├ílida (`Promise.all`) y ausencia de bloqueo a logins v├ílidos por fallos ajenos;
    4. el flujo HTTP real `401 -> 429` del borde de login (las dos pruebas HTTP nuevas en `authentication.test.ts:363-435` solo ejercitan mutaciones **autenticadas** `POST /payments/collect` y `POST /shifts/open`, nunca el l├¡mite de login ni la carga de `RATE_LIMIT_*` por `process.env`).
- **Acci├│n requerida:** permitir inyecci├│n de `clock` en `SupabaseAuthGuard` y a├▒adir pruebas unitarias + de integraci├│n HTTP que cubran lockout, ventana, reset tras expiraci├│n, concurrencia v├ílida y aislamiento de usuarios leg├¡timos.

---

## Hallazgos P2 (importantes)

### P2-1 ┬╖ Defaults y rangos m├íximos excesivamente permisivos en `readRateLimitPolicy`
- **Ubicaci├│n:** `apps/api/src/config.ts:20-25, 42-49`
- **Descripci├│n:** `DEFAULT_RATE_LIMIT_POLICY.loginMax = 60` en `60_000 ms` permite 3 600 intentos fallidos/hora por IP. Adem├ís, los l├¡mites de validaci├│n aceptan `RATE_LIMIT_LOGIN_MAX=10000` con `RATE_LIMIT_LOGIN_WINDOW_MS=1000` (10 000 fallos/segundo por IP, desactivando el control en la pr├íctica) y permiten `maxTrackedKeys` tan bajo como `100` independientemente de `loginMax` (habilitando `P1-2`).
- **Acci├│n recomendada:** ajustar defaults y cotas superiores a valores defendibles para un borde de autenticaci├│n, y exigir invariantes entre `maxTrackedKeys` y `loginMax`.

### P2-2 ┬╖ Bypass completo del l├¡mite de verificaci├│n de tokens a trav├⌐s de WebSocket (`RealtimeGateway`)
- **Ubicaci├│n:** `apps/api/src/realtime.gateway.ts:61-65, 180-185`
- **Descripci├│n:** `SupabaseAuthGuard` s├│lo aplica a rutas HTTP; `RealtimeGateway.authenticate()` invoca `this.verifier.verifyAccessToken(accessToken)` directamente durante el handshake Socket.IO (`/realtime/v1`) sin aplicar ning├║n rate limit, permitiendo probar tokens contra Supabase Auth sin l├¡mite desde el mismo servidor API.
- **Acci├│n recomendada:** extraer el limitador de verificaci├│n de tokens a un componente compartido y aplicarlo tambi├⌐n en `RealtimeGateway.authenticate()`.

### P2-3 ┬╖ Inyecci├│n fr├ígil de `RateLimitPolicy` en NestJS DI y falta de validaci├│n temprana en `main.ts`
- **Ubicaci├│n:** `apps/api/src/auth/authentication.ts:107-115`, `apps/api/src/app.module.ts:298-301`, `apps/api/src/main.ts:10-15`, `apps/api/src/auth/authentication.test.ts:369, 409`
- **Descripci├│n:** el tercer par├ímetro `policy: RateLimitPolicy = readRateLimitPolicy(process.env)` carece de `@Optional() @Inject(...)`; hoy funciona ├║nicamente porque `emitDecoratorMetadata` no est├í habilitado en `apps/api/tsconfig.json`. Si se habilita en el futuro, NestJS fallar├í al arrancar (`UnknownDependenciesException`). Adicionalmente, `main.ts` no valida `readRateLimitPolicy(process.env)` junto a `readApiConfig(process.env)`, y las pruebas HTTP (`authentication.test.ts:369, 409`) dependen impl├¡citamente del `process.env` del entorno que ejecuta los tests.
- **Acci├│n recomendada:** registrar un token DI `RATE_LIMIT_POLICY` en `AppModule` con `useFactory: () => readRateLimitPolicy(process.env)`, validarlo en `main.ts` y usar `@Optional() @Inject(RATE_LIMIT_POLICY)` en `SupabaseAuthGuard`.

### P2-4 ┬╖ Condici├│n de carrera en `RateLimitStore.refund()` al cruzar el borde de ventana
- **Ubicaci├│n:** `apps/api/src/auth/authentication.ts:52-55, 138-141`
- **Descripci├│n:** si una petici├│n entra justo antes de `expiresAt`, `await verifyAccessToken()` cruza el fin de la ventana y otra petici├│n abre una nueva entrada en el `Map`, el `refund()` tard├¡o de la primera petici├│n decrementa el contador de la ventana nueva (borrando un intento fallido real).
- **Acci├│n recomendada:** eliminar `consume-then-refund` (registrar solo en fallo) o devolver un handle/timestamp `expiresAt` para que `refund()` ├║nicamente afecte la misma ventana y borre la entrada al llegar a `0`.

### P2-5 ┬╖ Prueba de no-fuga en logs incompleta respecto al pipeline HTTP real
- **Ubicaci├│n:** `apps/api/src/auth/authentication.test.ts:333-352` (ref. `apps/api/src/app-setup.ts:28-52`)
- **Descripci├│n:** el test solo sustituye `console.info` y `console.error` sobre `guard.canActivate()` en aislamiento, sin cubrir `console.warn`/`console.log`, el `Logger` de NestJS ni el middleware HTTP de `configureApiApp`. Por inspecci├│n est├ítica, `app-setup.ts:49` no registra cabeceras ni IPs, pero conviene fijar esa garant├¡a en integraci├│n HTTP ante `401` y `429`.
- **Acci├│n recomendada:** a├▒adir aserci├│n de logs en una prueba HTTP con `configureApiApp(app)` disparando `401` y `429` con token y `X-Forwarded-For` identificables.

---

## Hallazgos P3 (mejoras y deuda menor)

### P3-1 ┬╖ `tokenFingerprint` sin clave ef├¡mera por proceso
- **Ubicaci├│n:** `apps/api/src/auth/authentication.ts:202-204`
- **Detalle:** `createHash("sha256")` sin sal permite correlaci├│n offline si hubiera un volcado de memoria. Sustituirlo por `createHmac("sha256", randomBytes(32))` generado al instanciar el guard refuerza defensa en profundidad sin costo operativo.

### P3-2 ┬╖ Cobertura parcial del contrato `@RateLimited` en caja (`cash-registers/open|close`)
- **Ubicaci├│n:** `apps/api/src/auth/authentication.test.ts:354-361`
- **Detalle:** la prueba de metadatos comprueba `PaymentsController.prototype.{quote,collect,report}` y `OperationalShiftsController.prototype.{open,listActive}`, pero omite `PaymentsController.prototype.open` (`cash-registers/open`) y `PaymentsController.prototype.close` (`cash-registers/close`), pese a mencionarlos en `HANDOFF.md:3`.

### P3-3 ┬╖ Sin telemetr├¡a ni auditor├¡a sanitizada de eventos 429 (`AGENTS.md ┬º13` / `┬º16`)
- **Ubicaci├│n:** `apps/api/src/auth/authentication.ts:161-165`
- **Detalle:** aunque evitar secretos/IPs crudas en logs es correcto, el guard no emite m├⌐trica ni evento estructurado sanitizado (p. ej. tipo de cubeta `ip|token` + `correlationId` sin valores sensibles) que permita alertar sobre ataques de fuerza bruta o DoS en operaci├│n.

### P3-4 ┬╖ Casos borde en `config.test.ts` y desalineaci├│n de metadatos en `HANDOFF.md`
- **Ubicaci├│n:** `apps/api/src/config.test.ts:79-93`, `HANDOFF.md:28`
- **Detalle:** `config.test.ts` no prueba enteros con espacios (`" 5 "`, `"5 "`) ni negativos (`"-1"`). Adem├ís, `HANDOFF.md:28` documenta *"commits locales en `ao/rate-limit-2/rate-limit-hardening`; sin push, sin PR"*, desalineado con la rama `ao/rate-limit-login` y el PR #50 abierto.

### P3-5 ┬╖ Limitaci├│n conocida: contadores en memoria por proceso
- **Ubicaci├│n:** `apps/api/src/auth/authentication.ts:23-56`, `HANDOFF.md:18`
- **Detalle:** ya registrada en `docs/agentic/debt.md:16`: reinicios y m├║ltiples r├⌐plicas no comparten cuota. Aceptable temporalmente en despliegues de instancia ├║nica, pero requiere almac├⌐n compartido antes de escalar horizontalmente en producci├│n.

---

## Aspectos positivos verificados

- Respuestas de error gen├⌐ricas y constantes: `401 { code: "AUTHENTICATION_REQUIRED" }` y `429 { code: "RATE_LIMITED" }` con cabecera `Retry-After`, sin filtrar detalles del proveedor, tokens ni IPs (`authentication.ts:161-165, 235-237`).
- `readRateLimitPolicy` falla cerrado con `ApiConfigurationError` y congela el objeto (`Object.freeze`), evitando `NaN`, flotantes o valores booleanos ambiguos (`config.ts:42-65`).
- `DEFAULT_RATE_LIMIT_POLICY.trustForwardedFor` arranca en `false` (`config.ts:24`), evitando confiar en `X-Forwarded-For` por omisi├│n.
- Se preservan los decoradores `@RateLimited` en mutaciones financieras y de turnos (`PaymentsController`, `OperationalShiftsController`) sin afectar lecturas (`report`, `listActive`).

---

## Resumen de verificaci├│n de esta revisi├│n

- Revisi├│n est├ítica de solo lectura sobre el diff y archivos completos del commit `3a1a47eb8eb3cab6c04086eb27db0a0ad217f8d5` (PR #50) contra `main` (`90bab930`).
- No se modific├│ c├│digo fuente, no se ejecutaron scripts/tests del PR, no se toc├│ la rama del PR ni se realiz├│ `push` ni publicaci├│n en GitHub.
