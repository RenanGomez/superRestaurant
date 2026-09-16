import { types as nodeTypes } from "node:util";
import { Inject, Injectable } from "@nestjs/common";
import {
  parseSaveCustomerProfileCommandV1,
  parseSaveCustomerAddressCommandV1,
  parseValidateCustomerAddressCommandV1,
  parseCustomerProfileRecordV1,
  parseCustomerAddressRecordV1,
  parseCustomerProfileMutationResultV1,
  parseCustomerAddressMutationResultV1,
  parseSearchCustomerDirectoryQueryV1,
  parseCustomerDirectorySearchResultV1,
  type SaveCustomerProfileCommandV1,
  type SaveCustomerAddressCommandV1,
  type ValidateCustomerAddressCommandV1,
  type CustomerProfileMutationResultV1,
  type CustomerAddressMutationResultV1,
  type SearchCustomerDirectoryQueryV1,
  type CustomerDirectorySearchResultV1,
  type RbacPermissionCode,
} from "@super-restaurant/shared-types";
import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

export type CustomerDirectoryApplicationErrorCode = "request" | "authorization" | "conflict" | "unavailable";
export class CustomerDirectoryApplicationError extends Error {
  public constructor(public readonly code: CustomerDirectoryApplicationErrorCode) {
    super(`CUSTOMER_DIRECTORY_${code.toUpperCase()}`);
    this.name = "CustomerDirectoryApplicationError";
  }
}
export interface CustomerDirectoryWriterPort {
  saveProfile(actorId: string, command: SaveCustomerProfileCommandV1): Promise<unknown>;
  saveAddress(actorId: string, command: SaveCustomerAddressCommandV1): Promise<unknown>;
  validateAddress(actorId: string, command: ValidateCustomerAddressCommandV1): Promise<unknown>;
}
export const CUSTOMER_DIRECTORY_WRITER_PORT = Symbol("CUSTOMER_DIRECTORY_WRITER_PORT");
export interface CustomerDirectoryReaderPort {
  search(actorId: string, query: SearchCustomerDirectoryQueryV1): Promise<unknown>;
}
export const CUSTOMER_DIRECTORY_READER_PORT = Symbol("CUSTOMER_DIRECTORY_READER_PORT");

@Injectable()
export class PostgresCustomerDirectoryReader implements CustomerDirectoryReaderPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}
  public async search(actorId: string, input: SearchCustomerDirectoryQueryV1): Promise<unknown> {
    const query = parseSearchCustomerDirectoryQueryV1(input);
    if (query === undefined || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(actorId)) throw request();
    const response = await this.database.query(
      "select app_private.search_customer_directory($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(query)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exact(response.rows[0]);
    if (row === undefined || Reflect.ownKeys(row).length !== 1 || !Reflect.ownKeys(row).includes("result")) throw unavailable();
    return own(row, "result");
  }
}

@Injectable()
export class PostgresCustomerDirectoryWriter implements CustomerDirectoryWriterPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}
  public async saveProfile(actorId: string, input: SaveCustomerProfileCommandV1): Promise<unknown> {
    const command = parseSaveCustomerProfileCommandV1(input);
    if (command === undefined) throw request();
    return this.mutate(actorId, "customer.profile_saved", command);
  }
  public async saveAddress(actorId: string, input: SaveCustomerAddressCommandV1): Promise<unknown> {
    const command = parseSaveCustomerAddressCommandV1(input);
    if (command === undefined) throw request();
    return this.mutate(actorId, "customer.address_saved", command);
  }
  public async validateAddress(actorId: string, input: ValidateCustomerAddressCommandV1): Promise<unknown> {
    const command = parseValidateCustomerAddressCommandV1(input);
    if (command === undefined) throw request();
    return this.mutate(actorId, "customer.address_validated", command);
  }
  private async mutate(actorId: string, operation: "customer.profile_saved" | "customer.address_saved" | "customer.address_validated", command: object): Promise<unknown> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(actorId)) throw request();
    const response = await this.database.query(
      "select app_private.mutate_customer_directory($1::uuid, $2::text, $3::jsonb) as result",
      [actorId, operation, JSON.stringify(command)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exact(response.rows[0]);
    if (row === undefined || Reflect.ownKeys(row).length !== 1 || !Reflect.ownKeys(row).includes("result")) throw unavailable();
    return own(row, "result");
  }
}

@Injectable()
export class CustomerDirectoryService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CUSTOMER_DIRECTORY_WRITER_PORT) private readonly writer: CustomerDirectoryWriterPort,
  ) {}

  public async saveProfile(principal: AuthenticatedPrincipal, input: unknown): Promise<CustomerProfileMutationResultV1> {
    const command = parseSaveCustomerProfileCommandV1(input);
    if (command === undefined) throw request();
    const actorId = await this.authorize(principal, command, command.expectedVersion === 0 ? "customers.create" : "customers.update");
    const outcome = await this.write(() => this.writer.saveProfile(actorId, command));
    const record = parseCustomerProfileRecordV1(outcome.record);
    if (record === undefined || record.restaurantId !== command.scope.restaurantId || record.customerId !== command.customerId
      || record.version !== command.expectedVersion + 1 || record.deletedAt !== null || record.displayName !== command.displayName
      || record.phones.length !== command.phones.length || record.phones.some((phone, index) => {
        const expected = command.phones[index];
        return expected === undefined || phone.contactId !== expected.contactId || phone.label !== expected.label
          || phone.displayValue !== expected.displayValue;
      })) throw unavailable();
    const result = parseCustomerProfileMutationResultV1({ schemaVersion: 1, record, replayed: outcome.replayed });
    if (result === undefined) throw unavailable();
    return result;
  }

  public async saveAddress(principal: AuthenticatedPrincipal, input: unknown): Promise<CustomerAddressMutationResultV1> {
    const command = parseSaveCustomerAddressCommandV1(input);
    if (command === undefined) throw request();
    const actorId = await this.authorize(principal, command, "customers.update");
    const outcome = await this.write(() => this.writer.saveAddress(actorId, command));
    const record = parseCustomerAddressRecordV1(outcome.record);
    if (record === undefined || record.restaurantId !== command.scope.restaurantId || record.customerId !== command.customerId
      || record.addressId !== command.addressId || record.version !== command.expectedVersion + 1 || record.deletedAt !== null
      || record.validation !== null || !sameAddress(record.address, command.address)) throw unavailable();
    const result = parseCustomerAddressMutationResultV1({ schemaVersion: 1, record, replayed: outcome.replayed });
    if (result === undefined) throw unavailable();
    return result;
  }

  public async validateAddress(principal: AuthenticatedPrincipal, input: unknown): Promise<CustomerAddressMutationResultV1> {
    const command = parseValidateCustomerAddressCommandV1(input);
    if (command === undefined) throw request();
    const actorId = await this.authorize(principal, command, "customers.validate");
    const outcome = await this.write(() => this.writer.validateAddress(actorId, command));
    const record = parseCustomerAddressRecordV1(outcome.record);
    if (record === undefined || record.restaurantId !== command.scope.restaurantId || record.customerId !== command.customerId
      || record.addressId !== command.addressId || record.version !== command.expectedVersion + 1 || record.deletedAt !== null
      || record.validation?.branchId !== command.scope.branchId || record.validation.eventId !== command.eventId
      || record.validation.deviceId !== command.deviceId || record.validation.actorId !== actorId) throw unavailable();
    const result = parseCustomerAddressMutationResultV1({ schemaVersion: 1, record, replayed: outcome.replayed });
    if (result === undefined) throw unavailable();
    return result;
  }

  private async authorize(principal: AuthenticatedPrincipal, command: SaveCustomerProfileCommandV1 | SaveCustomerAddressCommandV1 | ValidateCustomerAddressCommandV1,
    permission: RbacPermissionCode): Promise<string> {
    try {
      const authorized = await this.authorization.authorizeBranch(principal, command.scope, permission);
      return authorized.principal.actorId;
    } catch { throw new CustomerDirectoryApplicationError("authorization"); }
  }

  private async write(call: () => Promise<unknown>): Promise<Readonly<{ record: unknown; replayed: boolean }>> {
    let value: unknown;
    try { value = await call(); } catch { throw unavailable(); }
    const outcome = parseOutcome(value);
    if (outcome === undefined) throw unavailable();
    if (outcome.status === "conflict") throw new CustomerDirectoryApplicationError("conflict");
    if (outcome.status === "denied") throw new CustomerDirectoryApplicationError("authorization");
    return Object.freeze({ record: outcome.record, replayed: outcome.status === "replayed" });
  }
}

@Injectable()
export class CustomerDirectoryQueryService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CUSTOMER_DIRECTORY_READER_PORT) private readonly reader: CustomerDirectoryReaderPort,
  ) {}
  public async search(principal: AuthenticatedPrincipal, input: unknown): Promise<CustomerDirectorySearchResultV1> {
    const query = parseSearchCustomerDirectoryQueryV1(input);
    if (query === undefined) throw request();
    let actorId: string;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, query.scope, "customers.read");
      actorId = authorized.principal.actorId;
    } catch { throw new CustomerDirectoryApplicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.reader.search(actorId, query); } catch { throw unavailable(); }
    const outcome = parseQueryOutcome(raw);
    if (outcome === undefined || outcome.status === "rejected") throw unavailable();
    if (outcome.status === "denied") throw new CustomerDirectoryApplicationError("authorization");
    const result = parseCustomerDirectorySearchResultV1(outcome.result);
    if (result === undefined || result.scope.restaurantId !== query.scope.restaurantId || result.scope.branchId !== query.scope.branchId
      || result.candidates.length > query.limit || (result.nextCursor !== null && result.candidates.length !== query.limit)) throw unavailable();
    return result;
  }
}

type QueryOutcome = Readonly<{ status: "ok"; result: unknown }> | Readonly<{ status: "denied" }> | Readonly<{ status: "rejected" }>;
function parseQueryOutcome(value: unknown): QueryOutcome | undefined {
  const fields = exact(value);
  if (fields === undefined) return undefined;
  const status = own(fields, "status");
  if ((status === "denied" || status === "rejected") && Reflect.ownKeys(fields).length === 1) return Object.freeze({ status });
  return status === "ok" && Reflect.ownKeys(fields).length === 2 && Reflect.ownKeys(fields).includes("result")
    ? Object.freeze({ status, result: own(fields, "result") }) : undefined;
}

type Outcome = Readonly<{ status: "applied"; record: unknown }> | Readonly<{ status: "replayed"; record: unknown }>
  | Readonly<{ status: "conflict" }> | Readonly<{ status: "denied" }>;
function parseOutcome(value: unknown): Outcome | undefined {
  const base = exact(value);
  if (base === undefined) return undefined;
  const status = own(base, "status");
  if (status === "conflict" || status === "denied") {
    return Reflect.ownKeys(base).length === 1 ? Object.freeze({ status }) : undefined;
  }
  if ((status === "applied" || status === "replayed") && Reflect.ownKeys(base).length === 2 && Reflect.ownKeys(base).includes("record")) {
    return Object.freeze({ status, record: own(base, "record") });
  }
  return undefined;
}
function exact(value: unknown): Record<string, unknown> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || nodeTypes.isProxy(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result[key] = descriptor.value;
    }
    return result;
  } catch { return undefined; }
}
function own(record: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value as unknown;
}
function sameAddress(left: SaveCustomerAddressCommandV1["address"], right: SaveCustomerAddressCommandV1["address"]): boolean {
  return left.label === right.label && left.streetLine === right.streetLine && left.unit === right.unit
    && left.neighborhood === right.neighborhood && left.locality === right.locality && left.region === right.region
    && left.countryCode === right.countryCode && left.postalCode === right.postalCode
    && left.references === right.references && left.instructions === right.instructions
    && (left.coordinates === null ? right.coordinates === null : right.coordinates !== null
      && left.coordinates.latitudeE6 === right.coordinates.latitudeE6
      && left.coordinates.longitudeE6 === right.coordinates.longitudeE6);
}
function request(): CustomerDirectoryApplicationError { return new CustomerDirectoryApplicationError("request"); }
function unavailable(): CustomerDirectoryApplicationError { return new CustomerDirectoryApplicationError("unavailable"); }
