import {
  parseBranchScope,
  parseMenuCatalogStateV1,
  parseSaveMenuCatalogCommandV1,
  type BranchScope,
  type MenuCatalogStateV1,
  type SaveMenuCatalogCommandV1,
} from "@super-restaurant/shared-types";
import { Money, validateMenuCatalog } from "@super-restaurant/domain";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const readCatalogSql = "select app_private.get_menu_catalog($1::uuid, $2::uuid, $3::uuid) as state";
const saveCatalogSql = `
select status, state
from app_private.save_menu_catalog(
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::timestamptz,
  $8::bigint, $9::uuid, $10::text, $11::jsonb
)
`;

export type MenuCatalogApplicationErrorCode = "authorization" | "conflict" | "request" | "unavailable";

export class MenuCatalogApplicationError extends Error {
  public constructor(public readonly code: MenuCatalogApplicationErrorCode) {
    super(`MENU_CATALOG_${code.toUpperCase()}`);
    this.name = "MenuCatalogApplicationError";
  }
}

export type SaveMenuCatalogResult =
  | Readonly<{ status: "conflict" | "forbidden" }>
  | Readonly<{ state: MenuCatalogStateV1; status: "replayed" | "saved" }>;

export interface MenuCatalogPort {
  read(actorId: string, scope: BranchScope): Promise<MenuCatalogStateV1 | "forbidden">;
  save(actorId: string, command: SaveMenuCatalogCommandV1): Promise<SaveMenuCatalogResult>;
}

export const MENU_CATALOG_PORT = Symbol("MENU_CATALOG_PORT");

@Injectable()
export class PostgresMenuCatalogAdapter implements MenuCatalogPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async read(actorId: string, scope: BranchScope): Promise<MenuCatalogStateV1 | "forbidden"> {
    const result = await this.database.query(readCatalogSql, [actorId, scope.restaurantId, scope.branchId]);
    if (result.rows.length !== 1) throw unavailable();
    const row = exactRecord(result.rows[0], ["state"]);
    if (row === undefined) throw unavailable();
    const rawState = dataProperty(row, "state");
    if (rawState === null) return "forbidden";
    const state = parseMenuCatalogStateV1(rawState);
    if (state === undefined || !sameScope(state.scope, scope)) throw unavailable();
    return state;
  }

  public async save(actorId: string, command: SaveMenuCatalogCommandV1): Promise<SaveMenuCatalogResult> {
    const payload = JSON.stringify({
      categories: command.categories,
      modifierGroups: command.modifierGroups,
      products: command.products,
    });
    const result = await this.database.query(saveCatalogSql, [
      actorId,
      command.scope.restaurantId,
      command.scope.branchId,
      command.eventId,
      command.idempotencyKey,
      command.deviceId,
      command.occurredAt,
      command.expectedVersion,
      command.catalogVersion,
      command.currency,
      payload,
    ]);
    if (result.rows.length !== 1) throw unavailable();
    const row = exactRecord(result.rows[0], ["status", "state"]);
    if (row === undefined) throw unavailable();
    const status = dataProperty(row, "status");
    const rawState = dataProperty(row, "state");
    if (status === "conflict" || status === "forbidden") {
      if (rawState !== null) throw unavailable();
      return Object.freeze({ status });
    }
    if (status !== "saved" && status !== "replayed") throw unavailable();
    const state = parseMenuCatalogStateV1(rawState);
    if (
      state === undefined
      || state.catalog === null
      || !sameScope(state.scope, command.scope)
      || !catalogMatchesCommand(state, command)
      || state.catalog.replayed !== (status === "replayed")
    ) throw unavailable();
    return Object.freeze({ state, status });
  }
}

@Injectable()
export class MenuCatalogService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(MENU_CATALOG_PORT) private readonly catalogs: MenuCatalogPort,
  ) {}

  public async read(principal: AuthenticatedPrincipal, input: unknown): Promise<MenuCatalogStateV1> {
    const scope = parseUuidScope(input);
    if (scope === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, scope, "catalog.read");
    try {
      const result = await this.catalogs.read(actorId, scope);
      if (result === "forbidden") throw applicationError("authorization");
      return result;
    } catch (error: unknown) {
      if (error instanceof MenuCatalogApplicationError) throw error;
      throw unavailable();
    }
  }

  public async save(principal: AuthenticatedPrincipal, input: unknown): Promise<MenuCatalogStateV1> {
    const command = parseSaveMenuCatalogCommandV1(input);
    if (command === undefined || !validDomainCatalog(command)) throw applicationError("request");
    const actorId = await this.authorize(principal, command.scope, "catalog.manage");
    let result: SaveMenuCatalogResult;
    try {
      result = await this.catalogs.save(actorId, command);
    } catch {
      throw unavailable();
    }
    switch (result.status) {
      case "forbidden":
        throw applicationError("authorization");
      case "conflict":
        throw applicationError("conflict");
      case "replayed":
      case "saved":
        return result.state;
    }
  }

  private async authorize(
    principal: AuthenticatedPrincipal,
    scope: BranchScope,
    permission: "catalog.manage" | "catalog.read",
  ): Promise<string> {
    try {
      return (await this.authorization.authorizeBranch(principal, scope, permission)).principal.actorId;
    } catch {
      throw applicationError("authorization");
    }
  }
}

function validDomainCatalog(command: SaveMenuCatalogCommandV1): boolean {
  try {
    validateMenuCatalog({
      catalogVersion: command.catalogVersion,
      categories: command.categories.map((category) => ({
        active: category.active,
        catalogVersion: command.catalogVersion,
        displayOrder: category.displayOrder,
        id: category.categoryId,
        name: category.name,
        restaurantId: command.scope.restaurantId,
      })),
      currency: command.currency,
      modifierGroups: command.modifierGroups.map((group) => ({
        active: group.active,
        catalogVersion: command.catalogVersion,
        id: group.groupId,
        maximumQuantity: group.maximumQuantity,
        minimumQuantity: group.minimumQuantity,
        name: group.name,
        options: group.options.map((option) => ({
          active: option.active,
          id: option.optionId,
          ...(option.maximumQuantity === null ? {} : { maximumQuantity: option.maximumQuantity }),
          name: option.name,
          unitPrice: new Money(option.unitPriceMinor, command.currency),
        })),
        productId: group.productId,
        restaurantId: command.scope.restaurantId,
      })),
      products: command.products.map((product) => ({
        active: product.active,
        catalogVersion: command.catalogVersion,
        categoryId: product.categoryId,
        displayOrder: product.displayOrder,
        id: product.productId,
        modifierGroupIds: command.modifierGroups
          .filter(({ productId }) => productId === product.productId)
          .map(({ groupId }) => groupId),
        name: product.name,
        restaurantId: command.scope.restaurantId,
        ...(product.sku === null ? {} : { sku: product.sku }),
        stationId: product.stationId,
        ...(product.tax === null ? {} : {
          tax: {
            inclusion: product.tax.inclusion,
            name: product.tax.name,
            rate: {
              denominator: BigInt(product.tax.rateDenominator),
              numerator: BigInt(product.tax.rateNumerator),
            },
            taxId: product.tax.taxId,
            taxRuleVersion: product.tax.taxRuleVersion,
          },
        }),
        unit: product.unit,
        unitPrice: new Money(product.unitPriceMinor, command.currency),
      })),
      restaurantId: command.scope.restaurantId,
    });
    return true;
  } catch {
    return false;
  }
}

function catalogMatchesCommand(state: MenuCatalogStateV1, command: SaveMenuCatalogCommandV1): boolean {
  const catalog = state.catalog;
  return catalog !== null
    && catalog.catalogVersion === command.catalogVersion
    && catalog.currency === command.currency
    && JSON.stringify(catalog.categories) === JSON.stringify(command.categories)
    && JSON.stringify(catalog.products) === JSON.stringify(command.products)
    && JSON.stringify(catalog.modifierGroups) === JSON.stringify(command.modifierGroups);
}

function parseUuidScope(value: unknown): BranchScope | undefined {
  const scope = parseBranchScope(value);
  return scope !== undefined && UUID_PATTERN.test(scope.restaurantId) && UUID_PATTERN.test(scope.branchId)
    ? scope
    : undefined;
}

function sameScope(left: BranchScope, right: BranchScope): boolean {
  return left.restaurantId === right.restaurantId && left.branchId === right.branchId;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function dataProperty(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function unavailable(): MenuCatalogApplicationError {
  return applicationError("unavailable");
}

function applicationError(code: MenuCatalogApplicationErrorCode): MenuCatalogApplicationError {
  return new MenuCatalogApplicationError(code);
}
