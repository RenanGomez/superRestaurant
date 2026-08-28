import { cleanupAdr010BAuthBootstrap } from "./auth-bootstrap.js";
import { requireSupabaseDestructiveServerOptIn } from "./config.js";

// Explicitly opt-in remote cleanup. It combines database markers with the
// server-only Auth metadata marker, covering failures before DB tracking.
await cleanupAdr010BAuthBootstrap(requireSupabaseDestructiveServerOptIn(process.env));
