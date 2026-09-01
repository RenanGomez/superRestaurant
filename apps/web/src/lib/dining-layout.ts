import {
  parseCreateDiningTableCommandV1,
  parseDiningLayoutV1,
  parseDiningTableV1,
  parseUpdateDiningTableLayoutCommandV1,
  type BranchScope,
  type CreateDiningTableCommandV1,
  type DiningLayoutV1,
  type DiningTableV1,
  type UpdateDiningTableLayoutCommandV1,
} from "@super-restaurant/shared-types";

export async function getDiningLayout(accessToken: string, apiBaseUrl: string, scope: BranchScope): Promise<DiningLayoutV1 | undefined> {
  const query = new URLSearchParams({ branchId: scope.branchId, restaurantId: scope.restaurantId });
  return request(accessToken, `${apiBaseUrl}/api/v1/dining/layout?${query.toString()}`, "GET", undefined, parseDiningLayoutV1);
}

export async function createDiningTable(accessToken: string, apiBaseUrl: string, input: unknown): Promise<DiningTableV1 | undefined> {
  const command = parseCreateDiningTableCommandV1(input);
  if (command === undefined) return undefined;
  return request(accessToken, `${apiBaseUrl}/api/v1/dining/tables`, "POST", command, parseDiningTableV1);
}

export async function updateDiningTableLayout(accessToken: string, apiBaseUrl: string, input: unknown): Promise<DiningTableV1 | undefined> {
  const command = parseUpdateDiningTableLayoutCommandV1(input);
  if (command === undefined) return undefined;
  return request(accessToken, `${apiBaseUrl}/api/v1/dining/tables/layout`, "PATCH", command, parseDiningTableV1);
}

async function request<T, B extends CreateDiningTableCommandV1 | UpdateDiningTableLayoutCommandV1 | undefined>(
  accessToken: string,
  url: string,
  method: "GET" | "PATCH" | "POST",
  body: B,
  parser: (value: unknown) => T | undefined,
): Promise<T | undefined> {
  let response: Response;
  try {
    const init: RequestInit = {
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      method,
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    response = await fetch(url, init);
  } catch { return undefined; }
  if (!response.ok) return undefined;
  try { return parser(await response.json()); } catch { return undefined; }
}
