## Estado
done — endpoints de insumos y almacenes implementados y probados.
## Archivos tocados
- apps/api/src/inventory/{items.service.ts,items.controller.ts,items.module.ts,items.test.ts} — nuevos
- apps/api/package.json — registra .test-dist/inventory/items.test.js
## Verificación
- lint y typecheck api: exit 0; `git diff --check` limpio.
```
$ node .test-dist/inventory/items.test.js
ℹ pass 14
ℹ fail 0
```
## Riesgos / dudas
- SQL directo sobre app.inventory_*: 20261126000100 no da DML a app_api ni define RPCs; e ItemsModule necesita que m3-api-wire exponga DATABASE_CLIENT, MembershipAuthorizationService y MEMBERSHIP_DIRECTORY.
## Notas propuestas — ninguna