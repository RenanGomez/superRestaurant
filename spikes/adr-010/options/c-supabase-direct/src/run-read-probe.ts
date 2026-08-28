import { requireSupabaseDirectReadOptIn } from "./config.js";
import { SupabaseDirectReadClient } from "./read-client.js";

const requireProbeValue = (name: "ADR010_RESTAURANT_ID" | "ADR010_BRANCH_ID"): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`Remote option-C read probe requires ${name}.`);
  return value;
};

// Opt-in connectivity/read probe only. Its result is never decision evidence.
const client = new SupabaseDirectReadClient(requireSupabaseDirectReadOptIn(process.env));
const scope = {
  restaurantId: requireProbeValue("ADR010_RESTAURANT_ID"),
  branchId: requireProbeValue("ADR010_BRANCH_ID"),
};
await client.readOrders(scope, undefined, 1);
await client.readKdsEvents(scope, 0, 1);
