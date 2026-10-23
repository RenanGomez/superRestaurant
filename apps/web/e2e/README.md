# E2E del web (Playwright + buttonmash)

Corre contra servidores locales ya levantados: web `http://localhost:8082` y API `http://localhost:3000`
(`tools/agentic/local-servers/start-local.bat`). Usa el Chrome instalado; no descarga navegadores.

## Sesión
`pnpm e2e:auth` abre Chrome en `/login`; inicia sesión a mano. Al llegar a `/app` guarda la sesión en
`playwright/.auth/user.json` (ignorado por git). Ningún script escribe credenciales. Sin ese archivo los
tests autenticados fallan con «Sin sesión: ejecuta pnpm e2e:auth».

## Scripts
- `pnpm e2e`: proyecto escritorio (1366x800): smoke por ruta, crawl exhaustivo del DOM y pruebas `@public`.
- `pnpm e2e:mobile`: lo mismo con perfil Pixel 7.
- `pnpm e2e:offline`: corta la red y documenta qué pasa (el web aún no tiene soporte offline; Fase 3).
- `pnpm e2e:all`, `pnpm e2e:typecheck`, `pnpm e2e:report` (abre el reporte HTML).
- `pnpm e2e:mash:dry` / `pnpm e2e:mash`: buttonmash (monkey tester), configurado en `buttonmash.config.ts`.
  Requiere una vez `pnpm exec playwright install chromium` (~170 MB, decisión del humano).
- `E2E_MAX_ELEMENTS` (default 150) limita los elementos por ruta en el crawl; `E2E_BASE_URL` cambia el destino.

## Reportes
- `playwright-report/`: HTML con trazas y capturas de los fallos.
- `e2e-report/dom-coverage-<proyecto>.json`: por ruta, cada elemento con resultado
  `clicked | filled | skipped | error`, motivo y errores JS posteriores.
- `e2e-report/offline-offline.json`: comportamiento por ruta al cortar la red (informativo).
- `buttonmash-report/`: hallazgos del monkey tester.

El crawl salta controles destructivos (cobrar, guardar, cancelar, enviar a cocina, etc.), enlaces externos,
logout e inputs de archivo. Úsalo sólo con datos de prueba.
