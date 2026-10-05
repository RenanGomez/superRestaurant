# web-caja-cobro-corte-r3 (ronda de revisión; log `.claude/runs/web-caja-cobro-corte/review-r1.log`)

## Tarea
web-caja-cobro-corte-r3 · capa: L2 (Codex, `-Resume`) · nivel C. Worktree `C:\tmp\sr-wt\web-caja-cobro-corte`.

## Hallazgo
- [P2] `apps/web/src/app/app/caja/payment-panel.tsx:82`: el panel siempre cobra `remainingBalanceMinor`, así que un pago parcial o dividido (parte efectivo, parte tarjeta) ya no se puede registrar. Corrige sin romper el flujo rápido: el importe «A cobrar» se precarga con el saldo y es editable en pesos (botón «Cobrar parcial» o un campo con icono de lápiz que al tocarlo permite cambiar el importe; mínimo 1 centavo, máximo el saldo); el quote y el collect usan ese importe; con efectivo, «Recibido» se compara contra `importe + propina`; tras un cobro parcial el panel muestra «Saldo restante $X» y permite el siguiente cobro con otro método. Helper puro `paymentAmountBounds(remaining, typed)` con prueba.

## Criterios
- [ ] Flujo completo sin cambios en toques (saldo precargado); parcial con un toque extra.
- [ ] Puertas `pnpm --filter @super-restaurant/web lint && typecheck && test && build`. Informe de dos líneas. No hagas commit.
