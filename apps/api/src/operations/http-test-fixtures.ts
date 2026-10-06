import { randomUUID } from "node:crypto";

import type { Client } from "pg";

// Tenancy fixtures for the local-only HTTP flow test. They are inserted with the superuser
// connection of a disposable cluster (RLS does not apply to it) so every endpoint under test is
// reached with a real membership read, exactly like production reads them. Nothing here is usable
// against a shared database: the caller passes the disposable cluster's admin client.
export const HTTP_TEST_ACTORS = Object.freeze({
  manager: { restaurant: "A", role: "manager" },
  cashier: { restaurant: "A", role: "cashier" },
  courier: { restaurant: "A", role: "courier" },
  courier_other: { restaurant: "A", role: "courier" },
  other_restaurant_manager: { restaurant: "B", role: "manager" },
} as const);

export type HttpTestActorName = keyof typeof HTTP_TEST_ACTORS;

export interface HttpTestFixtures {
  /** Bearer token per actor name; `HttpTestAuthVerifier` maps it back to the actor id. */
  readonly actorIds: Readonly<Record<HttpTestActorName, string>>;
  readonly branchA: string;
  readonly branchB: string;
  readonly restaurantA: string;
  readonly restaurantB: string;
  readonly tokens: Readonly<Record<HttpTestActorName, string>>;
}

export async function provisionHttpFixtures(admin: Client): Promise<HttpTestFixtures> {
  const restaurantA = randomUUID();
  const branchA = randomUUID();
  const restaurantB = randomUUID();
  const branchB = randomUUID();
  const names = Object.keys(HTTP_TEST_ACTORS) as HttpTestActorName[];
  const actorIds = Object.fromEntries(names.map((name) => [name, randomUUID()])) as Record<HttpTestActorName, string>;
  const tokens = Object.fromEntries(names.map((name) => [name, `http-flow-token-${name}-${randomUUID()}`])) as Record<HttpTestActorName, string>;

  await admin.query("insert into app.restaurants(id,name,time_zone) values ($1,'http-flow restaurant A','America/Hermosillo'),($2,'http-flow restaurant B','America/Hermosillo')", [restaurantA, restaurantB]);
  await admin.query("insert into app.branches(id,restaurant_id,name) values ($1,$2,'http-flow branch A'),($3,$4,'http-flow branch B')", [branchA, restaurantA, branchB, restaurantB]);
  const grantor = actorIds.manager;
  for (const name of names) {
    await admin.query("insert into auth.users(id,email) values ($1,$2)", [actorIds[name], `http-flow-${name}@invalid.test`]);
  }
  for (const name of names) {
    const { restaurant, role } = HTTP_TEST_ACTORS[name];
    const membershipId = randomUUID();
    await admin.query("insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values ($1,$2,$3,$4,$5)",
      [membershipId, actorIds[name], restaurant === "A" ? restaurantA : restaurantB, restaurant === "A" ? branchA : branchB, grantor]);
    await admin.query("insert into app.membership_role_grants(membership_id,role_code,granted_by) values ($1,$2,$3)", [membershipId, role, grantor]);
  }
  return Object.freeze({ actorIds, branchA, branchB, restaurantA, restaurantB, tokens });
}
