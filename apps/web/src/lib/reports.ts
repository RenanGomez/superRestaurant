import {
  parseBranchDaySummaryRequestV1,
  parseBranchDaySummaryV1,
  type BranchDaySummaryV1,
  type BranchScope,
} from "@super-restaurant/shared-types";

export type ReportsApiFailure = "invalid" | "unauthorized" | "unavailable";
export type ReportsApiResult<T> = Readonly<{ status: "ok"; value: T }> | Readonly<{ status: ReportsApiFailure }>;

/** Read-only: the server aggregates the day; this client only validates and displays. */
export async function readDaySummary(
  token: string,
  baseUrl: string,
  scope: BranchScope,
  date: string,
): Promise<ReportsApiResult<BranchDaySummaryV1>> {
  const body = parseBranchDaySummaryRequestV1({ date, schemaVersion: 1, scope });
  if (body === undefined) return failure("invalid");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/reports/day-summary`, {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return failure("unavailable");
  }
  if (!response.ok) return failure(statusFailure(response.status));
  try {
    const value = parseBranchDaySummaryV1(await response.json());
    return value !== undefined && value.date === date && value.scope.restaurantId === scope.restaurantId
      && value.scope.branchId === scope.branchId ? Object.freeze({ status: "ok", value }) : failure("unavailable");
  } catch {
    return failure("unavailable");
  }
}

function statusFailure(status: number): ReportsApiFailure {
  if (status === 400) return "invalid";
  if (status === 401 || status === 403) return "unauthorized";
  return "unavailable";
}

function failure(status: ReportsApiFailure): Readonly<{ status: ReportsApiFailure }> {
  return Object.freeze({ status });
}
