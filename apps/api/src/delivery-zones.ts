import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { Inject, Injectable } from "@nestjs/common";
import {
  parseDeliveryZoneListV1,
  parseDeliveryZoneMatchRequestV1,
  parseDeliveryZoneMatchResultV1,
  type DeliveryMatchMethodV1,
  type DeliveryMatchReasonCodeV1,
  type DeliveryMatchReasonV1,
  type DeliveryMatchedSettlementV1,
  parseListDeliveryZonesQueryV1,
  parseRequestDeliveryQuoteCommandV1,
  parseSetCaptureDeliveryManualFeeCommandV1,
  parseSetCaptureDeliveryManualFeeResultV1,
  parseSettlementSearchRequestV1,
  parseSettlementSearchResultV1,
  parseUpsertDeliveryZoneCommandV1,
  parseUpsertDeliveryZoneResultV1,
  parseDeliveryQuoteV1,
  parseCaptureWorkspaceRequestV3,
  type BranchScope,
  type CaptureDeliveryManualFeeV1,
  type DeliveryAddressFactsV1,
  type DeliveryZoneBranchScopeV1,
  type DeliveryZoneListV1,
  type DeliveryZoneMatchResultV1,
  type DeliveryZoneV1,
  type DeliveryQuoteOverrideV1,
  type DeliveryQuoteV1,
  type ListDeliveryZonesQueryV1,
  type RequestDeliveryQuoteCommandV1,
  type SetCaptureDeliveryManualFeeCommandV1,
  type SetCaptureDeliveryManualFeeResultV1,
  type SettlementSearchRequestV1,
  type SettlementSearchResultV1,
  type SettlementSummaryV1,
  type UpsertDeliveryZoneCommandV1,
  type UpsertDeliveryZoneResultV1,
  SETTLEMENT_SEARCH_MAX_LIMIT,
} from "@super-restaurant/shared-types";
import {
  applyDeliveryManualFee,
  createDeliveryZone,
  quoteDelivery,
  Money,
  type DeliveryZone,
} from "@super-restaurant/domain";

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
const MAX_REASON_LABEL_LENGTH = 200;
const DELIVERY_MANUAL_FEE_ROLES: readonly string[] = Object.freeze(["owner", "admin", "manager", "supervisor"]);

export interface ActiveQuoteZoneFactsV1 {
  readonly zoneId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly name: string;
  readonly postalCodes: readonly string[];
  readonly localities: readonly string[];
  readonly settlementIds: readonly string[];
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

export interface DeliveryZoneSettlementSearchPort {
  searchSettlements(actorId: string, request: SettlementSearchRequestV1): Promise<unknown>;
}
export const DELIVERY_ZONE_SETTLEMENT_SEARCH_PORT = Symbol("DELIVERY_ZONE_SETTLEMENT_SEARCH_PORT");

export interface DeliveryZoneManualFeePort {
  setManualFee(actorId: string, command: SetCaptureDeliveryManualFeeCommandV1): Promise<unknown>;
  readManualFee(actorId: string, request: ReadManualFeeRequest): Promise<unknown>;
}
export const DELIVERY_ZONE_MANUAL_FEE_PORT = Symbol("DELIVERY_ZONE_MANUAL_FEE_PORT");

export interface ReadManualFeeRequest {
  readonly schemaVersion: 1;
  readonly scope: DeliveryZoneBranchScopeV1;
  readonly captureDraftId: string;
  readonly addressSnapshotRef: string;
}

@Injectable()
export class PostgresDeliveryZoneStore
  implements
    DeliveryZoneListPort,
    DeliveryZoneUpsertPort,
    DeliveryZoneQuoteFactsPort,
    DeliveryZoneSettlementSearchPort,
    DeliveryZoneManualFeePort
{
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

  public async searchSettlements(actorId: string, request: SettlementSearchRequestV1): Promise<unknown> {
    if (!canonicalUuid.test(actorId)) throw new DeliveryZoneApplicationError("request");
    const response = await this.database.query(
      "select app_private.search_settlements($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(request)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async setManualFee(actorId: string, command: SetCaptureDeliveryManualFeeCommandV1): Promise<unknown> {
    if (!canonicalUuid.test(actorId)) throw new DeliveryZoneApplicationError("request");
    const response = await this.database.query(
      "select app_private.set_capture_delivery_manual_fee($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(command)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async readManualFee(actorId: string, request: ReadManualFeeRequest): Promise<unknown> {
    if (!canonicalUuid.test(actorId)) throw new DeliveryZoneApplicationError("request");
    const response = await this.database.query(
      "select app_private.read_capture_delivery_manual_fee($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(request)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }
}

interface AddressResolution {
  readonly settlementId: string | null;
  readonly settlement: DeliveryMatchedSettlementV1 | null;
  readonly matchedBy: DeliveryMatchMethodV1 | null;
  readonly reason: DeliveryMatchReasonCodeV1 | null;
  readonly label: string | null;
}

interface BranchGeography {
  readonly name: string | null;
  readonly locality: string | null;
}

@Injectable()
export class DeliveryZoneService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(MEMBERSHIP_DIRECTORY) private readonly directory: MembershipDirectoryPort,
    @Inject(DELIVERY_ZONE_LIST_PORT) private readonly listPort: DeliveryZoneListPort,
    @Inject(DELIVERY_ZONE_UPSERT_PORT) private readonly upsertPort: DeliveryZoneUpsertPort,
    @Inject(DELIVERY_ZONE_QUOTE_FACTS_PORT) private readonly quoteFactsPort: DeliveryZoneQuoteFactsPort,
    @Inject(DELIVERY_ZONE_SETTLEMENT_SEARCH_PORT) private readonly searchPort: DeliveryZoneSettlementSearchPort,
    @Inject(DELIVERY_ZONE_MANUAL_FEE_PORT) private readonly manualFeePort: DeliveryZoneManualFeePort,
    @Inject(CAPTURE_CREATION_PORT) private readonly captures: CaptureCreationPort,
    @Inject(MENU_CATALOG_PORT) private readonly catalogs: MenuCatalogPort,
    @Inject(BRANCH_OPERATIONAL_CONTEXT_PORT) private readonly branchContext: BranchOperationalContextPort,
    @Inject(SERVER_CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  public async searchSettlements(
    principal: AuthenticatedPrincipal,
    input: unknown,
  ): Promise<SettlementSearchResultV1> {
    const request = parseSettlementSearchRequestV1(input);
    if (request === undefined) throw new DeliveryZoneApplicationError("request");
    let actorId: string;
    let authorizedScope: BranchScope;
    try {
      const authorized = await this.authorizeRead(principal, request.scope);
      actorId = authorized.principal.actorId;
      authorizedScope = authorized.scope;
    } catch { throw new DeliveryZoneApplicationError("authorization"); }
    return this.querySettlements(actorId, authorizedScope, request);
  }

  public async setManualFee(
    principal: AuthenticatedPrincipal,
    input: unknown,
  ): Promise<SetCaptureDeliveryManualFeeResultV1> {
    const command = parseSetCaptureDeliveryManualFeeCommandV1(input);
    if (command === undefined) throw new DeliveryZoneApplicationError("request");
    let actorId: string;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, command.scope, "deliveries.manage");
      // §4.2: only owner/admin/manager/supervisor may fix a manual fee, even though cashier
      // carries `deliveries.manage` for assigning/settling deliveries.
      if (!authorized.roles.some((role) => DELIVERY_MANUAL_FEE_ROLES.includes(role))) {
        throw new DeliveryZoneApplicationError("authorization");
      }
      actorId = authorized.principal.actorId;
    } catch { throw new DeliveryZoneApplicationError("authorization"); }

    let raw: unknown;
    try { raw = await this.manualFeePort.setManualFee(actorId, command); } catch { throw unavailable(); }
    const statusOnly = exactRecord(raw, ["status"]);
    if (statusOnly?.status === "denied") throw new DeliveryZoneApplicationError("authorization");
    if (statusOnly?.status === "conflict") throw new DeliveryZoneApplicationError("conflict");
    if (statusOnly?.status === "rejected") throw new DeliveryZoneApplicationError("request");
    if (statusOnly?.status === "missing") throw new DeliveryZoneApplicationError("missing");
    if (statusOnly !== undefined) throw unavailable();

    const result = parseSetCaptureDeliveryManualFeeResultV1(raw);
    if (result === undefined
      || result.manualFee.captureDraftId !== command.captureDraftId
      || result.manualFee.addressSnapshotRef !== command.addressSnapshotRef) throw unavailable();
    return result;
  }

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
    allZones.sort(compareZoneId);
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
      settlementIds: canonicalizeUuidArray(command.settlementIds),
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
    const snapshot = workspace.fulfillmentSnapshot;
    const facts: DeliveryAddressFactsV1 = {
      settlementId: null,
      neighborhood: snapshot.neighborhood,
      postalCode: snapshot.postalCode,
      locality: snapshot.locality,
    };

    let catalogState;
    try { catalogState = await this.catalogs.read(actorId, authorizedScope); } catch { throw unavailable(); }
    if (catalogState === "forbidden") throw new DeliveryZoneApplicationError("authorization");
    if (catalogState.catalog === null) throw new DeliveryZoneApplicationError("conflict");
    const currency = catalogState.catalog.currency;

    const context = await this.branchContext.select(actorId, authorizedScope);
    if (context === "forbidden") throw new DeliveryZoneApplicationError("authorization");
    const timeZone = context.timeZone;

    const resolution = await this.resolveAddress(actorId, authorizedScope, facts);
    const zones = await this.fetchZoneFacts(actorId, authorizedScope);
    const quotedAt = this.clock.now();

    let quote;
    try {
      quote = quoteDelivery({
        // Placeholder: quoteDelivery only requires quoteId to be non-empty text and never reads
        // it back to derive coverage/fee/window, so the real, fact-derived id is computed below.
        quoteId: command.captureDraftId,
        restaurantId: command.scope.restaurantId,
        branchId: command.scope.branchId,
        captureDraftId: command.captureDraftId,
        addressSnapshotRef: snapshot.snapshotRef,
        address: {
          settlementId: resolution.settlementId,
          neighborhood: facts.neighborhood ?? null,
          postalCode: resolution.matchedBy === "postal_code" ? facts.postalCode ?? null : null,
          locality: facts.locality ?? null,
        },
        zones,
        currency,
        timeZone,
        quotedAt,
        scheduledFor: command.scheduledFor,
        version: 1,
      });
    } catch { throw new DeliveryZoneApplicationError("request"); }

    // A live manual-fee authorization overrides the (zero) not-covered zone fee; the binding
    // check happens again in SQL at confirmation.
    let override: DeliveryQuoteOverrideV1 | null = null;
    if (quote.coverageStatus === "not_covered") {
      const manualFee = await this.readManualFee(actorId, command.scope, command.captureDraftId, snapshot.snapshotRef);
      if (manualFee !== null) {
        if (manualFee.currency !== quote.currency) throw unavailable();
        try {
          quote = applyDeliveryManualFee(quote, {
            eventId: manualFee.eventId,
            actorId: manualFee.actorId,
            role: manualFee.role,
            reason: manualFee.reason,
            feeMinor: new Money(manualFee.feeMinor, manualFee.currency),
            overriddenAt: manualFee.authorizedAt,
          });
        } catch { throw unavailable(); }
        const authorized = quote.override;
        if (authorized === null) throw unavailable();
        override = Object.freeze({
          kind: "manual_fee",
          eventId: authorized.eventId,
          actorId: authorized.actorId,
          role: authorized.role,
          reason: authorized.reason,
          feeMinor: authorized.feeMinor.amountMinor,
          promiseStart: authorized.promiseStart,
          promiseEnd: authorized.promiseEnd,
          overriddenAt: authorized.overriddenAt,
        });
      }
    }

    // Deterministic, fact-derived quoteId (never Math.random/uuid-v4): every frozen fact the
    // quote carries goes into the hash, including the manual-fee authorization when present.
    const quoteId = deterministicQuoteId([
      command.captureDraftId,
      snapshot.snapshotRef,
      command.scheduledFor,
      quote.quotedAt,
      quote.coverageStatus,
      quote.zoneId,
      quote.feeMinor.amountMinor,
      quote.currency,
      quote.timeZone,
      quote.promiseStart,
      quote.promiseEnd,
      quote.expiresAt,
      override?.eventId ?? null,
      override?.feeMinor ?? null,
      override?.role ?? null,
      override?.actorId ?? null,
      override?.reason ?? null,
      override?.overriddenAt ?? null,
    ]);

    const result = parseDeliveryQuoteV1({
      schemaVersion: 1,
      quoteId,
      restaurantId: quote.restaurantId,
      branchId: quote.branchId,
      captureDraftId: quote.captureDraftId,
      addressSnapshotRef: quote.addressSnapshotRef,
      address: {
        settlementId: resolution.settlementId,
        neighborhood: facts.neighborhood ?? null,
        postalCode: facts.postalCode ?? null,
        locality: facts.locality ?? null,
      },
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
      override,
    });
    if (result === undefined) throw unavailable();
    return result;
  }

  /**
   * Read-only coverage check for an address: zone, fee and ASAP promise window. Persists nothing
   * and never touches capture_delivery_quotes; the binding quote remains `quoteForCapture`.
   * Either `captures.read` (capture screen) or `customers.read` (customer screen) authorizes it.
   */
  public async matchAddress(principal: AuthenticatedPrincipal, input: unknown): Promise<DeliveryZoneMatchResultV1> {
    const request = parseDeliveryZoneMatchRequestV1(input);
    if (request === undefined) throw new DeliveryZoneApplicationError("request");
    const requestedScope: DeliveryZoneBranchScopeV1 = { restaurantId: request.restaurantId, branchId: request.branchId };
    let actorId: string;
    let authorizedScope: BranchScope;
    try {
      const authorized = await this.authorizeRead(principal, requestedScope);
      actorId = authorized.principal.actorId;
      authorizedScope = authorized.scope;
    } catch { throw new DeliveryZoneApplicationError("authorization"); }

    let catalogState;
    try { catalogState = await this.catalogs.read(actorId, authorizedScope); } catch { throw unavailable(); }
    if (catalogState === "forbidden") throw new DeliveryZoneApplicationError("authorization");
    if (catalogState.catalog === null) throw new DeliveryZoneApplicationError("conflict");
    const currency = catalogState.catalog.currency;

    const context = await this.branchContext.select(actorId, authorizedScope);
    if (context === "forbidden") throw new DeliveryZoneApplicationError("authorization");
    const geography: BranchGeography = {
      name: context.branchName ?? null,
      locality: context.locality ?? null,
    };

    const zones = await this.fetchZoneFacts(actorId, authorizedScope);
    const facts = request.address;
    const resolution = await this.resolveAddress(actorId, authorizedScope, facts);
    const evaluatedAt = this.clock.now();

    let quote;
    try {
      quote = quoteDelivery({
        quoteId: "match", restaurantId: authorizedScope.restaurantId, branchId: authorizedScope.branchId,
        captureDraftId: "match", addressSnapshotRef: "match",
        address: {
          settlementId: resolution.settlementId,
          neighborhood: facts.neighborhood ?? null,
          postalCode: resolution.matchedBy === "postal_code" ? facts.postalCode ?? null : null,
          locality: facts.locality ?? null,
        },
        zones,
        currency, timeZone: context.timeZone, quotedAt: evaluatedAt, scheduledFor: null, version: 1,
      });
    } catch { throw unavailable(); }
    const matched = quote.zoneId === null ? undefined : zones.find((zone) => zone.zoneId === quote.zoneId);

    let reason: DeliveryMatchReasonV1 | null = null;
    let matchedBy: DeliveryMatchMethodV1 | null = resolution.matchedBy;
    let settlement: DeliveryMatchedSettlementV1 | null = resolution.settlement;
    if (quote.coverageStatus === "covered") {
      if (resolution.matchedBy === "postal_code") {
        reason = matchReason("legacy_postal_code_match", null, geography);
      }
    } else {
      matchedBy = null;
      settlement = null;
      reason = matchReason(
        resolution.reason ?? "settlement_not_in_zone",
        resolution.label ?? resolution.settlement?.name ?? facts.neighborhood ?? facts.postalCode ?? null,
        geography,
      );
    }

    const result = parseDeliveryZoneMatchResultV1({
      schemaVersion: 1,
      coverageStatus: quote.coverageStatus,
      zoneId: quote.zoneId,
      zoneName: matched?.name ?? null,
      feeMinor: quote.feeMinor.amountMinor,
      currency: quote.currency,
      promiseMinutes: (new Date(quote.promiseEnd).getTime() - new Date(quote.promiseStart).getTime()) / 60_000,
      promiseStart: quote.promiseStart,
      promiseEnd: quote.promiseEnd,
      evaluatedAt,
      reason,
      matchedBy,
      settlement,
    });
    if (result === undefined) throw unavailable();
    return result;
  }

  private async authorizeRead(
    principal: AuthenticatedPrincipal,
    requestedScope: unknown,
  ): Promise<{ principal: { actorId: string }; scope: BranchScope }> {
    try {
      return await this.authorization.authorizeBranch(principal, requestedScope, "captures.read");
    } catch {
      return await this.authorization.authorizeBranch(principal, requestedScope, "customers.read");
    }
  }

  private async querySettlements(
    actorId: string,
    scope: BranchScope,
    request: SettlementSearchRequestV1,
  ): Promise<SettlementSearchResultV1> {
    let raw: unknown;
    try { raw = await this.searchPort.searchSettlements(actorId, request); } catch { throw unavailable(); }
    const statusOnly = exactRecord(raw, ["status"]);
    if (statusOnly?.status === "denied") throw new DeliveryZoneApplicationError("authorization");
    if (statusOnly?.status === "rejected") throw new DeliveryZoneApplicationError("request");
    if (statusOnly !== undefined) throw unavailable();
    const parsed = parseSettlementSearchResultV1(raw);
    if (parsed === undefined || parsed.scope.restaurantId !== scope.restaurantId
      || parsed.scope.branchId !== scope.branchId) throw unavailable();
    return parsed;
  }

  private async resolveAddress(
    actorId: string,
    scope: BranchScope,
    facts: DeliveryAddressFactsV1,
  ): Promise<AddressResolution> {
    if (facts.settlementOutsideCatalog === true) {
      return resolution(null, null, null, "settlement_outside_catalog", facts.neighborhood ?? null);
    }
    if (facts.settlementId !== null && facts.settlementId !== undefined) {
      const details = await this.lookupSettlement(actorId, scope, facts);
      if (details !== null && details.settlementId === facts.settlementId) {
        return resolution(details.settlementId, details, "settlement", null, details.name ?? facts.neighborhood ?? null);
      }
      // A caller-supplied settlementId that the branch catalog cannot confirm must never be echoed
      // back into the quote: doing so would let a client drive zone matching with an unverified id.
      // Report it as unknown (with no settlementId) so coverage stays uncovered and the UI asks the
      // operator to pick a confirmed settlement.
      return resolution(null, null, null, "settlement_unknown", facts.neighborhood ?? null);
    }
    if (facts.neighborhood !== null && facts.neighborhood !== undefined) {
      const normalized = normalizeSettlementName(facts.neighborhood);
      if (normalized.length < 2 || normalized.length > 40) {
        return resolution(null, null, null, "settlement_unknown", facts.neighborhood);
      }
      const searched = await this.querySettlements(actorId, scope, {
        schemaVersion: 1,
        scope: { restaurantId: scope.restaurantId, branchId: scope.branchId },
        query: normalized,
        postalCode: null,
        limit: SETTLEMENT_SEARCH_MAX_LIMIT,
      });
      let candidates = searched.settlements.filter((settlement) => normalizeSettlementName(settlement.name) === normalized);
      if (candidates.length === 0) {
        return resolution(null, null, null, "settlement_unknown", facts.neighborhood);
      }
      if (candidates.length > 1 && facts.postalCode !== null && facts.postalCode !== undefined) {
        candidates = candidates.filter((settlement) => settlement.postalCode === facts.postalCode);
      }
      if (candidates.length !== 1) {
        return resolution(null, null, null, "settlement_ambiguous", facts.neighborhood);
      }
      const match = candidates[0] as SettlementSummaryV1;
      return resolution(match.settlementId, toMatchedSettlement(match), "settlement", null, match.name);
    }
    if (facts.postalCode !== null && facts.postalCode !== undefined) {
      return resolution(null, null, "postal_code", null, facts.postalCode);
    }
    return resolution(null, null, null, "settlement_missing", null);
  }

  private async lookupSettlement(
    actorId: string,
    scope: BranchScope,
    facts: DeliveryAddressFactsV1,
  ): Promise<DeliveryMatchedSettlementV1 | null> {
    if (facts.postalCode !== null && facts.postalCode !== undefined) {
      const byPostalCode = await this.querySettlements(actorId, scope, {
        schemaVersion: 1,
        scope: { restaurantId: scope.restaurantId, branchId: scope.branchId },
        query: null,
        postalCode: facts.postalCode,
        limit: SETTLEMENT_SEARCH_MAX_LIMIT,
      });
      const match = byPostalCode.settlements.find((settlement) => settlement.settlementId === facts.settlementId);
      return match === undefined ? null : toMatchedSettlement(match);
    }
    if (facts.neighborhood !== null && facts.neighborhood !== undefined) {
      const normalized = normalizeSettlementName(facts.neighborhood);
      if (normalized.length < 2 || normalized.length > 40) return null;
      const byName = await this.querySettlements(actorId, scope, {
        schemaVersion: 1,
        scope: { restaurantId: scope.restaurantId, branchId: scope.branchId },
        query: normalized,
        postalCode: null,
        limit: SETTLEMENT_SEARCH_MAX_LIMIT,
      });
      const match = byName.settlements.find((settlement) =>
        settlement.settlementId === facts.settlementId && normalizeSettlementName(settlement.name) === normalized);
      return match === undefined ? null : toMatchedSettlement(match);
    }
    return null;
  }

  private async readManualFee(
    actorId: string,
    scope: DeliveryZoneBranchScopeV1,
    captureDraftId: string,
    addressSnapshotRef: string,
  ): Promise<CaptureDeliveryManualFeeV1 | null> {
    const request: ReadManualFeeRequest = {
      schemaVersion: 1,
      scope: { restaurantId: scope.restaurantId, branchId: scope.branchId },
      captureDraftId,
      addressSnapshotRef,
    };
    let raw: unknown;
    try { raw = await this.manualFeePort.readManualFee(actorId, request); } catch { throw unavailable(); }
    const statusOnly = exactRecord(raw, ["status"]);
    if (statusOnly?.status === "denied") throw new DeliveryZoneApplicationError("authorization");
    if (statusOnly?.status === "rejected") throw new DeliveryZoneApplicationError("request");
    if (statusOnly?.status === "missing") throw new DeliveryZoneApplicationError("missing");
    if (statusOnly !== undefined) throw unavailable();
    const envelope = exactRecord(raw, ["schemaVersion", "scope", "manualFee"]);
    if (envelope === undefined || envelope.schemaVersion !== 1) throw unavailable();
    const envelopeScope = envelope.scope;
    if (typeof envelopeScope !== "object" || envelopeScope === null) throw unavailable();
    if ((envelopeScope as Record<string, unknown>).restaurantId !== scope.restaurantId
      || (envelopeScope as Record<string, unknown>).branchId !== scope.branchId) throw unavailable();
    if (envelope.manualFee === null) return null;
    const parsed = parseSetCaptureDeliveryManualFeeResultV1({
      schemaVersion: 1,
      manualFee: envelope.manualFee,
      replayed: false,
    });
    if (parsed === undefined || parsed.manualFee.captureDraftId !== captureDraftId
      || parsed.manualFee.addressSnapshotRef !== addressSnapshotRef) throw unavailable();
    return parsed.manualFee;
  }

  private async fetchZoneFacts(actorId: string, scope: BranchScope): Promise<readonly DeliveryZone[]> {
    let rawZones: unknown;
    try { rawZones = await this.quoteFactsPort.listActiveZonesForQuote(scope.restaurantId, scope.branchId); }
    catch { throw unavailable(); }
    if (exactRecord(rawZones, ["status"]) !== undefined) throw unavailable();
    const zoneFacts = parseActiveQuoteZoneFacts(rawZones, scope);
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
          settlementIds: fact.settlementIds,
        }));
      } catch { throw unavailable(); }
    }
    return zones;
  }

  private async fetchZonesForBranch(actorId: string, scope: DeliveryZoneBranchScopeV1): Promise<readonly DeliveryZoneV1[]> {
    let raw: unknown;
    try { raw = await this.listPort.listZones(actorId, scope); } catch { throw unavailable(); }
    const statusOnly = exactRecord(raw, ["status"]);
    if (statusOnly?.status === "denied") throw new DeliveryZoneApplicationError("authorization");
    if (statusOnly?.status === "rejected") throw new DeliveryZoneApplicationError("request");
    if (statusOnly !== undefined) throw unavailable();
    // app_private.list_delivery_zones orders its rows by (name, id) for a human-friendly listing,
    // not by zoneId — but parseDeliveryZoneListV1 requires zones strictly ascending by zoneId, so
    // the SQL order can never be handed to the parser as-is. Sort by zoneId first, the same as
    // the restaurant-wide aggregation path below already does after merging multiple branches.
    const rawZones = exactRecord(raw, ["schemaVersion", "scope", "zones"])?.zones;
    const sortedZones = Array.isArray(rawZones) ? [...rawZones].sort(compareZoneId) : rawZones;
    const parsed = parseDeliveryZoneListV1({
      schemaVersion: 1,
      scope: { kind: "branch", restaurantId: scope.restaurantId, branchId: scope.branchId },
      zones: sortedZones,
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

function resolution(
  settlementId: string | null,
  settlement: DeliveryMatchedSettlementV1 | null,
  matchedBy: DeliveryMatchMethodV1 | null,
  reason: DeliveryMatchReasonCodeV1 | null,
  label: string | null,
): AddressResolution {
  return Object.freeze({ settlementId, settlement, matchedBy, reason, label });
}

function toMatchedSettlement(settlement: SettlementSummaryV1): DeliveryMatchedSettlementV1 {
  return Object.freeze({
    settlementId: settlement.settlementId,
    name: settlement.name,
    postalCode: settlement.postalCode,
  });
}

/** Mirrors tools/sepomex/normalize-settlements.mjs and app_private.normalize_settlement_name. */
export function normalizeSettlementName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function matchReason(
  code: DeliveryMatchReasonCodeV1,
  label: string | null,
  geography: BranchGeography,
): DeliveryMatchReasonV1 {
  const name = sanitizeLabel(label);
  const locality = geography.locality === null ? null : sanitizeLabel(geography.locality);
  const branch = geography.name === null ? null : sanitizeLabel(geography.name);
  let message: string;
  switch (code) {
    case "settlement_missing":
      message = "Falta la colonia.";
      break;
    case "settlement_unknown":
      message = locality === null
        ? "Colonia no reconocida en el catálogo de la sucursal."
        : `Colonia no reconocida en ${locality}.`;
      break;
    case "settlement_ambiguous":
      message = locality === null
        ? `La colonia ${name ?? "seleccionada"} coincide con varias colonias del catálogo. Elige una del catálogo.`
        : `La colonia ${name ?? "seleccionada"} coincide con varias colonias de ${locality}. Elige una del catálogo.`;
      break;
    case "settlement_not_in_zone":
      message = branch === null
        ? `La colonia ${name ?? "seleccionada"} no está en ninguna zona de la sucursal.`
        : `La colonia ${name ?? "seleccionada"} no está en ninguna zona de la sucursal ${branch}.`;
      break;
    case "settlement_outside_catalog":
      message = locality === null
        ? `La colonia ${name ?? "seleccionada"} no está en el catálogo de la sucursal. El envío requiere cuota manual de un supervisor.`
        : `La colonia ${name ?? "seleccionada"} no está en el catálogo de ${locality}. El envío requiere cuota manual de un supervisor.`;
      break;
    case "legacy_postal_code_match":
      message = "No se reconoció la colonia; se usó el código postal como respaldo. Actualiza la dirección.";
      break;
  }
  return Object.freeze({ code, message });
}

function sanitizeLabel(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > MAX_REASON_LABEL_LENGTH ? cleaned.slice(0, MAX_REASON_LABEL_LENGTH).trim() : cleaned;
}

/**
 * Deterministic, name-based id (sha-256 over the given facts, reshaped into the canonical
 * UUID format the rest of the codebase expects) — never `Math.random`/`crypto.randomUUID()`.
 * Identical facts always produce the identical id; any differing fact produces a different one.
 */
export function deterministicQuoteId(facts: readonly (string | number | null)[]): string {
  const hash = createHash("sha256").update(facts.map((fact) => String(fact)).join("\u0000")).digest("hex");
  const variantNibble = ((parseInt(hash[16] as string, 16) & 0x3) | 0x8).toString(16);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `${variantNibble}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

function compareZoneId(left: unknown, right: unknown): number {
  const leftId = zoneIdOf(left);
  const rightId = zoneIdOf(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}
function zoneIdOf(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  const zoneId = (value as Record<string, unknown>).zoneId;
  return typeof zoneId === "string" ? zoneId : "";
}

export function canonicalizeTextArray(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
}

export function canonicalizeUuidArray(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
}

function parseActiveQuoteZoneFacts(raw: unknown, scope: BranchScope): readonly ActiveQuoteZoneFactsV1[] | undefined {
  const envelope = exactRecord(raw, ["schemaVersion", "scope", "zones"]);
  if (envelope === undefined || envelope.schemaVersion !== 1) return undefined;
  const rawZones = envelope.zones;
  if (!Array.isArray(rawZones)) return undefined;
  const zones: ActiveQuoteZoneFactsV1[] = [];
  for (const rawZone of rawZones) {
    const extended = exactRecord(rawZone, [
      "zoneId", "restaurantId", "branchId", "name", "postalCodes", "localities", "settlementIds", "feeMinor", "currency",
    ]);
    const legacy = extended === undefined ? exactRecord(rawZone, [
      "zoneId", "restaurantId", "branchId", "name", "postalCodes", "localities", "feeMinor", "currency",
    ]) : undefined;
    const record = extended ?? legacy;
    if (record === undefined) return undefined;
    const { zoneId, restaurantId, branchId, name, postalCodes, localities, feeMinor, currency } = record;
    const settlementIds = extended === undefined ? [] : record.settlementIds;
    if (typeof zoneId !== "string" || typeof restaurantId !== "string" || typeof branchId !== "string"
      || typeof name !== "string" || !Array.isArray(postalCodes) || !postalCodes.every((value) => typeof value === "string")
      || !Array.isArray(localities) || !localities.every((value) => typeof value === "string")
      || !Array.isArray(settlementIds) || !settlementIds.every((value) => typeof value === "string")
      || typeof feeMinor !== "number" || !Number.isSafeInteger(feeMinor) || feeMinor < 0
      || typeof currency !== "string" || restaurantId !== scope.restaurantId || branchId !== scope.branchId) {
      return undefined;
    }
    zones.push({
      zoneId, restaurantId, branchId, name,
      postalCodes: Object.freeze([...postalCodes]),
      localities: Object.freeze([...localities]),
      settlementIds: Object.freeze([...(settlementIds as string[])]),
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
