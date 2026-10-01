import { setMeasurementAge } from "./measurement-age-helpers";
import { test, expect, type Page, type Route } from "@playwright/test";
// Keep actual authentication limits enabled. This large file can otherwise
// exhaust the shared IP window halfway through a successful scenario.
let authGroup = 0;
test.beforeEach(async () => {
  if (authGroup++ % 15 !== 0) return;
  test.setTimeout(test.info().timeout + 65000);
  await new Promise((resolve) =>
    setTimeout(resolve, 60000 - (Date.now() % 60000) + 250),
  );
});
const password = "frontend-test-password-2026!";
const apiOrigin = new URL(
  process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1",
).origin;
function failApi(route: Route, status: number, extra = {}) {
  return route.fulfill({
    status,
    json: { message: "Injected test error", ...extra },
    headers: {
      "Access-Control-Allow-Origin": route.request().headers().origin,
      "Access-Control-Allow-Credentials": "true",
    },
  });
}
async function login(page: Page, email: string) {
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  const response = page.waitForResponse((r) => r.url().endsWith("/auth/login"));
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  if ((await response).status() === 429) {
    await expect(
      page.getByRole("button", { name: "로그인", exact: true }),
    ).toBeEnabled({ timeout: 65000 });
    await page.getByRole("button", { name: "로그인", exact: true }).click();
  }
}
async function signout(page: Page) {
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/auth/logout"),
  );
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();
  const result = await response;
  if (result.status() === 429) {
    const body = await result.json();
    // The full suite shares a client IP. Respect the real server's wait; never disable rate limiting.
    await page.waitForTimeout(
      Math.min(60, Number(body.retry_after) || 60) * 1000,
    );
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "로그아웃", exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/login/);
}
async function openRecords(page: Page) {
  await page
    .getByRole("navigation", { name: "하단 메뉴" })
    .getByRole("link", { name: "내 프로필", exact: true })
    .click();
  await page.getByRole("link", { name: "내 측정 기록", exact: true }).click();
}
async function signup(page: Page, destination: "records" | "main" = "records") {
  const email = `frontend-e2e-${crypto.randomUUID()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인", { exact: true }).fill(password);
  await page.getByLabel("생년월일", { exact: true }).fill("2000-02-29");
  const registration = page.waitForResponse((response) =>
    response.url().endsWith("/auth/register"),
  );
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  if ((await registration).status() === 429) {
    // Respect the real backend's rate limit when running the full suite repeatedly.
    await expect(
      page.getByRole("button", { name: "가입하고 시작하기" }),
    ).toBeEnabled({ timeout: 65000 });
    await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  }
  await expect(page).toHaveURL("/welcome");
  await page.getByLabel("닉네임", { exact: true }).fill("운동친구");
  await page.getByRole("button", { name: "저장하고 다음으로" }).click();
  await expect(page).toHaveURL("/onboarding");
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toHaveCount(
    0,
  );
  if (destination === "records") {
    await page.getByRole("link", { name: "이전 화면", exact: true }).click();
    await openRecords(page);
    await expect(page.getByText("첫 기록을 기다리고 있어요")).toBeVisible();
  } else {
    await page.getByRole("link", { name: "이전 화면", exact: true }).click();
    await expect(page).toHaveURL("/");
  }
  return email;
}
async function openManualRecord(page: Page) {
  await page.getByRole("link", { name: "새 기록 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "체력 기록 시작", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "직접 입력하기" }).click();
}
async function openSavedRecord(page: Page) {
  await expect(page).toHaveURL(/\/onboarding\/complete\?record=/);
  await page.getByRole("link", { name: "측정 기록 보기", exact: true }).click();
  await expect(page.getByRole("link", { name: "기록 수정" })).toBeVisible();
}
async function startRecord(page: Page, age = "25") {
  await openManualRecord(page);
  await page.getByLabel("측정일", { exact: true }).fill("2026-09-17");
  await setMeasurementAge(page, age);
  await page.getByLabel("성별", { exact: true }).selectOption("male");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(
    page.getByRole("heading", { name: "측정한 항목만 입력해요" }),
  ).toBeVisible();
}
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
async function save(page: Page, count = 1) {
  await page.getByRole("button", { name: `${count}개 항목 저장하기` }).click();
  await openSavedRecord(page);
}
test("가입 → 정확한 부분 저장 → 새로고침 → 수정 → 삭제 → 로그아웃 → 로그인", async ({
  page,
}, testInfo) => {
  const email = await signup(page);
  await page.goto("/measurements/new");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("link", { name: "결과표가 있어요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "결과표가 없어요" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await openRecords(page);
  await startRecord(page);
  await page.getByRole("button", { name: "변경", exact: true }).click();
  await page.getByText("추가 정보", { exact: false }).click();
  await page.getByLabel("성별", { exact: true }).selectOption("female");
  await page.getByLabel("측정 유형", { exact: true }).selectOption("standard");
  await page
    .getByLabel("측정 센터", { exact: true })
    .fill("테스트 체력인증센터");
  await page.getByLabel("결과표 종합등급", { exact: true }).fill("참가등급");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await add(page, "신장", "170.1234567890123456789");
  await add(page, "앉아윗몸앞으로굽히기", "-3.25");
  await add(page, "교차윗몸일으키기", "0");
  await page.getByText("항목별 결과표 등급", { exact: false }).click();
  await page.getByLabel("신장 등급", { exact: true }).fill("참가");
  await save(page, 3);
  await expect(
    page
      .locator(".result-card")
      .getByText("170.1234567890123456789 cm", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".result-card").getByText("-3.25 cm", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".result-card").getByText("0 회", { exact: true }),
  ).toBeVisible();
  await page.getByText("미입력 항목 보기", { exact: false }).click();
  await expect(page.getByText("체중 · 미입력", { exact: true })).toBeVisible();
  await expect(page.getByText("BMI · 미입력", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page
      .locator(".result-card")
      .getByText("170.1234567890123456789 cm", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("record-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "기록 수정" }).click();
  await page.getByLabel("신장", { exact: true }).fill("171.25");
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(
    page.locator(".result-card").getByText("171.25 cm", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".result-card").getByText("-3.25 cm", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".result-card")
      .getByText("결과표 등급: 참가", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("테스트 체력인증센터", { exact: true }),
  ).toBeVisible();
  await page.getByText("결과표 추가 정보", { exact: true }).click();
  await expect(page.getByText("여성", { exact: true })).toBeVisible();
  await expect(page.getByText("일반 체력측정", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("definition").filter({ hasText: "참가등급" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "기록 삭제", exact: true })
    .click();
  await expect(page.getByText("첫 기록을 기다리고 있어요")).toBeVisible();
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(new URL("/", page.url()).href);
  await openRecords(page);
  await expect(page.getByText("첫 기록을 기다리고 있어요")).toBeVisible();
});
test("생년월일은 계정 설정에서 수정·복원하고 조회·저장 실패와 미저장 이탈을 처리한다", async ({
  page,
}) => {
  await signup(page, "main");
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  const input = page.getByLabel("생년월일 입력", { exact: true });
  await expect(input).toHaveCount(0);
  await page.getByRole("link", { name: "계정 설정", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/settings$/);
  await page.getByRole("button", { name: "생년월일", exact: true }).click();
  await expect(input).toHaveValue("2000-02-29");
  await input.fill("1999-03-01");
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/users/me/profile") && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "생년월일 저장" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("생년월일을 저장했어요.")).toBeVisible();
  await page.reload();
  await expect(input).toHaveValue("1999-03-01");
  let failRead = true;
  await page.route("**/users/me/profile", (route) =>
    route.request().method() === "PATCH" || failRead
      ? failApi(route, 503)
      : route.continue(),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "생년월일 다시 불러오기" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "이메일 변경", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("새 이메일", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "생년월일", exact: true }).click();
  failRead = false;
  await page.getByRole("button", { name: "생년월일 다시 불러오기" }).click();
  await expect(input).toHaveValue("1999-03-01");
  await input.fill("1998-03-01");
  await page.getByRole("button", { name: "생년월일 저장" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue("1998-03-01");
  await page
    .getByRole("button", { name: "이메일 변경", exact: true })
    .first()
    .click();
  await page
    .getByLabel("새 이메일", { exact: true })
    .fill("unsaved@example.test");
  let prompts = 0;
  const cancel = async (dialog: import("@playwright/test").Dialog) => {
    prompts++;
    await dialog.dismiss();
  };
  page.on("dialog", cancel);
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/settings\?tab=email$/);
  expect(prompts).toBe(1);
  await expect(page.locator("#profile-birth")).toHaveValue("1998-03-01");
  await expect(page.getByLabel("새 이메일", { exact: true })).toHaveValue(
    "unsaved@example.test",
  );
  page.off("dialog", cancel);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(input).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeEnabled();
});
test("오늘 루틴은 목적·측정을 안내하고 응답 유실·새로고침 후 같은 배정을 복구한다", async ({
  page,
}) => {
  await signup(page, "main");
  await expect(
    page.getByRole("button", { name: "오늘 운동 준비하기", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("button", { name: "오늘 운동 준비하기", exact: true })
    .click();
  await page.getByRole("link", { name: "운동 목적 선택하기" }).click();
  await page.getByText("기본 체력 증진", { exact: true }).click();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByText("운동 설정을 저장했어요.")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "메인", exact: true })
    .click();
  await page
    .getByRole("button", { name: "오늘 운동 준비하기", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "측정 기록 등록하기" }),
  ).toBeVisible();
  await openRecords(page);
  await startRecord(page);
  await add(page, "신장", "170");
  await save(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "메인", exact: true })
    .click();
  let assignmentId = "";
  const keys: string[] = [];
  await page.route("**/workout-routines/today", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    expect(route.request().postDataJSON()).toEqual({});
    const response = await route.fetch();
    if (!assignmentId) {
      assignmentId = (await response.json()).id;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "오늘 운동 준비하기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "이전 추천 요청 확인하기" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "이전 추천 요청 확인하기" }).click();
  await expect(
    page.getByRole("button", { name: "이전 추천 요청 확인하기" }),
  ).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(assignmentId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(
    page.getByRole("list", { name: "오늘 배정된 운동" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "운동 시작하기", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "오늘 운동 준비하기", exact: true }),
  ).toHaveCount(0);
});
test("실제 저장 응답 유실 후 같은 키로 재시도해 중복 생성하지 않는다", async ({
  page,
}) => {
  await signup(page);
  await startRecord(page);
  await add(page, "신장", "170");
  let lost = false;
  const keys: string[] = [];
  await page.route("**/api/v1/measurements", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    if (!lost) {
      lost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
  await expect(
    page.getByRole("button", { name: "같은 내용으로 다시 확인" }),
  ).toBeVisible();
  await expect(page.getByLabel("신장", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "같은 내용으로 다시 확인" }).click();
  await openSavedRecord(page);
  await expect(
    page.locator(".result-card").getByText("170 cm", { exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page.locator(".record-card")).toHaveCount(1);
});
test("두 탭에서의 수정 충돌은 입력을 유지하고 최신 기록을 보여준다", async ({
  page,
  context,
}) => {
  await signup(page);
  await startRecord(page);
  await add(page, "신장", "170");
  await save(page);
  const url = page.url().split("?")[0];
  await page.getByRole("link", { name: "기록 수정" }).click();
  await page.getByLabel("신장", { exact: true }).fill("171");
  const second = await context.newPage();
  await second.goto(url + "/edit");
  await second.getByLabel("신장", { exact: true }).fill("180");
  await second.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(
    second.locator(".result-card").getByText("180 cm", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(
    page.getByRole("dialog", { name: "최신 기록을 확인해 주세요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("180 cm", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "내 입력으로 돌아가기" })
    .click();
  await expect(page.getByLabel("신장", { exact: true })).toHaveValue("171");
  await second.reload();
  await expect(
    second.locator(".result-card").getByText("180 cm", { exact: true }),
  ).toBeVisible();
});
test("동시 새로고침 후 인증 유지, 한 탭의 로그아웃이 다른 탭도 비운다", async ({
  page,
  context,
}) => {
  await signup(page);
  const second = await context.newPage();
  await second.goto("/measurements");
  await expect(second.getByText("첫 기록을 기다리고 있어요")).toBeVisible();
  await Promise.all([page.reload(), second.reload()]);
  for (const tab of [page, second])
    await expect(tab.getByText("첫 기록을 기다리고 있어요")).toBeVisible();
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();
  await expect(second).toHaveURL(/\/login/);
  await expect(
    second.getByRole("heading", { name: "다시 만나 반가워요" }),
  ).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});
test("청소년 항목과 나이 변경 검증, 입력 유지", async ({ page }) => {
  await signup(page);
  await startRecord(page, "18");
  await page
    .getByRole("button", { name: "측정 항목 추가", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button")
      .filter({ hasText: "반복점프" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button")
      .filter({ hasText: "교차윗몸일으키기" }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button")
    .filter({ hasText: "반복점프" })
    .click();
  await page.getByLabel("반복점프", { exact: true }).fill("12");
  await page.getByRole("button", { name: "변경", exact: true }).click();
  await setMeasurementAge(page, "19");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
  await expect(
    page.getByText("이 검사는 만 13~18세에 적용돼요.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("반복점프", { exact: true })).toHaveValue("12");
});
test("다른 사용자 기록 차단 및 기간 필터", async ({ page, browser }) => {
  await signup(page);
  await startRecord(page);
  await add(page, "신장", "170");
  await save(page);
  const url = page.url().split("?")[0];
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await page.getByRole("button", { name: "기간", exact: false }).click();
  await page.getByLabel("시작일", { exact: true }).fill("2026-01-01");
  await page.getByLabel("종료일", { exact: true }).fill("2026-01-31");
  await page.getByRole("button", { name: "기간 적용" }).click();
  await expect(page.getByText("이 기간에는 기록이 없어요")).toBeVisible();
  const other = await browser.newContext({ baseURL: new URL(url).origin });
  const stranger = await other.newPage();
  await signup(stranger);
  await stranger.goto(url);
  await expect(
    stranger.getByRole("alert").filter({ hasText: "기록을 찾을 수 없어요" }),
  ).toBeVisible();
  await expect(stranger.getByText("170 cm", { exact: true })).toHaveCount(0);
  await other.close();
});
test("좁은 화면에서 가로 넘침 없이 로그인 화면 표시", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "다시 만나 반가워요" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("login-320.png"),
    fullPage: true,
  });
});
test("API 인증 만료 응답을 받으면 갱신 후 본인 계정을 다시 조회한다", async ({
  page,
}) => {
  const email = await signup(page);
  let refreshes = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/auth/refresh")) refreshes++;
  });
  await page.route("**/api/v1/auth/me", async (route) => {
    // Keep the active read expired even if Strict Mode cancels its first request.
    if (refreshes === 0) {
      await failApi(route, 401);
    } else await route.continue();
  });
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => refreshes).toBe(1);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  expect(refreshes).toBe(1);
});
test("카탈로그 장애 시 기본 정보를 유지하며 다시 불러올 수 있다", async ({
  page,
}) => {
  await signup(page);
  await openManualRecord(page);
  await page.getByLabel("측정일", { exact: true }).fill("2026-09-17");
  await setMeasurementAge(page, "25");
  await page.getByLabel("성별", { exact: true }).selectOption("male");
  await page.route("**/api/v1/measurement-catalog", (route) =>
    failApi(route, 503),
  );
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(
    page.getByText("서버가 잠시 응답하지 않아요.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByLabel("측정 당시 만 나이", { exact: true }),
  ).toHaveValue("25");
  await expect(page.getByLabel("측정일", { exact: true })).toHaveValue(
    "2026-09-17",
  );
  await page.unroute("**/api/v1/measurement-catalog");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(
    page.getByRole("heading", { name: "측정한 항목만 입력해요" }),
  ).toBeVisible();
});
test("수정된 기록은 최신 내용 확인 전 삭제하지 않는다", async ({
  page,
  context,
}, testInfo) => {
  await signup(page);
  await startRecord(page);
  await add(page, "신장", "170");
  await page.screenshot({
    path: testInfo.outputPath("entry-mobile.png"),
    fullPage: true,
  });
  // A reduced viewport approximates the space left by a mobile keyboard.
  await page.setViewportSize({ width: 390, height: 390 });
  await page.getByLabel("신장", { exact: true }).scrollIntoViewIfNeeded();
  const inputBox = await page.getByLabel("신장", { exact: true }).boundingBox();
  const actionBox = await page
    .getByRole("button", { name: "1개 항목 저장하기" })
    .boundingBox();
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(actionBox!.y);
  await page.setViewportSize({ width: 390, height: 844 });
  await save(page);
  const url = page.url().split("?")[0];
  const second = await context.newPage();
  await second.goto(url + "/edit");
  await second.getByLabel("신장", { exact: true }).fill("180");
  await second.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(
    second.locator(".result-card").getByText("180 cm", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "기록 삭제", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "최신 기록 불러오기", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "기록 삭제", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "최신 기록 불러오기", exact: true })
    .click();
  await expect(
    page.locator(".result-card").getByText("180 cm", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "기록 삭제", exact: true })
    .click();
  await expect(page.getByText("첫 기록을 기다리고 있어요")).toBeVisible();
});

test("뒤로가기·앞으로가기·새로고침 후 측정 입력을 복원한다", async ({
  page,
}) => {
  await signup(page);
  await startRecord(page);
  await add(page, "신장", "170.1234567890123456789");
  await page.getByText("항목별 결과표 등급", { exact: false }).click();
  await page.getByLabel("신장 등급", { exact: true }).fill("참가");
  await page.goBack();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goForward();
  await expect(page.getByLabel("신장", { exact: true })).toHaveValue(
    "170.1234567890123456789",
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel("신장", { exact: true })).toHaveValue(
    "170.1234567890123456789",
  );
  await page.getByText("항목별 결과표 등급", { exact: false }).click();
  await expect(page.getByLabel("신장 등급", { exact: true })).toHaveValue(
    "참가",
  );
  await page.getByRole("button", { name: "변경", exact: true }).click();
  await expect(page.getByLabel("측정일", { exact: true })).toHaveValue(
    "2026-09-17",
  );
  await expect(
    page.getByLabel("측정 당시 만 나이", { exact: true }),
  ).toHaveValue("25");
  await page.getByRole("button", { name: "임시 입력 지우기" }).click();
  await expect(page.getByLabel("측정일", { exact: true })).toHaveValue("");
});

test("저장 응답 유실 뒤 갱신 429와 새로고침에도 원래 키·본문을 유지한다", async ({
  page,
}) => {
  await signup(page);
  await startRecord(page);
  await add(page, "신장", "170");
  let attempts = 0;
  const keys: string[] = [],
    bodies: string[] = [];
  await page.route("**/api/v1/measurements", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts++;
    keys.push(route.request().headers()["idempotency-key"]);
    bodies.push(route.request().postData()!);
    if (attempts === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      return route.abort("failed");
    }
    if (attempts === 2) return failApi(route, 401);
    return route.continue();
  });
  await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
  await expect(
    page.getByRole("button", { name: "같은 내용으로 다시 확인" }),
  ).toBeVisible();
  await page.route("**/api/v1/auth/refresh", (route) =>
    failApi(route, 429, { retry_after: 1 }),
  );
  await page.getByRole("button", { name: "같은 내용으로 다시 확인" }).click();
  await expect(
    page.getByText("요청이 많아요.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("신장", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "같은 내용으로 다시 확인" }),
  ).toBeVisible();
  await page.unroute("**/api/v1/auth/refresh");
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel("신장", { exact: true })).toHaveValue("170");
  await expect(page.getByLabel("신장", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "같은 내용으로 다시 확인" }).click();
  await openSavedRecord(page);
  await expect(
    page.locator(".result-card").getByText("170 cm", { exact: true }),
  ).toBeVisible();
  expect(new Set(keys).size).toBe(1);
  expect(new Set(bodies).size).toBe(1);
  expect(keys).toHaveLength(3);
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page.locator(".record-card")).toHaveCount(1);
  await openManualRecord(page);
  await expect(page.getByLabel("측정일", { exact: true })).toHaveValue("");
});

test("세션 만료 후 같은 계정으로 로그인하면 입력과 생성 요청을 복구한다", async ({
  page,
}) => {
  const email = await signup(page);
  await startRecord(page);
  await add(page, "신장", "170");
  const keys: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/measurements") && request.method() === "POST")
      keys.push(request.headers()["idempotency-key"]);
  });
  await page.route("**/api/v1/measurements", (route) =>
    route.request().method() === "POST"
      ? failApi(route, 401)
      : route.continue(),
  );
  await page.route("**/api/v1/auth/refresh", (route) => failApi(route, 401));
  await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.unroute("**/api/v1/auth/refresh");
  await page.unroute("**/api/v1/measurements");
  await login(page, email);
  await expect(page.getByLabel("신장", { exact: true })).toHaveValue("170");
  await page.getByRole("button", { name: "같은 내용으로 다시 확인" }).click();
  await openSavedRecord(page);
  await expect(
    page.locator(".result-card").getByText("170 cm", { exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test("다른 탭에서 명시적으로 로그아웃하면 임시 입력도 폐기한다", async ({
  page,
  context,
}) => {
  const email = await signup(page);
  await startRecord(page);
  await add(page, "신장", "170");
  const second = await context.newPage();
  await second.goto("/account");
  await expect(second.getByText(email, { exact: true })).toBeVisible();
  await signout(second);
  await expect(page).toHaveURL(/\/login/);
  await login(page, email);
  await expect(page.getByLabel("측정일", { exact: true })).toHaveValue("");
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) =>
        k.startsWith("modu-measurement-draft:"),
      ),
    ),
  ).toEqual([]);
});

test("만료 후 다른 계정으로 바꾸면 이전 계정의 임시 입력을 폐기한다", async ({
  page,
  browser,
}) => {
  const alice = await signup(page);
  const other = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const otherPage = await other.newPage();
  const bob = await signup(otherPage);
  await other.close();
  await startRecord(page);
  await add(page, "신장", "170");
  await page.route("**/api/v1/measurements", (route) =>
    route.request().method() === "POST"
      ? failApi(route, 401)
      : route.continue(),
  );
  await page.route("**/api/v1/auth/refresh", (route) => failApi(route, 401));
  await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.unroute("**/api/v1/auth/refresh");
  await page.unroute("**/api/v1/measurements");
  await login(page, bob);
  await expect(page.getByLabel("측정일", { exact: true })).toHaveValue("");
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) =>
        k.startsWith("modu-measurement-draft:"),
      ),
    ),
  ).toEqual([]);
  await page.goto("/account");
  await signout(page);
  await login(page, alice);
  await expect(page).toHaveURL(new URL("/", page.url()).href);
  await openRecords(page);
  await expect(
    page.getByRole("link", { name: "새 기록 등록", exact: true }),
  ).toBeVisible();
  await openManualRecord(page);
  await expect(page.getByLabel("측정일", { exact: true })).toHaveValue("");
});

test("복원한 수정 입력은 원래 ETag를 유지하여 최신 기록을 덮어쓰지 않는다", async ({
  page,
  context,
}) => {
  await signup(page);
  await startRecord(page);
  await add(page, "신장", "170");
  await save(page);
  const url = page.url().split("?")[0];
  await page.getByRole("link", { name: "기록 수정" }).click();
  await page.getByLabel("신장", { exact: true }).fill("171");
  const second = await context.newPage();
  await second.goto(url + "/edit");
  await second.getByLabel("신장", { exact: true }).fill("180");
  await second.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(
    second.locator(".result-card").getByText("180 cm", { exact: true }),
  ).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel("신장", { exact: true })).toHaveValue("171");
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(
    page.getByRole("dialog").getByText("180 cm", { exact: true }),
  ).toBeVisible();
});

test("브라우저 인증 요청은 프론트 프록시를 거치지 않고 공개 API로 보낸다", async ({
  page,
}) => {
  const request = page.waitForRequest((request) =>
    request.url().endsWith("/api/v1/auth/refresh"),
  );
  await page.goto("/login");
  expect(new URL((await request).url()).origin).toBe(apiOrigin);
  expect(apiOrigin).not.toBe(new URL(page.url()).origin);
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeEnabled();
});

async function draftKeys(page: Page) {
  return page.evaluate(() =>
    Object.keys(sessionStorage).filter((key) =>
      key.startsWith("modu-measurement-draft:"),
    ),
  );
}

async function storedDrafts(page: Page) {
  return page.evaluate(() =>
    Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith("modu-measurement-draft:"))
      .map(([key, value]) => [key, JSON.parse(value)]),
  );
}

// Commit to the real backend, but keep the browser's first response pending.
async function holdMutation(page: Page, method: string, url: string) {
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<"success" | "network" | "server">();
  const finished = Promise.withResolvers<void>();
  const requests: { key?: string; etag?: string; body: string | null }[] = [];
  await page.route(url, async (route) => {
    const request = route.request();
    if (request.method() !== method) return route.continue();
    requests.push({
      key: request.headers()["idempotency-key"],
      etag: request.headers()["if-match"],
      body: request.postData(),
    });
    if (requests.length > 1) return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    ready.resolve();
    const outcome = await release.promise;
    const received =
      outcome === "network"
        ? page.waitForEvent("requestfailed", (r) => r === request)
        : page.waitForResponse((r) => r.request() === request);
    if (outcome === "network") await route.abort("failed");
    else if (outcome === "server") await failApi(route, 503);
    else await route.fulfill({ response });
    await received;
    // Let fetch/json continuations and React updates finish before inspecting
    // absence of side effects; do not reload and cancel the old request.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    finished.resolve();
  });
  return {
    ready: ready.promise,
    requests,
    async finish(outcome: "success" | "network" | "server") {
      release.resolve(outcome);
      await finished.promise;
    },
  };
}

for (const outcome of ["success", "network", "server"] as const) {
  test(`이전 생성의 늦은 ${outcome} 응답은 재확인 후 새 초안을 변경하지 않는다`, async ({
    page,
  }) => {
    await signup(page);
    await startRecord(page);
    await add(page, "신장", "170");
    const held = await holdMutation(page, "POST", "**/api/v1/measurements");
    await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
    await held.ready;
    page.on("dialog", (dialog) => dialog.accept());
    await page.goBack();
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByRole("link", { name: "직접 입력하기" }).click();
    await expect(page.getByLabel("신장", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "같은 내용으로 다시 확인" }).click();
    await openSavedRecord(page);
    await expect(
      page.locator(".result-card").getByText("170 cm", { exact: true }),
    ).toBeVisible();
    expect(held.requests).toHaveLength(2);
    expect(held.requests[0]).toEqual(held.requests[1]);
    await page.getByRole("link", { name: "이전 화면", exact: true }).click();
    await expect(page.locator(".record-card")).toHaveCount(1);
    await startRecord(page);
    await add(page, "신장", "181.25");
    const before = await storedDrafts(page);
    expect(before).toHaveLength(1);
    await held.finish(outcome);
    expect(await storedDrafts(page)).toEqual(before);
    await expect(page).toHaveURL(/\/onboarding\/manual$/);
    await page.reload();
    await expect(page.getByLabel("신장", { exact: true })).toHaveValue(
      "181.25",
    );
    await expect(page.getByLabel("신장", { exact: true })).toBeEnabled();
  });
}

for (const status of [503, 0]) {
  test(`계정 조회 ${status} 실패 중에도 로그아웃을 재시도할 수 있다`, async ({
    page,
  }) => {
    const email = await signup(page, "main");
    await page.route("**/api/v1/auth/me", (route) =>
      status ? failApi(route, status) : route.abort(),
    );
    await page.getByRole("link", { name: "내 프로필", exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("button", { name: "다시 불러오기" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "내 측정 기록", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "로그아웃", exact: true }),
    ).toBeVisible();
    await page.route("**/api/v1/auth/logout", (route) => failApi(route, 503));
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "로그아웃", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "다시 불러오기" }),
    ).toBeVisible();
    await page.unroute("**/api/v1/auth/me");
    await page.getByRole("button", { name: "다시 불러오기" }).click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.locator(".notice.error")).toContainText(
      "서버가 잠시 응답하지 않아요",
    );
    await page.unroute("**/api/v1/auth/logout");
    await signout(page);
  });
}

test("계정 조회 응답을 기다리는 동안에도 로그아웃할 수 있다", async ({
  page,
}) => {
  await signup(page, "main");
  const pending = Promise.withResolvers<Route>();
  await page.route("**/api/v1/auth/me", (route) => pending.resolve(route));
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const route = await pending.promise;
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();
  await signout(page);
  await route.abort();
});

for (const outcome of ["success", "network"] as const) {
  test(`이전 수정의 늦은 ${outcome} 응답은 재확인 후 같은 기록의 새 초안을 변경하지 않는다`, async ({
    page,
  }) => {
    await signup(page);
    await startRecord(page);
    await add(page, "신장", "170");
    await save(page);
    await page.getByRole("link", { name: "기록 수정", exact: true }).click();
    await page.getByLabel("신장", { exact: true }).fill("171");
    const held = await holdMutation(page, "PATCH", "**/api/v1/measurements/*");
    await page.getByRole("button", { name: "수정 내용 저장" }).click();
    await held.ready;
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("link", { name: "이전 화면", exact: true }).click();
    await page.getByRole("link", { name: "기록 수정", exact: true }).click();
    await expect(page.getByLabel("신장", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "같은 내용으로 다시 확인" }).click();
    // Retrying PATCH with the original ETag sees the committed first request.
    await page.getByRole("button", { name: "최신 기록으로 다시 편집" }).click();
    expect(held.requests).toHaveLength(2);
    expect(held.requests[0]).toEqual(held.requests[1]);
    await page.getByLabel("신장", { exact: true }).fill("181.25");
    const before = await storedDrafts(page);
    expect(before).toHaveLength(1);
    await held.finish(outcome);
    expect(await storedDrafts(page)).toEqual(before);
    await expect(page).toHaveURL(/\/edit$/);
    await page.reload();
    await expect(page.getByLabel("신장", { exact: true })).toHaveValue(
      "181.25",
    );
    await expect(page.getByLabel("신장", { exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "수정 내용 저장" }).click();
    await expect(
      page.locator(".result-card").getByText("181.25 cm", { exact: true }),
    ).toBeVisible();
  });
}

test("이전 삭제의 늦은 성공 응답은 새 입력 화면을 이동시키지 않는다", async ({
  page,
}) => {
  await signup(page);
  await startRecord(page);
  await add(page, "신장", "170");
  await save(page);
  // Re-enter from the record list so browser Back still exercises navigation
  // while deletion is pending, after the newer onboarding completion route.
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page).toHaveURL(/\/measurements$/);
  await page.locator(".record-card").first().click();
  const held = await holdMutation(page, "DELETE", "**/api/v1/measurements/*");
  await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "기록 삭제", exact: true })
    .click();
  await held.ready;
  // The busy dialog blocks clicks, but browser history can still leave it.
  await page.goBack();
  await expect(page).toHaveURL(/\/measurements$/);
  await startRecord(page);
  await add(page, "신장", "181.25");
  await held.finish("success");
  await expect(page.getByLabel("신장", { exact: true })).toHaveValue("181.25");
  await expect(page).toHaveURL(/\/onboarding\/manual$/);
});

test("로그아웃 401에서도 모든 탭의 인증과 임시 입력을 정리한다", async ({
  page,
  context,
}) => {
  const email = await signup(page);
  await startRecord(page);
  await add(page, "신장", "170");
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  const second = await context.newPage();
  await second.goto("/account");
  await expect(second.getByText(email, { exact: true })).toBeVisible();
  await context.clearCookies();
  await second.route("**/api/v1/auth/logout", (route) => failApi(route, 401));

  await signout(second);
  await expect(page).toHaveURL(/\/login/);
  for (const tab of [page, second]) {
    await expect(tab.getByText(email, { exact: true })).toHaveCount(0);
    expect(await draftKeys(tab)).toEqual([]);
  }
  await login(page, email);
  await expect(page.getByLabel("측정일", { exact: true })).toHaveValue("");
  expect(await draftKeys(page)).toEqual([]);
});

test("메인과 내 프로필 탭을 오가며 기록을 관리하고 입력 이탈을 확인한다", async ({
  page,
}) => {
  const email = await signup(page, "main");
  const nav = page.getByRole("navigation", { name: "하단 메뉴" });
  const mainTab = nav.getByRole("link", { name: "메인", exact: true });
  const profileTab = nav.getByRole("link", { name: "내 프로필", exact: true });
  await expect(nav.getByRole("link")).toHaveText(["", "", "", ""]);
  for (const label of ["메인", "운동", "내 그룹", "내 프로필"]) {
    await expect(
      nav.getByRole("link", { name: label, exact: true }),
    ).toBeVisible();
  }
  await expect(mainTab).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "체력 기록 등록하기" }),
  ).toBeVisible();
  await page.reload();
  await expect(mainTab).toHaveAttribute("aria-current", "page");

  await profileTab.click();
  await expect(
    page.getByRole("heading", { name: "내 프로필", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(profileTab).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(mainTab).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(profileTab).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "내 측정 기록", exact: true }).click();
  await startRecord(page);
  await add(page, "신장", "170");
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\/manual$/);
  await expect(
    page.getByLabel("측정 당시 만 나이", { exact: true }),
  ).toHaveValue("25");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(mainTab).toHaveAttribute("aria-current", "page");
  await openRecords(page);
  await openManualRecord(page);
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(page.getByLabel("신장", { exact: true })).toHaveValue("170");
  await save(page);

  const editButton = page.getByRole("link", { name: "기록 수정", exact: true });
  await editButton.scrollIntoViewIfNeeded();
  const buttonBox = await editButton.boundingBox();
  const navBox = await nav.boundingBox();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(navBox!.y);
  await profileTab.click();
  await signout(page);
  await expect(nav).toHaveCount(0);
});

test("로그아웃의 권한·요청 제한·서버·통신 오류는 입력을 유지하고 재시도한다", async ({
  page,
  context,
}) => {
  const email = await signup(page);
  await startRecord(page);
  await add(page, "신장", "170");
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  const second = await context.newPage();
  await second.goto("/account");
  await expect(second.getByText(email, { exact: true })).toBeVisible();
  const cases = [
    { status: 403, message: "요청을 확인할 수 없어요" },
    { status: 429, message: "요청이 많아요" },
    { status: 503, message: "서버가 잠시 응답하지 않아요" },
    { status: 0, message: "서버에 연결하지 못했어요" },
  ];
  for (const failure of cases) {
    await second.route("**/api/v1/auth/logout", (route) =>
      failure.status ? failApi(route, failure.status) : route.abort(),
    );
    await second.getByRole("button", { name: "로그아웃", exact: true }).click();
    await second
      .getByRole("dialog")
      .getByRole("button", { name: "로그아웃", exact: true })
      .click();
    await expect(second.locator(".notice.error")).toContainText(
      failure.message,
    );
    await expect(second).toHaveURL(/\/account$/);
    await expect(second.getByText(email, { exact: true })).toBeVisible();
    await expect(page.getByLabel("신장", { exact: true })).toHaveValue("170");
    expect(await draftKeys(page)).toHaveLength(1);
    await second.unroute("**/api/v1/auth/logout");
  }

  await signout(second);
  await expect(page).toHaveURL(/\/login/);
  expect(await draftKeys(page)).toEqual([]);
});
