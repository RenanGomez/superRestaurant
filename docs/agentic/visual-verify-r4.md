# Verificacion visual r4 - PR #54 (barra de estado de sync y /app/sync)

VEREDICTO: APROBAR (nivel C, con 1 P2 y 2 P3 a deuda)

- Rama: origin/ao/web-sync-status-ui, head 61e699f2.
- Fecha: 2026-11-23. Verificador: Claude Sonnet 5.5.
- Metodo: Playwright-core + Chrome instalado, siguiendo `visual-verify-r3.md`.

## Entorno y limitaciones (leer primero)

- No hay PostgreSQL ni docker en esta maquina. **La API Nest y Supabase Auth fueron reemplazados por stubs efimeros** (GoTrue falso por HTTPS en 54329, API falsa por HTTP en 3013). Los stubs viven fuera del repo.
- El stub responde 404 a `/api/v1/sync/*`, igual que main sin API de sync. Se verifica por tanto el **manejo del 404 en la web**, no la API real.
- Web: `next dev` (Turbopack) en `http://localhost:8093`, Node 24, Chrome instalado.
- Sesion: usuario de prueba solo del stub (`operador@vittorinos.local`), rol owner/manager, sucursal "Navojoa Centro".
- Con origen 127.0.0.1 el dev server de Next dio 403 en un chunk y fallo el WebSocket HMR. Es comportamiento de allowed-origins de dev; con `localhost` desaparece. No es del PR.

## Matriz

| Comprobacion | Desktop 1366x800 | Movil 390x844 |
|---|---|---|
| Barra visible en el layout (En linea / sucursal / Sin pendientes / Ultima confirmacion: sin confirmar / Ver sincronizacion) | OK | OK |
| Barra tambien en otra ruta (`/app/tables`) | OK | OK |
| `/app/sync` renderiza | OK | OK |
| 404 de sync: texto honesto ("Aun sin sincronizacion confirmada", "El servicio de sincronizacion aun no esta habilitado", "Pendiente de verificar") | OK | OK |
| Nunca "Sincronizacion confirmada" ni hora junto a "confirmacion" | OK | OK |
| Estado sin conexion (offline emulado) | "Sin conexion", sin confirmacion fabricada | igual |
| Errores de consola / pageerror | 0 | 0 |
| Solo warning de consola | 3x aviso de supabase `getSession()` (log del servidor reenviado en dev) | igual |
| Red 4xx/5xx en el navegador | 0 | 0 |
| API (log del stub) | 404 esperado en `/api/v1/sync/manual-review` | igual |
| alert/confirm/prompt | 0 | 0 |
| Desbordamiento horizontal | 1366/1366 | 390/390 |
| Targets menores de 44 px en `/app/sync` | 0 | 0 |
| Enlaces de la barra | Conexion 208x44, Ver sincronizacion 128x44 | Ver sincronizacion 128x44 |

## Hallazgos

P1: ninguno.

P2
- Estado sin conexion contradictorio. Offline, el titular dice "Sin conexion. Este cambio se guardo en este dispositivo; no esta disponible en otros equipos todavia." y a la vez el aviso dice "este navegador aun no tiene cola local persistente activada". Sin cola local no hay cambio guardado en el dispositivo, asi que el titular promete algo no probado. Conviene un texto que no afirme guardado mientras la cola persistente no exista (ver `sync-offline-mobile.png`).

P3
- En movil la entrada "Conexion" no esta en la barra inferior (queda en "Mas"); el acceso directo es el enlace "Ver sincronizacion" de la barra. Aceptable, solo anotarlo.
- Aviso de supabase "Using the user object as returned from getSession()..." en consola en dev. Pre-existente (no del PR); usar `getUser()` donde se lea el usuario en servidor.

## Capturas (`docs/agentic/visual-verify-r4/`)

- `app-home-desktop.png`, `app-home-mobile.png`
- `sync-desktop.png`, `sync-mobile.png`
- `sync-offline-desktop.png`, `sync-offline-mobile.png`
- `other-route-desktop.png`, `other-route-mobile.png`
- `diagnostics.json` (consola, red, medidas)
