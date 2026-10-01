import { expect, test } from "@playwright/test";
import { installApi, testRecord } from "./integration-fixtures";
import catalog from "../../public/hamsters/wardrobe/catalog.json";
import { installCommerce } from "./avatar-rewards-fixtures";

test("홈은 최근 7일만 조회하고 정적 정보는 반복 조회하지 않으며 복귀 이벤트를 합친다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  await page.clock.install({ time: new Date("2026-09-27T12:00:00+09:00") });
  const requests: URL[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes("/api/"))
      requests.push(new URL(request.url()));
  });
  const count = (path: string) =>
    requests.filter((url) => url.pathname.endsWith(path)).length;
  await page.goto("/");
  await expect(
    page.getByRole("list", { name: "최근 7일 운동 기록" }),
  ).toBeVisible();
  await expect.poll(() => count("/users/me/avatar/outfit")).toBe(1);
  await expect.poll(() => count("/workout-routines/current")).toBe(1);
  for (const url of requests.filter((url) =>
    url.pathname.endsWith("/history"),
  )) {
    expect(url.searchParams.get("from")).toBe("2026-09-21");
    expect(url.searchParams.get("to")).toBe("2026-09-27");
  }
  const initial = requests.length;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(59999);
  expect(requests).toHaveLength(initial);
  await page.clock.fastForward(240001);
  await expect.poll(() => count("/workout-routines/current")).toBe(2);
  await expect.poll(() => count("/workout-routines/history")).toBe(2);
  expect(count("/users/me/avatar/outfit")).toBe(1);
  expect(count("/users/me/profile/activity")).toBe(1);
  await page.evaluate(() =>
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    }),
  );
  const hidden = requests.length;
  await page.clock.fastForward(300000);
  expect(requests).toHaveLength(hidden);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => count("/workout-routines/history")).toBe(3);
  await expect.poll(() => count("/users/me/avatar/outfit")).toBe(2);
  await expect.poll(() => count("/auth/me")).toBe(2);
  await page.clock.runFor(1);
  expect(count("/workout-routines/current")).toBe(3);
  expect(count("/users/me/profile/activity")).toBe(2);
});

test("달력·상세는 보이는 월·주·날짜만 조회하고 과거 기록은 자동 폴링하지 않는다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  await page.clock.install({ time: new Date("2026-09-27T12:00:00+09:00") });
  const ranges: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/workout-routines/history"))
      ranges.push(
        `${url.searchParams.get("from")}:${url.searchParams.get("to")}`,
      );
  });
  await page.goto("/workout");
  await expect(
    page.getByRole("heading", { name: "2026년 9월", exact: true }),
  ).toBeVisible();
  expect(ranges.sort()).toEqual([
    "2026-09-01:2026-09-30",
    "2026-09-21:2026-09-27",
  ]);
  await page.getByRole("button", { name: "이전 달" }).click();
  await expect(
    page.getByRole("heading", { name: "2026년 8월", exact: true }),
  ).toBeVisible();
  expect(ranges).toHaveLength(3);
  expect(ranges).toContain("2026-08-01:2026-08-31");
  await page.clock.fastForward(300000);
  expect(
    ranges.filter((range) => range === "2026-08-01:2026-08-31"),
  ).toHaveLength(1);
  ranges.length = 0;
  await page.goto("/workouts/history/2026-09-26");
  await expect(
    page.getByRole("heading", { name: /2026년 9월 20일/ }),
  ).toBeVisible();
  await expect
    .poll(() => ranges.slice().sort())
    .toEqual(["2026-09-20:2026-09-26", "2026-09-26:2026-09-26"]);
  await page.clock.fastForward(300000);
  expect(ranges).toHaveLength(2);
});

test("저장소의 실제 아바타 PNG를 FE 정적 경로로 렌더링하고 백엔드 이미지 호출은 없다", async ({
  page,
}) => {
  await installCommerce(page, true);
  await page.unroute("**/hamsters/wardrobe/assets/*.png");
  await page.route("**/hamsters/wardrobe/catalog.json", (route) =>
    route.fulfill({ json: catalog }),
  );
  const shirt = catalog.catalog["mint-shirt"].poses.basic.cream.layers[0].src;
  const backendImages: string[] = [];
  page.on("request", (request) => {
    if (
      /\/api\/v\d+\/(?:avatar\/(?:assets|render-catalog)|avatar-manager\/(?:images|catalog))/.test(
        request.url(),
      )
    )
      backendImages.push(request.url());
  });
  await page.goto("/shop/wardrobe");
  await page.getByRole("button", { name: "상의", exact: true }).click();
  await page.getByRole("button", { name: /민트 티셔츠.*보유 중/ }).click();
  const layers = page
    .getByRole("img", { name: "내 캐릭터 미리보기" })
    .locator("image");
  await expect(layers.nth(1)).toHaveAttribute("href", shirt);
  const response = await page.request.get(shirt);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  expect(response.headers()["cache-control"]).toContain("immutable");
  const dimensions = await page.evaluate(
    (src) =>
      new Promise<number[]>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
        image.onerror = () => reject(new Error("FE avatar PNG failed to load"));
        image.src = src;
      }),
    shirt,
  );
  expect(dimensions).toEqual([1000, 1000]);
  expect(backendImages).toEqual([]);
});

test("기기 시계가 달라도 빈 이력의 서버 날짜로 홈과 달력 조회 범위를 보정한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  await page.clock.install({ time: new Date("2030-01-10T12:00:00+09:00") });
  const ranges: string[] = [];
  await page.route("**/api/v2/workout-routines/history?*", (route) => {
    const url = new URL(route.request().url());
    ranges.push(
      `${url.searchParams.get("from")}:${url.searchParams.get("to")}`,
    );
    return route.fulfill({
      json: { items: [], nextCursor: null, serverKoreanDate: "2026-09-27" },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("listitem", {
      name: "9월 27일 오늘, 완료 기록 없음",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(() => ranges)
    .toEqual(["2030-01-04:2030-01-10", "2026-09-21:2026-09-27"]);
  await page.clock.fastForward(300000);
  await expect
    .poll(() => ranges)
    .toEqual([
      "2030-01-04:2030-01-10",
      "2026-09-21:2026-09-27",
      "2026-09-21:2026-09-27",
    ]);
  await page.goto("/workout");
  await expect(
    page.getByRole("heading", { name: "2026년 9월", exact: true }),
  ).toBeVisible();
  expect(ranges).toContain("2026-09-01:2026-09-30");
});
