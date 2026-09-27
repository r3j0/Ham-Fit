import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, request } from "../../lib/http.ts";

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
