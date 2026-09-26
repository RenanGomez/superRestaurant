import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import {
  CAPTURE_CONTINUITY_SMOKE_ACK_PATH,
  CAPTURE_CONTINUITY_SMOKE_LEASE_PATH,
} from "./capture-continuity-protected-smoke-coordinator.js";
import {
  driveCaptureContinuityApiSmoke,
  parseCaptureContinuityApiSmokeLease,
} from "./capture-continuity-api-smoke-driver.js";

const OPT_IN = "REMOTE_CAPTURE_CONTINUITY_API_SMOKE";
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const WRITING_PATH = new URL("../../../../.capture-continuity-smoke-api-ack-writing.tmp", import.meta.url);

try {
  const expectedProjectRef = process.env.CAPTURE_CONTINUITY_SMOKE_CONFIRM_PROJECT_REF;
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (
    process.env.CAPTURE_CONTINUITY_API_DRIVER_RUN !== OPT_IN
    || typeof expectedProjectRef !== "string"
    || !PROJECT_REF.test(expectedProjectRef)
    || typeof supabaseUrl !== "string"
    || new URL(supabaseUrl).hostname !== `${expectedProjectRef}.supabase.co`
    || typeof publishableKey !== "string"
    || !publishableKey.startsWith("sb_publishable_")
    || publishableKey.length > 2_048
    || existsSync(WRITING_PATH)
  ) throw driverError();
  const lease = parseCaptureContinuityApiSmokeLease(JSON.parse(
    readFileSync(CAPTURE_CONTINUITY_SMOKE_LEASE_PATH, "utf8"),
  ));
  if (lease === undefined) throw driverError();
  const auth = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const login = await auth.auth.signInWithPassword({ email: lease.email, password: lease.password });
  const token = login.data.session?.access_token;
  if (login.error !== null || typeof token !== "string" || token.length === 0) throw driverError();
  await driveCaptureContinuityApiSmoke(lease, {
    acknowledge: async (runId) => {
      writeFileSync(WRITING_PATH, JSON.stringify({ phase: "capture_continuity", runId }), { encoding: "utf8", flag: "wx" });
      renameSync(WRITING_PATH, CAPTURE_CONTINUITY_SMOKE_ACK_PATH);
    },
    postJson: async (path, body) => {
      const response = await fetch(`${lease.apiBaseUrl}${path}`, {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw driverError();
      return response.json() as Promise<unknown>;
    },
  });
  process.stdout.write(`${JSON.stringify({ runId: lease.runId, status: "acknowledged" })}\n`);
} catch {
  rmSync(WRITING_PATH, { force: true });
  process.stderr.write(`${JSON.stringify({ code: "CAPTURE_CONTINUITY_API_SMOKE_REJECTED", status: "failed" })}\n`);
  process.exitCode = 1;
}

function driverError(): Error {
  return new Error("CAPTURE_CONTINUITY_API_SMOKE_REJECTED");
}
