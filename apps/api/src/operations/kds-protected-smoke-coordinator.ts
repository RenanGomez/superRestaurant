import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import { TenancyVerificationError } from "./tenancy-verification-config.js";
import { tenancyFixtureName } from "./tenancy-fixture-markers.js";
import type { TenancyVerificationLiveFixture } from "./tenancy-verification.js";
import type { KdsBrowserVerificationHooks } from "./orders-realtime-tenancy-verification.js";

const RUN_OPT_IN = "REMOTE_BROWSER_SMOKE";
const WAIT_TIMEOUT_MS = 10 * 60 * 1_000;
const POLL_INTERVAL_MS = 250;

export const KDS_PROTECTED_SMOKE_API_PORT = 4_312;
export const KDS_PROTECTED_SMOKE_LEASE_PATH = new URL(
  "../../../../.kds-protected-smoke-lease.tmp",
  import.meta.url,
);
export const KDS_PROTECTED_SMOKE_ACK_PATH = new URL(
  "../../../../.kds-protected-smoke-ack.tmp",
  import.meta.url,
);
const WRITING_PATH = new URL("../../../../.kds-protected-smoke-writing.tmp", import.meta.url);

export type KdsSmokePhase = "ready" | "revoked" | "sent";

export interface KdsProtectedSmokeCoordinator {
  readonly cleanup: () => void;
  readonly hooks: KdsBrowserVerificationHooks;
}

export function createKdsProtectedSmokeCoordinator(
  environment: NodeJS.ProcessEnv,
  expectedProjectRef: string,
  onPhase: (phase: KdsSmokePhase, runId: string) => void,
): KdsProtectedSmokeCoordinator {
  if (
    environment.KDS_PROTECTED_SMOKE_RUN !== RUN_OPT_IN
    || environment.KDS_PROTECTED_SMOKE_CONFIRM_PROJECT_REF !== expectedProjectRef
    || [KDS_PROTECTED_SMOKE_LEASE_PATH, KDS_PROTECTED_SMOKE_ACK_PATH, WRITING_PATH]
      .some((path) => existsSync(path))
  ) throw configurationError();

  const hooks: KdsBrowserVerificationHooks = Object.freeze({
    afterRevocation: async (fixture: TenancyVerificationLiveFixture) => (
      publishAndWait("revoked", fixture, onPhase)
    ),
    ready: async (fixture: TenancyVerificationLiveFixture) => (
      publishAndWait("ready", fixture, onPhase)
    ),
    sent: async (fixture: TenancyVerificationLiveFixture) => (
      publishAndWait("sent", fixture, onPhase)
    ),
  });
  return Object.freeze({ cleanup: clearArtifacts, hooks });
}

async function publishAndWait(
  phase: KdsSmokePhase,
  fixture: TenancyVerificationLiveFixture,
  onPhase: (phase: KdsSmokePhase, runId: string) => void,
): Promise<void> {
  const record = phase === "sent"
    ? {
        apiBaseUrl: fixture.apiBaseUrl,
        branchId: fixture.branchId,
        branchName: fixture.branchName,
        email: fixture.credentials.email,
        expectedModifierName: tenancyFixtureName(fixture.runId, "menu-option"),
        expectedProductName: tenancyFixtureName(fixture.runId, "menu-product"),
        password: fixture.credentials.password,
        phase,
        restaurantId: fixture.restaurantId,
        restaurantName: fixture.restaurantName,
        runId: fixture.runId,
        stationId: "kitchen",
      }
    : { phase, runId: fixture.runId };

  replaceLease(JSON.stringify(record));
  onPhase(phase, fixture.runId);
  await waitForAck(phase, fixture.runId);
}

async function waitForAck(phase: KdsSmokePhase, runId: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!existsSync(KDS_PROTECTED_SMOKE_ACK_PATH)) {
      await delay(POLL_INTERVAL_MS);
      continue;
    }
    let acknowledgement: unknown;
    try {
      acknowledgement = JSON.parse(readFileSync(KDS_PROTECTED_SMOKE_ACK_PATH, "utf8"));
    } catch {
      throw smokeError();
    }
    if (!isExactAcknowledgement(acknowledgement, phase, runId)) throw smokeError();
    rmSync(KDS_PROTECTED_SMOKE_ACK_PATH, { force: true });
    return;
  }
  throw smokeError();
}

function isExactAcknowledgement(value: unknown, phase: KdsSmokePhase, runId: string): boolean {
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
    rmSync(KDS_PROTECTED_SMOKE_LEASE_PATH, { force: true });
    renameSync(WRITING_PATH, KDS_PROTECTED_SMOKE_LEASE_PATH);
  } catch {
    rmSync(WRITING_PATH, { force: true });
    throw smokeError();
  }
}

function clearArtifacts(): void {
  for (const path of [
    KDS_PROTECTED_SMOKE_LEASE_PATH,
    KDS_PROTECTED_SMOKE_ACK_PATH,
    WRITING_PATH,
  ]) rmSync(path, { force: true });
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
