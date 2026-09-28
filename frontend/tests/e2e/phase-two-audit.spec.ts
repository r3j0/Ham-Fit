import { prepareAssessment } from "./workout-helpers";
import { test, expect, type Page } from "@playwright/test";

// Authentication writes share the real backend's 60/minute IP limit with the
// preceding test file. Begin this group in a fresh window instead of disabling it.
test.beforeAll(async () => {
  test.setTimeout(65000);
  await new Promise((resolve) =>
    setTimeout(resolve, 60000 - (Date.now() % 60000) + 250),
  );
});

const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
const password = "phase-two-audit-password-2026!";
async function register(page: Page) {
  const email = `audit-${crypto.randomUUID()}@example.test`;
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const response = await page.request.post(`${api}/auth/register`, {
    headers: { Origin: origin, "X-CSRF-Protection": "1" },
    data: { email, password },
  });
  expect(response.status()).toBe(201);
  return { email, ...(await response.json()) };
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK3sAAAAASUVORK5CYII=",
  "base64",
);

test("진행 중인 측정에서 이전 단계로 돌아오면 해당 항목을 다시 시작한다", async ({
  page,
}) => {
  await register(page);
  await page.goto("/workout?mode=assessment");
  await prepareAssessment(page);
  await page.getByRole("button", { name: "측정 시작", exact: true }).click();
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await expect(page.getByRole("timer")).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  await page.getByRole("button", { name: "변경 완료", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "이 항목 다시 시작" }),
  ).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
});

test("사진 입력을 버리면 새 사진을 등록할 수 있고 초안이 복원되지 않는다", async ({
  page,
}) => {
  await register(page);
  await page.goto("/onboarding/photo");
  await page
    .getByLabel("결과표 파일 선택")
    .setInputFiles({ name: "report.png", mimeType: "image/png", buffer: png });
  const preview = page.getByRole("img", { name: "선택한 국민체력100 결과표" });
  await expect(preview).toBeVisible();
  await page.getByRole("button", { name: "이 사진을 보며 직접 입력" }).click();
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("25");
  page.on("dialog", (dialog) => dialog.accept());
  await expect(
    page.getByRole("navigation", { name: "하단 메뉴" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\/photo$/);
  await expect(
    page.getByRole("heading", { name: "결과표 사진 선택", exact: true }),
  ).toBeVisible();
  await expect(preview).toHaveCount(0);
  await page.reload();
  await page.getByLabel("결과표 파일 선택").setInputFiles({
    name: "new-report.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByRole("button", { name: "이 사진을 보며 직접 입력" }).click();
  await expect(
    page.getByLabel("측정 당시 만 나이", { exact: true }),
  ).toHaveValue("");
});

test("설정 요청 중 화면을 떠났다가 돌아와도 재시도할 수 있다", async ({
  page,
}) => {
  await register(page);
  await page.goto("/account/settings");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const started = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route(`${api}/users/me`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    received();
    await gate;
    await route.fulfill({
      status: 503,
      json: { message: "Injected failure" },
      headers: {
        "Access-Control-Allow-Origin": route.request().headers().origin,
        "Access-Control-Allow-Credentials": "true",
      },
    });
  });
  await page
    .getByLabel("새 이메일", { exact: true })
    .fill(`changed-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("현재 비밀번호").fill(password);
  await page
    .getByRole("button", { name: "이메일 변경", exact: true })
    .last()
    .click();
  await started;
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  release();
  await page.waitForTimeout(300);
  await page.goBack();
  await expect(page.getByLabel("현재 비밀번호")).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "처리 중", exact: true }),
  ).toHaveCount(0);
});

test("계정 변경 응답을 잃어도 중복 제출 없이 다시 로그인할 수 있다", async ({
  page,
}) => {
  await register(page);
  await page.goto("/account/settings");
  const email = `lost-${crypto.randomUUID()}@example.test`;
  let updates = 0;
  await page.route(`${api}/users/me`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    updates++;
    const response = await route.fetch();
    expect(response.status()).toBe(204);
    await route.abort("connectionreset");
  });
  await page.getByLabel("새 이메일", { exact: true }).fill(email);
  await page.getByLabel("현재 비밀번호").fill(password);
  await page
    .getByRole("button", { name: "이메일 변경", exact: true })
    .last()
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "처리 결과를 확인하지 못했어요",
  );
  await expect(
    page.getByRole("button", { name: "이메일 변경", exact: true }).last(),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "다시 로그인하기", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  expect(updates).toBe(1);
});

for (const committed of [false, true]) {
  test(`탈퇴 응답 유실 후 재로그인은 실제 처리 결과를 따른다 (서버 처리: ${committed})`, async ({
    page,
    context,
  }) => {
    const account = await register(page);
    await page.goto("/workout?mode=assessment");
    await prepareAssessment(page);
    await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
    await page.goto("/account/settings");
    const other = await context.newPage();
    await other.goto("/account");
    await expect(other.getByText(account.email, { exact: true })).toBeVisible();
    let deletes = 0;
    await page.route(`${api}/users/me`, async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      deletes++;
      if (committed) expect((await route.fetch()).status()).toBe(204);
      await route.abort("connectionreset");
    });
    await page
      .getByRole("button", { name: "회원 탈퇴", exact: true })
      .first()
      .click();
    await page.getByLabel("현재 비밀번호").fill(password);
    await page
      .getByRole("button", { name: "회원 탈퇴", exact: true })
      .last()
      .click();
    await page.getByRole("button", { name: "영구 탈퇴하기" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "처리 결과를 확인하지 못했어요",
    );
    await page
      .getByRole("button", { name: "다시 로그인하기", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login/);
    await expect(other).toHaveURL(/\/login/);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("modu-workout-session-v2"),
      ),
    ).toBeNull();
    await page.getByLabel("이메일", { exact: true }).fill(account.email);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    if (committed) {
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "이메일 또는 비밀번호를 확인해 주세요",
      );
      await expect(page).toHaveURL(/\/login/);
    } else {
      await expect(page).not.toHaveURL(/\/login/);
    }
    expect(deletes).toBe(1);
  });
}
