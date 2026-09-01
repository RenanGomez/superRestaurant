import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import { TenancyVerificationError } from "./tenancy-verification-config.js";
import type {
  TenancyVerificationLiveFixture,
  TenancyVerificationLiveFixtureHooks,
} from "./tenancy-verification.js";

const RUN_OPT_IN = "REMOTE_BROWSER_SMOKE";
const WAIT_TIMEOUT_MS = 10 * 60 * 1_000;
const POLL_INTERVAL_MS = 250;

export const WEB_PROTECTED_SMOKE_API_PORT = 4_311;
export const WEB_PROTECTED_SMOKE_LEASE_PATH = new URL(
  "../../../../.web-protected-smoke-lease.tmp",
  import.meta.url,
);

export const WEB_PROTECTED_SMOKE_ACK_PATH = new URL(
  "../../../../.web-protected-smoke-ack.tmp",
  import.meta.url,
);
const WRITING_PATH = new URL("../../../../.web-protected-smoke-writing.tmp", import.meta.url);

type SmokePhase = "revoked" | "selection";

export interface WebProtectedSmokeCoordinator {
  readonly cleanup: () => void;
  readonly hooks: TenancyVerificationLiveFixtureHooks;
}

export function createWebProtectedSmokeCoordinator(
  environment: NodeJS.ProcessEnv,
  expectedProjectRef: string,
  onPhase: (phase: SmokePhase, runId: string) => void,
): WebProtectedSmokeCoordinator {
  if (
    environment.WEB_PROTECTED_SMOKE_RUN !== RUN_OPT_IN
    || environment.WEB_PROTECTED_SMOKE_CONFIRM_PROJECT_REF !== expectedProjectRef
    || [WEB_PROTECTED_SMOKE_LEASE_PATH, WEB_PROTECTED_SMOKE_ACK_PATH, WRITING_PATH]
      .some((path) => existsSync(path))
  ) throw configurationError();

  const hooks: TenancyVerificationLiveFixtureHooks = Object.freeze({
    afterRevocation: async (fixture: TenancyVerificationLiveFixture) => {
      await publishAndWait("revoked", fixture, onPhase);
    },
    beforeRevocation: async (fixture: TenancyVerificationLiveFixture) => {
      await publishAndWait("selection", fixture, onPhase);
    },
  });
  return Object.freeze({ cleanup: clearArtifacts, hooks });
}

function publishAndWait(
  phase: SmokePhase,
  fixture: TenancyVerificationLiveFixture,
  onPhase: (phase: SmokePhase, runId: string) => void,
): Promise<void> {
  const record = phase === "selection"
    ? {
        apiBaseUrl: fixture.apiBaseUrl,
        branchId: fixture.branchId,
        branchName: fixture.branchName,
        email: fixture.credentials.email,
        password: fixture.credentials.password,
        phase,
        restaurantId: fixture.restaurantId,
        restaurantName: fixture.restaurantName,
        runId: fixture.runId,
      }
    : { phase, runId: fixture.runId };

  replaceLease(JSON.stringify(record));
  onPhase(phase, fixture.runId);
  return waitForAck(phase, fixture.runId);
}

async function waitForAck(phase: SmokePhase, runId: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!existsSync(WEB_PROTECTED_SMOKE_ACK_PATH)) {
      await delay(POLL_INTERVAL_MS);
      continue;
    }
    let acknowledgement: unknown;
    try {
      acknowledgement = JSON.parse(readFileSync(WEB_PROTECTED_SMOKE_ACK_PATH, "utf8"));
    } catch {
      throw smokeError();
    }
    if (!isExactAcknowledgement(acknowledgement, phase, runId)) throw smokeError();
    rmSync(WEB_PROTECTED_SMOKE_ACK_PATH, { force: true });
    return;
  }
  throw smokeError();
}

function isExactAcknowledgement(value: unknown, phase: SmokePhase, runId: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("phase") || !keys.includes("runId")) return false;
  const phaseDescriptor = Object.getOwnPropertyDescriptor(value, "phase");
  const runIdDescriptor = Object.getOwnPropertyDescriptor(value, "runId");
  return phaseDescriptor !== undefined
    && "value" in phaseDescriptor
    && phaseDescriptor.value === phase
    && runIdDescriptor !== undefined
    && "value" in runIdDescriptor
    && runIdDescriptor.value === runId;
}

function replaceLease(contents: string): void {
  try {
    writeFileSync(WRITING_PATH, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    rmSync(WEB_PROTECTED_SMOKE_LEASE_PATH, { force: true });
    renameSync(WRITING_PATH, WEB_PROTECTED_SMOKE_LEASE_PATH);
  } catch {
    rmSync(WRITING_PATH, { force: true });
    throw smokeError();
  }
}

function clearArtifacts(): void {
  for (const path of [
    WEB_PROTECTED_SMOKE_LEASE_PATH,
    WEB_PROTECTED_SMOKE_ACK_PATH,
    WRITING_PATH,
  ]) {
    rmSync(path, { force: true });
  }
}

function configurationError(): TenancyVerificationError {
  return new TenancyVerificationError(
    "configuration",
    "TENANCY_VERIFICATION_CONFIGURATION_REJECTED",
  );
}

function smokeError(): TenancyVerificationError {
  return new TenancyVerificationError("http", "TENANCY_VERIFICATION_HTTP_FAILED");
}
