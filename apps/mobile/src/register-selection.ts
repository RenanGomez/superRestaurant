import type { BranchDaySummaryV1 } from "@super-restaurant/shared-types";

export function branchDate(now: Date, timeZone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: string): string | undefined => parts.find((entry) => entry.type === type)?.value;
    const year = part("year"), month = part("month"), day = part("day");
    return year === undefined || month === undefined || day === undefined ? undefined : `${year}-${month}-${day}`;
  } catch { return undefined; }
}

export function openRegisters(summary: BranchDaySummaryV1, shiftId: string): readonly { registerId: string; cashRegisterSessionId: string; cashierId: string }[] {
  return summary.shifts.filter((shift) => shift.shiftId === shiftId && shift.status === "open")
    .flatMap((shift) => shift.registers.filter((register) => register.status === "open")
      .map(({ registerId, cashRegisterSessionId, cashierId }) => ({ registerId, cashRegisterSessionId, cashierId })));
}
