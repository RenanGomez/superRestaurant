import assert from "node:assert/strict";
import test from "node:test";

import {
  DataApiExposureError,
  dataApiExposureEndpoint,
  formatDataApiExposureFailure,
  readDataApiExposureConfig,
} from "./data-api-exposure-config.js";

const projectRef = "abcdefghijklmnopqrst";
const accessToken = "sbp_private-management-token_123";
const confirmation = [`--confirm=EXPOSE_ONLY_APP_DATA_API_FOR:${projectRef}`] as const;
const validEnvironment = Object.freeze({
  DATA_API_EXPOSURE_PROJECT_REF: projectRef,
  DATA_API_EXPOSURE_RUN: "REMOTE_CONFIG_WRITE",
  SUPABASE_ACCESS_TOKEN: accessToken,
});

test("requires the exact remote-write opt-ins and derives the fixed management endpoint", () => {
  const config = readDataApiExposureConfig(validEnvironment, confirmation);
  assert.deepEqual(config, { accessToken, projectRef });
  assert.ok(Object.isFrozen(config));
  assert.equal(
    dataApiExposureEndpoint(config.projectRef),
    `https://api.supabase.com/v1/projects/${projectRef}/postgrest`,
  );
});

test("rejects missing, whitespace, non-ASCII and oversized tokens", () => {
  const invalidTokens = [undefined, "", " token", "token ", "tok\nen", "tok\ten", "tóken", "x".repeat(8_193)];
  for (const invalidToken of invalidTokens) {
    assert.throws(
      () => readDataApiExposureConfig(
        { ...validEnvironment, SUPABASE_ACCESS_TOKEN: invalidToken },
        confirmation,
      ),
      isConfigurationError,
    );
  }
});

test("rejects mismatched confirmations, extra arguments and invalid or forbidden refs", () => {
  const cases: readonly [NodeJS.ProcessEnv, readonly string[]][] = [
    [{ ...validEnvironment, DATA_API_EXPOSURE_RUN: "1" }, confirmation],
    [validEnvironment, []],
    [validEnvironment, [...confirmation, "--extra"]],
    [validEnvironment, ["--confirm=EXPOSE_ONLY_APP_DATA_API_FOR:otherprojectref00000"]],
    [{ ...validEnvironment, DATA_API_EXPOSURE_PROJECT_REF: "UPPERCASEPROJECTREF00" }, confirmation],
    [{ ...validEnvironment, DATA_API_EXPOSURE_PROJECT_REF: "too-short" }, confirmation],
    [{ ...validEnvironment, DATA_API_EXPOSURE_PROJECT_REF: "cxcnnhafchqslvgvkeye" }, [
      "--confirm=EXPOSE_ONLY_APP_DATA_API_FOR:cxcnnhafchqslvgvkeye",
    ]],
  ];

  for (const [environment, arguments_] of cases) {
    assert.throws(
      () => readDataApiExposureConfig(environment, arguments_),
      isConfigurationError,
    );
  }
});

test("formats only allowlisted failure data and never provider or token details", () => {
  const output = formatDataApiExposureFailure(
    new Error(`${accessToken}:jwt_secret:provider-native-body`),
  );
  assert.deepEqual(JSON.parse(output), {
    code: "DATA_API_EXPOSURE_CONFIGURATION_REJECTED",
    stage: "configuration",
    status: "failed",
  });
  for (const sensitive of [accessToken, "jwt_secret", "provider-native-body"]) {
    assert.equal(output.includes(sensitive), false);
  }
});

function isConfigurationError(error: unknown): boolean {
  assert.ok(error instanceof DataApiExposureError);
  assert.equal(error.stage, "configuration");
  assert.equal(error.code, "DATA_API_EXPOSURE_CONFIGURATION_REJECTED");
  return true;
}
