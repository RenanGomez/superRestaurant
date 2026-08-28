import path from "node:path";

import { requireFreshRemotePushOptIn, runFreshRemotePush } from "./fresh-remote-push.js";

const config = requireFreshRemotePushOptIn(process.env);
const result = await runFreshRemotePush({
  config,
  cwd: path.resolve(process.cwd(), "options", "b-supabase-nest"),
  apply: process.env.ADR010_APPLY_FRESH_REMOTE_PUSH === "1",
});

console.log(JSON.stringify({
  projectRef: config.confirmedIsolatedProjectRef,
  ...result,
  evidenceNext: "Capture this report, the dry-run output and remote-schema-audit output outside Git.",
}));
