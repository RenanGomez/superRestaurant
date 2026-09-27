import assert from "node:assert/strict";
import test from "node:test";
import type { BranchScope, MembershipRoleCode } from "@super-restaurant/shared-types";

import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import type { MembershipDirectoryPort } from "./auth/membership-directory.js";
import {
  canonicalizeTextArray,
  deterministicQuoteId,
  DeliveryZoneApplicationError,
  DeliveryZoneService,
  type DeliveryZoneListPort,
  type DeliveryZoneQuoteFactsPort,
  type DeliveryZoneUpsertPort,
} from "./delivery-zones.js";
import type { CaptureCreationPort } from "./captures.js";
import type { MenuCatalogPort } from "./menu-catalog.js";
import type { BranchOperationalContextPort } from "./branch-operational-context.js";
import type { ClockPort } from "./clock.js";

const principal = { actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" };
const scope = {
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
} as unknown as BranchScope;
const otherRestaurantId = "9f8a5f0a-93ee-4a0b-9f0e-6a2a5f2a1234";
const captureDraftId = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const zoneId = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

const zoneWire = {
  schemaVersion: 1, zoneId, restaurantId: scope.restaurantId, branchId: scope.branchId,
  name: "Centro", postalCodes: ["83000"], localities: ["Hermosillo"], feeMinor: 2500,
  currency: "MXN", active: true, version: 1, updatedAt: "2026-09-16T12:00:01.000Z",
};

function code(expected: string) {
  return (error: unknown) => error instanceof DeliveryZoneApplicationError && error.code === expected;
}

function authorizationFor(
  memberships: readonly { roles: readonly MembershipRoleCode[]; scope: BranchScope }[],
): MembershipAuthorizationService {
  return new MembershipAuthorizationService({
    findActiveMembership: async (_principal, requestedScope) => {
      const match = memberships.find((membership) =>
        membership.scope.restaurantId === requestedScope.restaurantId && membership.scope.branchId === requestedScope.branchId);
      return match === undefined ? undefined : { roles: match.roles, scope: match.scope };
    },
  });
}

function directoryFor(memberships: readonly { roles: readonly MembershipRoleCode[]; scope: BranchScope }[]): MembershipDirectoryPort {
  return { listActiveMemberships: async () => ({ schemaVersion: 1, memberships: memberships.map((m) => ({
    branchName: "Sucursal", restaurantName: "Restaurante", roles: m.roles, scope: m.scope,
  })) }) };
}

const workspaceFixture = {
  schemaVersion: 3 as const,
  detail: {
    schemaVersion: 2 as const, scope, captureDraftId, folio: `C-${captureDraftId}`,
    sourceChannel: "phone" as const, fulfillmentChannel: "delivery" as const,
    status: "draft" as const, attentionStatus: "claimed" as const,
    ownerMembershipId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", version: 3,
    updatedAt: "2026-09-16T12:00:01.000Z", attentionLeaseId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
    attentionLeaseExpiresAt: "2026-09-16T12:05:01.000Z", confirmedOrderId: null,
    customerSnapshotRef: "c483b6e7-e102-4cc5-a887-d30712c85e52",
    fulfillmentSnapshotRef: "a409ec59-9f5e-496d-a45d-b83a46b49674",
    deliveryInstructions: null,
  },
  customerSnapshot: {
    schemaVersion: 1 as const, snapshotRef: "c483b6e7-e102-4cc5-a887-d30712c85e52",
    customerId: captureDraftId, contactId: "a409ec59-9f5e-496d-a45d-b83a46b49674",
    displayName: "Nombre congelado", phoneDisplayValue: "+52 662 000 0000", phoneNormalizedValue: "+526620000000",
  },
  fulfillmentSnapshot: {
    schemaVersion: 1 as const, snapshotRef: "a409ec59-9f5e-496d-a45d-b83a46b49674",
    customerSnapshotRef: "c483b6e7-e102-4cc5-a887-d30712c85e52", customerId: captureDraftId,
    addressId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4", label: "Casa", streetLine: "Acacia 84",
    unit: null, neighborhood: "Centro", locality: "Hermosillo", region: "Sonora", countryCode: "MX",
    postalCode: "83000", referencesText: null, legacyAddressInstructions: null,
    latitudeE6: null, longitudeE6: null, validatedAt: "2026-09-16T12:00:00.000Z",
  },
  repeatOrderPlan: null,
};

function captureCreationDouble(workspace: unknown = workspaceFixture): CaptureCreationPort {
  return {
    createDraft: async () => { throw new Error("not used"); },
    readWorkspaceV3: async () => workspace,
  };
}

function catalogDouble(currency = "MXN"): MenuCatalogPort {
  return {
    read: async () => ({
      schemaVersion: 1, scope,
      catalog: { catalogVersion: "v1", currency, categories: [], products: [], modifierGroups: [],
        version: 1, updatedAt: "2026-09-16T12:00:00.000Z", updatedBy: principal.actorId, replayed: false },
    } as unknown as Awaited<ReturnType<MenuCatalogPort["read"]>>),
    save: async () => { throw new Error("not used"); },
  };
}

function branchContextDouble(timeZone = "America/Hermosillo"): BranchOperationalContextPort {
  return { select: async () => ({ schemaVersion: 1, scope, roles: ["cashier"], timeZone } as unknown as Awaited<ReturnType<BranchOperationalContextPort["select"]>>) };
}

const clock: ClockPort = { now: () => "2026-09-16T12:00:02.000Z" };

function serviceFor(options: {
  roles?: readonly MembershipRoleCode[];
  directoryMemberships?: readonly { roles: readonly MembershipRoleCode[]; scope: BranchScope }[];
  listPort?: DeliveryZoneListPort;
  upsertPort?: DeliveryZoneUpsertPort;
  quoteFactsPort?: DeliveryZoneQuoteFactsPort;
  captures?: CaptureCreationPort;
  catalogs?: MenuCatalogPort;
  branchContext?: BranchOperationalContextPort;
} = {}): DeliveryZoneService {
  const roles = options.roles ?? (["cashier"] as const);
  const memberships = options.directoryMemberships ?? [{ roles, scope }];
  return new DeliveryZoneService(
    authorizationFor(memberships),
    directoryFor(memberships),
    options.listPort ?? { listZones: async () => ({ schemaVersion: 1, scope, zones: [zoneWire] }) },
    options.upsertPort ?? { upsertZone: async () => { throw new Error("not used"); } },
    options.quoteFactsPort ?? { listActiveZonesForQuote: async () => ({
      schemaVersion: 1, scope, zones: [{ zoneId, restaurantId: scope.restaurantId, branchId: scope.branchId,
        name: "Centro", postalCodes: ["83000"], localities: ["Hermosillo"], feeMinor: 2500, currency: "MXN" }],
    }) },
    options.captures ?? captureCreationDouble(),
    options.catalogs ?? catalogDouble(),
    options.branchContext ?? branchContextDouble(),
    clock,
  );
}

// --- listZones -------------------------------------------------------------

test("listZones: authorized branch scope returns zones", async () => {
  const service = serviceFor();
  const result = await service.listZones(principal, { schemaVersion: 1, scope: { kind: "branch", ...scope } });
  assert.equal(result.zones.length, 1);
  assert.equal(result.zones[0]?.zoneId, zoneId);
});

test("listZones: SQL rows ordered by name (not zoneId) are re-sorted before parsing", async () => {
  // app_private.list_delivery_zones orders by (name, id) for a human-friendly listing; here the
  // name order is the exact reverse of the zoneId order, which parseDeliveryZoneListV1 requires.
  const lowId = "10000000-0000-4000-8000-000000000001";
  const highId = "90000000-0000-4000-8000-000000000009";
  const lowIdZone = { ...zoneWire, zoneId: lowId, name: "Zulu" };
  const highIdZone = { ...zoneWire, zoneId: highId, name: "Alpha" };
  const listPort: DeliveryZoneListPort = {
    // SQL row order: "Alpha" (highId) before "Zulu" (lowId) — reversed relative to zoneId.
    listZones: async () => ({ schemaVersion: 1, scope, zones: [highIdZone, lowIdZone] }),
  };
  const service = serviceFor({ listPort });
  const result = await service.listZones(principal, { schemaVersion: 1, scope: { kind: "branch", ...scope } });
  assert.deepEqual(result.zones.map((zone) => zone.zoneId), [lowId, highId]);
});

test("listZones: denies actor without captures.read in the branch", async () => {
  const service = serviceFor({ roles: ["kitchen"] });
  await assert.rejects(
    service.listZones(principal, { schemaVersion: 1, scope: { kind: "branch", ...scope } }),
    code("authorization"),
  );
});

test("listZones: branch scope forgery (client claims a branch it has no membership in) is rejected", async () => {
  const service = serviceFor({ directoryMemberships: [{ roles: ["manager"], scope }] });
  const foreignScope = { restaurantId: scope.restaurantId, branchId: "00000000-0000-4000-8000-000000000000" } as unknown as BranchScope;
  await assert.rejects(
    service.listZones(principal, { schemaVersion: 1, scope: { kind: "branch", ...foreignScope } }),
    code("authorization"),
  );
});

test("listZones: restaurant-wide scope never trusts client `kind` — aggregates only the actor's own authorized branches", async () => {
  const secondBranch = { restaurantId: scope.restaurantId, branchId: "3d2b1a4c-5e6f-4a7b-8c9d-0e1f2a3b4c5d" } as unknown as BranchScope;
  const secondZoneId = "c3d4e5f6-a7b8-4c9d-9e1f-2a3b4c5d6e7f";
  const listPort: DeliveryZoneListPort = {
    listZones: async (_actorId, requestedScope) => requestedScope.branchId === scope.branchId
      ? { schemaVersion: 1, scope: requestedScope, zones: [zoneWire] }
      : { schemaVersion: 1, scope: requestedScope, zones: [{ ...zoneWire, zoneId: secondZoneId, branchId: secondBranch.branchId }] },
  };
  const service = serviceFor({
    directoryMemberships: [{ roles: ["manager"], scope }, { roles: ["manager"], scope: secondBranch }],
    listPort,
  });
  const result = await service.listZones(principal, {
    schemaVersion: 1, scope: { kind: "restaurant", restaurantId: scope.restaurantId },
  });
  assert.equal(result.zones.length, 2);
  assert.ok(result.zones.every((zone) => zone.restaurantId === scope.restaurantId));
});

test("listZones: restaurant-wide scope excludes branches under a different restaurant", async () => {
  const service = serviceFor({ directoryMemberships: [{ roles: ["manager"], scope }] });
  const result = await service.listZones(principal, {
    schemaVersion: 1, scope: { kind: "restaurant", restaurantId: scope.restaurantId },
  });
  assert.equal(result.zones.length, 1);
  await assert.rejects(
    service.listZones(principal, { schemaVersion: 1, scope: { kind: "restaurant", restaurantId: otherRestaurantId } }),
    code("authorization"),
  );
});

// --- upsertZone --------------------------------------------------------------

const upsertInput = {
  schemaVersion: 1, scope, zoneId, expectedVersion: 0, name: "Centro",
  postalCodes: ["83000", "83010"], localities: [],
  feeMinor: 2500, currency: "MXN", active: true,
  eventId: "a409ec59-9f5e-496d-a45d-b83a46b49674", idempotencyKey: "c483b6e7-e102-4cc5-a887-d30712c85e52",
  deviceId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4", occurredAt: "2026-09-16T12:00:00.000Z", reason: null,
};

test("upsertZone: manager-tier role required, cashier is denied", async () => {
  const service = serviceFor({ roles: ["cashier"] });
  await assert.rejects(service.upsertZone(principal, upsertInput), code("authorization"));
});

test("upsertZone: manager role is authorized and sends the already-canonical postal codes to SQL", async () => {
  let capturedCommand: Record<string, unknown> | undefined;
  const upsertPort: DeliveryZoneUpsertPort = {
    upsertZone: async (_actorId, command) => {
      capturedCommand = command as Record<string, unknown>;
      return { schemaVersion: 1, replayed: false, zone: { ...zoneWire, postalCodes: (command as Record<string, unknown>).postalCodes } };
    },
  };
  const service = serviceFor({ roles: ["manager"], upsertPort });
  const result = await service.upsertZone(principal, upsertInput);
  assert.deepEqual(capturedCommand?.postalCodes, ["83000", "83010"]);
  assert.deepEqual(result.zone.postalCodes, ["83000", "83010"]);
});

test("canonicalizeTextArray: deduplicates and sorts by ascending code-unit order", () => {
  assert.deepEqual(canonicalizeTextArray(["83010", "83000", "83010", "B", "a"]), ["83000", "83010", "B", "a"]);
  assert.deepEqual(canonicalizeTextArray([]), []);
});

test("upsertZone: SQL conflict status maps to a conflict error", async () => {
  const upsertPort: DeliveryZoneUpsertPort = { upsertZone: async () => ({ status: "conflict" }) };
  const service = serviceFor({ roles: ["manager"], upsertPort });
  await assert.rejects(service.upsertZone(principal, upsertInput), code("conflict"));
});

test("upsertZone: replaying an accepted idempotent command returns replayed=true", async () => {
  const upsertPort: DeliveryZoneUpsertPort = {
    upsertZone: async () => ({ schemaVersion: 1, replayed: true, zone: zoneWire }),
  };
  const service = serviceFor({ roles: ["manager"], upsertPort });
  const result = await service.upsertZone(principal, upsertInput);
  assert.equal(result.replayed, true);
});

test("upsertZone: hostile SQL response (extra key) is rejected as unavailable", async () => {
  const upsertPort: DeliveryZoneUpsertPort = {
    upsertZone: async () => ({ schemaVersion: 1, replayed: false, zone: zoneWire, extra: "field" }),
  };
  const service = serviceFor({ roles: ["manager"], upsertPort });
  await assert.rejects(service.upsertZone(principal, upsertInput), code("unavailable"));
});

test("upsertZone: rejects a malformed command before ever calling the port", async () => {
  const service = serviceFor({ roles: ["manager"] });
  await assert.rejects(service.upsertZone(principal, { ...upsertInput, feeMinor: -1 }), code("request"));
});

// --- quoteForCapture ---------------------------------------------------------

const quoteInput = { schemaVersion: 1, scope, captureDraftId, scheduledFor: null };

test("quoteForCapture: covered address returns the zone fee, never a client-supplied fee", async () => {
  // RequestDeliveryQuoteCommandV1 has no fee field at all (exactRecord rejects any extra key),
  // so a client cannot smuggle a fee in; the server always derives it from the authorized zones.
  const service = serviceFor();
  const quote = await service.quoteForCapture(principal, quoteInput);
  assert.equal(quote.coverageStatus, "covered");
  assert.equal(quote.zoneId, zoneId);
  assert.equal(quote.feeMinor, 2500);
});

test("quoteForCapture: address outside every zone is not_covered with a zero fee", async () => {
  const notCoveredWorkspace = {
    ...workspaceFixture,
    fulfillmentSnapshot: { ...workspaceFixture.fulfillmentSnapshot, postalCode: "99999", locality: "Otra ciudad" },
  };
  const service = serviceFor({ captures: captureCreationDouble(notCoveredWorkspace) });
  const quote = await service.quoteForCapture(principal, quoteInput);
  assert.equal(quote.coverageStatus, "not_covered");
  assert.equal(quote.zoneId, null);
  assert.equal(quote.feeMinor, 0);
});

test("quoteForCapture: expires exactly at promiseStart (15-minute window)", async () => {
  const service = serviceFor();
  const quote = await service.quoteForCapture(principal, quoteInput);
  assert.equal(quote.expiresAt, quote.promiseStart);
  assert.equal(new Date(quote.promiseEnd).getTime() - new Date(quote.promiseStart).getTime(), 15 * 60 * 1000);
});

test("quoteForCapture: draft without a fulfillment snapshot is a conflict, not a crash", async () => {
  const service = serviceFor({ captures: captureCreationDouble({ ...workspaceFixture, fulfillmentSnapshot: null,
    detail: { ...workspaceFixture.detail, fulfillmentSnapshotRef: null } }) });
  await assert.rejects(service.quoteForCapture(principal, quoteInput), code("conflict"));
});

test("quoteForCapture: denies an actor without captures.read on the branch", async () => {
  const service = serviceFor({ roles: ["kitchen"] });
  await assert.rejects(service.quoteForCapture(principal, quoteInput), code("authorization"));
});

test("quoteForCapture: identical facts always produce the identical quoteId", async () => {
  const service = serviceFor();
  const first = await service.quoteForCapture(principal, quoteInput);
  const second = await service.quoteForCapture(principal, quoteInput);
  assert.equal(first.quoteId, second.quoteId);
  assert.notEqual(first.quoteId, captureDraftId);
});

test("quoteForCapture: a different scheduledFor produces a different quoteId", async () => {
  const service = serviceFor();
  const asap = await service.quoteForCapture(principal, quoteInput);
  const scheduled = await service.quoteForCapture(principal, {
    ...quoteInput, scheduledFor: "2026-09-16T13:00:00.000Z",
  });
  assert.notEqual(asap.quoteId, scheduled.quoteId);
});

test("deterministicQuoteId: identical facts produce the identical id, in canonical UUID form", () => {
  const facts = [captureDraftId, "snapshot-ref", zoneId, 2500, "2026-09-16T12:00:02.000Z", null] as const;
  const first = deterministicQuoteId([...facts]);
  const second = deterministicQuoteId([...facts]);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
});

test("deterministicQuoteId: any changed fact produces a different id (no Math.random involved)", () => {
  const base = deterministicQuoteId([captureDraftId, "snapshot-ref", zoneId, 2500, "2026-09-16T12:00:02.000Z", null]);
  const feeChanged = deterministicQuoteId([captureDraftId, "snapshot-ref", zoneId, 2600, "2026-09-16T12:00:02.000Z", null]);
  const scheduleChanged = deterministicQuoteId([captureDraftId, "snapshot-ref", zoneId, 2500, "2026-09-16T12:00:02.000Z", "2026-09-16T13:00:00.000Z"]);
  assert.notEqual(base, feeChanged);
  assert.notEqual(base, scheduleChanged);
});

test("quoteForCapture: hostile inputs (unknown captureDraftId shape) are rejected as a request error", async () => {
  const service = serviceFor();
  await assert.rejects(service.quoteForCapture(principal, { ...quoteInput, captureDraftId: "not-a-uuid" }), code("request"));
});
