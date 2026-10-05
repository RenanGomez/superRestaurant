# web-caja-cobro-corte-r4 (log `.claude/runs/web-caja-cobro-corte/review-r2.log`)

## Tarea
web-caja-cobro-corte-r4 · capa: L2 (Codex, `-Resume`) · nivel C. Worktree `C:\tmp\sr-wt\web-caja-cobro-corte`.

## Hallazgo
- [P1] `caja/actions.ts:169-170`: tras un cobro exitoso, `revalidatePath("/app/caja")` remonta la página y el recibo desaparece; con pago completo la pantalla dice «No se registró ningún pago». Corrige con un estado de éxito durable: la server action redirige a `/app/caja?receipt=<paymentId>&orderId=<id>` (o guarda el resumen en una cookie de un solo uso leída por el servidor); la página renderiza el recibo desde el servidor (`GET /payments/checkout` + el resumen devuelto: cobrado, cambio, propina, saldo, método) con «Cobrar otra cuenta» y, si queda saldo, «Seguir cobrando esta cuenta». El recibo sobrevive a recargas; nada se calcula en cliente. Prueba del helper puro que construye/parsea el parámetro.

## Criterios
- [ ] Puertas `pnpm --filter @super-restaurant/web lint && typecheck && test && build`. Informe de dos líneas. No hagas commit.
