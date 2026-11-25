import {
  parsePublishRecipeCommandV1,
  parseRecipeLineV1,
  parseRecipeVersionV1,
  type BranchMembershipListV1,
  type RecipeLineV1,
  type RecipeVersionV1,
} from "@super-restaurant/shared-types";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "../auth/authentication.js";
import { MEMBERSHIP_DIRECTORY, type MembershipDirectoryPort } from "../auth/membership-directory.js";
import { rolesGrantPermission } from "../auth/rbac-policy.js";
import {
  DATABASE_CLIENT,
  type DatabaseClientPort,
  type DatabaseQueryResult,
  type TransactionalDatabaseClientPort,
} from "../database.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const publishSql = "select app_private.publish_inventory_recipe($1::uuid,$2::uuid,$3::jsonb) as result";
const listRecipesSql =
  "select * from app_private.list_inventory_recipes($1::uuid,$2::uuid,$3::uuid,$4::boolean)";
const readRecipeSql = "select * from app_private.read_inventory_recipe($1::uuid,$2::uuid,$3::uuid)";

const LIST_QUERY_KEYS = Object.freeze(["restaurantId", "productId", "includeInactive"] as const);
const READ_QUERY_KEYS = Object.freeze(["restaurantId"] as const);

export type RecipeApplicationErrorCode = "request" | "authorization" | "conflict" | "missing" | "unavailable";

export class RecipeApplicationError extends Error {
  public constructor(public readonly code: RecipeApplicationErrorCode) {
    super(`INVENTORY_RECIPE_${code.toUpperCase()}`);
    this.name = "RecipeApplicationError";
  }
}

export interface RecipeVersionSummaryV1 {
  readonly recipeId: string;
  readonly restaurantId: string;
  readonly productId: string;
  readonly modifierId: string | null;
  readonly version: number;
  readonly active: boolean;
  readonly notes: string | null;
  readonly createdAt: string;
}

export interface RecipeVersionListV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly productId: string;
  readonly recipes: readonly RecipeVersionSummaryV1[];
}

@Injectable()
export class RecipesService {
  public constructor(
    @Inject(MEMBERSHIP_DIRECTORY) private readonly directory: MembershipDirectoryPort,
    @Inject(DATABASE_CLIENT) private readonly database: TransactionalDatabaseClientPort,
  ) {}

  public async publishRecipe(principal: AuthenticatedPrincipal, input: unknown): Promise<RecipeVersionV1> {
    const command = parsePublishRecipeCommandV1(input);
    if (command === undefined) throw requestError();
    await this.authorizeRestaurant(principal, command.restaurantId, "catalog.manage");

    const payload = JSON.stringify({
      productId: command.productId,
      modifierId: command.modifierId,
      notes: command.notes,
      lines: command.lines,
    });
    const rows = await this.rows((database) => database.query(publishSql, [
      principal.actorId,
      command.restaurantId,
      payload,
    ]));
    if (rows.length !== 1) throw unavailable();
    const published = toPublished(rows[0]);
    if (published === undefined) throw unavailable();

    const version = await this.readRecipe(principal, command.restaurantId, published.recipeId);
    if (version === undefined || version.version !== published.version) throw unavailable();
    return version;
  }

  public async listRecipes(principal: AuthenticatedPrincipal, input: unknown): Promise<RecipeVersionListV1> {
    const query = parseListQuery(input);
    if (query === undefined) throw requestError();
    await this.authorizeRestaurant(principal, query.restaurantId, "catalog.read");

    const rows = await this.rows((database) => database.query(listRecipesSql, [
      principal.actorId,
      query.restaurantId,
      query.productId,
      query.includeInactive,
    ]));
    const recipes: RecipeVersionSummaryV1[] = [];
    for (const row of rows) {
      const recipe = toSummary(row);
      if (recipe === undefined) throw unavailable();
      recipes.push(recipe);
    }
    return Object.freeze({
      schemaVersion: 1,
      restaurantId: query.restaurantId,
      productId: query.productId,
      recipes: Object.freeze(recipes),
    });
  }

  public async readRecipeById(
    principal: AuthenticatedPrincipal,
    id: unknown,
    input: unknown,
  ): Promise<RecipeVersionV1> {
    const recipeId = parseId(id);
    const query = parseReadQuery(input);
    if (recipeId === undefined || query === undefined) throw requestError();
    await this.authorizeRestaurant(principal, query.restaurantId, "catalog.read");

    const version = await this.readRecipe(principal, query.restaurantId, recipeId);
    if (version === undefined) throw new RecipeApplicationError("missing");
    return version;
  }

  private async readRecipe(
    principal: AuthenticatedPrincipal,
    restaurantId: string,
    recipeId: string,
  ): Promise<RecipeVersionV1 | undefined> {
    const rows = await this.rows((database) => database.query(readRecipeSql, [
      principal.actorId,
      restaurantId,
      recipeId,
    ]));
    if (rows.length === 0) return undefined;

    const header = plainRecord(rows[0]);
    if (header === undefined) throw unavailable();
    const headerRecipeId = ownValue(header, "recipe_id");
    const headerRestaurantId = ownValue(header, "restaurant_id");
    const headerProductId = ownValue(header, "product_id");
    const headerVersion = ownValue(header, "version");

    const lines: RecipeLineV1[] = [];
    for (const row of rows) {
      const record = plainRecord(row);
      if (record === undefined) throw unavailable();
      if (ownValue(record, "recipe_id") !== headerRecipeId
        || ownValue(record, "restaurant_id") !== headerRestaurantId
        || ownValue(record, "product_id") !== headerProductId
        || ownValue(record, "version") !== headerVersion) {
        throw unavailable();
      }
      const line = parseRecipeLineV1({
        itemId: ownValue(record, "item_id"),
        quantity: ownValue(record, "quantity"),
        unitCode: ownValue(record, "unit_code"),
      });
      if (line === undefined) throw unavailable();
      lines.push(line);
    }

    return parseRecipeVersionV1({
      restaurantId: headerRestaurantId,
      recipeId: headerRecipeId,
      productId: headerProductId,
      version: headerVersion,
      lines,
    });
  }

  private async authorizeRestaurant(
    principal: AuthenticatedPrincipal,
    restaurantId: string,
    permission: "catalog.read" | "catalog.manage",
  ): Promise<void> {
    let memberships: BranchMembershipListV1;
    try {
      memberships = await this.directory.listActiveMemberships(principal);
    } catch {
      throw unavailable();
    }
    const granted = memberships.memberships.some((membership) =>
      membership.scope.restaurantId === restaurantId
      && rolesGrantPermission(membership.roles, permission));
    if (!granted) throw new RecipeApplicationError("authorization");
  }

  private async rows(
    action: (database: DatabaseClientPort) => Promise<DatabaseQueryResult>,
  ): Promise<readonly unknown[]> {
    try {
      return await this.database.transaction(async (database) => {
        const result = await action(database);
        return result.rows;
      });
    } catch (error: unknown) {
      if (error instanceof RecipeApplicationError) throw error;
      const state = sqlState(error);
      if (state === "23503") throw new RecipeApplicationError("conflict");
      if (state === "22000" || state === "23514") throw new RecipeApplicationError("request");
      if (state === "42501") throw new RecipeApplicationError("authorization");
      throw unavailable();
    }
  }
}

function parseListQuery(
  input: unknown,
): { restaurantId: string; productId: string; includeInactive: boolean } | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, LIST_QUERY_KEYS)) return undefined;
  const restaurantId = uuidValue(record, "restaurantId");
  const productId = uuidValue(record, "productId");
  if (restaurantId === undefined || productId === undefined) return undefined;

  const includeInactive = Object.hasOwn(record, "includeInactive")
    ? parseBoolean(ownValue(record, "includeInactive"))
    : false;
  if (includeInactive === undefined) return undefined;

  return { restaurantId, productId, includeInactive };
}

function parseReadQuery(input: unknown): { restaurantId: string } | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, READ_QUERY_KEYS)) return undefined;
  const restaurantId = uuidValue(record, "restaurantId");
  return restaurantId === undefined ? undefined : { restaurantId };
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseId(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

function uuidValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = ownValue(record, key);
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

function toPublished(row: unknown): { recipeId: string; version: number } | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  const result = plainRecord(ownValue(record, "result"));
  if (result === undefined) return undefined;
  const recipeId = ownValue(result, "recipeId");
  const version = ownValue(result, "version");
  if (typeof recipeId !== "string" || !UUID_PATTERN.test(recipeId)) return undefined;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) return undefined;
  return Object.freeze({ recipeId, version });
}

function toSummary(row: unknown): RecipeVersionSummaryV1 | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  const recipeId = ownValue(record, "recipe_id");
  const restaurantId = ownValue(record, "restaurant_id");
  const productId = ownValue(record, "product_id");
  const modifierId = ownValue(record, "modifier_id");
  const version = ownValue(record, "version");
  const active = ownValue(record, "active");
  const notes = ownValue(record, "notes");
  const createdAt = timestampText(ownValue(record, "created_at"));

  if (typeof recipeId !== "string" || !UUID_PATTERN.test(recipeId)) return undefined;
  if (typeof restaurantId !== "string" || !UUID_PATTERN.test(restaurantId)) return undefined;
  if (typeof productId !== "string" || !UUID_PATTERN.test(productId)) return undefined;
  if (!(modifierId === null || (typeof modifierId === "string" && UUID_PATTERN.test(modifierId)))) return undefined;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) return undefined;
  if (typeof active !== "boolean") return undefined;
  if (!(notes === null || typeof notes === "string")) return undefined;
  if (typeof createdAt !== "string" || createdAt.length === 0) return undefined;

  return Object.freeze({ recipeId, restaurantId, productId, modifierId, version, active, notes, createdAt });
}

function timestampText(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  try {
    return Reflect.ownKeys(record).every((key) => typeof key === "string" && allowedKeys.includes(key));
  } catch {
    return false;
  }
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function requestError(): RecipeApplicationError {
  return new RecipeApplicationError("request");
}

function unavailable(): RecipeApplicationError {
  return new RecipeApplicationError("unavailable");
}
