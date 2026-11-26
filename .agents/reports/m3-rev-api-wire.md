VEREDICTO: APROBAR

Hallazgos:
- P1/P2: ninguno.
- P3 `apps/api/src/inventory/items.module.ts:6-10` — `ItemsModule` quedó huérfano (no se importa en ningún lado); conviven dos vías de registro (AppModule directo y el módulo). Inofensivo, pero conviene borrarlo o importarlo.
- P3 `apps/api/src/app.smoke.test.ts:130-136` — solo cubre 401 no autenticado; no hay caso autenticado 200 para inventario (cubierto en `inventory/items.test.ts`, así que es brecha menor).

1) Coherente: `AppModule` registra todo controller/provider directo y su `@Module` no tiene `imports:` (`app.module.ts:143-323`); `ItemsService` resuelve sus 3 deps ya provistas ahí (`MembershipAuthorizationService:200`, `MEMBERSHIP_DIRECTORY:196-199`, `DATABASE_CLIENT:180-183`). No duplica porque `items.module.ts` no se importa.
2) Rutas coinciden: `@Controller("inventory")`+`@Get("items")`/`@Get("warehouses")` (`items.controller.ts:29,35,64`) con prefijo `api/v1` (`app.smoke.test.ts:116`) = las URLs probadas (130,134). El 401 es del guard global `APP_GUARD: SupabaseAuthGuard` (`app.module.ts:318-321`); sin `@Public` y sin `Authorization` lanza `AUTHENTICATION_REQUIRED` (`authentication.ts:140-145,257`). Ruta inexistente daría 404, no 401.
3) Estable y sin BD: usa `DatabaseClientPort` falso (`app.smoke.test.ts:27-106`), overridea `DATABASE_CLIENT` y `AUTH_PRINCIPAL_VERIFIER` (109-112), escucha en puerto efímero 0 (117) y cierra en `finally` (398-400); las llamadas no autenticadas cortan en el guard antes de tocar BD. NO VERIFICADO: no ejecuté la suite (generaría `.test-dist`).

Evidencia:
```
PS> git diff -- apps/api/src/app.module.ts apps/api/src/app.smoke.test.ts
(no output)

PS> git show ee1846b5 --stat
 apps/api/src/app.module.ts     | 4 ++++
 apps/api/src/app.smoke.test.ts | 8 ++++++++
 2 files changed, 12 insertions(+)

+    const inventoryItemsUnauthenticated = await fetch(`${url}/api/v1/inventory/items?restaurantId=${restaurantId}`);
+    assert.equal(inventoryItemsUnauthenticated.status, 401);
+    const inventoryWarehousesUnauthenticated = await fetch(`${url}/api/v1/inventory/warehouses?restaurantId=${restaurantId}&branchId=${branchId}`);
+    assert.equal(inventoryWarehousesUnauthenticated.status, 401);
```