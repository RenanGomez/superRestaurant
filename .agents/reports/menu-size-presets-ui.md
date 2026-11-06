**Estado: IN_PROGRESS.** Se implementaron el CRUD de presets, el selector por variante y su persistencia en el borrador y la publicación. Se añadieron pruebas para el helper y el borrador, pendientes de ejecución.

**Verificación:** NO VERIFICADO: lint, typecheck, tests, build y navegador; la instalación de dependencias encontró conexiones rechazadas.

```text
pnpm turbo run lint typecheck test build --filter=@super-restaurant/web
[WARN] GET https://registry.npmjs.org/react/-/react-19.2.8.tgz error (ECONNREFUSED). Will retry in 10 seconds. 2 retries left.
```

**Commit:** NO REALIZADO: permiso denegado al crear `index.lock`. El estado y los pasos pendientes quedaron en [HANDOFF.md](C:/tmp/sr-wt/menu-size-presets-ui/HANDOFF.md).