import {
  parseCaptureTrayItemV2,
  parseCaptureWorkTrayRequestV1,
  parseCaptureWorkTrayRequestV2,
  parseCaptureWorkTrayResultV2,
  parseRenewCaptureLeaseCommandV1,
  parseRenewCaptureLeaseResultV1,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const scope = { branchId: "22222222-2222-4222-8222-222222222222", restaurantId: "11111111-1111-4111-8111-111111111111" };
const item = {
  attentionLeaseExpiresAt: "2026-10-03T12:05:00.000Z",
  attentionStatus: "claimed",
  captureDraftId: "33333333-3333-4333-8333-333333333333",
  currency: "MXN",
  customer: { displayName: "Ana Perez", phone: "+52 662 123 4567" },
  folio: "T-0001",
  fulfillmentChannel: "delivery",
  ownerMembershipId: "44444444-4444-4444-8444-444444444444",
  schemaVersion: 2,
  scope,
  sourceChannel: "phone",
  status: "draft",
  totalMinor: 18_500,
  updatedAt: "2026-10-03T12:00:00.000Z",
  version: 3,
};

const parsed = parseCaptureTrayItemV2(item);
expect(parsed !== undefined && Object.isFrozen(parsed), "item parses frozen");
expect(parsed?.schemaVersion === 2 && parsed.totalMinor === 18_500 && parsed.customer?.phone === "+52 662 123 4567", "item keeps V2 facts");
expect(parseCaptureTrayItemV2({ ...item, customer: null, totalMinor: null, currency: null }) !== undefined, "PII-reduced item without total parses");
expect(parseCaptureTrayItemV2({ ...item, totalMinor: null }) === undefined, "total and currency must be paired");
expect(parseCaptureTrayItemV2({ ...item, totalMinor: 1.5 }) === undefined, "total must be an integer (no float money)");
expect(parseCaptureTrayItemV2({ ...item, totalMinor: -1 }) === undefined, "total cannot be negative");
expect(parseCaptureTrayItemV2({ ...item, currency: "mxn" }) === undefined, "currency is ISO uppercase");
expect(parseCaptureTrayItemV2({ ...item, extra: true }) === undefined, "item rejects unknown keys");
expect(parseCaptureTrayItemV2({ ...item, attentionLeaseExpiresAt: null }) === undefined, "claimed draft needs a lease expiry");
expect(parseCaptureTrayItemV2({ ...item, customer: { displayName: "A", phone: "1", extra: 1 } }) === undefined, "customer is exact");
expect(parseCaptureTrayItemV2({ ...item, schemaVersion: 1 }) === undefined, "item rejects V1 marker");

const result = parseCaptureWorkTrayResultV2({ items: [item], schemaVersion: 2 });
expect(result !== undefined && result.items.length === 1 && Object.isFrozen(result.items), "result parses");
expect(parseCaptureWorkTrayResultV2({ items: [{ ...item, folio: "" }], schemaVersion: 2 }) === undefined, "result rejects a bad item");
expect(parseCaptureWorkTrayResultV2({ items: Array.from({ length: 51 }, () => item), schemaVersion: 2 }) === undefined, "result caps at 50");

expect(parseCaptureWorkTrayRequestV2({ limit: 20, schemaVersion: 2, scope }) !== undefined, "request V2 parses");
expect(parseCaptureWorkTrayRequestV2({ limit: 51, schemaVersion: 2, scope }) === undefined, "request V2 caps limit");
expect(parseCaptureWorkTrayRequestV2({ limit: 20, schemaVersion: 1, scope }) === undefined, "request V2 rejects V1");
expect(parseCaptureWorkTrayRequestV1({ limit: 20, schemaVersion: 2, scope }) === undefined, "request V1 still rejects V2");

const command = { attentionLeaseId: "55555555-5555-4555-8555-555555555555", captureDraftId: item.captureDraftId, schemaVersion: 1, scope };
expect(parseRenewCaptureLeaseCommandV1(command) !== undefined, "renew command parses");
expect(parseRenewCaptureLeaseCommandV1({ ...command, expectedVersion: 1 }) === undefined, "renew command is exact");
expect(parseRenewCaptureLeaseCommandV1({ ...command, attentionLeaseId: "x" }) === undefined, "renew command needs a uuid lease");

const renewed = { attentionLeaseExpiresAt: "2026-10-03T12:10:00.000Z", attentionLeaseId: command.attentionLeaseId, captureDraftId: item.captureDraftId, schemaVersion: 1, version: 3 };
expect(parseRenewCaptureLeaseResultV1(renewed) !== undefined, "renew result parses");
expect(parseRenewCaptureLeaseResultV1({ ...renewed, version: 0 }) === undefined, "renew result needs a positive version");
expect(parseRenewCaptureLeaseResultV1({ ...renewed, attentionLeaseExpiresAt: "tomorrow" }) === undefined, "renew result needs an ISO instant");
