# caja-split-payments-fix2 · hallazgos de la segunda revisión (Codex) sobre `claude/caja-split-payments-fix1`

Nivel A · Codex (`tools/agentic/codex-task.ps1 -Task caja-split-payments-fix2 -Packet .claude/packets/caja-split-payments-fix2.md -Base claude/caja-split-payments-fix1 -Effort medium`). Trabaja en el worktree que crea el lanzador. No toques la migración `20261102000300` (ya verificada en remoto) salvo el archivo de invariantes del punto 3. El orquestador hará el commit si el sandbox no puede.

## Hallazgos
1. **P1 `apps/web/src/app/app/caja/payment-panel.tsx:55-58`**: el faltante se calcula en cliente (`serverRequiredMinor - receivedMinor`). Debe quedar: `quotePaymentAction` (`caja/actions.ts`) devuelve también `missingMinor` calculado en el servidor (a partir de `requiredMinor` y `tenderedAmountMinor` que ya recibe) junto con `status: "invalid_amount"`; la UI sólo lo formatea con `formatMinorUnits` y deshabilita «Cobrar». Tests en `caja-helpers.test.ts`/acción para recibido menor, igual y mayor (igual y mayor → sin `missingMinor`).
2. **P2 `payment-panel.tsx:117-127`**: el `catch` atrapa cualquier excepción, incluidas redirecciones que `collectPaymentAction` aún puede lanzar desde `getAuthorizedContext()` (`actions.ts:250-258`). Debe quedar: `catch (error) { unstable_rethrow(error); … }` (de `next/navigation`, ya usado en el repo) antes de la recuperación por `paymentId`.
3. **P2 `supabase/tests/order_payments_captured_by_invariants.sql:13-15,105-110`**: `other_branch` pertenece a `other_restaurant`, así que la prueba de aislamiento cubre otro restaurante pero no otra sucursal del mismo. Añade una sucursal hermana bajo `restaurant` y comprueba la fuga en ambos sentidos. El archivo sigue `begin;` … `rollback;` sin `commit`.
4. **P3 `payable-orders.tsx:47-63`**: `toggleExpand` no captura rechazos de `orderDetailAction`; captura el error y guarda un estado de fallo por orden («No se pudo cargar el detalle», reintento al volver a tocar).

## Verificación
- `pnpm turbo run lint typecheck test --filter=@super-restaurant/web --filter=@super-restaurant/api` (el build puede fallar en el sandbox por `spawn EPERM`; dilo si pasa); `git diff --check`.
- Commit `fix(web-caja): server-side shortfall, rethrow redirects, sibling-branch isolation test`.

## Salida
Por hallazgo qué cambió, salida literal, hash o motivo de no commitear.
