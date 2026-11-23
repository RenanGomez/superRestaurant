# Verificacion visual r5 - PR #59 (banner offline POS en /app/capture)

VEREDICTO: APROBAR CON HALLAZGOS (nivel C, 0 P1, 2 P2, 2 P3 a deuda)

- Rama: origin/ao/web-offline-pos-cash, head 3de2b69b. Fecha 2026-11-23. Verificador: Claude Sonnet 5.5.
- Metodo: Playwright-core + Chrome instalado, siguiendo `visual-verify-r4.md`. Web `next dev` en `http://localhost:8093` (Node 24), viewport 1280x800 y 390x844.
- Limitaciones: API Nest y Supabase Auth son stubs efimeros (GoTrue falso por HTTPS, API falsa por HTTP, fuera del repo). El stub no sirve catalogo, asi que la pagina muestra "No fue posible leer el catalogo": el banner se renderiza antes y no depende de eso. No se verifico el flujo real de captura offline (cobro/orden local) porque ninguna pantalla lo invoca (ver P2-1). El puerto `__srOfflinePosPort` se simulo desde la consola de la pagina; no existe puente real (`registerOfflinePosPort` no se llama en `src`).
- Offline emulado con `context.setOffline(true)`.

## Matriz (desktop 1280 / movil 390: resultados identicos)

| Escenario | Banner | Resultado |
|---|---|---|
| 01 online, sin puerto | no se renderiza | OK, area operativa limpia |
| 09 online tras desregistrar puerto | no se renderiza | OK |
| 02/03 offline, sin puerto | "Sin conexion" (warning). Texto: "Este dispositivo todavia no tiene menu ni mesas guardados; reconecta..." Sin lista de permitido | OK, honesto |
| 04/05 offline, puerto sin `commitLocalOperation` | "Trabajando sin conexion" (info). Lista: consultar menu/mesas, "Crear ordenes locales...", "Puedes cobrar en efectivo..." | P2-1 (promete lo que el puerto no puede hacer) |
| 06/07 offline, puerto con `commitLocalOperation` | igual que 04/05 (textos identicos) | Ver P2-1 |
| 08 online, puerto `sync_blocked` | "Sincronizacion pendiente" (error) | OK en tono; P3-1, P3-2 |

Comprobaciones transversales:
- Texto honesto: ningun escenario afirma "cobrado/pagado". La unica mencion es la promesa de poder cobrar en efectivo (P2-1). "Guardado en este dispositivo. Pendiente de sincronizar (solo este dispositivo)" aparece como estado general del modo, no como confirmacion de una operacion concreta.
- Summary "Operaciones que siguen bloqueadas sin conexion": presente y alcanzable (en viewport tras scrollIntoView, tabIndex >= 0, se abre y cierra con clic) en todos los escenarios; muestra las 7 operaciones prohibidas. **Altura 18.6 px (ancho 958/324 px): incumple el minimo de 44 px** (P2-2).
- Sin overflow horizontal: 1280/1280 y 390/390 en los 9 escenarios.
- Dialogos nativos: 0. Errores de consola: 0, pageerror: 0, requestfailed: 0, HTTP >=400 en navegador: 0. Solo 2 warnings de supabase `getSession()` por log de servidor reenviado (pre-existente, ya anotado en r4).
- Foco/teclado: el summary es nativo `<summary>` (activable con teclado); no se probo el anillo de foco visualmente.

## Hallazgos

P1: ninguno.

P2-1. Con un puerto registrado el banner anuncia "Crear ordenes locales y agregar lineas..." y "Puedes cobrar en efectivo sin conexion" aunque (a) el puerto no tenga `commitLocalOperation` (escenarios 04/05; `commitOfflineOperation` devolveria `unavailable`) y (b) ninguna pantalla llama a `commitOfflineOperation` (grep: solo `lib/offline-pos.ts` y su test), mientras el encabezado de la misma pagina dice "conexion requerida". Hoy no hay puente registrado, asi que en produccion se ve el texto honesto de 02/03, pero en cuanto exista un puerto el banner prometera capacidades que la captura no ofrece. Condicionar `allowed` a `typeof port.commitLocalOperation === "function"` y a que haya flujo offline cableado, o mantener la promesa fuera hasta el flujo.
P2-2. `<summary>` de 18.6 px de alto: target tactil menor a 44 px (AGENTS.md 14). Agregar `min-h-11` y `flex items-center`/padding vertical.

P3-1. Estado online + `sync_blocked`: el summary dice "Operaciones que siguen bloqueadas **sin conexion**" estando en linea; titulo "Sincronizacion pendiente" con tono de error. Ajustar el rotulo segun conectividad.
P3-2. El mensaje `sync_blocked` muestra una ruta literal "/app/sync" en lenguaje de operador; usar un enlace "Ver sincronizacion".

## Capturas (`docs/agentic/visual-verify-r5/`, `-desktop` y `-mobile`)

`01-online-sin-puerto`, `02-offline-sin-puerto-cerrado`, `03-offline-sin-puerto-abierto`, `04-offline-puerto-sin-commit-cerrado`, `05-offline-puerto-sin-commit-abierto`, `06-offline-puerto-con-commit-cerrado`, `07-offline-puerto-con-commit-abierto`, `08-online-puerto-sync-bloqueado`, `09-online-regreso-sin-puerto`, `diagnostics.json`. Nota: en las capturas fullPage la barra inferior movil (fija) aparece superpuesta a mitad de pantalla; es artefacto de captura.

## No verificado

Flujo real de cobro/orden offline; puente IndexedDB real; anillo de foco; reconexion automatica (online tras offline con puerto, solo se probo desregistrando el puerto); lectores de pantalla.
