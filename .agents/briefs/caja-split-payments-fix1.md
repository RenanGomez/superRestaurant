# caja-split-payments-fix1 — correcciones de la revisión nivel A (escribe código)
Agente: Gemini   Nivel de rigor: A   Complejidad: Estándar

## Objetivo
Corregir en la rama `gemini/caja-split-payments` (worktree `C:\tmp\sr-wt\caja-split-payments`; no edites el checkout principal) los hallazgos de la revisión. La migración `20261102000300` y sus invariantes ya pasaron contra PostgreSQL con rollback: **no la toques**.

## Hallazgos
1. **P2 `apps/web/src/app/app/caja/payment-panel.tsx:51-55, 276-279` y `actions.ts:92`**: el faltante de efectivo lo calcula el cliente (`insufficientCashTenderDifference`) y el `requiredMinor` que ya devuelve `quotePaymentAction` nunca se lee; `invalid_amount` cae en un mensaje genérico (~427). Debe quedar: el panel guarda `requiredMinor` del servidor en estado y muestra «Faltan $X» con `formatMinorUnits(requiredMinor - receivedMinor)` sólo como presentación; la habilitación de «Cobrar» depende del estado devuelto por el servidor (`invalid_amount` ⇒ deshabilitado), no de una resta local.
2. **P2 `caja-helpers.ts:~80`**: `formatInsufficientTenderWarning` usa `/ 100` y `toFixed(2)` (float) y no se usa. Elimínala (y su test) o reescríbela con `formatMinorUnits`.
3. **P3 `payment-panel.tsx:5,108`**: `isRedirectError` se importa de `next/dist/client/components/redirect-error` (ruta interna). Quítalo si ya no hace falta (los `redirect()` ocurren en el servidor fuera del `try/catch`); si lo conservas, usa la exportación pública (`next/navigation` → `isRedirectError` existe en Next 15/16) y documenta por qué.
4. **P3 `page.tsx:~232`**: `OrderSummary` recalcula `remainingMinor` con `Math.max(0, total - suma)` cuando no hay `checkout`. Sustitúyelo por el valor del servidor si existe o «Saldo no disponible».
5. **P3 `payment-panel.tsx:34-37, 81-84`**: comenta la dependencia del `key={orderId:orderVersion}` de `page.tsx` para la resincronización del importe en «Pagar total».

## Verificación (en el worktree)
- `& "<node24>\node.exe" "<node24>\node_modules\corepack\dist\pnpm.js" turbo run lint typecheck test build --filter=@super-restaurant/web --force`; `git diff --check`.
- Commit en la misma rama: `fix(web-caja): server-provided tender shortfall, drop float helper, public redirect check`.

## Formato de salida: reporte §8 en .agents/reports/caja-split-payments-fix1.md
Por hallazgo: qué cambió; salida de puertas; hash. Máximo 40 líneas.
