import test from "node:test";
import assert from "node:assert/strict";
import { request, ApiError } from "../../lib/http.ts";
test("multipart keeps browser boundary and Headers instances preserve auth", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      const headers = new Headers(options?.headers);
      assert.equal(headers.has("Content-Type"), false);
      assert.equal(headers.get("Authorization"), "Bearer test");
      assert.equal("timeoutMs" in options!, false);
      assert.equal("allowNull" in options!, false);
      return Response.json({ ok: true });
    };
    await request("/measurements/extract", {
      method: "POST",
      body: new FormData(),
      headers: new Headers({ Authorization: "Bearer test" }),
      timeoutMs: 50000,
    });
  } finally {
    globalThis.fetch = original;
  }
});
test("extraction error codes and server retry delay survive transport", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json(
        { code: "EXTRACTION_RATE_LIMITED", retry_after: 17 },
        { status: 429 },
      );
    await assert.rejects(
      request("/measurements/extract"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === "EXTRACTION_RATE_LIMITED" &&
        error.retryAfter === 17,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("null is accepted only for an explicitly nullable endpoint; malformed JSON still fails", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("null"));
  assert.equal(
    (await request("/workouts/current", { allowNull: true })).data,
    null,
  );
  await assert.rejects(request("/auth/me"), ApiError);
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>error</html>"),
  );
  await assert.rejects(
    request("/workouts/current", { allowNull: true }),
    ApiError,
  );
});
test("readiness codes survive the existing HTTP error mapping", async (t) => {
  for (const code of [
    "DATE_OF_BIRTH_REQUIRED",
    "MEASUREMENT_REQUIRED",
    "AGE_UNSUPPORTED",
    "WORKOUT_CONFLICT",
    "WORKOUT_CATALOG_UNAVAILABLE",
  ]) {
    const status = code === "WORKOUT_CATALOG_UNAVAILABLE" ? 503 : 409;
    t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(JSON.stringify({ code }), { status }),
    );
    await assert.rejects(
      request("/workouts/today"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === status &&
        error.code === code,
    );
  }
});
test("existing validation, retry and no-content contracts remain available", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          errors: [{ field: "dateOfBirth", message: "invalid date" }],
          retry_after: 42,
        }),
        { status: 429 },
      ),
  );
  await assert.rejects(
    request("/users/me/profile"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.retryAfter === 42 &&
      error.fields.dateOfBirth === "invalid date",
  );
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 204 }),
  );
  assert.equal((await request("/auth/logout")).data, null);
});

test("routine requests use v2 while authentication and measurements keep v1 and their headers", async (t) => {
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      calls.push(String(url));
      assert.equal("apiVersion" in options, false);
      assert.equal(options.credentials, "include");
      assert.equal(
        new Headers(options.headers).get("Authorization"),
        "Bearer test",
      );
      return Response.json({ ok: true });
    },
  );
  const headers = { Authorization: "Bearer test" };
  await request("/auth/refresh", { headers });
  await request("/measurements", { headers });
  await request("/workout-routines/today", {
    apiVersion: "v2",
    method: "POST",
    headers,
    body: "{}",
  });
  assert.ok(calls[0].endsWith("/api/v1/auth/refresh"));
  assert.ok(calls[1].endsWith("/api/v1/measurements"));
  assert.ok(calls[2].endsWith("/api/v2/workout-routines/today"));
});
