"use server";

import { randomUUID } from "node:crypto";
import {
  parseManualReviewCaseV1,
  parseResolveManualReviewCaseCommandV1,
  type BranchScope,
  type ManualReviewCaseV1,
} from "@super-restaurant/shared-types";
import { cookies } from "next/headers";

import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import {
  BRANCH_PREFERENCE_COOKIE,
  findMembership,
  listMemberships,
  parseBranchPreference,
} from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import { isSupervisorRoleList } from "../../../lib/sync-ui";
import { fetchManualReviewCases, type ManualReviewListOutcome } from "./server-fetch";

const DEVICE_COOKIE = "sr-device-id";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ConnectivityProbeOutcome =
  | {
      readonly ok: true;
      /** Authoritative sync confirmation timestamp; null when sync API is not deployed or denied. */
      readonly syncConfirmedAt: string | null;
      readonly syncAvailable: boolean;
      readonly openManualReviewCount: number | null;
    }
  | {
      readonly ok: false;
      readonly reason: "unauthorized" | "unavailable";
    };

export type ResolveManualReviewOutcome =
  | { readonly ok: true; readonly resolvedCase: ManualReviewCaseV1 | null; readonly confirmedAt: string }
  | { readonly ok: false; readonly error: "conflict" | "denied" | "invalid" | "not_deployed" | "unavailable" };

interface AuthorizedSyncContext {
  readonly accessToken: string;
  readonly apiBaseUrl: string;
  readonly scope: BranchScope;
  readonly roles: readonly string[];
}

async function resolveAuthorizedSyncContext(): Promise<
  | { readonly status: "ok"; readonly context: AuthorizedSyncContext }
  | { readonly status: "unauthorized" }
  | { readonly status: "unavailable" }
> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session === null) {
    return { status: "unauthorized" };
  }

  const cookieStore = await cookies();
  const scope = parseBranchPreference(cookieStore.get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) {
    return { status: "unauthorized" };
  }

  const env = getServerEnv();
  let memberships: Awaited<ReturnType<typeof listMemberships>>;
  let authorized: Awaited<ReturnType<typeof authorizeBranch>>;
  try {
    [memberships, authorized] = await Promise.all([
      listMemberships(session.access_token, env.apiBaseUrl),
      authorizeBranch(session.access_token, env.apiBaseUrl, scope),
    ]);
  } catch {
    return { status: "unavailable" };
  }

  if (memberships === undefined || authorized === undefined) {
    return { status: "unavailable" };
  }
  if (findMembership(memberships.memberships, scope) === undefined) {
    return { status: "unauthorized" };
  }

  return {
    context: {
      accessToken: session.access_token,
      apiBaseUrl: env.apiBaseUrl,
      roles: authorized.roles,
      scope,
    },
    status: "ok",
  };
}

async function getOrCreateDeviceId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(DEVICE_COOKIE)?.value;
  if (existing !== undefined && UUID_PATTERN.test(existing)) {
    return existing.toLowerCase();
  }
  const deviceId = randomUUID();
  cookieStore.set(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: getServerEnv().cookiesSecure,
  });
  return deviceId;
}

/**
 * Lightweight server-side connectivity probe used by `SyncStatusBar` and `/app/sync`.
 * Distinguishes API reachability (`ok: true`) from an actual confirmed sync response
 * (`syncConfirmedAt !== null`, `syncAvailable: true`): `not_deployed` never fabricates a timestamp.
 */
export async function checkSyncConnectivityAction(): Promise<ConnectivityProbeOutcome> {
  const resolved = await resolveAuthorizedSyncContext();
  if (resolved.status === "unauthorized") {
    return { ok: false, reason: "unauthorized" };
  }
  if (resolved.status === "unavailable") {
    return { ok: false, reason: "unavailable" };
  }

  const reviewOutcome = await fetchManualReviewCases(
    resolved.context.accessToken,
    resolved.context.apiBaseUrl,
    resolved.context.scope,
  );

  if (reviewOutcome.status === "ok") {
    const openCount = reviewOutcome.cases.filter((item) => item.status === "open").length;
    return {
      ok: true,
      openManualReviewCount: openCount,
      syncAvailable: true,
      syncConfirmedAt: reviewOutcome.confirmedAt,
    };
  }

  if (reviewOutcome.status === "not_deployed") {
    return {
      ok: true,
      openManualReviewCount: null,
      syncAvailable: false,
      syncConfirmedAt: null,
    };
  }

  if (reviewOutcome.status === "denied") {
    return {
      ok: true,
      openManualReviewCount: null,
      syncAvailable: true,
      syncConfirmedAt: null,
    };
  }

  return { ok: false, reason: "unavailable" };
}

/** Refreshes the manual review queue for `/app/sync` from the authoritative API. */
export async function refreshManualReviewCasesAction(): Promise<ManualReviewListOutcome> {
  const resolved = await resolveAuthorizedSyncContext();
  if (resolved.status === "unauthorized") {
    return { status: "denied" };
  }
  if (resolved.status === "unavailable") {
    return { status: "unavailable" };
  }
  return fetchManualReviewCases(
    resolved.context.accessToken,
    resolved.context.apiBaseUrl,
    resolved.context.scope,
  );
}

/**
 * Submits an audited supervisor manual-review resolution to `POST /api/v1/sync/manual-review`.
 * Checks supervisor role early as defense in depth; the backend remains the sole authority and
 * enforces `sync.manual_review.resolve`.
 */
export async function resolveManualReviewCaseAction(input: {
  readonly caseId: string;
  readonly decision: "compensate" | "reject";
  readonly reason: string;
  readonly compensatingEventId: string | null;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}): Promise<ResolveManualReviewOutcome> {
  const resolved = await resolveAuthorizedSyncContext();
  if (resolved.status === "unauthorized") {
    return { error: "denied", ok: false };
  }
  if (resolved.status === "unavailable") {
    return { error: "unavailable", ok: false };
  }
  if (!isSupervisorRoleList(resolved.context.roles)) {
    return { error: "denied", ok: false };
  }

  const deviceId = await getOrCreateDeviceId();
  const command = parseResolveManualReviewCaseCommandV1({
    caseId: input.caseId,
    compensatingEventId: input.decision === "compensate" ? input.compensatingEventId : null,
    decision: input.decision,
    deviceId,
    idempotencyKey: input.idempotencyKey,
    occurredAt: input.occurredAt,
    reason: input.reason.trim(),
    schemaVersion: 1,
    scope: resolved.context.scope,
  });

  if (command === undefined) {
    return { error: "invalid", ok: false };
  }

  let response: Response;
  try {
    response = await fetch(`${resolved.context.apiBaseUrl}/api/v1/sync/manual-review`, {
      body: JSON.stringify(command),
      cache: "no-store",
      headers: {
        authorization: `Bearer ${resolved.context.accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
  } catch {
    return { error: "unavailable", ok: false };
  }

  if (response.status === 404 || response.status === 501) {
    return { error: "not_deployed", ok: false };
  }
  if (response.status === 401 || response.status === 403) {
    return { error: "denied", ok: false };
  }
  if (response.status === 409) {
    return { error: "conflict", ok: false };
  }
  if (response.status === 400 || response.status === 422) {
    return { error: "invalid", ok: false };
  }
  if (!response.ok) {
    return { error: "unavailable", ok: false };
  }

  const confirmedAt = new Date().toISOString();
  try {
    const body: unknown = await response.json();
    const candidate =
      typeof body === "object" && body !== null && "case" in body
        ? (body as { readonly case?: unknown }).case
        : body;
    const parsedCase = parseManualReviewCaseV1(candidate) ?? null;
    return { confirmedAt, ok: true, resolvedCase: parsedCase };
  } catch {
    return { confirmedAt, ok: true, resolvedCase: null };
  }
}
