**Estado: IN_PROGRESS.** Cambios parciales en `apps/web`: pantallas de carga, contexto compartido, enlaces internos y consultas paralelas donde se confirmó que son independientes. `TODO.md` y `HANDOFF.md` quedaron actualizados.

**Pendiente:** verificar moneda en zonas de entrega y completar las puertas y revisión visual. Caja conserva la secuencia reporte → checkout porque el checkout necesita la sesión de caja del reporte. NO VERIFICADO: mediciones en navegador; no existe la sesión Playwright guardada.

```text
node --version
v24.19.0
corepack pnpm turbo run lint typecheck test build --filter=@super-restaurant/web
[WARN] GET https://registry.npmjs.org/typescript-eslint/-/typescript-eslint-8.67.0.tgz error (ECONNREFUSED). Will retry in 10 seconds. 2 retries left.
git diff --check: OK
git add TODO.md HANDOFF.md apps/web/src/app/app apps/web/src/proxy.ts
fatal: Unable to create 'C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant/.git/worktrees/web-nav-perf-r1/index.lock': Permission denied
```

Las puertas no terminaron por falta de dependencias y acceso al registro; tampoco se pudo crear el commit local por el permiso sobre el índice Git. CodeGraph no estaba disponible.