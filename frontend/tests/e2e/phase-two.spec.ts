import { testWorkout } from "./integration-fixtures";
import { prepareAssessment, skipToFlexibility } from "./workout-helpers";
import { test, expect, type Page, type Route } from "@playwright/test";

// Authentication writes share the real backend's 60/minute IP limit with the
// preceding test file. Begin this group in a fresh window instead of disabling it.
test.beforeAll(async () => {
  test.setTimeout(65000);
  await new Promise((resolve) =>
    setTimeout(resolve, 60000 - (Date.now() % 60000) + 250),
  );
});

const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
const password = "phase-two-test-password-2026!";
async function register(page: Page) {
  const email = `phase-two-${crypto.randomUUID()}@example.test`;
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const response = await page.request.post(`${api}/auth/register`, {
    headers: { Origin: origin, "X-CSRF-Protection": "1" },
    data: { email, password },
  });
  expect(response.status()).toBe(201);
  return { email, ...(await response.json()) };
}
function fail(route: Route, status: number, extra = {}) {
  return route.fulfill({
    status,
    json: { message: "Injected error", ...extra },
    headers: {
      "Access-Control-Allow-Origin": route.request().headers().origin,
      "Access-Control-Allow-Credentials": "true",
    },
  });
}

async function login(page: Page, email: string, secret = password) {
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("메인은 미배정·배정·완료를 구분하고 운동 내용을 임의로 생성하지 않는다", async ({
  page,
}) => {
  await register(page);
  await page.goto("/");
  await expect(
    page.getByText("아직 오늘 배정된 운동이 없어요.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "체력 기록 등록하기" }),
  ).toBeVisible();
  let completed = false;
  await page.route(`${api}/workouts/history?*`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...testWorkout,
            status: completed ? "completed" : "assigned",
            completedAt: completed ? new Date().toISOString() : null,
          },
        ],
        nextCursor: null,
      },
      headers: {
        "Access-Control-Allow-Origin": route.request().headers().origin,
        "Access-Control-Allow-Credentials": "true",
      },
    }),
  );
  await page.reload();
  await expect(page.getByText("내 기존 운동", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "운동 시작하기", exact: true }),
  ).toHaveAttribute("href", `/workouts/${testWorkout.id}`);
  completed = true;
  await page.reload();
  await expect(
    page
      .getByRole("list", { name: "오늘 배정된 운동" })
      .getByText("완료", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "운동 시작하기", exact: true }),
  ).toHaveCount(0);
});

test("구형 사용자 응답은 임의의 초기 상태로 표시하지 않고 재시도를 제공한다", async ({
  page,
}) => {
  const account = await register(page);
  await page.route(`${api}/auth/me`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: account.user,
          headers: {
            "Access-Control-Allow-Origin": route.request().headers().origin,
            "Access-Control-Allow-Credentials": "true",
          },
        })
      : route.continue(),
  );
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "사용자 정보를 확인할 수 없어요",
  );
  await expect(
    page.getByRole("button", { name: "다시 불러오기" }),
  ).toBeVisible();
  await expect(
    page.getByText("아직 오늘 배정된 운동이 없어요.", { exact: false }),
  ).toHaveCount(0);
});

test("주요 화면은 좁은 모바일 너비에서 가로 넘침 없이 사용할 수 있다", async ({
  page,
}, testInfo) => {
  await register(page);
  await page.setViewportSize({ width: 320, height: 760 });
  for (const path of [
    "/",
    "/account",
    "/account/settings",
    "/onboarding",
    "/onboarding/photo",
    "/workout?mode=assessment",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    if (path === "/")
      await expect(
        page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
      ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`${path.replaceAll("/", "-") || "home"}.png`),
      fullPage: true,
    });
    if (path === "/workout?mode=assessment") {
      await prepareAssessment(page);
      // Fixed bottom navigation must not block actions after scrolling at 320px.
      await page.getByRole("button", { name: "처음부터", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "취소", exact: true }).click();
      await page.getByRole("link", { name: "나중에 이어하기" }).click();
      await expect(page).toHaveURL(new URL("/", page.url()).href);
    }
  }
});

test("온보딩 직접 입력은 기존 폼을 복원하고 실제 저장 후 상태를 갱신한다", async ({
  page,
}) => {
  const account = await register(page);
  await page.goto("/measurements");
  await page
    .getByRole("link", { name: "첫 측정 기록 등록", exact: true })
    .click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("link", { name: "직접 입력하기", exact: false }).click();
  await page.getByLabel("측정일", { exact: true }).fill("2026-09-17");
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("25");
  await page.getByLabel("성별", { exact: true }).selectOption("male");
  await page.reload();
  await expect(
    page.getByLabel("측정 당시 만 나이", { exact: true }),
  ).toHaveValue("25");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await page
    .getByRole("button", { name: "측정 항목 추가", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("검사명 검색")
    .fill("교차윗몸일으키기");
  await page
    .getByRole("dialog")
    .getByRole("button")
    .filter({ hasText: "교차윗몸일으키기" })
    .click();
  await page.getByLabel("교차윗몸일으키기", { exact: true }).fill("0");
  await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
  await expect(page).toHaveURL(/\/onboarding\/complete\?record=/);
  await page.goto("/onboarding");
  await expect(
    page.getByText("이미 등록한 기록이 있어요.", { exact: false }),
  ).toBeVisible();
  const result = await page.request.get(`${api}/auth/me`, {
    headers: { Authorization: `Bearer ${account.access_token}` },
  });
  expect((await result.json()).isOnboarded).toBe(true);
  const other = await page.context().newPage();
  await other.goto("/");
  await expect(
    other.getByRole("img", { name: "나의 대표 캐릭터" }),
  ).toBeVisible();
  await expect(
    other.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toHaveCount(0);
  const records = await page.request.get(`${api}/measurements`, {
    headers: { Authorization: `Bearer ${account.access_token}` },
  });
  const record = (await records.json()).items[0];
  await page.goto(`/measurements/${record.id}`);
  await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "기록 삭제", exact: true })
    .click();
  await expect(page).toHaveURL(/\/measurements$/);
  await expect(
    other.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toBeVisible();
});

test("사진을 로컬에서 확인하고 같은 측정 폼에서 입력하며 잘못된 사진은 거절한다", async ({
  page,
}) => {
  await register(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().startsWith(api) &&
      request.method() === "POST" &&
      !request.url().includes("/auth/")
    )
      writes.push(request.url());
  });
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles({
    name: "report.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "JPG, PNG, WEBP",
  );
  await page.getByLabel("결과표 파일 선택").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("broken image"),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "사진을 읽을 수 없어요",
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK3sAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .getByLabel("결과표 파일 선택")
    .setInputFiles({ name: "report.png", mimeType: "image/png", buffer: png });
  await expect(
    page.getByRole("img", { name: "선택한 국민체력100 결과표" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "이 사진을 보며 직접 입력" }).click();
  await expect(page.getByLabel("측정일", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "선택한 국민체력100 결과표" }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole("img", { name: "선택한 국민체력100 결과표" }),
  ).toHaveCount(0);
});

test("간이측정은 제출 전까지 기록을 만들지 않고 입력을 복원한다", async ({
  page,
}) => {
  const account = await register(page);
  await page.goto("/workout?mode=assessment");
  await prepareAssessment(page);
  await skipToFlexibility(page);
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "측정한 값을 입력",
  );
  await page.getByLabel("기준선에서 도달한 거리 (cm)").fill("-3.25");
  await page.reload();
  await expect(page.getByLabel("기준선에서 도달한 거리 (cm)")).toHaveValue(
    "-3.25",
  );
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "측정한 값을 확인해요" }),
  ).toBeVisible();
  const profile = await page.request.get(`${api}/auth/me`, {
    headers: { Authorization: `Bearer ${account.access_token}` },
  });
  expect((await profile.json()).isOnboarded).toBe(false);
});

test("로그아웃하면 간이측정 진행도 함께 지워진다", async ({ page }) => {
  const { email } = await register(page);
  await page.goto("/workout?mode=assessment");
  await prepareAssessment(page);
  await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  // Active assessment deliberately hides navigation; leave via the address bar.
  page.once("dialog", (dialog) => dialog.accept());
  await page.goto("/account");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, email);
  await page.goto("/workout?mode=assessment");
  await expect(page.getByLabel("만 나이", { exact: true })).toHaveValue("");
});

test("계정 수정은 비밀번호 오류를 재전송하지 않고 성공하면 모든 탭에서 로그아웃한다", async ({
  page,
  context,
}) => {
  const account = await register(page);
  await page.goto("/account/settings");
  const other = await context.newPage();
  await other.goto("/account");
  await expect(other.getByText(account.email, { exact: true })).toBeVisible();
  let updates = 0;
  page.on("request", (request) => {
    if (request.url() === `${api}/users/me` && request.method() === "PATCH")
      updates++;
  });
  const email = `changed-${crypto.randomUUID()}@example.test`;
  await page.getByLabel("새 이메일", { exact: true }).fill(email);
  await page.getByLabel("현재 비밀번호").fill("incorrect-password");
  await page
    .getByRole("button", { name: "이메일 변경", exact: true })
    .last()
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "본인 확인에 실패",
  );
  expect(updates).toBe(1);
  await expect(other.getByText(account.email, { exact: true })).toBeVisible();
  await page.getByLabel("현재 비밀번호").fill(password);
  await page
    .getByRole("button", { name: "이메일 변경", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/login/);
  await expect(other).toHaveURL(/\/login/);
  expect(updates).toBe(2);
  expect(
    (
      await page.request.get(`${api}/auth/me`, {
        headers: { Authorization: `Bearer ${account.access_token}` },
      })
    ).status(),
  ).toBe(401);
  await login(page, email);
  await page.goto("/account");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "보유 재화", exact: true }),
  ).toBeVisible();
});

test("새 비밀번호 확인 후 변경하고 재로그인하여 영구 탈퇴한다", async ({
  page,
}) => {
  const { email } = await register(page);
  await page.goto("/account/settings");
  await page
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  const updated = "new-password-with-spaces 2026! ";
  await page.getByLabel("새 비밀번호", { exact: true }).fill(updated);
  await page.getByLabel("새 비밀번호 확인").fill("does-not-match-2026");
  await page.getByLabel("현재 비밀번호").fill(password);
  await page
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .last()
    .click();
  await expect(page.getByText("새 비밀번호가 일치하지 않아요.")).toBeVisible();
  await page.getByLabel("새 비밀번호 확인").fill(updated);
  await page
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, email, updated);
  await page.goto("/account/settings");
  await page.getByRole("button", { name: "회원 탈퇴", exact: true }).click();
  await page.getByLabel("현재 비밀번호").fill(updated);
  await page
    .getByRole("button", { name: "회원 탈퇴", exact: true })
    .last()
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "취소" }).click();
  await expect(page).toHaveURL(/\/account\/settings/);
  await page
    .getByRole("button", { name: "회원 탈퇴", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "영구 탈퇴하기" }).click();
  await expect(page).toHaveURL(/\/login/);
  const response = await page.request.post(`${api}/auth/login`, {
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Protection": "1" },
    data: { email, password: updated },
  });
  expect(response.status()).toBe(401);
});

test("중복 이메일과 요청 제한은 입력을 보존하고 재시도할 수 있다", async ({
  page,
}) => {
  const owner = await register(page);
  await register(page);
  await page.goto("/account/settings");
  await page.getByLabel("새 이메일", { exact: true }).fill(owner.email);
  await page.getByLabel("현재 비밀번호").fill(password);
  await page
    .getByRole("button", { name: "이메일 변경", exact: true })
    .last()
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "이미 사용 중인 이메일",
  );
  await page.route(`${api}/users/me`, (route) =>
    route.request().method() === "PATCH"
      ? fail(route, 429, { retry_after: 2 })
      : route.continue(),
  );
  await page
    .getByRole("button", { name: "이메일 변경", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: /초 후 다시 시도/ }),
  ).toBeDisabled();
  await expect(page.getByLabel("새 이메일", { exact: true })).toHaveValue(
    owner.email,
  );
  await expect(
    page
      .getByRole("form", { name: "이메일 변경", exact: true })
      .getByRole("button"),
  ).toHaveText("이메일 변경");
  await expect(
    page
      .getByRole("form", { name: "이메일 변경", exact: true })
      .getByRole("button"),
  ).toBeEnabled();
});

test("공통 사용자 상태를 화면 이동에서 공유하고 새로고침 후 복원한다", async ({
  page,
}) => {
  const { email } = await register(page);
  let reads = 0;
  page.on("request", (request) => {
    if (request.url() === `${api}/auth/me` && request.method() === "GET")
      reads++;
  });
  await page.goto("/account");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const first = reads;
  await page.getByRole("link", { name: "메인", exact: true }).click();
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  expect(reads).toBe(first);
  await page.reload();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  expect(reads).toBeGreaterThan(first);
});

test("사용자 상태 조회 실패를 재시도하고 로그아웃을 유지한다", async ({
  page,
}) => {
  const { email } = await register(page);
  await page.route(`${api}/auth/me`, (route) =>
    route.request().method() === "GET" ? fail(route, 503) : route.continue(),
  );
  await page.goto("/account");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "서버가 잠시 응답하지 않아요",
  );
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeEnabled();
  await page.unroute(`${api}/auth/me`);
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
});
