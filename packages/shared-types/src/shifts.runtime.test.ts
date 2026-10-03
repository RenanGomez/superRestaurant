import {
  parseOpenOperationalShiftCommandV1,
  parseOpenOperationalShiftResultV1,
  parseOperationalShiftListV1,
} from "./shifts.js";

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

const openCommand = Object.freeze({
  schemaVersion: 1,
  scope,
  shiftId: "db2549b5-50ec-4c9c-8c72-17a710c5aa46",
  name: "Turno de comida",
  eventId: "1e8e3d4a-6b2c-4f8a-9d1e-3c5b7a9f2d4e",
  idempotencyKey: "open-shift-attempt-1",
  deviceId: "20cf8b06-3b8a-40e5-891d-242923c5705e",
  occurredAt: "2026-09-05T18:00:00.000Z",
});
expect(parseOpenOperationalShiftCommandV1(openCommand) !== undefined, "open shift command parses");
expectUndefined(parseOpenOperationalShiftCommandV1({ ...openCommand, name: " Turno" }), "open shift command rejects untrimmed name");
expectUndefined(parseOpenOperationalShiftCommandV1({ ...openCommand, shiftId: "invalid" }), "open shift command requires a UUID shift id");

const openResult = Object.freeze({ schemaVersion: 1, scope, shiftId: openCommand.shiftId, replayed: false });
expect(parseOpenOperationalShiftResultV1(openResult) !== undefined, "open shift result parses");
expectUndefined(parseOpenOperationalShiftResultV1({ ...openResult, replayed: "false" }), "open shift result requires a boolean replayed");
