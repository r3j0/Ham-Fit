import { test, type APIResponse } from "@playwright/test";

// Live suites share the real server's per-IP mutation budget. Only retry an
// explicit 429: the guard rejected the request before it changed any data.
export async function respectRateLimit(
  send: () => Promise<APIResponse>,
): Promise<APIResponse> {
  let response = await send();
  for (let attempt = 0; attempt < 2 && response.status() === 429; attempt++) {
    const body = await response.json();
    const seconds = Number(
      response.headers()["retry-after"] ?? body.retry_after,
    );
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60)
      return response;
    const delay = Math.ceil(seconds * 1000) + 100;
    test.setTimeout(test.info().timeout + delay);
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await send();
  }
  return response;
}
