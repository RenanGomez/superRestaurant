# caja-split-payments-research — investigación de sólo lectura para rediseñar el cobro en caja (pagos divididos)
Agente: Gemini   Nivel de rigor: A (dinero; la implementación)   Complejidad: Compleja

## Objetivo
Preparar el paquete de implementación de nivel A para `/app/caja`. Retroalimentación de Emmanuel (2026-11-02):
1. En «Cuenta» sólo se ve el ID de la orden; debe verse de quién es: mesa (nombre real), nombre de la cuenta (`accountLabel`, ya en `OrderDetailV1`), canal, hora, líneas.
2. Bug: cuenta de 130; escribe 70 en «A cobrar», 60 en «Recibido» (menor al cobro), pulsa «Cobrar», aparece un mensaje genérico de error; al volver, la cuenta sigue diciendo 130, «A cobrar» sólo permite 60, y en ningún lado dice que ya se pagaron 70. Determinar: ¿el pago de 70 se capturó pese al error? ¿falta en cliente la validación «recibido ≥ cobro» y el servidor devuelve un error sin detalle? ¿dónde se muestra (o no) el historial de pagos de la orden?
3. Rediseño: antes de elegir método, elegir «Pagar total» o «Dividir pago». Al dividir, se cobra uno por uno y la cuenta muestra: Total 130, Pago 1 −70, Pendiente 60; «A cobrar» precargado siempre con el pendiente; cada pago queda listado.
4. En «Órdenes por cobrar» mostrar mesa (nombre) y nombre de cuenta; al tocar la tarjeta se expande ahí mismo con las líneas; «Cobrar» lleva al detalle y cobro.

## Archivos (sólo lectura)
- apps/web/src/app/app/caja/** (page.tsx, payment-panel.tsx, payable-orders.tsx, caja-view.ts, caja-helpers.ts, actions.ts, receipt.ts, context.ts)
- apps/web/src/lib/orders-view.ts, print-documents.ts, branch-order-work-tray.ts
- packages/shared-types/src/payments.ts (CollectPaymentCommandV1, PaymentCollectionSummaryV1, QuoteCashPaymentRequestV1, CashPaymentQuoteV1), payment-intent.ts, payment-obligation.ts, orders.ts (OrderDetailV1: pagos, remainingBalanceMinor, accountLabel, tableId), branch-order-work-tray.ts
- packages/domain/src/** (pagos, cambio, propina: buscar collect, tender, change, remaining)
- apps/api/src/payments.ts, payments.controller.ts, payments.test.ts, orders.ts (proyección de pagos en read_order)
- supabase/migrations: última definición de collect_simple_payment, collect_simple_payment_core, quote_cash_payment (o equivalentes), read_order, read_cash_register_operational_report
- docs/runbooks/guia-de-pruebas-operador.md §12 paso 6 (comportamiento esperado de caja)

## Tarea
1. Flujo actual de cobro parcial: qué valida el cliente, qué valida el servidor, qué devuelve cuando recibido < cobro, y cómo se proyectan los pagos ya capturados en OrderDetailV1 (si no se proyectan, decir qué tabla los tiene).
2. Diagnóstico del bug: con el código actual, ¿puede un collect capturar 70 y la UI mostrar error? Señala archivo:línea de la causa más probable (por ejemplo resultado `unavailable` tratado como error pese a éxito, o error de validación de cambio después de persistir).
3. Diseño mínimo para «Pagar total / Dividir pago» usando lo que ya existe (remainingBalanceMinor, pagos capturados): qué falta en contrato (por ejemplo lista payments[] en el detalle con método, monto, propina, hora, actor), en API y en SQL; qué es sólo UI. Sin cambiar reglas de dinero: el servidor sigue calculando cambio y saldo.
4. Datos para «Órdenes por cobrar»: qué trae hoy BranchOrderWorkItemV1 (ya tiene tableId y accountLabel) y qué haría falta para expandir líneas (¿read_order por tarjeta bajo demanda?).
5. Propón la partición: paquete A (contrato/SQL/API de historial de pagos + corrección del bug) y paquete C (UI de caja: encabezado de cuenta, selector total/dividir, lista de pagos, tarjetas expandibles). Tests necesarios y riesgos (doble cobro, idempotencia, propinas, cambio).

## Restricciones
- No modificar archivos, no instalar, no red, no base de datos.

## Formato de salida
Reporte §8 en `.agents/reports/caja-split-payments-research.md`, máximo 150 líneas, con rutas y líneas verificables.
