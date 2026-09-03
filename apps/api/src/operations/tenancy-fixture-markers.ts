export const tenancyAuthMetadataMarker = "superrestaurant_tenancy_e2e";
export const tenancyAuthMetadataVersion = "v1";

export const tenancyFixtureKeys = ["amber", "cobalt"] as const;
export type TenancyFixtureKey = (typeof tenancyFixtureKeys)[number];

export const tenancyMainRestaurantSuffixes = ["restaurant-1", "restaurant-2"] as const;
export const tenancyBranchSuffixes = ["branch-11", "branch-12", "branch-21", "branch-22"] as const;
export const tenancyCanarySuffixes = ["canary-anon", "canary-authenticated", "canary-service"] as const;
export const tenancyDiningZoneSuffixes = [
  "dining-zone-created",
  "dining-zone-conflict",
  "dining-zone-viewer",
  "dining-zone-false-pair",
  "dining-zone-revoked",
] as const;
export const tenancyDiningTableSuffixes = [
  "dining-table-created",
  "dining-table-conflict",
  "dining-table-viewer",
  "dining-table-false-pair",
  "dining-table-revoked",
] as const;
export const tenancyMenuSuffixes = [
  "menu-category",
  "menu-product",
  "menu-group",
  "menu-option",
] as const;
const tenancyDiningTableNameCodes: Readonly<Record<(typeof tenancyDiningTableSuffixes)[number], string>> = Object.freeze({
  "dining-table-created": "c",
  "dining-table-conflict": "x",
  "dining-table-viewer": "v",
  "dining-table-false-pair": "f",
  "dining-table-revoked": "r",
});
export type TenancyFixtureSuffix =
  | (typeof tenancyMainRestaurantSuffixes)[number]
  | (typeof tenancyBranchSuffixes)[number]
  | (typeof tenancyCanarySuffixes)[number]
  | (typeof tenancyDiningZoneSuffixes)[number]
  | (typeof tenancyDiningTableSuffixes)[number]
  | (typeof tenancyMenuSuffixes)[number];

export function tenancyFixtureName(runId: string, suffix: TenancyFixtureSuffix): string {
  if ((tenancyDiningTableSuffixes as readonly string[]).includes(suffix)) {
    return `t_${runId}_${tenancyDiningTableNameCodes[suffix as (typeof tenancyDiningTableSuffixes)[number]]}`;
  }
  return `__tenancy_e2e__${runId}__${suffix}`;
}

export function tenancyFixtureEmail(runId: string, fixtureKey: TenancyFixtureKey): string {
  return `tenancy-${fixtureKey}-${runId}@example.invalid`;
}

export function tenancyFixtureAdvisoryLockKey(runId: string): string {
  return `superrestaurant:tenancy-e2e:${runId}`;
}

export const appApiLifecycleAdvisoryLockKey = "superrestaurant:app-api-lifecycle";
