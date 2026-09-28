import { test, expect, type Page } from "@playwright/test";
import { prepareAssessment, skipToFlexibility } from "./workout-helpers";
const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
const password = "fitness-live-test-2026!";
const today = () =>
  new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
let headers: Record<string, string>, version: string;
let pageErrors: string[];
const examples = [
  ["왕복오래달리기(20m)", "44", "shuttle_run_20m", "회"],
  ["상대악력", "51.6", "relative_grip_strength", "%"],
  ["교차윗몸일으키기", "51", "cross_sit_up", "회"],
  ["앉아윗몸앞으로굽히기", "10.1", "sit_and_reach", "cm"],
  ["반응시간", "0.335", "reaction_time", "초"],
  ["제자리 멀리뛰기", "223", "standing_long_jump", "cm"],
];
// These scenarios use real HTTP responses, never route.fulfill or grade fixtures.
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  headers = {
    Origin: new URL(test.info().project.use.baseURL as string).origin,
    "X-CSRF-Protection": "1",
  };
  const r = await page.request.post(`${api}/auth/register`, {
    headers,
    data: {
      email: `fitness-live-${crypto.randomUUID()}@example.test`,
      password,
    },
  });
  expect(r.status()).toBe(201);
  headers.Authorization = `Bearer ${(await r.json()).access_token}`;
  const catalog = await page.request.get(`${api}/measurement-catalog`);
  expect(catalog.status()).toBe(200);
  version = (await catalog.json()).version;
});
test.afterEach(async ({ page }) => {
  if (headers.Authorization) {
    const removed = await page.request.delete(`${api}/users/me`, {
      headers,
      data: { password },
    });
    expect(removed.status()).toBe(204);
  }
  expect(pageErrors).toEqual([]);
});
async function add(page: Page, label: string, value: string) {
  await page
    .getByRole("button", { name: "측정 항목 추가", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("검사명 검색").fill(label);
  await page
    .getByRole("dialog")
    .getByRole("button")
    .filter({ hasText: label })
    .click();
  await page.getByLabel(label, { exact: true }).fill(value);
}
async function seed(page: Page, overrides: Record<string, unknown> = {}) {
  const response = await page.request.post(`${api}/measurements`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      catalogVersion: version,
      measuredOn: today(),
      ageAtMeasurement: 25,
      sexAtMeasurement: "male",
      items: examples.map(([, value, measurementCode, unit]) => ({
        measurementCode,
        value,
        unit,
      })),
      ...overrides,
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
test("실제 API: 6종목 직접 입력·상세 등급·기준·수정 재평가", async ({
  page,
}, info) => {
  await page.goto("/measurements");
  await page
    .getByRole("link", { name: "첫 측정 기록 등록", exact: true })
    .click();
  await expect(page).toHaveURL("/onboarding");
  await page.getByRole("link", { name: "직접 입력하기" }).click();
  await page.getByLabel("측정일", { exact: true }).fill(today());
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("25");
  await page.getByText("추가 정보", { exact: false }).click();
  await page.getByLabel("성별", { exact: true }).selectOption("male");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  for (const [label, value] of examples) await add(page, label, value);
  const waiting = page.waitForResponse(
    (r) => r.url() === `${api}/measurements` && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "6개 항목 저장하기" }).click();
  const response = await waiting;
  expect(response.status()).toBe(201);
  const saved = await response.json();
  expect(saved.axes.map((a: { grade: number }) => a.grade)).toEqual([
    2, 3, 1, 2, 2, 1,
  ]);
  await expect(page).toHaveURL(/\/onboarding\/complete\?record=/);
  await page.goto(`/measurements/${saved.id}`);
  await expect(
    page.locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade"),
  ).toHaveText(["2등급", "3등급", "1등급", "2등급", "2등급", "1등급"]);
  await expect(page.locator(".radar-point")).toHaveCount(6);
  await page.locator('summary[aria-label^="유연성 · 2등급"]').click();
  await expect(page.getByText(/현재 값과의 차이 4.8 cm/)).toBeVisible();
  await page.screenshot({
    path: info.outputPath("real-detail.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "기록 수정", exact: true }).click();
  await page.getByLabel("앉아윗몸앞으로굽히기", { exact: true }).fill("14.9");
  await add(page, "트레드밀(VO₂max)", "44.8");
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page).toHaveURL(/saved=1/);
  await expect(
    page.locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade"),
  ).toHaveText(["1등급", "3등급", "1등급", "1등급", "2등급", "1등급"]);
  await page.reload();
  await expect(
    page
      .locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade")
      .nth(3),
  ).toHaveText("1등급");
  const stored = await page.request.get(`${api}/measurements/${saved.id}`, {
    headers,
  });
  const changed = await stored.json();
  expect(changed.revision).toBe(2);
  expect(
    changed.items.every(
      (i: { evaluation: { recordRevision: number } }) =>
        i.evaluation.recordRevision === 2,
    ),
  ).toBe(true);
});
test("실제 API: 미측정·정보 부족·기준 미확보·0회·음수를 구별한다", async ({
  page,
}) => {
  const saved = await seed(page, {
    entryMethod: "self_assessment",
    items: [
      { measurementCode: "cross_sit_up", value: "0", unit: "회" },
      { measurementCode: "sit_and_reach", value: "-2.5", unit: "cm" },
      { measurementCode: "ymca_recovery_heart_rate", value: "90", unit: "bpm" },
    ],
  });
  await page.goto(`/measurements/${saved.id}`);
  await expect(
    page.locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade"),
  ).toHaveText([
    "평가 불가 · 정보 부족",
    "평가 미존재 · 미측정",
    "기준 미달",
    "기준 미달",
    "평가 미존재 · 미측정",
    "평가 미존재 · 미측정",
  ]);
  await expect(page.locator('.radar-point[cx="180"][cy="158"]')).toHaveCount(4);
  await expect(page.getByTestId("radar-path")).toHaveAttribute("d", / Z$/);
  const patch = await page.request.patch(`${api}/measurements/${saved.id}`, {
    headers: { ...headers, "If-Match": '"1"' },
    data: { sexAtMeasurement: null },
  });
  expect(patch.status()).toBe(200);
  await page.reload();
  await expect(
    page
      .locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade")
      .nth(3),
  ).toHaveText("평가 불가 · 정보 부족");
  await expect(page.locator('.radar-point[cx="180"][cy="158"]')).toHaveCount(6);
});

test("실제 API: 내 프로필은 최신 한 회차만 표시하고 수정·삭제 후 갱신한다", async ({
  page,
}, info) => {
  const yesterday = new Date(Date.now() + 9 * 3600000 - 86400000)
    .toISOString()
    .slice(0, 10);
  const older = await seed(page, { measuredOn: yesterday });
  const partial = await seed(page, {
    entryMethod: "self_assessment",
    items: [{ measurementCode: "sit_and_reach", value: "10.1", unit: "cm" }],
  });
  await page.goto("/account");
  await expect(page.locator(".latest-fitness .radar-point")).toHaveCount(6);
  await expect(
    page.locator('.latest-fitness .radar-point[cx="180"][cy="158"]'),
  ).toHaveCount(5);
  await expect(page.locator(".latest-fitness .radar-grade")).toHaveText([
    "평가 미존재",
    "평가 미존재",
    "평가 미존재",
    "2등급",
    "평가 미존재",
    "평가 미존재",
  ]);
  await expect(
    page.getByRole("link", { name: "이 기록의 상세 리포트 보기" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("real-latest-partial.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "내 측정 기록", exact: true }).click();
  await page
    .locator(`a.record-card[href="/measurements/${partial.id}"]`)
    .click();
  await page.getByRole("link", { name: "기록 수정", exact: true }).click();
  await page.getByLabel("앉아윗몸앞으로굽히기", { exact: true }).fill("14.9");
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page).toHaveURL(/saved=1/);
  await page
    .getByRole("navigation", { name: "하단 메뉴" })
    .getByRole("link", { name: "내 프로필", exact: true })
    .click();
  await expect(page.locator(".latest-fitness .radar-grade").nth(3)).toHaveText(
    "1등급",
  );
  await page.getByRole("link", { name: "내 측정 기록", exact: true }).click();
  await page
    .locator(`a.record-card[href="/measurements/${partial.id}"]`)
    .click();
  await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "기록 삭제", exact: true })
    .click();
  await expect(page).toHaveURL("/measurements");
  await page
    .getByRole("navigation", { name: "하단 메뉴" })
    .getByRole("link", { name: "내 프로필", exact: true })
    .click();
  await expect(page.locator(".latest-fitness .radar-grade")).toHaveText([
    "2등급",
    "3등급",
    "1등급",
    "2등급",
    "2등급",
    "1등급",
  ]);
  await expect(
    page.getByRole("link", { name: "이 기록의 상세 리포트 보기" }),
  ).toHaveCount(0);
  const removed = await page.request.delete(`${api}/measurements/${older.id}`, {
    headers: { ...headers, "If-Match": '"1"' },
  });
  expect(removed.status()).toBe(204);
  const empty = await page.request.get(`${api}/measurements/latest-polygon`, {
    headers,
  });
  expect(empty.status()).toBe(200);
  expect(await empty.json()).toMatchObject({
    measurementId: null,
    measuredOn: null,
    revision: null,
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toBeVisible();
  await expect(page.locator(".radar-point")).toHaveCount(0);
});

test("실제 API: 간이측정은 기관 결과표와 구분하고 부분 기록·평가·온보딩을 저장한다", async ({
  page,
}) => {
  const before = await page.request.get(`${api}/auth/me`, { headers });
  const profile = await before.json();
  await page.goto("/onboarding");
  await page.getByRole("link", { name: "결과표가 없어요" }).click();
  await page.getByLabel("성별 (선택)").selectOption("male");
  await prepareAssessment(page);
  await skipToFlexibility(page);
  await page.getByLabel("기준선에서 도달한 거리 (cm)").fill("10.1");
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  const waiting = page.waitForResponse(
    (r) => r.url() === `${api}/measurements` && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  const response = await waiting;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({
    entryMethod: "self_assessment",
    reportKind: "unknown",
    items: [{ measurementCode: "sit_and_reach", value: "10.1", unit: "cm" }],
  });
  const saved = await response.json();
  expect(saved).toMatchObject({
    entryMethod: "self_assessment",
    reportKind: "unknown",
  });
  expect(saved.items).toHaveLength(1);
  await page.getByRole("link", { name: "측정 기록 보기", exact: true }).click();
  await expect(page.locator(".radar-point")).toHaveCount(6);
  await expect(page.locator('.radar-point[cx="180"][cy="158"]')).toHaveCount(5);
  await expect(
    page
      .locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade")
      .nth(3),
  ).toHaveText("2등급");
  await page.getByRole("link", { name: "기록 수정", exact: true }).click();
  await page.getByRole("button", { name: "변경", exact: true }).click();
  await page.getByText("추가 정보", { exact: false }).click();
  await expect(page.getByLabel("측정 당시 성별")).toHaveValue("male");
  await expect(page.getByLabel("측정 유형", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("측정 센터", { exact: true })).toHaveCount(0);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await expect(page.locator(".latest-fitness .radar-grade").nth(3)).toHaveText(
    "2등급",
  );
  const after = await page.request.get(`${api}/auth/me`, { headers });
  expect(await after.json()).toMatchObject({
    isOnboarded: true,
    currentCurriculum: profile.currentCurriculum,
  });
});

test("실제 API: 절대악력 저장·환산 리포트·체중 수정 및 제거를 검증한다", async ({
  page,
}, info) => {
  await page.goto("/onboarding/manual");
  await page.getByLabel("측정일", { exact: true }).fill(today());
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("25");
  await page.getByText("추가 정보", { exact: false }).click();
  await page.getByLabel("성별", { exact: true }).selectOption("male");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await add(page, "절대악력", "30");
  await page.getByRole("button", { name: "측정 당시 체중 추가" }).click();
  await page.locator("#value-weight").fill("50");
  const waiting = page.waitForResponse(
    (r) => r.url() === `${api}/measurements` && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "2개 항목 저장하기" }).click();
  const response = await waiting;
  expect(response.status()).toBe(201);
  const record = await response.json();
  const grip = record.items.find(
    (i: { measurementCode: string }) =>
      i.measurementCode === "absolute_grip_strength",
  );
  expect(grip).toMatchObject({
    value: "30",
    unit: "kg",
    evaluation: { grade: 2, conversion: { value: "60", unit: "%" } },
  });
  await expect(page).toHaveURL(/\/onboarding\/complete\?record=/);
  await page.getByRole("link", { name: "메인으로", exact: true }).click();
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await expect(page.locator(".latest-fitness .radar-grade").nth(1)).toHaveText(
    "2등급",
  );
  await page.goto(`/measurements/${record.id}`);
  await page.locator('summary[aria-label^="근력 · 2등급"]').click();
  await expect(
    page.getByText("등급 판정에 사용한 상대악력: 60 %"),
  ).toBeVisible();
  await expect(
    page.getByText("현재 값과의 차이 2.4 %p · 증가 필요"),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("absolute-grip-report.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "기록 수정" }).click();
  await page.locator("#value-weight").fill("100");
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page).toHaveURL(/saved=1/);
  await expect(
    page
      .locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade")
      .nth(1),
  ).toHaveText("기준 미달");
  await page.reload();
  await page.locator('summary[aria-label^="근력 · 기준 미달"]').click();
  await expect(
    page.getByText("등급 판정에 사용한 상대악력: 30 %"),
  ).toBeVisible();
  await page.getByRole("link", { name: "기록 수정" }).click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "체중 항목 삭제", exact: true })
    .click();
  await expect(page.getByText(/체중이 없으면 절대악력만 저장/)).toBeVisible();
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page).toHaveURL(/saved=1/);
  await expect(
    page
      .locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade")
      .nth(1),
  ).toHaveText("평가 불가 · 정보 부족");
  await page
    .locator('summary[aria-label^="근력 · 평가 불가 · 정보 부족"]')
    .click();
  await expect(
    page
      .locator(".evaluation-item")
      .getByText(/같은 측정 기록의 체중\(kg\)이 없습니다/),
  ).toBeVisible();
  await expect(
    page.locator(".evaluation-item").getByText("30 kg", { exact: true }),
  ).toBeVisible();
  const saved = await page.request.get(`${api}/measurements/${record.id}`, {
    headers,
  });
  expect((await saved.json()).items).toHaveLength(1);
});

test("실제 API: 스텝검사 완료부터 환산 리포트·내 프로필·신체정보 수정까지 연결된다", async ({
  page,
}, info) => {
  await page.goto("/workout?mode=assessment");
  await page.getByLabel("성별", { exact: false }).selectOption("male");
  await page.getByLabel("신장 (cm)").fill("170");
  await page.getByLabel("체중 (kg)").fill("65");
  await prepareAssessment(page);
  await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  await page.clock.install();
  await page.getByRole("button", { name: "측정 시작", exact: true }).click();
  await page.clock.fastForward(253050);
  await page.getByLabel("10초 동안 센 맥박 (회)").fill("15");
  await expect(
    page.getByText("분당 심박수 90 bpm으로 저장돼요."),
  ).toBeVisible();
  await page.getByRole("button", { name: "입력하고 다음으로" }).click();
  await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  const waiting = page.waitForResponse(
    (r) => r.url() === `${api}/measurements` && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  const response = await waiting;
  expect(response.status()).toBe(201);
  const record = await response.json();
  expect(
    record.items.find(
      (i: { measurementCode: string }) =>
        i.measurementCode === "ymca_recovery_heart_rate",
    ),
  ).toMatchObject({
    value: "90",
    unit: "bpm",
    evaluation: {
      grade: 1,
      conversion: { value: "49.877", assessmentKind: "reference" },
    },
  });
  await page.getByRole("link", { name: "측정 기록 보기", exact: true }).click();
  await expect(
    page
      .locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade")
      .first(),
  ).toHaveText("1등급 (참고)");
  await page.locator('summary[aria-label^="심폐지구력 · 1등급"]').click();
  await expect(
    page.getByLabel("추정 최대산소섭취량: 49.877 ml/kg/min", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("step-live-detail.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/account");
  await expect(page.locator(".latest-fitness .radar-grade").first()).toHaveText(
    "1등급 (참고)",
  );
  await page.goto(`/measurements/${record.id}/edit`);
  await page.getByLabel("체중", { exact: true }).fill("100");
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page).toHaveURL(/saved=1/);
  await expect(
    page
      .locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade")
      .first(),
  ).toHaveText("3등급 (참고)");
  await page.locator('summary[aria-label^="심폐지구력 · 3등급"]').click();
  await expect(
    page.getByLabel("추정 최대산소섭취량: 42.107 ml/kg/min", { exact: true }),
  ).toBeVisible();
  await page.goto(`/measurements/${record.id}/edit`);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "신장 항목 삭제", exact: true })
    .click();
  await expect(
    page.getByText(/스텝검사 평가에 필요한 정보: 신장/),
  ).toBeVisible();
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page).toHaveURL(/saved=1/);
  await page.reload();
  await expect(
    page
      .locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade")
      .first(),
  ).toHaveText("평가 불가 · 정보 부족");
  await expect(
    page.getByRole("definition").filter({ hasText: "90 bpm" }),
  ).toBeVisible();
  await page.goto("/account");
  await expect(page.locator(".latest-fitness .radar-grade").first()).toHaveText(
    "평가 불가",
  );
});
