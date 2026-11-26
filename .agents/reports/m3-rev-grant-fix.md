VEREDICTO: APROBAR

- P1: ninguno.
- P2: ninguno.
- P3 (no bloqueantes): `err_message` se asigna y no se usa (`supabase/tests/inventory_movements_api_invariants.sql:103`); el 400 por `compensatesMovementId` solo se cubre en unitaria de servicio, no en el contrato HTTP (`apps/api/src/inventory/movements.test.ts:214`); la ausencia del campo ya se rechazaba antes por `exactRecord` (15 claves), no es regresión de este commit.

Comprobaciones:
1. Guard en `apps/api/src/inventory/movements.service.ts:266` corre en `parseMovementRequest`, antes de `authorize` y de cualquier `database.query`; `requestError()` → `code:"request"` → `BadRequestException` 400 (`movements.controller.ts:73`), no 500/503.
2. `compensatesMovementId:null` explícito sigue pasando (`hasValidCompensation`); transferencias no usan compensación y sus tests siguen enviando `null`. Único llamador de `recordMovement` es el controlador.
3. Quitar el guard haría que `adjustment` con uuid pase `hasValidCompensation` y ejecute SQL: la unitaria falla por `assert.rejects` y por `database.queries.length === 0`.
4. La prueba SQL corre ya bajo `set local role app_api` (línea 95); firma de 14 args coincide con `app_private.inventory_record_movement`; el `raise` deliberado es P0001 y se re-lanza por `state <> '42501'`, así que no se traga errores ajenos.

```
$ git grep -n "compensatesMovementId !== null" 4bd759ab -- apps/api/src/inventory/movements.service.ts
4bd759ab:apps/api/src/inventory/movements.service.ts:266:  if (parsed.compensatesMovementId !== null) return undefined;

$ git show 4bd759ab:apps/api/src/inventory/movements.controller.ts | Select-Object -Skip 54 -First 12
    } catch (error: unknown) {
      if (error instanceof InventoryMovementApplicationError) {
        if (error.code === "request") throw new BadRequestException({ code: "INVENTORY_REQUEST_INVALID" });
        if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
...
      throw new ServiceUnavailableException({ code: "INVENTORY_UNAVAILABLE" });

$ git show 4bd759ab:supabase/tests/inventory_movements_api_invariants.sql | Select-Object -Skip 92 -First 15
  execute 'set local role app_api';
  begin
    perform app_private.inventory_record_movement(
      manager, r, b, warehouse_a, item, 'adjustment', 1, 'direct ledger call',
      'movements-api-direct-ledger', null, null, null, pg_catalog.clock_timestamp(), null);
    raise exception 'app_api called the raw ledger writer';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' then raise; end if;
  end;
```