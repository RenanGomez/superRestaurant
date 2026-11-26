# Brief m3-e2e-journey-fix (nivel B · corregir el journey 13 tras la revisión)

Rama: `harness/m3-e2e-journey` (PR #123), ya rebasada sobre `main` con `isDefault` disponible en los
almacenes. Eres el único escritor de los archivos de la sección «Archivos».

## P1/P2 obligatorios de la revisión

1. **P1 — el timeout no puede quedar en verde.** `waitForMovement` hoy hace
   `.catch(() => undefined)` y el caller llama `test.skip`; una regresión de `sale_consumption` o
   `sale_reversal` pasaría el journey. Cambia a espera con `expect.poll` **que falle** (mensaje
   explícito con el `runId` y el saldo observado) y elimina los `test.skip` que enmascaran fallos de
   inventario. Los únicos skips permitidos son precondiciones del entorno **antes** de escribir:
   catálogo inexistente o sin producto vendible, y cuenta sin permiso de inventario.
2. **P1 — la receta no puede quedarse publicada sobre el producto real.** Hoy publica una versión
   activa del primer producto vendible y no restaura la anterior. Registra en `cleanup` **antes** de
   escribir: guarda la versión activa previa (id y líneas) del producto y, al terminar, vuelve a
   publicar esa misma composición (o, si no había, deja el producto en su estado previo con lo que
   exponga la API) y desactiva el insumo del run. Documenta en el informe qué queda restaurado y qué
   no se puede restaurar con la API actual.
3. **P2 — almacén predeterminado real.** Con `isDefault` ya expuesto: si la sucursal no tiene
   almacén predeterminado activo, crea uno estable `Almacén principal` con `isDefault: true` (sin
   `runId`: es fixture de la sucursal y se queda; anótalo) y usa **ese** almacén en todas las
   aserciones de saldo; si ya existe, reutilízalo y no lo modifiques. Comprueba en la API que el
   consumo escribió exactamente en el almacén predeterminado (saldo del default antes/después).
4. **P2 — rama muerta del confirm.** `/captures/confirm` no devuelve `inventory`; no dependas de ese
   campo. Comprueba el resultado por `GET /inventory/movements` y `GET /inventory/balances` como ya
   hacías, y borra el `if (inventoryStatus === "skipped")` y los 20 s de espera asociados.
5. **P2 — sin skips por 400/409 genéricos.** Un `400/409` del plan/confirmación debe fallar con el
   cuerpo del error, no convertirse en skip de catálogo.
6. **P3 — aserciones tautológicas y limpieza del proveedor** si la respuesta se pierde: registra el
   proveedor en `cleanup` en cuanto lo crees; evita `expect(x).toBe(x)`.

## Archivos (exactos)

- `apps/web/e2e/journeys/journey-13-inventario.spec.ts`
- `apps/web/e2e/fixtures/journey-api.ts` (solo lo necesario; métodos aditivos)
- `apps/web/e2e/fixtures/journey-test.ts` (solo si hace falta un helper compartido)

Prohibido tocar: `apps/api/**`, `supabase/**`, `packages/**`, `apps/web/src/**`, la spec visual,
los journeys 1-12.

## Reglas de la sesión

- No hagas `git commit`, `git push`, ni crees ramas o PRs.
- **No ejecutes Playwright ni PostgreSQL**; el orquestador ejecuta el journey contra el stack local.
- Puedes ejecutar `pnpm --filter @super-restaurant/web e2e:typecheck`, ESLint sobre los dos archivos
  y `playwright test --list --project desktop`.

## Hecho cuando

`e2e:typecheck` en 0, el journey lista, y `.agents/reports/m3-e2e-journey-fix.md` dice exactamente
qué se siembra, qué se restaura, qué fixture queda y por qué ningún fallo de inventario puede
terminar en skip. Aplica AGENTS §15.
