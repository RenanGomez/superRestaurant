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
export type TenancyFixtureSuffix =
  | (typeof tenancyMainRestaurantSuffixes)[number]
  | (typeof tenancyBranchSuffixes)[number]
  | (typeof tenancyCanarySuffixes)[number]
  | (typeof tenancyDiningZoneSuffixes)[number];

export function tenancyFixtureName(runId: string, suffix: TenancyFixtureSuffix): string {
  return `__tenancy_e2e__${runId}__${suffix}`;
}

export function tenancyFixtureEmail(runId: string, fixtureKey: TenancyFixtureKey): string {
  return `tenancy-${fixtureKey}-${runId}@example.invalid`;
}

export function tenancyFixtureAdvisoryLockKey(runId: string): string {
  return `superrestaurant:tenancy-e2e:${runId}`;
}

export const appApiLifecycleAdvisoryLockKey = "superrestaurant:app-api-lifecycle";
