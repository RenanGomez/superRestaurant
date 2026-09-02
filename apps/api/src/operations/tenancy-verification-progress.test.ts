import assert from "node:assert/strict";
import test from "node:test";

import {
  DINING_TABLE_VERIFICATION_CHECKPOINTS,
  classifyDiningLayoutFetchFailure,
  diagnoseDiningLayoutRead,
  requiredDiningTableAuditEventIds,
  type DiningLayoutReadObservation,
  type DiningLayoutReadOutcome,
} from "./tenancy-verification-progress.js";

const createdEventId = "71000000-0000-4000-8000-000000000001";
const updatedEventId = "71000000-0000-4000-8000-000000000002";

test("requires only audit events confirmed by dining-table fixture progress", () => {
  assert.deepEqual(requiredDiningTableAuditEventIds(
    { created: false, updated: false },
    createdEventId,
    updatedEventId,
  ), []);
  assert.deepEqual(requiredDiningTableAuditEventIds(
    { created: true, updated: false },
    createdEventId,
    updatedEventId,
  ), [createdEventId]);
  assert.deepEqual(requiredDiningTableAuditEventIds(
    { created: true, updated: true },
    createdEventId,
    updatedEventId,
  ), [createdEventId, updatedEventId]);
  assert.throws(
    () => requiredDiningTableAuditEventIds(
      { created: false, updated: true },
      createdEventId,
      updatedEventId,
    ),
    /TENANCY_DINING_TABLE_PROGRESS_INVALID/u,
  );
});

test("keeps dining-table progress checkpoints unique and non-sensitive", () => {
  assert.equal(new Set(DINING_TABLE_VERIFICATION_CHECKPOINTS).size, DINING_TABLE_VERIFICATION_CHECKPOINTS.length);
  assert.equal(
    DINING_TABLE_VERIFICATION_CHECKPOINTS.every((checkpoint) => /^dining_tables\.[a-z_]+$/u.test(checkpoint)),
    true,
  );
});

test("classifies every manager layout read failure without returning fixture data", () => {
  const successful: DiningLayoutReadObservation = {
    cacheControlValid: true,
    contractValid: true,
    fetchSucceeded: true,
    httpStatus: 200,
    jsonDecoded: true,
    scopeMatches: true,
    tableFound: true,
    tableMatches: true,
    zoneFound: true,
  };
  const cases: readonly Readonly<{
    expected: DiningLayoutReadOutcome;
    observation: DiningLayoutReadObservation;
  }>[] = [
    { expected: "fetch_failed", observation: { fetchSucceeded: false } },
    { expected: "unexpected_status", observation: { ...successful, httpStatus: 503 } },
    { expected: "cache_control_invalid", observation: { ...successful, cacheControlValid: false } },
    { expected: "invalid_json", observation: { ...successful, jsonDecoded: false } },
    { expected: "contract_invalid", observation: { ...successful, contractValid: false } },
    { expected: "scope_mismatch", observation: { ...successful, scopeMatches: false } },
    { expected: "zone_missing", observation: { ...successful, zoneFound: false } },
    { expected: "table_missing", observation: { ...successful, tableFound: false } },
    { expected: "table_mismatch", observation: { ...successful, tableMatches: false } },
    { expected: "ok", observation: successful },
  ];

  for (const fixture of cases) {
    const diagnostic = diagnoseDiningLayoutRead(fixture.observation);
    assert.equal(diagnostic.outcome, fixture.expected);
    assert.deepEqual(
      Object.keys(diagnostic).sort(),
      [
        "cacheControlValid",
        "contractValid",
        "httpStatus",
        "jsonDecoded",
        "outcome",
        "scopeMatches",
        "tableFound",
        "tableMatches",
        "transportFailure",
        "zoneFound",
      ],
    );
  }
});

test("reports only bounded status and tri-state checks", () => {
  assert.deepEqual(diagnoseDiningLayoutRead({ fetchSucceeded: true, httpStatus: 700 }), {
    cacheControlValid: null,
    contractValid: null,
    httpStatus: null,
    jsonDecoded: null,
    outcome: "unexpected_status",
    scopeMatches: null,
    tableFound: null,
    tableMatches: null,
    transportFailure: null,
    zoneFound: null,
  });
});

test("classifies only allowlisted layout transport failures", () => {
  assert.equal(classifyDiningLayoutFetchFailure(Object.assign(new Error("secret"), { code: "ECONNREFUSED" })), "connection_refused");
  assert.equal(classifyDiningLayoutFetchFailure({ cause: { code: "ECONNRESET", detail: "secret" } }), "connection_reset");
  assert.equal(classifyDiningLayoutFetchFailure({ cause: { code: "UND_ERR_SOCKET" } }), "socket_closed");
  assert.equal(classifyDiningLayoutFetchFailure({ code: "UND_ERR_HEADERS_TIMEOUT" }), "timeout");
  assert.equal(classifyDiningLayoutFetchFailure({ code: "ENETUNREACH" }), "network_unreachable");
  assert.equal(classifyDiningLayoutFetchFailure({ code: "SECRET_PROVIDER_CODE", message: "secret" }), "other");
  assert.equal(classifyDiningLayoutFetchFailure(new Proxy({}, { get: () => { throw new Error("secret"); } })), "other");
});
