# E2E del web (Playwright + buttonmash)

Corre contra servidores locales ya levantados: web `http://localhost:8082` y API `http://localhost:3000`
(`tools/agentic/local-servers/start-local.bat`). Usa el Chrome instalado; no descarga navegadores.

## Sesión
`pnpm e2e:auth` abre Chrome en `/login`; inicia sesión a mano. Al llegar a `/app` guarda la sesión en
`playwright/.auth/user.json` (ignorado por git). El login debe terminar con la sucursal confirmada («Elige tu sucursal» → «Confirmar sucursal»); si la cuenta no tiene
membresías el script sale con error. Ningún script escribe credenciales. Sin ese archivo los
tests autenticados fallan con «Sin sesión: ejecuta pnpm e2e:auth».

## Journeys 1-6 (`e2e/journeys/`)
Una spec determinista por journey del plan maestro §4.2:

1. `journey-1-open-shift-cash-register.spec.ts`: abre la caja desde Caja, verifica el aviso de apertura y el corte X.
2. `journey-2-start-or-recover-order.spec.ts`: inicia una captura telefónica a domicilio y la recupera desde la bandeja tras recargar.
3. `journey-3-customer-address.spec.ts`: busca y elige cliente, confirma teléfono y dirección, y verifica la respuesta de cobertura.
4. `journey-4-configure-product.spec.ts`: configura tamaño, mitad y mitad, ingredientes, orilla y nota antes de agregar la línea.
5. `journey-5-hold-and-cancel.spec.ts`: guarda en espera, retoma desde la bandeja y cancela con motivo.
6. `journey-6-confirm-pay-send.spec.ts`: confirma el precio, envía las líneas a estación y cobra el saldo exacto en caja.

Corren sólo en el proyecto `desktop` y requieren la sesión guardada (`pnpm e2e:auth`); sin ella se saltan con el mensaje habitual. Usan la API local (`E2E_API_URL`, por defecto `http://127.0.0.1:3000/api/v1`) para sembrar datos con un `runId` por corrida (`E2E_RUN_ID` lo fija) y hacen cleanup obligatorio: cierran cajas, cancelan borradores y órdenes sin cobrar, y desactivan lo que sembraron cuando aplica. Los clientes sembrados quedan en el directorio (la API no expone borrado) pero llevan el `runId` en nombre, teléfono y dirección para identificarlos. `E2E_AUTH_FILE` permite usar otro storageState.

## Scripts
- `pnpm e2e`: proyecto escritorio (1366x800): smoke por ruta, crawl exhaustivo del DOM y pruebas `@public`.
- `pnpm e2e:mobile`: lo mismo con perfil Pixel 7.
- `pnpm e2e:offline`: corta la red y documenta qué pasa (el web aún no tiene soporte offline; Fase 3).
- `pnpm e2e:all`, `pnpm e2e:typecheck`, `pnpm e2e:report` (abre el reporte HTML).
- `pnpm e2e:mash:dry` / `pnpm e2e:mash`: buttonmash (monkey tester), configurado en `buttonmash.config.ts`.
  Requiere una vez `pnpm exec playwright install chromium` (~170 MB, decisión del humano).
- `E2E_MAX_ELEMENTS` (default 150) limita los elementos por ruta en el crawl; `E2E_BASE_URL` cambia el destino.
- `E2E_BRANCH`: texto de la etiqueta de la sucursal que los tests eligen si aparece «Elige tu sucursal» (por defecto la primera).

La guarda es de estado, no de cantidad: el test falla si el nav no muestra «Sucursal activa» (salvo `/app`), si `main` muestra «Elige tu sucursal» o «Sin sucursales asignadas», o si `main` tiene menos de 20 caracteres. `encontrados` y `mainTextLength` son datos informativos (resumen `[dom]` y JSON de cobertura).

Si una ruta sólo muestra «No tienes autorización…» para la cuenta guardada, el test se salta con la anotación `sin-autorizacion` (no cuenta como cobertura).

## Reportes
- `playwright-report/`: HTML con trazas y capturas de los fallos.
- `e2e-report/dom-coverage-<proyecto>.json`: por ruta, cada elemento con resultado
  `clicked | filled | skipped | error`, motivo y errores JS posteriores.
- `e2e-report/offline-offline.json`: comportamiento por ruta al cortar la red (informativo).
- `buttonmash-report/`: hallazgos del monkey tester.

El crawl salta controles destructivos (cobrar, guardar, cancelar, enviar a cocina, etc.), enlaces externos,
logout e inputs de archivo. Úsalo sólo con datos de prueba.

El crawl excluye los enlaces de la navegación principal y «Cerrar sesión» salvo en `/app` (donde se pulsan una vez), y «Cambiar sucursal» fuera de `/app` (descarta el alcance). Tras cada regreso con `goto` espera `main` + `networkidle` y reafirma la sucursal; si un índice ya no existe lo marca «ya no existe». Cierra los diálogos abiertos con «Cerrar»/«Cancelar» (`closedDialog: true`). El resumen `[dom]` incluye `skippedByReason` y se guarda en `e2e-report/dom-skipped-by-reason-<proyecto>.json`.
