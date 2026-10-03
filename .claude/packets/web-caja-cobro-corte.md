# web-caja-cobro-corte · cobrar con cambio y corte legible

## Tarea
web-caja-cobro-corte · capa: L2 (Codex) · riesgo: moderado · nivel C (`apps/web/src/app/app/caja/*`). Ritmo: **operación** para cobrar (dos o tres toques), **cierre** para el corte (formulario claro). Fila D4+D5 del «Día operable». Una sola ronda de revisión (§19.3). Base: `main` con `cash-collect-change-api` integrado (verificar que `POST /payments/quote`, `tenderedAmountMinor`, `tipMinor`, `changeMinor` y `movements` existen en `packages/shared-types/src/payments.ts`; si no, detente e informa).

## Objetivo
Que el cajero cobre una cuenta en efectivo escribiendo lo que el cliente entregó (o tocando «Exacto», «$100», «$200», «$500») y vea el cambio al instante, registre propina aparte, cobre con tarjeta externa o transferencia con su referencia, y que el corte muestre fondo, ventas por método, propinas, esperado, contado, diferencia y la lista de movimientos en lenguaje de operador.

## Criterios de aceptación (verificables)
- [ ] **Cobrar** (`/app/caja`, panel «Cargar cuenta» → fila «Cobrar»): la cuenta muestra total, pagado y saldo en pesos. Método como tres botones grandes (Efectivo, Tarjeta externa, Transferencia). Con Efectivo: campo «Recibido» en pesos con botones «Exacto», «$100», «$200», «$500» y teclado; al cambiar, `POST /payments/quote` devuelve el cambio y la UI muestra «Cambio: $X.XX» (o «Falta $X.XX» si el recibido es menor; el botón «Cobrar» se deshabilita). Con Tarjeta externa: referencia (≥ 6 caracteres) y terminal; con Transferencia: referencia. Campo «Propina» opcional en pesos. «Cobrar» (≥44 px) llama `POST /payments/collect` con `tenderedAmountMinor` y `tipMinor` y muestra el resultado: «Cobrado $X.XX · Cambio $Y.YY · Propina $Z.ZZ · Saldo $0.00», con botón «Cobrar otra cuenta». Toques del flujo principal: elegir cuenta → Efectivo → monto rápido → Cobrar (4; justificar si no se puede bajar).
- [ ] **Corte X** (resumen operativo): fondo inicial, ventas en efectivo, tarjeta externa, transferencias, propinas, número de cobros, efectivo esperado; todo en pesos con `formatMinorUnits`; sin «u.m.» ni «ISO». Debajo, lista de movimientos (hora, tipo en español: «Venta en efectivo», «Propina», «Entrada», «Salida», «Ajuste», «Reembolso»; monto con signo; referencia corta de la cuenta si existe) con «Actualizar».
- [ ] **Cerrar caja** (Corte Z): «Efectivo esperado» grande, campo «Efectivo contado» en pesos, diferencia calculada por el servidor tras cerrar (mostrar la del reporte; mientras no se cierra, mostrar la resta como «Diferencia estimada» sólo si el API la devuelve en el quote; si no, no mostrar cifra), motivo obligatorio sólo si hay diferencia (el servidor lo exige), confirmación in-app con el texto «Este cierre es definitivo» y resultado visible.
- [ ] Toda acción muestra «Guardando…» y resultado; errores del API con texto claro (`invalid_amount`, `mixed_currency`, `unsupported_currency`, insuficiente).
- [ ] Helpers puros con prueba: etiquetas de tipo de movimiento, montos rápidos (≥ saldo), estado del botón «Cobrar».
- [ ] Sin `alert/confirm/prompt`; 390×844 sin scroll horizontal; consola limpia.

## Invariantes
El servidor calcula cambio, saldo, esperado y diferencia; la web sólo convierte texto a centavos y formatea; contratos intactos; no tocar `capture/*`, `menu/*`, `tables/*`.

## Fuera de alcance
Reembolsos, división de cuenta, impresión del corte, API.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```

## Formato de salida esperado
Resumen (toques por flujo), archivos tocados, salida literal, riesgos. No hagas commit.
