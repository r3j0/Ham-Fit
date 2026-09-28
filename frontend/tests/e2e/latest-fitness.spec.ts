import { test, expect } from "@playwright/test";
import { installApi, testUser } from "./integration-fixtures";
import {
  storedRecordFixture,
  storedCatalogFixture,
  recordIdentity,
} from "../fixtures/measurement-evaluation";
const polygon = () => ({
  measurementId: recordIdentity.id,
  revision: 1,
  measuredOn: recordIdentity.measuredOn,
  axes: storedRecordFixture().axes,
});
const empty = () => ({
  measurementId: null,
  revision: null,
  measuredOn: null,
  axes: storedRecordFixture().axes.map((a) => ({
    ...a,
    status: "not_measured",
    grade: null,
    representativeMeasurementCode: null,
    measuredMeasurementCodes: [],
    recordRevision: null,
  })),
});

test("대표 API 미연결과 실제 계약의 빈 기록을 구분하고 재시도한다", async ({
  page,
}) => {
  await installApi(page, storedRecordFixture(), storedCatalogFixture);
  await page.goto("/account");
  await expect(page.getByText(/체력 프로필을 준비 중이에요/)).toBeVisible();
  await expect(page.locator(".radar-point")).toHaveCount(0);
  await page.route("**/measurements/latest-polygon", (route) =>
    route.fulfill({ json: empty() }),
  );
  await page.getByRole("button", { name: "체력 프로필 다시 확인" }).click();
  await expect(
    page.getByText("아직 등록한 측정 기록이 없어요.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".radar-point")).toHaveCount(0);
});
test("다른 탭의 기록 변경은 이전 차트를 숨기고 늦게 도착한 응답을 버린다", async ({
  page,
}) => {
  await installApi(page, storedRecordFixture(), storedCatalogFixture);
  let count = 0;
  let phase: "initial" | "held" | "updated" = "initial";
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/measurements/latest-polygon", async (route) => {
    count++;
    // Development Strict Mode may mount twice; hold only an explicit refresh.
    const responsePhase = phase;
    if (responsePhase === "held") await held;
    await route
      .fulfill({ json: responsePhase === "updated" ? empty() : polygon() })
      .catch(() => {});
  });
  await page.goto("/account");
  await expect(page.locator(".radar-point")).toHaveCount(6);
  const broadcast = async () => {
    const other = await page.context().newPage();
    await other.route("**/contract-broadcast", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
    );
    await other.goto("/contract-broadcast");
    await other.evaluate((id) => {
      const c = new BroadcastChannel("modu-auth-session");
      c.postMessage({ type: "profile-changed", userId: id });
      c.close();
    }, testUser.id);
    await other.close();
  };
  const initialRequests = count;
  phase = "held";
  await broadcast();
  await expect.poll(() => count).toBeGreaterThan(initialRequests);
  await expect(page.locator(".radar-point")).toHaveCount(0);
  phase = "updated";
  await broadcast();
  await expect(
    page.getByText("아직 등록한 측정 기록이 없어요.", { exact: true }),
  ).toBeVisible();
  release();
  await expect(page.locator(".radar-point")).toHaveCount(0);
});
test("대표 응답의 revision 불일치는 잘못된 다각형 대신 재시도로 복구한다", async ({
  page,
}) => {
  await installApi(page, storedRecordFixture(), storedCatalogFixture);
  let corrected = false;
  await page.route("**/measurements/latest-polygon", (route) =>
    route.fulfill({ json: { ...polygon(), revision: corrected ? 1 : 2 } }),
  );
  await page.goto("/account");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "평가 응답을 확인하지 못했어요",
  );
  await expect(page.locator(".radar-point")).toHaveCount(0);
  corrected = true;
  await page.getByRole("button", { name: "체력 프로필 다시 확인" }).click();
  await expect(page.locator(".radar-point")).toHaveCount(6);
});
