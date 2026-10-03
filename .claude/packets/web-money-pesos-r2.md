# web-money-pesos-r2 (addendum; hallazgos `codex exec review` ronda 1, log `.claude/runs/web-money-pesos/review-r1.log`)

## Tarea
web-money-pesos-r2 · capa: L2 (Codex, `-Resume`) · riesgo: moderado · nivel C + B (`apps/web/src/lib/capture-payment.ts`, `apps/web/src/app/app/caja/actions.ts`, formato en menú/caja). Base: tu commit `aece85a` en `C:\tmp\sr-wt\web-money-pesos`.

## Hallazgos a cerrar
- [P1] `caja/actions.ts:38`: la moneda del registro se fuerza desde el catálogo actual; si cambiara, órdenes abiertas con otra moneda quedarían incobrables. **Decisión del orquestador (producto)**: el restaurante opera en una sola moneda y el operador no la elige nunca. La moneda de la caja se resuelve en el servidor-web así: (1) si hay órdenes cobrables en la bandeja (`/branch-orders/tray`, estados `open|partially_paid`), usar la moneda de esas órdenes y, si hubiera más de una distinta, bloquear la apertura con el mensaje «Hay cuentas abiertas en más de una moneda; avisa al administrador» (no ocultar el problema); (2) si no hay cuentas abiertas, usar la moneda del catálogo publicado; (3) si tampoco hay catálogo, `MXN`. Documentar la regla en un comentario de tres líneas junto a la función que la resuelve y en una prueba del helper puro `resolveRegisterCurrency(orderCurrencies, catalogCurrency)`.
- [P1] `capture-payment.ts:33-36`: parser y formato asumen dos decimales. Hacer que `parseMoneyInputToMinor(text, currency)` y cualquier formato editable usen la escala de la moneda (misma tabla de dígitos que `formatMinorUnits` en `branch-order-work-tray.ts`; extraer a un helper compartido si está duplicada) y **rechacen** monedas fuera de la tabla con `null`/error visible en vez de tratarlas como pesos. Todos los llamadores pasan la moneda que ya conocen (catálogo, `CheckoutOrderSummaryV1`, `CashRegisterSummaryV1`). Pruebas: MXN 2 dígitos, una moneda de 0 dígitos de la tabla, moneda desconocida → `null`.

## Criterios
- [ ] Ambos hallazgos cerrados con pruebas node:test; sin cambios de contrato ni API.
- [ ] Puertas: `pnpm --filter @super-restaurant/web lint && typecheck && test && build`.
- [ ] Informe breve con archivos tocados y salida literal. No hagas commit.
