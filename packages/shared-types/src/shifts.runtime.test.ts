import { parseOperationalShiftListV1 } from "./shifts.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectUndefined(value: unknown, message: string): void {
  expect(value === undefined, message);
}

const scope = Object.freeze({
  branchId: "1487a3ac-4b8a-49bf-a261-50cf6d947df4",
  restaurantId: "d2dcadca-85c4-48f8-b938-646323ce5a33",
});
const valid = Object.freeze({
  schemaVersion: 1,
  scope,
  shifts: [{
    name: "Servicio de cena",
    openedAt: "2026-09-05T18:00:00.000Z",
    openedBy: "20cf8b06-3b8a-40e5-891d-242923c5705e",
    schemaVersion: 1,
    scope,
    shiftId: "db2549b5-50ec-4c9c-8c72-17a710c5aa46",
    status: "open",
    version: 1,
  }],
});

const parsed = parseOperationalShiftListV1(valid);
expect(parsed?.shifts[0]?.name === "Servicio de cena", "exact branch-scoped open shift parses");
expect(Object.isFrozen(parsed?.shifts), "parsed shift list is frozen");

expectUndefined(parseOperationalShiftListV1({
  ...valid,
  shifts: [{ ...valid.shifts[0], scope: { ...scope, branchId: "902eff09-15c7-4630-9eb8-ae1ec62fcfaf" } }],
}), "foreign scope is rejected");
expectUndefined(parseOperationalShiftListV1({ ...valid, shifts: [valid.shifts[0], valid.shifts[0]] }), "duplicate ids are rejected");
expectUndefined(parseOperationalShiftListV1({ ...valid, shifts: [{ ...valid.shifts[0], status: "closed" }] }), "closed rows are rejected");

const accessor = Object.defineProperty({}, "schemaVersion", { enumerable: true, get: () => 1 });
Object.defineProperties(accessor, {
  scope: { enumerable: true, value: scope },
  shifts: { enumerable: true, value: [] },
});
expectUndefined(parseOperationalShiftListV1(accessor), "accessors are rejected");

const sparse: unknown[] = [];
sparse.length = 1;
expectUndefined(parseOperationalShiftListV1({ ...valid, shifts: sparse }), "sparse arrays are rejected");
expectUndefined(parseOperationalShiftListV1({
  ...valid,
  shifts: [{ ...valid.shifts[0], name: " Servicio", openedAt: "2026-09-05T18:00:00Z" }],
}), "noncanonical fields are rejected");
