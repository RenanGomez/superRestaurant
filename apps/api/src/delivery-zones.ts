import { types as nodeTypes } from "node:util";
import { Inject, Injectable } from "@nestjs/common";
import {
  parseDeliveryZoneListV1,
  parseListDeliveryZonesQueryV1,
  parseRequestDeliveryQuoteCommandV1,
  parseUpsertDeliveryZoneCommandV1,
  parseUpsertDeliveryZoneResultV1,
  parseDeliveryQuoteV1,
  parseCaptureWorkspaceRequestV3,
  type BranchScope,
  type DeliveryZoneBranchScopeV1,
  type DeliveryZoneListV1,
  type DeliveryZoneV1,
  type DeliveryQuoteV1,
  type ListDeliveryZonesQueryV1,
  type RequestDeliveryQuoteCommandV1,
  type UpsertDeliveryZoneCommandV1,
  type UpsertDeliveryZoneResultV1,
} from "@super-restaurant/shared-types";
import { createDeliveryZone, quoteDelivery, Money, type DeliveryZone } from "@super-restaurant/domain";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { MEMBERSHIP_DIRECTORY, type MembershipDirectoryPort } from "./auth/membership-directory.js";
import { rolesGrantPermission } from "./auth/rbac-policy.js";
import { SERVER_CLOCK_PORT, type ClockPort } from "./clock.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { CAPTURE_CREATION_PORT, type CaptureCreationPort } from "./captures.js";
import { decodeCaptureWorkspaceV3 } from "./persistence/capture-persistence-codec.js";
import { MENU_CATALOG_PORT, type MenuCatalogPort } from "./menu-catalog.js";
import { BRANCH_OPERATIONAL_CONTEXT_PORT, type BranchOperationalContextPort } from "./branch-operational-context.js";

export type DeliveryZoneApplicationErrorCode = "request" | "authorization" | "conflict" | "missing" | "unavailable";
export class DeliveryZoneApplicationError extends Error {
  public constructor(public readonly code: DeliveryZoneApplicationErrorCode) {
    super(`DELIVERY_ZONE_${code.toUpperCase()}`);
    this.name = "DeliveryZoneApplicationError";
  }
}

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface ActiveQuoteZoneFactsV1 {
  readonly zoneId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly name: string;
  readonly postalCodes: readonly string[];
  readonly localities: readonly string[];
  readonly feeMinor: number;
  readonly currency: string;
}

export interface DeliveryZoneListPort {
  listZones(actorId: string, scope: DeliveryZoneBranchScopeV1): Promise<unknown>;
}
export const DELIVERY_ZONE_LIST_PORT = Symbol("DELIVERY_ZONE_LIST_PORT");

export interface DeliveryZoneUpsertPort {
  upsertZone(actorId: string, command: unknown): Promise<unknown>;
}
export const DELIVERY_ZONE_UPSERT_PORT = Symbol("DELIVERY_ZONE_UPSERT_PORT");

export interface DeliveryZoneQuoteFactsPort {
  listActiveZonesForQuote(restaurantId: string, branchId: string): Promise<unknown>;
}
export const DELIVERY_ZONE_QUOTE_FACTS_PORT = Symbol("DELIVERY_ZONE_QUOTE_FACTS_PORT");

@Injectable()
export class PostgresDeliveryZoneStore implements DeliveryZoneListPort, DeliveryZoneUpsertPort, DeliveryZoneQuoteFactsPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async listZones(actorId: string, scope: DeliveryZoneBranchScopeV1): Promise<unknown> {
    if (!canonicalUuid.test(actorId)) throw new DeliveryZoneApplicationError("request");
    const request = { schemaVersion: 1, scope };
    const response = await this.database.query(
      "select app_private.list_delivery_zones($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(request)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async upsertZone(actorId: string, command: unknown): Promise<unknown> {
    if (!canonicalUuid.test(actorId)) throw new DeliveryZoneApplicationError("request");
    const response = await this.database.query(
      "select app_private.upsert_delivery_zone($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(command)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async listActiveZonesForQuote(restaurantId: string, branchId: string): Promise<unknown> {
    if (!canonicalUuid.test(restaurantId) || !canonicalUuid.test(branchId)) throw new DeliveryZoneApplicationError("request");
    const response = await this.database.query(
      "select app_private.list_active_delivery_zones_for_quote($1::uuid, $2::uuid) as result",
      [restaurantId, branchId],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }
}

@Injectable()
export class DeliveryZoneService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(MEMBERSHIP_DIRECTORY) private readonly directory: MembershipDirectoryPort,
    @Inject(DELIVERY_ZONE_LIST_PORT) private readonly listPort: DeliveryZoneListPort,
    @Inject(DELIVERY_ZONE_UPSERT_PORT) private readonly upsertPort: DeliveryZoneUpsertPort,
    @Inject(DELIVERY_ZONE_QUOTE_FACTS_PORT) private readonly quoteFactsPort: DeliveryZoneQuoteFactsPort,
    @Inject(CAPTURE_CREATION_PORT) private readonly captures: CaptureCreationPort,
    @Inject(MENU_CATALOG_PORT) private readonly catalogs: MenuCatalogPort,
    @Inject(BRANCH_OPERATIONAL_CONTEXT_PORT) private readonly branchContext: BranchOperationalContextPort,
    @Inject(SERVER_CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  public async listZones(principal: AuthenticatedPrincipal, input: unknown): Promise<DeliveryZoneListV1> {
    const query = parseListQuery(input);

    if (query.scope.kind === "branch") {
      const branchScope: DeliveryZoneBranchScopeV1 = { restaurantId: query.scope.restaurantId, branchId: query.scope.branchId };
      let actorId: string;
      try { actorId = (await this.authorization.authorizeBranch(principal, branchScope, "captures.read")).principal.actorId; }
      catch { throw new DeliveryZoneApplicationError("authorization"); }
      const zones = await this.fetchZonesForBranch(actorId, branchScope);
      const result = parseDeliveryZoneListV1({ schemaVersion: 1, scope: query.scope, zones });
      if (result === undefined) throw unavailable();
      return result;
    }

    // Restaurant-wide overview: never trust the client's `kind` label as evidence of access.
    // The available SQL surface (app_private.list_delivery_zones) is Branch-scoped only, so the
    // server independently derives the actor's own active branch memberships under this
    // restaurant and aggregates the per-branch listing across exactly those branches — the
    // client's requested `kind` never widens what is queried.
    let branchScopes: readonly DeliveryZoneBranchScopeV1[];
    try {
      branchScopes = await this.authorizedRestaurantBranches(principal, query.scope.restaurantId);
    } catch { throw new DeliveryZoneApplicationError("authorization"); }
    if (branchScopes.length === 0) throw new DeliveryZoneApplicationError("authorization");

    const allZones: DeliveryZoneV1[] = [];
    for (const branchScope of branchScopes) {
      let actorId: string;
      try { actorId = (await this.authorization.authorizeBranch(principal, branchScope, "captures.read")).principal.actorId; }
      catch { throw new DeliveryZoneApplicationError("authorization"); }
      const zones = await this.fetchZonesForBranch(actorId, branchScope);
      allZones.push(...zones);
    }
    allZones.sort((left, right) => (left.zoneId < right.zoneId ? -1 : left.zoneId > right.zoneId ? 1 : 0));
    const result = parseDeliveryZoneListV1({ schemaVersion: 1, scope: query.scope, zones: allZones });
    if (result === undefined) throw unavailable();
    return result;
  }

  public async upsertZone(principal: AuthenticatedPrincipal, input: unknown): Promise<UpsertDeliveryZoneResultV1> {
    const command = parseUpsertCommand(input);
    let actorId: string;
    try {
      actorId = (await this.authorization.authorizeBranch(principal, command.scope, "delivery_zones.manage")).principal.actorId;
    } catch { throw new DeliveryZoneApplicationError("authorization"); }

    // Canonical form: deduplicated, ascending code-unit order — matches the shape the shared
    // parser requires and the invariant `app_private.upsert_delivery_zone` enforces server-side.
    const storageCommand = {
      schemaVersion: 1,
      scope: command.scope,
      zoneId: command.zoneId,
      expectedVersion: command.expectedVersion,
      name: command.name,
      postalCodes: canonicalizeTextArray(command.postalCodes),
      localities: canonicalizeTextArray(command.localities),
      feeMinor: command.feeMinor,
      currency: command.currency,
      active: command.active,
      eventId: command.eventId,
      idempotencyKey: command.idempotencyKey,
      deviceId: command.deviceId,
      occurredAt: command.occurredAt,
      reason: command.reason,
    };

    let raw: unknown;
    try { raw = await this.upsertPort.upsertZone(actorId, storageCommand); } catch { throw unavailable(); }
    const statusOnly = exactRecord(raw, ["status"]);
    if (statusOnly?.status === "denied") throw new DeliveryZoneApplicationError("authorization");
    if (statusOnly?.status === "conflict") throw new DeliveryZoneApplicationError("conflict");
    if (statusOnly?.status === "rejected") throw new DeliveryZoneApplicationError("request");
    if (statusOnly !== undefined) throw unavailable();

    const response = exactRecord(raw, ["schemaVersion", "zone", "replayed"]);
    if (response === undefined) throw unavailable();
    const result = parseUpsertDeliveryZoneResultV1(raw);
    if (result === undefined || result.zone.zoneId !== command.zoneId
      || result.zone.restaurantId !== command.scope.restaurantId || result.zone.branchId !== command.scope.branchId
      || result.zone.active !== command.active) throw unavailable();
    return result;
  }

  public async quoteForCapture(principal: AuthenticatedPrincipal, input: unknown): Promise<DeliveryQuoteV1> {
    const command = parseQuoteCommand(input);
    let actorId: string;
    let authorizedScope: BranchScope;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, command.scope, "captures.read");
      actorId = authorized.principal.actorId;
      authorizedScope = authorized.scope;
    } catch { throw new DeliveryZoneApplicationError("authorization"); }

    if (this.captures.readWorkspaceV3 === undefined) throw unavailable();
    const workspaceRequest = parseCaptureWorkspaceRequestV3({
      schemaVersion: 3, scope: command.scope, captureDraftId: command.captureDraftId,
    });
    if (workspaceRequest === undefined) throw new DeliveryZoneApplicationError("request");
    let rawWorkspace: unknown;
    try { rawWorkspace = await this.captures.readWorkspaceV3(actorId, workspaceRequest); } catch { throw unavailable(); }
    const workspaceStatus = exactRecord(rawWorkspace, ["status"]);
    if (workspaceStatus?.status === "denied") throw new DeliveryZoneApplicationError("authorization");
    if (workspaceStatus?.status === "missing") throw new DeliveryZoneApplicationError("missing");
    if (workspaceStatus !== undefined) throw unavailable();
    const workspace = decodeCaptureWorkspaceV3(rawWorkspace, authorizedScope);
    if (workspace.detail.captureDraftId !== command.captureDraftId) throw unavailable();
    if (workspace.fulfillmentSnapshot === null) throw new DeliveryZoneApplicationError("conflict");
    const address = { postalCode: workspace.fulfillmentSnapshot.postalCode, locality: workspace.fulfillmentSnapshot.locality };

    let catalogState;
    try { catalogState = await this.catalogs.read(actorId, authorizedScope); } catch { throw unavailable(); }
    if (catalogState === "forbidden") throw new DeliveryZoneApplicationError("authorization");
    if (catalogState.catalog === null) throw new DeliveryZoneApplicationError("conflict");
    const currency = catalogState.catalog.currency;

    const context = await this.branchContext.select(actorId, authorizedScope);
    if (context === "forbidden") throw new DeliveryZoneApplicationError("authorization");
    const timeZone = context.timeZone;

    let rawZones: unknown;
    try { rawZones = await this.quoteFactsPort.listActiveZonesForQuote(authorizedScope.restaurantId, authorizedScope.branchId); }
    catch { throw unavailable(); }
    const zonesStatus = exactRecord(rawZones, ["status"]);
    if (zonesStatus !== undefined) throw unavailable();
    const zoneFacts = parseActiveQuoteZoneFacts(rawZones, authorizedScope);
    if (zoneFacts === undefined) throw unavailable();

    const zones: DeliveryZone[] = [];
    for (const fact of zoneFacts) {
      try {
        zones.push(createDeliveryZone({
          zoneId: fact.zoneId,
          restaurantId: fact.restaurantId,
          branchId: fact.branchId,
          name: fact.name,
          feeMinor: new Money(fact.feeMinor, fact.currency),
          postalCodes: fact.postalCodes,
          localities: fact.localities,
        }));
      } catch { throw unavailable(); }
    }

    const quotedAt = this.clock.now();
    let quote;
    try {
      quote = quoteDelivery({
        quoteId: command.captureDraftId,
        restaurantId: command.scope.restaurantId,
        branchId: command.scope.branchId,
        captureDraftId: command.captureDraftId,
        addressSnapshotRef: workspace.fulfillmentSnapshot.snapshotRef,
        address,
        zones,
        currency,
        timeZone,
        quotedAt,
        scheduledFor: command.scheduledFor,
        version: 1,
      });
    } catch { throw new DeliveryZoneApplicationError("request"); }

    const result = parseDeliveryQuoteV1({
      schemaVersion: 1,
      quoteId: quote.quoteId,
      restaurantId: quote.restaurantId,
      branchId: quote.branchId,
      captureDraftId: quote.captureDraftId,
      addressSnapshotRef: quote.addressSnapshotRef,
      address,
      currency: quote.currency,
      timeZone: quote.timeZone,
      quotedAt: quote.quotedAt,
      scheduledFor: command.scheduledFor,
      version: quote.version,
      coverageStatus: quote.coverageStatus,
      zoneId: quote.zoneId,
      feeMinor: quote.feeMinor.amountMinor,
      promiseStart: quote.promiseStart,
      promiseEnd: quote.promiseEnd,
      expiresAt: quote.expiresAt,
      override: null,
    });
    if (result === undefined) throw unavailable();
    return result;
  }

  private async fetchZonesForBranch(actorId: string, scope: DeliveryZoneBranchScopeV1): Promise<readonly DeliveryZoneV1[]> {
    let raw: unknown;
    try { raw = await this.listPort.listZones(actorId, scope); } catch { throw unavailable(); }
    const statusOnly = exactRecord(raw, ["status"]);
    if (statusOnly?.status === "denied") throw new DeliveryZoneApplicationError("authorization");
    if (statusOnly?.status === "rejected") throw new DeliveryZoneApplicationError("request");
    if (statusOnly !== undefined) throw unavailable();
    const parsed = parseDeliveryZoneListV1({
      schemaVersion: 1,
      scope: { kind: "branch", restaurantId: scope.restaurantId, branchId: scope.branchId },
      zones: exactRecord(raw, ["schemaVersion", "scope", "zones"])?.zones,
    });
    if (parsed === undefined) throw unavailable();
    return parsed.zones;
  }

  /**
   * The actor's own active branch memberships under `restaurantId` that grant `captures.read` —
   * this is the server-derived evidence for a restaurant-wide listing; it never depends on
   * anything the client sent (the request's `kind` field is not consulted here at all).
   */
  private async authorizedRestaurantBranches(
    principal: AuthenticatedPrincipal,
    restaurantId: string,
  ): Promise<readonly DeliveryZoneBranchScopeV1[]> {
    const memberships = await this.directory.listActiveMemberships(principal);
    const scopes: DeliveryZoneBranchScopeV1[] = [];
    for (const membership of memberships.memberships) {
      if (membership.scope.restaurantId !== restaurantId) continue;
      if (!rolesGrantPermission(membership.roles, "captures.read")) continue;
      scopes.push({ restaurantId: membership.scope.restaurantId, branchId: membership.scope.branchId });
    }
    return Object.freeze(scopes);
  }
}

export function canonicalizeTextArray(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
}

function parseActiveQuoteZoneFacts(raw: unknown, scope: BranchScope): readonly ActiveQuoteZoneFactsV1[] | undefined {
  const envelope = exactRecord(raw, ["schemaVersion", "scope", "zones"]);
  if (envelope === undefined || envelope.schemaVersion !== 1) return undefined;
  const rawZones = envelope.zones;
  if (!Array.isArray(rawZones)) return undefined;
  const zones: ActiveQuoteZoneFactsV1[] = [];
  for (const rawZone of rawZones) {
    const record = exactRecord(rawZone, [
      "zoneId", "restaurantId", "branchId", "name", "postalCodes", "localities", "feeMinor", "currency",
    ]);
    if (record === undefined) return undefined;
    const { zoneId, restaurantId, branchId, name, postalCodes, localities, feeMinor, currency } = record;
    if (typeof zoneId !== "string" || typeof restaurantId !== "string" || typeof branchId !== "string"
      || typeof name !== "string" || !Array.isArray(postalCodes) || !postalCodes.every((value) => typeof value === "string")
      || !Array.isArray(localities) || !localities.every((value) => typeof value === "string")
      || typeof feeMinor !== "number" || !Number.isSafeInteger(feeMinor) || feeMinor < 0
      || typeof currency !== "string" || restaurantId !== scope.restaurantId || branchId !== scope.branchId) {
      return undefined;
    }
    zones.push({
      zoneId, restaurantId, branchId, name,
      postalCodes: Object.freeze([...postalCodes]),
      localities: Object.freeze([...localities]),
      feeMinor, currency,
    });
  }
  return Object.freeze(zones);
}

function parseListQuery(input: unknown): ListDeliveryZonesQueryV1 {
  const query = parseListDeliveryZonesQueryV1(input);
  if (query === undefined) throw new DeliveryZoneApplicationError("request");
  return query;
}
function parseUpsertCommand(input: unknown): UpsertDeliveryZoneCommandV1 {
  const command = parseUpsertDeliveryZoneCommandV1(input);
  if (command === undefined || command.expectedVersion >= Number.MAX_SAFE_INTEGER) {
    throw new DeliveryZoneApplicationError("request");
  }
  return command;
}
function parseQuoteCommand(input: unknown): RequestDeliveryQuoteCommandV1 {
  const command = parseRequestDeliveryQuoteCommandV1(input);
  if (command === undefined) throw new DeliveryZoneApplicationError("request");
  return command;
}
function unavailable(): DeliveryZoneApplicationError { return new DeliveryZoneApplicationError("unavailable"); }
function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || nodeTypes.isProxy(value) || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    const detached: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      detached[key] = descriptor.value;
    }
    return detached;
  } catch { return undefined; }
}
