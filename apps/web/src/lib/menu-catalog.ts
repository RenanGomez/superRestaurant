import {
  parseMenuCatalogStateV1,
  parseSaveMenuCatalogCommandV1,
  type BranchScope,
  type MenuCatalogStateV1,
  type SaveMenuCatalogCommandV1,
} from "@super-restaurant/shared-types";

export async function getMenuCatalog(
  accessToken: string,
  apiBaseUrl: string,
  scope: BranchScope,
): Promise<MenuCatalogStateV1 | undefined> {
  const query = new URLSearchParams({ branchId: scope.branchId, restaurantId: scope.restaurantId });
  return request(
    accessToken,
    `${apiBaseUrl}/api/v1/catalog/menu?${query.toString()}`,
    "GET",
    undefined,
  );
}

export async function saveMenuCatalog(
  accessToken: string,
  apiBaseUrl: string,
  input: unknown,
): Promise<MenuCatalogStateV1 | undefined> {
  const command = parseSaveMenuCatalogCommandV1(input);
  if (command === undefined) return undefined;
  return request(accessToken, `${apiBaseUrl}/api/v1/catalog/menu`, "PUT", command);
}

async function request(
  accessToken: string,
  url: string,
  method: "GET" | "PUT",
  body: SaveMenuCatalogCommandV1 | undefined,
): Promise<MenuCatalogStateV1 | undefined> {
  let response: Response;
  try {
    const init: RequestInit = {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      method,
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    response = await fetch(url, init);
  } catch {
    return undefined;
  }
  if (!response.ok) return undefined;
  try {
    return parseMenuCatalogStateV1(await response.json());
  } catch {
    return undefined;
  }
}
