# Decisiones pendientes de Emmanuel

Regla (`docs/plans/plan-2026-11-28-etapa-fase5.md` §9): ninguna de estas decisiones la toma el agente. Cada
una bloquea un corte concreto; mientras falte, la tarea no se abre.

## Bloquean el corte 3 de la Ola 8 (reembolsos ejecutados)

1. **¿El reembolso ejecutado se registra en el POS o solo se anota?**
   - Si se registra: `app.refunds` es la fuente de verdad y el reporte lo cuenta (`rep-refunds-field`).
   - Si solo se anota: no hay tabla, no hay reporte ejecutado y el hueco del catálogo de métricas se queda
     como `no existe` con su motivo.
2. **¿Qué rol puede ejecutar un reembolso?** (owner/admin/manager hoy ejecutan cancelaciones; ¿supervisor
   también, con auditoría?)
3. **¿Efectivo y tarjeta, o solo efectivo en esta etapa?** El efectivo sale de la caja y ya tiene
   movimientos; la tarjeta depende del proveedor y no hay integración.

## Bloquean `rep-gross-net-tax` (no bloquea el resto del corte 1)

4. **¿El impuesto se reporta incluido en la venta o desglosado?** Y si se desglosa: ¿el total del ticket
   sigue siendo el cobrado (impuesto incluido) o se suma aparte?
5. **¿Se factura (CFDI) en esta etapa?** Si sí, es Fase 6 con ADR y PAC, no una tarea de reportes.

## Deuda de producto que sigue abierta

6. **Cuenta web `viewer`/`auditor` de pruebas** en dev (o aceptar la evidencia de API + helper) para cerrar
   `o5-compras-ui-read`, que lleva dos cortes en REVIEW.
7. **Prueba del operador** (D1–D7, T1–T4, seis pestañas de inventario). Sin ella ninguna fila de «Día
   operable» pasa a DONE.
