import { test, expect, type Page } from "@playwright/test";
import { prepareAssessment, skipToFlexibility } from "./workout-helpers";
// Keep the real authentication limiter enabled; start after the preceding group.
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
      email: `self-${crypto.randomUUID()}@example.test`,
      password: "self-assessment-test-2026!",
    },
  });
  expect(response.status()).toBe(201);
  return await response.json();
}
test("성인 범위, 준비 화면, 잘못된 커리큘럼을 처리한다", async ({ page }) => {
  await register(page);
  await page.goto("/onboarding");
  await page.getByRole("link", { name: "결과표가 없어요" }).click();
  await expect(page).toHaveURL(/mode=assessment/);
  await page.getByLabel("만 나이", { exact: true }).fill("18");
  await page.getByRole("button", { name: "측정 준비 완료" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "19~64",
  );
  await page.getByLabel("신장 (cm)").fill("170");
  await page.getByLabel("체중 (kg)").fill("65");
  await expect(page.getByText("22.5", { exact: false })).toBeVisible();
  await page.goto("/workout?curriculum=unknown");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "지원하지 않는",
  );
  await page.getByRole("link", { name: "성인 간이측정 열기" }).click();
  await expect(page.getByLabel("신장 (cm)")).toHaveValue("170");
});
test("교차 윗몸일으키기와 YMCA의 실제 시간·맥박 환산·저장·수정을 검증한다", async ({
  page,
}, info) => {
  const account = await register(page);
  await page.goto("/workout?mode=assessment");
  await prepareAssessment(page);
  await page.clock.install();
  await page.getByRole("button", { name: "측정 시작", exact: true }).click();
  await page.clock.fastForward(63050);
  await page.getByLabel("성공한 횟수 (회)").fill("0");
  await page.getByRole("button", { name: "입력하고 다음으로" }).click();
  await page.getByRole("button", { name: "측정 시작", exact: true }).click();
  await page.clock.fastForward(3050);
  await expect(
    page.getByRole("status").filter({ hasText: "스텝 운동" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "측정 중단", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("navigation", { name: "하단 메뉴" }),
  ).not.toBeVisible();
  await page.screenshot({
    path: info.outputPath("ymca-running.png"),
    fullPage: true,
  });
  await page.clock.fastForward(180000);
  await expect(
    page.getByText("회복 · 편안히 쉬어요", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(60000);
  await expect(
    page.getByText("손목 맥박을 세어 주세요", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(10000);
  await page.getByLabel("10초 동안 센 맥박 (회)").fill("15");
  await expect(
    page.getByText("분당 심박수 90 bpm으로 저장돼요."),
  ).toBeVisible();
  await page.getByRole("button", { name: "입력하고 다음으로" }).click();
  await page.getByRole("button", { name: "측정값 입력", exact: true }).click();
  await page.getByLabel("기준선에서 도달한 거리 (cm)").fill("-2.5");
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("review.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
  const profile = await page.request.get(`${api}/auth/me`, {
    headers: { Authorization: `Bearer ${account.access_token}` },
  });
  expect((await profile.json()).isOnboarded).toBe(true);
  await page.getByRole("link", { name: "측정 기록 보기", exact: true }).click();
  await expect(page.getByText("자가측정", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("definition").filter({ hasText: "90 bpm" }),
  ).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1);
  const record = await page.request.get(`${api}/measurements/${id}`, {
    headers: { Authorization: `Bearer ${account.access_token}` },
  });
  const saved = await record.json();
  expect(saved).toMatchObject({
    entryMethod: "self_assessment",
    reportKind: "unknown",
  });
  expect(
    saved.items.map((i: { measurementCode: string; value: string }) => [
      i.measurementCode,
      i.value,
    ]),
  ).toEqual([
    ["cross_sit_up", "0"],
    ["sit_and_reach", "-2.5"],
    ["ymca_recovery_heart_rate", "90"],
  ]);
  await page.getByRole("link", { name: "기록 수정" }).click();
  await expect(page.getByText("항목별 결과표 등급")).toHaveCount(0);
  await page.getByLabel("YMCA 회복 심박수", { exact: true }).fill("96.5");
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page).toHaveURL(/saved=1/);
  const changed = await page.request.get(`${api}/measurements/${id}`, {
    headers: { Authorization: `Bearer ${account.access_token}` },
  });
  expect(await changed.json()).toMatchObject({
    entryMethod: "self_assessment",
    reportKind: "unknown",
    revision: 2,
    items: expect.arrayContaining([
      {
        ...saved.items.find(
          (item: { measurementCode: string }) =>
            item.measurementCode === "ymca_recovery_heart_rate",
        ),
        value: "96.5",
        evaluation: expect.objectContaining({ recordRevision: 2 }),
      },
    ]),
  });
  await page.getByRole("link", { name: "메인", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "편안하게 숨 쉬는 햄스터" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "나의 기록을 이어가요" }),
  ).toHaveCount(0);
});
test("건너뛰기는 0을 만들지 않고, 응답 유실 후 같은 요청으로 한 번만 저장한다", async ({
  page,
}) => {
  const account = await register(page);
  await page.goto("/workout?mode=assessment");
  await prepareAssessment(page);
  await skipToFlexibility(page);
  await page.getByLabel("기준선에서 도달한 거리 (cm)").fill("-3");
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  const attempts: { key: string; body: string | null }[] = [];
  await page.route(`${api}/measurements`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(attempts.length === 1 ? 201 : 200);
    if (attempts.length === 1) await route.abort("connectionreset");
    else await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "같은 내용으로 다시 확인" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "앉아 윗몸 앞으로 굽히기 다시 측정" }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "같은 내용으로 다시 확인" }).click();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
  const list = await page.request.get(`${api}/measurements`, {
    headers: { Authorization: `Bearer ${account.access_token}` },
  });
  const records = (await list.json()).items;
  expect(records).toHaveLength(1);
  expect(records[0].itemCount).toBe(1);
});
test("빈 측정은 저장하지 않으며 결과 재측정과 신체정보 수정을 지원한다", async ({
  page,
}) => {
  await register(page);
  await page.goto("/workout?mode=assessment");
  await prepareAssessment(page);
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  await expect(
    page.getByText("측정값을 하나 이상 입력해 주세요."),
  ).toBeVisible();
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await expect(page.getByRole("radio", { name: "윗몸말아올리기" })).toHaveCount(
    0,
  );
  await page.getByLabel("신장 (cm)").fill("170");
  await page.getByRole("button", { name: "변경 완료" }).click();
  await page
    .getByRole("button", { name: "앉아 윗몸 앞으로 굽히기 다시 측정" })
    .click();
  await page.getByRole("button", { name: "측정값 입력", exact: true }).click();
  await page.getByLabel("기준선에서 도달한 거리 (cm)").fill("0");
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
});
test("교차 윗몸일으키기 중단·새로고침 후 60초 재측정을 지원한다", async ({
  page,
}) => {
  await register(page);
  await page.goto("/workout?mode=assessment");
  await prepareAssessment(page);
  await page.clock.install();
  await page.getByRole("button", { name: "측정 시작", exact: true }).click();
  await page.clock.fastForward(3100);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "이 항목 다시 시작" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "이 항목 다시 시작" }).click();
  await page.clock.fastForward(63050);
  await page.getByLabel("성공한 횟수 (회)").fill("1");
  await page.getByRole("button", { name: "입력하고 다음으로" }).click();
  await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
});

test("재로그인 후 간이측정 저장 요청의 키와 본문을 복구한다", async ({
  page,
}) => {
  const account = await register(page);
  await page.goto("/workout?mode=assessment");
  await prepareAssessment(page);
  await skipToFlexibility(page);
  await page.getByLabel("기준선에서 도달한 거리 (cm)").fill("2");
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  const attempts: { key: string; body: string | null }[] = [];
  await page.route(`${api}/measurements`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    if (attempts.length > 1) return route.continue();
    await route.fulfill({
      status: 401,
      json: { message: "Expired test session" },
      headers: {
        "Access-Control-Allow-Origin": route.request().headers().origin,
        "Access-Control-Allow-Credentials": "true",
      },
    });
  });
  await page.route(`${api}/auth/refresh`, async (route) =>
    route.fulfill({
      status: 401,
      json: { message: "Expired test refresh" },
      headers: {
        "Access-Control-Allow-Origin": route.request().headers().origin,
        "Access-Control-Allow-Credentials": "true",
      },
    }),
  );
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login/);
  await page.unroute(`${api}/auth/refresh`);
  await page.getByLabel("이메일", { exact: true }).fill(account.user.email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("self-assessment-test-2026!");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "같은 내용으로 다시 확인" }),
  ).toBeVisible();
  expect(attempts).toHaveLength(1);
  await page.getByRole("button", { name: "같은 내용으로 다시 확인" }).click();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
});
test("신체정보만 저장한 뒤 수정하면 BMI도 현재 값으로 계산한다", async ({
  page,
}) => {
  await register(page);
  await page.goto("/workout?mode=assessment");
  await page.getByLabel("신장 (cm)").fill("170");
  await page.getByLabel("체중 (kg)").fill("65");
  await prepareAssessment(page);
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  await page.getByRole("link", { name: "측정 기록 보기", exact: true }).click();
  await page.getByRole("link", { name: "기록 수정" }).click();
  await page.getByLabel("신장", { exact: true }).fill("180");
  await expect(page.getByLabel("BMI", { exact: true })).toHaveValue("20.1");
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page).toHaveURL(/saved=1/);
  await expect(
    page.getByRole("definition").filter({ hasText: "20.1" }),
  ).toBeVisible();
});
test("320px 측정 화면의 조작 버튼이 보이고 카탈로그 장애에서 초안을 복원한다", async ({
  page,
}, info) => {
  await register(page);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/workout?mode=assessment");
  await page.getByLabel("만 나이", { exact: true }).fill("25");
  await page.route(`${api}/measurement-catalog*`, async (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Injected catalog failure" },
      headers: {
        "Access-Control-Allow-Origin": route.request().headers().origin,
        "Access-Control-Allow-Credentials": "true",
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page.unroute(`${api}/measurement-catalog*`);
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(page.getByLabel("만 나이", { exact: true })).toHaveValue("25");
  await page.getByRole("button", { name: "측정 준비 완료" }).click();
  await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  await page.getByRole("button", { name: "안내 소리 켜기" }).click();
  await expect(
    page.getByRole("button", { name: "안내 소리 끄기" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "측정 시작", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "측정 중단", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("workout-320.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "측정 중단", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "이 항목 다시 시작" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "나중에 이어하기" }).click();
  await expect(
    page.getByRole("navigation", { name: "하단 메뉴" }),
  ).toBeVisible();
});

test("서버에서 삭제된 저장 요청은 재전송을 멈추고 새 측정으로 이동할 수 있다", async ({
  page,
}) => {
  await register(page);
  await page.goto("/workout?mode=assessment");
  await prepareAssessment(page);
  await skipToFlexibility(page);
  await page.getByLabel("기준선에서 도달한 거리 (cm)").fill("1");
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  await page.route(`${api}/measurements`, async (route) =>
    route.fulfill({
      status: 410,
      json: { message: "Deleted measurement" },
      headers: {
        "Access-Control-Allow-Origin": route.request().headers().origin,
        "Access-Control-Allow-Credentials": "true",
      },
    }),
  );
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "같은 내용으로 다시 확인" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "이 요청을 닫고 새로 측정" }).click();
  await page
    .getByRole("button", { name: "처음부터 시작", exact: true })
    .click();
  await expect(page.getByLabel("만 나이", { exact: true })).toHaveValue("");
});

test("저장 완료 후 메인에서 다시 시작하면 이전 값 없이 별도 기록을 만든다", async ({
  page,
}) => {
  const account = await register(page);
  await page.goto("/onboarding");
  await page.getByRole("link", { name: "결과표가 없어요" }).click();
  for (const value of ["1", "2"]) {
    await expect(page.getByLabel("만 나이", { exact: true })).toHaveValue("");
    await prepareAssessment(page);
    await skipToFlexibility(page);
    await page.getByLabel("기준선에서 도달한 거리 (cm)").fill(value);
    await page.getByRole("button", { name: "결과 확인", exact: true }).click();
    await page
      .getByRole("button", { name: "측정 기록 저장", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
    ).toBeVisible();
    if (value === "1") {
      await expect(
        page.getByRole("link", { name: "새 체력 기록 시작" }),
      ).toHaveCount(0);
      await page.getByRole("link", { name: "메인으로", exact: true }).click();
      await page.goto("/onboarding");
      await expect(page).toHaveURL(/\/onboarding$/);
      await expect(
        page.getByRole("heading", { name: "체력 기록 시작", exact: true }),
      ).toBeVisible();
      await page.getByRole("link", { name: "결과표가 없어요" }).click();
    }
  }
  const response = await page.request.get(`${api}/measurements`, {
    headers: { Authorization: `Bearer ${account.access_token}` },
  });
  expect((await response.json()).items).toHaveLength(2);
});
