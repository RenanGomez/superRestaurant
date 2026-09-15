import type { SystemOnboardingResultV1 } from "@super-restaurant/shared-types";

export interface SystemRestaurantSummary { readonly id: string; readonly name: string; readonly timeZone: string; readonly disabledAt: string | null; }
export async function canAccessSystemAdministration(token: string, apiBaseUrl: string, timeoutMs = 3_000): Promise<boolean> {
  return await listSystemRestaurants(token, apiBaseUrl, AbortSignal.timeout(timeoutMs)) !== undefined;
}
export async function listSystemRestaurants(token: string, apiBaseUrl: string, signal?: AbortSignal): Promise<readonly SystemRestaurantSummary[] | undefined> {
  try { const response = await fetch(`${apiBaseUrl}/api/v1/system/onboarding/restaurants`, { cache: "no-store", headers: { authorization: `Bearer ${token}` }, ...(signal === undefined ? {} : { signal }) }); if (!response.ok) return undefined; const value: unknown = await response.json(); if (!Array.isArray(value)) return undefined; return value.filter(isSummary); } catch { return undefined; }
}
export async function provisionSystemRestaurant(token: string, apiBaseUrl: string, input: unknown): Promise<SystemOnboardingResultV1 | undefined> {
  try { const response = await fetch(`${apiBaseUrl}/api/v1/system/onboarding/restaurants`, { method: "POST", cache: "no-store", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(input) }); const value: unknown = await response.json(); return response.status === 202 && typeof value === "object" && value !== null ? value as SystemOnboardingResultV1 : undefined; } catch { return undefined; }
}
export async function disableSystemRestaurant(token: string, apiBaseUrl: string, restaurantId: string, reason: string): Promise<boolean> {
  try { const response = await fetch(`${apiBaseUrl}/api/v1/system/onboarding/restaurants/${encodeURIComponent(restaurantId)}/disable`, { method: "POST", cache: "no-store", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ reason }) }); return response.ok; } catch { return false; }
}
function isSummary(value: unknown): value is SystemRestaurantSummary { if (typeof value !== "object" || value === null || Array.isArray(value)) return false; const item = value as Record<string, unknown>; return typeof item.id === "string" && typeof item.name === "string" && typeof item.timeZone === "string" && (item.disabledAt === null || typeof item.disabledAt === "string"); }
