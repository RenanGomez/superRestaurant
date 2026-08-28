import { bootstrapAdr010BAuth } from "./auth-bootstrap.js";
import { requireSupabaseDestructiveServerOptIn } from "./config.js";

// Explicitly opt-in remote setup. Do not print user IDs, generated credentials,
// session material, or configuration values.
await bootstrapAdr010BAuth(requireSupabaseDestructiveServerOptIn(process.env));
