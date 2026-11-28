import type { BranchDaySummaryV1 } from "@super-restaurant/shared-types";

export interface CsvOptions {
  readonly bom?: boolean;
}

const HEADER = ["seccion", "concepto", "zona", "moneda", "importe", "conteo", "detalle"] as const;

export function serializeRfc4180(
  rows: readonly (readonly string[])[],
  options?: CsvOptions,
): string {
  const bom = options?.bom === true ? "\uFEFF" : "";
  if (rows.length === 0) return bom;
  let csv = "";
  for (const row of rows) csv += `${row.map(escapeField).join(",")}\r\n`;
  return bom + csv;
}

export function daySummaryRows(summary: BranchDaySummaryV1): readonly (readonly string[])[] {
  const { currency, timeZone } = summary;
  const rows: (readonly string[])[] = [
    HEADER,
    ["totales", "pagos cobrados", timeZone, currency, String(summary.totals.salesMinor),
      String(summary.totals.paymentCount),
      `propinas=${summary.totals.tipsMinor};efectivo=${summary.totals.cashTipsMinor}`],
    ["ordenes", "pagadas", "", currency, String(summary.ordersPaid.amountMinor),
      String(summary.ordersPaid.count), `ticket=${averageTicket(summary)}`],
    ["entregas", "cargo congelado", "", currency, String(summary.deliveryFees.amountMinor),
      String(summary.deliveryFees.orderCount), ""],
    ["entregas", "liquidadas", "", currency, String(summary.deliveriesSettled.cashCollectedMinor),
      String(summary.deliveriesSettled.count), ""],
    // Errata del plan §2.1: la columna zona de cancelaciones es summary.timeZone.
    ["cancelaciones", "ordenes", timeZone, "", "", String(summary.cancellations.orders),
      `capturas=${summary.cancellations.captures};devolucion_pendiente=${summary.cancellations.refundPendingMinor}`],
    ...summary.salesByChannel.filter((row) => row.paymentCount > 0)
      .map((row) => ["canal", row.channel, "", currency, String(row.amountMinor), String(row.paymentCount),
        `propina=${row.tipMinor}`]),
    ...summary.salesByMethod.filter((row) => row.paymentCount > 0)
      .map((row) => ["metodo", row.method, "", currency, String(row.amountMinor), String(row.paymentCount),
        `propina=${row.tipMinor}`]),
  ];
  // Contrato §2.1: todas las filas `turno`, después todas las `caja`, después todos los `movimiento`.
  for (const shift of summary.shifts) {
    // El contrato no expone fondo a nivel de turno: importe vacío, sin inventar 0.
    rows.push(["turno", shift.shiftId, timeZone, "", "", String(shift.registers.length),
      `nombre=${shift.name};estado=${shift.status};abierto=${shift.openedAt};cerrado=${shift.closedAt ?? ""}`]);
  }
  for (const shift of summary.shifts) {
    for (const register of shift.registers) {
      rows.push(["caja", register.registerId, timeZone, currency, String(register.expectedCashBalanceMinor),
        String(register.movements.length),
        `turno=${shift.shiftId};estado=${register.status};contado=${register.countedClosingBalanceMinor ?? ""};diferencia=${register.differenceMinor ?? ""}`]);
    }
  }
  for (const shift of summary.shifts) {
    for (const register of shift.registers) {
      for (const movement of register.movements) {
        rows.push(["movimiento", movement.type, timeZone, currency, String(movement.amountMinor),
          String(movement.count), `caja=${register.registerId};direccion=${movement.direction}`]);
      }
    }
  }
  return rows;
}

function averageTicket(summary: BranchDaySummaryV1): string {
  // `averageMinor` llega con sql-average-ticket; mientras no exista el campo, la celda va vacía.
  const averageMinor = (summary.ordersPaid as { readonly averageMinor?: number }).averageMinor;
  return averageMinor === undefined ? "" : String(averageMinor);
}

function escapeField(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}
