import assert from "node:assert/strict";
import test from "node:test";
import { Test } from "@nestjs/testing";
import type { BranchScope, MembershipRoleCode } from "@super-restaurant/shared-types";

import { AppModule } from "./app.module.js";
import { AUTH_PRINCIPAL_VERIFIER } from "./auth/authentication.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { MENU_CATALOG_PORT } from "./menu-catalog.js";
import { BRANCH_OPERATIONAL_CONTEXT_PORT } from "./branch-operational-context.js";

import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import type { MembershipDirectoryPort } from "./auth/membership-directory.js";
import {
  canonicalizeTextArray,
  deterministicQuoteId,
  DeliveryZoneApplicationError,
  DeliveryZoneService,
  DELIVERY_ZONE_QUOTE_FACTS_PORT,
  PostgresDeliveryZoneStore,
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
  clock?: ClockPort;
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
    options.clock ?? clock,
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

test("quoteForCapture: ASAP quote lives 15 minutes from quotedAt and promises from quotedAt + 30 minutes", async () => {
  const service = serviceFor();
  const quote = await service.quoteForCapture(principal, quoteInput);
  const quotedAtMs = new Date(quote.quotedAt).getTime();
  assert.equal(new Date(quote.expiresAt).getTime() - quotedAtMs, 15 * 60 * 1000);
  assert.equal(new Date(quote.promiseStart).getTime() - quotedAtMs, 30 * 60 * 1000);
  assert.equal(new Date(quote.promiseEnd).getTime() - new Date(quote.promiseStart).getTime(), 15 * 60 * 1000);
});

test("quoteForCapture: a scheduled quote still expires exactly at promiseStart", async () => {
  const service = serviceFor();
  const quote = await service.quoteForCapture(principal, { ...quoteInput, scheduledFor: "2026-09-16T13:00:00.000Z" });
  assert.equal(quote.expiresAt, quote.promiseStart);
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

test("quoteForCapture: same request quoted at a different instant produces a different quoteId, even when promiseStart is identical", async () => {
  // A scheduled (non-ASAP) request freezes promiseStart/promiseEnd/expiresAt at the requested
  // schedule regardless of quotedAt, so this isolates quotedAt as the only differing fact.
  const scheduledQuoteInput = { ...quoteInput, scheduledFor: "2026-09-16T13:00:00.000Z" };
  const earlyClock: ClockPort = { now: () => "2026-09-16T12:00:02.000Z" };
  const laterClock: ClockPort = { now: () => "2026-09-16T12:05:00.000Z" };
  const early = await serviceFor({ clock: earlyClock }).quoteForCapture(principal, scheduledQuoteInput);
  const later = await serviceFor({ clock: laterClock }).quoteForCapture(principal, scheduledQuoteInput);
  assert.equal(early.promiseStart, later.promiseStart);
  assert.equal(early.expiresAt, later.expiresAt);
  assert.notEqual(early.quotedAt, later.quotedAt);
  assert.notEqual(early.quoteId, later.quoteId);
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
  const quotedAtChanged = deterministicQuoteId([captureDraftId, "snapshot-ref", zoneId, 2500, "2026-09-16T12:05:00.000Z", null]);
  assert.notEqual(base, feeChanged);
  assert.notEqual(base, scheduleChanged);
  assert.notEqual(base, quotedAtChanged);
});

test("quoteForCapture: hostile inputs (unknown captureDraftId shape) are rejected as a request error", async () => {
  const service = serviceFor();
  await assert.rejects(service.quoteForCapture(principal, { ...quoteInput, captureDraftId: "not-a-uuid" }), code("request"));
});

// --- matchAddress ------------------------------------------------------------

const matchInput = (address: { postalCode: string | null; locality: string }) => ({
  schemaVersion: 1, restaurantId: scope.restaurantId, branchId: scope.branchId, address,
});

test("matchAddress: covered by postal code returns zone, fee in minor units and the ASAP window", async () => {
  const result = await serviceFor().matchAddress(principal, matchInput({ postalCode: "83000", locality: "Otra" }));
  assert.deepEqual(result, {
    schemaVersion: 1, coverageStatus: "covered", zoneId, zoneName: "Centro", feeMinor: 2500, currency: "MXN",
    promiseMinutes: 15, promiseStart: "2026-09-16T12:30:02.000Z", promiseEnd: "2026-09-16T12:45:02.000Z",
    evaluatedAt: "2026-09-16T12:00:02.000Z",
  });
});

test("matchAddress: covered by locality when the postal code does not match", async () => {
  const result = await serviceFor().matchAddress(principal, matchInput({ postalCode: null, locality: "Hermosillo" }));
  assert.equal(result.coverageStatus, "covered");
  assert.equal(result.zoneId, zoneId);
});

test("matchAddress: uncovered address is not_covered with fee 0 and no zone", async () => {
  const result = await serviceFor().matchAddress(principal, matchInput({ postalCode: "99999", locality: "Lejos" }));
  assert.equal(result.coverageStatus, "not_covered");
  assert.equal(result.zoneId, null);
  assert.equal(result.zoneName, null);
  assert.equal(result.feeMinor, 0);
});

test("matchAddress: zones of another branch never apply and the facts query uses the authorized scope", async () => {
  const queried: string[] = [];
  const service = serviceFor({
    quoteFactsPort: { listActiveZonesForQuote: async (restaurantId, branchId) => {
      queried.push(`${restaurantId}/${branchId}`);
      return { schemaVersion: 1, scope, zones: [] };
    } },
  });
  const result = await service.matchAddress(principal, matchInput({ postalCode: "83000", locality: "Hermosillo" }));
  assert.equal(result.coverageStatus, "not_covered");
  assert.deepEqual(queried, [`${scope.restaurantId}/${scope.branchId}`]);
  const foreign = { ...matchInput({ postalCode: "83000", locality: "Hermosillo" }), branchId: "00000000-0000-4000-8000-000000000000" };
  await assert.rejects(service.matchAddress(principal, foreign), code("authorization"));
  assert.equal(queried.length, 1);
});

test("matchAddress: a zone row from another branch makes the read unavailable instead of leaking", async () => {
  const service = serviceFor({
    quoteFactsPort: { listActiveZonesForQuote: async () => ({ schemaVersion: 1, scope, zones: [{
      zoneId, restaurantId: scope.restaurantId, branchId: "00000000-0000-4000-8000-000000000000",
      name: "Ajena", postalCodes: ["83000"], localities: [], feeMinor: 100, currency: "MXN" }] }) },
  });
  await assert.rejects(service.matchAddress(principal, matchInput({ postalCode: "83000", locality: "X" })), code("unavailable"));
});

test("matchAddress: a cashier is authorized; a role with neither captures.read nor customers.read is denied", async () => {
  const customersOnly = serviceFor({ roles: ["cashier"] });
  assert.equal((await customersOnly.matchAddress(principal, matchInput({ postalCode: "83000", locality: "X" }))).coverageStatus, "covered");
  await assert.rejects(
    serviceFor({ roles: ["kitchen"] }).matchAddress(principal, matchInput({ postalCode: "83000", locality: "X" })),
    code("authorization"),
  );
});

test("matchAddress: hostile bodies are request errors", async () => {
  const service = serviceFor();
  await assert.rejects(service.matchAddress(principal, {}), code("request"));
  await assert.rejects(service.matchAddress(principal, { ...matchInput({ postalCode: "83000", locality: "X" }), scheduledFor: null }), code("request"));
});

test("PostgresDeliveryZoneStore.listActiveZonesForQuote: real `{ result }` row feeds matchAddress", async () => {
  const database: DatabaseClientPort = {
    query: async () => ({ rows: [{ result: {
      schemaVersion: 1, scope, zones: [{ zoneId, restaurantId: scope.restaurantId, branchId: scope.branchId,
        name: "Centro", postalCodes: ["83000"], localities: [], feeMinor: 3500, currency: "MXN" }],
    } }] }),
  } as unknown as DatabaseClientPort;
  const store = new PostgresDeliveryZoneStore(database);
  const service = serviceFor({ quoteFactsPort: store });
  const result = await service.matchAddress(principal, matchInput({ postalCode: "83000", locality: "X" }));
  assert.equal(result.feeMinor, 3500);
  const broken = new PostgresDeliveryZoneStore({ query: async () => ({ rows: [{ result: 1, extra: 2 }] }) } as unknown as DatabaseClientPort);
  await assert.rejects(broken.listActiveZonesForQuote(scope.restaurantId, scope.branchId), code("unavailable"));
});

test("POST /delivery-zones/match: HTTP contract (401, 400, 200 no-store, 403, 503 sanitized)", async () => {
  let roles: readonly MembershipRoleCode[] = ["cashier"];
  let facts: () => Promise<unknown> = async () => ({ schemaVersion: 1, scope, zones: [{
    zoneId, restaurantId: scope.restaurantId, branchId: scope.branchId,
    name: "Centro", postalCodes: ["83000"], localities: [], feeMinor: 2500, currency: "MXN" }] });
  const queries: string[] = [];
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_CLIENT).useValue({ query: async (sql: string) => { queries.push(sql); throw new Error("unexpected database call"); } })
    .overrideProvider(MembershipAuthorizationService).useValue(authorizationFor([{ get roles() { return roles; }, scope }]))
    .overrideProvider(DELIVERY_ZONE_QUOTE_FACTS_PORT).useValue({ listActiveZonesForQuote: () => facts() })
    .overrideProvider(MENU_CATALOG_PORT).useValue(catalogDouble())
    .overrideProvider(BRANCH_OPERATIONAL_CONTEXT_PORT).useValue(branchContextDouble())
    .overrideProvider(AUTH_PRINCIPAL_VERIFIER).useValue({ verifyAccessToken: async () => principal })
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const url = `${await app.getUrl()}/api/v1/delivery-zones/match`;
  const send = (body: unknown, authenticated = true) => fetch(url, {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer delivery-match-fixture-token" } : {}) },
  });
  try {
    const body = matchInput({ postalCode: "83000", locality: "Hermosillo" });
    assert.equal((await send(body, false)).status, 401);
    assert.equal((await send({})).status, 400);
    const ok = await send(body);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "private, no-store");
    const json = await ok.json() as { coverageStatus: string; feeMinor: number; zoneName: string };
    assert.equal(json.coverageStatus, "covered");
    assert.equal(json.feeMinor, 2500);
    assert.equal(json.zoneName, "Centro");
    roles = ["kitchen"];
    const denied = await send(body);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { code: "ACTION_NOT_AUTHORIZED" });
    roles = ["cashier"];
    facts = async () => { throw new Error("secret connection string"); };
    const down = await send(body);
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), { code: "DELIVERY_ZONE_UNAVAILABLE" });
    assert.deepEqual(queries, [], "match never reaches the database client directly (no capture_delivery_quotes write)");
  } finally {
    await app.close();
  }
});
