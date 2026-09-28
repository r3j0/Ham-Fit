import { test, expect, type Page } from "@playwright/test";

// Keep the real API's authentication limit enabled between test groups.
test.beforeAll(async () => {
  test.setTimeout(65000);
  await new Promise((resolve) =>
    setTimeout(resolve, 60000 - (Date.now() % 60000) + 250),
  );
});
const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
async function register(page: Page) {
  const response = await page.request.post(`${api}/auth/register`, {
    headers: {
      Origin: new URL(test.info().project.use.baseURL as string).origin,
      "X-CSRF-Protection": "1",
    },
    data: {
      email: `profile-recovery-${crypto.randomUUID()}@example.test`,
      password: "profile-recovery-password-2026!",
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function createRecord(page: Page, token: string) {
  const catalog = await page.request.get(`${api}/measurement-catalog`);
  expect(catalog.ok()).toBe(true);
  const { version, definitions } = await catalog.json();
  const height = definitions.find(
    (item: { label: string }) => item.label === "신장",
  );
  const response = await page.request.post(`${api}/measurements`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      measuredOn: "2026-09-17",
      ageAtMeasurement: 25,
      sexAtMeasurement: null,
      reportKind: "unknown",
      centerName: null,
      reportedOverallGrade: null,
      catalogVersion: version,
      items: [
        {
          measurementCode: height.code,
          value: "170",
          unit: height.unit,
          reportedGrade: null,
        },
      ],
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test("저장 응답을 잃어도 메인은 실제 서버의 등록 상태를 반영한다", async ({
  page,
}) => {
  await register(page);
  await page.goto("/");
  await page.getByRole("link", { name: "체력 기록 등록하기" }).click();
  await page.getByRole("link", { name: "직접 입력하기", exact: false }).click();
  await page.getByLabel("측정일", { exact: true }).fill("2026-09-17");
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("25");
  await page.getByLabel("성별", { exact: true }).selectOption("male");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await page
    .getByRole("button", { name: "측정 항목 추가", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("검사명 검색").fill("신장");
  await page
    .getByRole("dialog")
    .getByRole("button")
    .filter({ hasText: "신장" })
    .click();
  await page.getByLabel("신장", { exact: true }).fill("170");
  let creates = 0;
  await page.route(`${api}/measurements`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    creates++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
  await expect(
    page.getByRole("button", { name: "같은 내용으로 다시 확인" }),
  ).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  // The onboarding flow hides the main tab. Leave via browser history and
  // its existing back link while keeping the same client profile provider.
  await page.goBack();
  await expect(page).toHaveURL("/onboarding");
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "편안하게 숨 쉬는 햄스터" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toHaveCount(0);
  expect(creates).toBe(1);
});

test("focus 없이 화면이 다시 표시되어도 외부 변경을 반영한다", async ({
  page,
}) => {
  const account = await register(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toBeVisible();
  // Model an app returning from the background without a window focus event.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await createRecord(page, account.access_token);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("img", { name: "편안하게 숨 쉬는 햄스터" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toHaveCount(0);
});

test("마지막 기록의 삭제 응답을 잃어도 메인 등록 상태를 다시 확인한다", async ({
  page,
}) => {
  const account = await register(page);
  const record = await createRecord(page, account.access_token);
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: "편안하게 숨 쉬는 햄스터" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await page.getByRole("link", { name: "내 측정 기록", exact: true }).click();
  await page.locator(".record-card").click();
  let deletes = 0;
  await page.route(`${api}/measurements/${record.id}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deletes++;
    const response = await route.fetch();
    expect(response.status()).toBe(204);
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "기록 삭제", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "서버에 연결하지 못했어요",
  );
  await page.getByRole("link", { name: "메인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toBeVisible();
  expect(deletes).toBe(1);
});
