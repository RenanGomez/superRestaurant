import {
  parseCreateDiningTableCommandV1,
  parseDiningLayoutV1,
  parseDiningTableV1,
  parseUpdateDiningTableLayoutCommandV1,
  type BranchScope,
  type CreateDiningTableCommandV1,
  type DiningLayoutV1,
  type DiningTableShape,
  type DiningTableV1,
  type UpdateDiningTableLayoutCommandV1,
} from "@super-restaurant/shared-types";

export type DiningFailure = "conflict" | "denied" | "invalid" | "unavailable";
export type DiningResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DiningFailure };

/** Command for `PATCH /api/v1/dining/tables/details` (name, capacity and shape; geometry is untouched). */
export interface UpdateDiningTableDetailsCommand {
  readonly schemaVersion: 1;
  readonly scope: BranchScope;
  readonly tableId: string;
  readonly expectedVersion: number;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly name: string;
  readonly capacity: number;
  readonly shape: DiningTableShape;
}

type DiningBody = CreateDiningTableCommandV1 | UpdateDiningTableLayoutCommandV1 | UpdateDiningTableDetailsCommand;

export async function getDiningLayout(accessToken: string, apiBaseUrl: string, scope: BranchScope): Promise<DiningLayoutV1 | undefined> {
  const query = new URLSearchParams({ branchId: scope.branchId, restaurantId: scope.restaurantId });
  return unwrap(await request(accessToken, `${apiBaseUrl}/api/v1/dining/layout?${query.toString()}`, "GET", undefined, parseDiningLayoutV1));
}

export async function createDiningTable(accessToken: string, apiBaseUrl: string, input: unknown): Promise<DiningTableV1 | undefined> {
  const result = await createDiningTableResult(accessToken, apiBaseUrl, input);
  return result.ok ? result.value : undefined;
}

export async function createDiningTableResult(accessToken: string, apiBaseUrl: string, input: unknown): Promise<DiningResult<DiningTableV1>> {
  const command = parseCreateDiningTableCommandV1(input);
  if (command === undefined) return { ok: false, error: "invalid" };
  return request(accessToken, `${apiBaseUrl}/api/v1/dining/tables`, "POST", command, parseDiningTableV1);
}

export async function updateDiningTableLayout(accessToken: string, apiBaseUrl: string, input: unknown): Promise<DiningTableV1 | undefined> {
  const result = await updateDiningTableLayoutResult(accessToken, apiBaseUrl, input);
  return result.ok ? result.value : undefined;
}

export async function updateDiningTableLayoutResult(accessToken: string, apiBaseUrl: string, input: unknown): Promise<DiningResult<DiningTableV1>> {
  const command = parseUpdateDiningTableLayoutCommandV1(input);
  if (command === undefined) return { ok: false, error: "invalid" };
  return request(accessToken, `${apiBaseUrl}/api/v1/dining/tables/layout`, "PATCH", command, parseDiningTableV1);
}

/** 409 means the table changed elsewhere (conflict), 403 means the role may not manage tables. */
export async function updateDiningTableDetails(accessToken: string, apiBaseUrl: string, command: UpdateDiningTableDetailsCommand): Promise<DiningResult<DiningTableV1>> {
  return request(accessToken, `${apiBaseUrl}/api/v1/dining/tables/details`, "PATCH", command, parseDiningTableV1);
}

function unwrap<T>(result: DiningResult<T>): T | undefined {
  return result.ok ? result.value : undefined;
}

function failureFor(status: number): DiningFailure {
  return status === 409 ? "conflict" : status === 400 || status === 422 ? "invalid" : status === 401 || status === 403 ? "denied" : "unavailable";
}

async function request<T>(
  accessToken: string,
  url: string,
  method: "GET" | "PATCH" | "POST",
  body: DiningBody | undefined,
  parser: (value: unknown) => T | undefined,
): Promise<DiningResult<T>> {
  let response: Response;
  try {
    const init: RequestInit = {
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      method,
      signal: AbortSignal.timeout(10_000),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    response = await fetch(url, init);
  } catch { return { ok: false, error: "unavailable" }; }
  if (!response.ok) return { ok: false, error: failureFor(response.status) };
  try {
    const value = parser(await response.json());
    return value === undefined ? { ok: false, error: "unavailable" } : { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}
