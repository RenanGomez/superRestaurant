import assert from "node:assert/strict";
import test from "node:test";

import {
  DataApiExposureError,
  formatDataApiExposureFailure,
  type DataApiExposureConfig,
} from "./data-api-exposure-config.js";
import {
  exposeAppDataApi,
  type DataApiExposureFetch,
  type DataApiExposureHttpResponse,
} from "./data-api-exposure.js";

const projectRef = "abcdefghijklmnopqrst";
const accessToken = "sbp_private-management-token_123";
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/postgrest`;
const config: DataApiExposureConfig = Object.freeze({ accessToken, projectRef });

test("changes a known baseline with the exact PATCH body and audits the final state", async () => {
  const calls: Array<{ init: RequestInit; url: string }> = [];
  const fetch = queuedFetch([
    jsonResponse(settings("public,graphql_public,adr010_b")),
    emptyResponse(200),
    jsonResponse(settings("public,graphql_public,app")),
  ], calls);

  const summary = await exposeAppDataApi({ config, fetch });

  assert.deepEqual(summary, {
    audit: true,
    changed: true,
    currentSchemas: ["public", "graphql_public", "app"],
    status: "ok",
  });
  assert.ok(Object.isFrozen(summary));
  assert.ok(Object.isFrozen(summary.currentSchemas));
  assert.deepEqual(calls.map(({ url }) => url), [endpoint, endpoint, endpoint]);
  assert.deepEqual(calls.map(({ init }) => init.method), ["GET", "PATCH", "GET"]);
  assert.equal(calls[1]?.init.body, '{"db_schema":"public,graphql_public,app"}');
  assert.equal(calls[1]?.init.redirect, "error");
  assert.equal(calls[1]?.init.headers !== undefined, true);
  assert.deepEqual(calls[1]?.init.headers, {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  });
  for (const { init } of calls) assert.ok(init.signal instanceof AbortSignal);
});

test("is idempotent when app is already the only additional exposed schema", async () => {
  const calls: Array<{ init: RequestInit; url: string }> = [];
  const summary = await exposeAppDataApi({
    config,
    fetch: queuedFetch([jsonResponse(settings("public,graphql_public,app"))], calls),
  });
  assert.deepEqual(summary, {
    audit: true,
    changed: false,
    currentSchemas: ["public", "graphql_public", "app"],
    status: "ok",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init.method, "GET");
});

test("rejects private, duplicate, reordered and unknown schema states before PATCH", async () => {
  const rejectedStates = [
    "public,graphql_public,app_private",
    "public,graphql_public,app_rls",
    "public,graphql_public,public",
    "graphql_public,public",
    "public,graphql_public,unknown",
  ];
  for (const dbSchema of rejectedStates) {
    const calls: Array<{ init: RequestInit; url: string }> = [];
    await assert.rejects(
      exposeAppDataApi({
        config,
        fetch: queuedFetch([jsonResponse(settings(dbSchema))], calls),
      }),
      (error: unknown) => isExposureError(
        error,
        "precheck",
        "DATA_API_EXPOSURE_PRECHECK_FAILED",
      ),
    );
    assert.equal(calls.length, 1);
  }
});

test("fails closed for hostile HTTP, response and provider bodies without leaking details", async () => {
  const jwtSecret = "jwt_secret_native_provider_value";
  const hostileResponses: readonly DataApiExposureHttpResponse[] = [
    emptyResponse(500),
    {
      get status(): unknown {
        throw new Error(`${accessToken}:${jwtSecret}`);
      },
      text: async () => "",
    },
    {
      status: 200,
      text: async () => {
        throw new Error(`${accessToken}:${jwtSecret}`);
      },
    },
    jsonResponse({ ...settings("public,graphql_public"), jwt_secret: jwtSecret, max_rows: {} }),
    jsonResponse({ ...settings("public,graphql_public"), db_pool: true }),
    { status: 200, text: async () => ({ db_schema: "public,graphql_public" }) },
  ];

  for (const response of hostileResponses) {
    let captured: unknown;
    try {
      await exposeAppDataApi({ config, fetch: queuedFetch([response]) });
    } catch (error: unknown) {
      captured = error;
    }
    assert.ok(captured instanceof DataApiExposureError);
    const output = formatDataApiExposureFailure(captured);
    assert.deepEqual(JSON.parse(output), {
      code: "DATA_API_EXPOSURE_PRECHECK_FAILED",
      stage: "precheck",
      status: "failed",
    });
    for (const sensitive of [accessToken, jwtSecret, "provider"]) {
      assert.equal(output.includes(sensitive), false);
      assert.equal(JSON.stringify(captured).includes(sensitive), false);
    }
  }
});

test("detects non-target configuration drift after a successful PATCH", async () => {
  await assert.rejects(
    exposeAppDataApi({
      config,
      fetch: queuedFetch([
        jsonResponse(settings("public,graphql_public", { max_rows: 1_000 })),
        emptyResponse(200),
        jsonResponse(settings("public,graphql_public,app", { max_rows: 500 })),
      ]),
    }),
    (error: unknown) => isExposureError(
      error,
      "postcheck",
      "DATA_API_EXPOSURE_POSTCHECK_FAILED",
    ),
  );
});

test("reconciles an ambiguous PATCH as success only when GET proves it was applied", async () => {
  const calls: Array<{ init: RequestInit; url: string }> = [];
  const fetch = queuedFetch([
    jsonResponse(settings("public,graphql_public")),
    new Error(`${accessToken}:provider-timeout-native-body`),
    jsonResponse(settings("public,graphql_public,app")),
  ], calls);

  const summary = await exposeAppDataApi({ config, fetch });
  assert.equal(summary.changed, true);
  assert.equal(summary.audit, true);
  assert.deepEqual(calls.map(({ init }) => init.method), ["GET", "PATCH", "GET"]);
});

test("reports an ambiguous PATCH as failed when GET proves it was not applied", async () => {
  let captured: unknown;
  try {
    await exposeAppDataApi({
      config,
      fetch: queuedFetch([
        jsonResponse(settings("public,graphql_public")),
        emptyResponse(503),
        jsonResponse(settings("public,graphql_public")),
      ]),
    });
  } catch (error: unknown) {
    captured = error;
  }
  assert.ok(isExposureError(captured, "change", "DATA_API_EXPOSURE_CHANGE_FAILED"));
  const output = formatDataApiExposureFailure(captured);
  for (const sensitive of [accessToken, "jwt_secret", "native-body"]) {
    assert.equal(output.includes(sensitive), false);
  }
});

function settings(
  dbSchema: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    db_extra_search_path: "extensions",
    db_pool: 10,
    db_pool_acquisition_timeout: 10,
    db_schema: dbSchema,
    max_rows: 1_000,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): DataApiExposureHttpResponse {
  return { status, text: async () => JSON.stringify(body) };
}

function emptyResponse(status: number): DataApiExposureHttpResponse {
  return { status, text: async () => "" };
}

function queuedFetch(
  queue: readonly (DataApiExposureHttpResponse | Error)[],
  calls: Array<{ init: RequestInit; url: string }> = [],
): DataApiExposureFetch {
  let index = 0;
  return async (url, init) => {
    calls.push({ init, url });
    const result = queue[index];
    index += 1;
    if (result instanceof Error) throw result;
    if (result === undefined) throw new Error("UNEXPECTED_FETCH");
    return result;
  };
}

function isExposureError(
  error: unknown,
  stage: DataApiExposureError["stage"],
  code: DataApiExposureError["code"],
): boolean {
  assert.ok(error instanceof DataApiExposureError);
  assert.equal(error.stage, stage);
  assert.equal(error.code, code);
  return true;
}
