import { test, expect } from "@playwright/test";
import { installApi, testUser, testWorkout } from "./integration-fixtures";
import {
  storedRecordFixture,
  storedCatalogFixture,
} from "../fixtures/measurement-evaluation";

test("프로필은 재화·가입 경과일·활동 리포트와 얼굴 모션을 표시하고 기록 상세로 이어진다", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const record = storedRecordFixture();
  const api = await installApi(page, record, storedCatalogFixture);
  await page.clock.setFixedTime(new Date("2026-09-27T00:00:00Z"));
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      json: {
        ...testUser,
        nickname: null,
        isOnboarded: true,
        currency: { balance: 1234567 },
        currentCurriculum: null,
      },
    }),
  );
  await page.route("**/measurements/latest-polygon", (route) =>
    route.fulfill({
      json: {
        measurementId: record.id,
        revision: record.revision,
        measuredOn: record.measuredOn,
        axes: record.axes,
      },
    }),
  );
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "닉네임", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("나의 건강한 일상", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("가입일", { exact: true })).toHaveCount(0);
  const balance = page.getByRole("group", { name: "보유 재화" });
  await expect(balance).toHaveText("1,234,567");
  const seed = balance.getByRole("img", { name: "해바라기씨" });
  await expect(seed).toHaveAttribute("src", "/icons/sunflower-seed.svg");
  await expect
    .poll(() =>
      seed.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(page.locator(".profile-tenure dd")).toHaveText("26일");
  const report = page.getByRole("region", { name: "활동 리포트" });
  await expect(report.getByText("예시", { exact: true })).toHaveCount(0);
  await expect(report.getByRole("heading")).toHaveCount(0);
  for (const emphasis of await report.locator("strong, svg").all())
    await expect(emphasis).toHaveCSS("color", "rgb(255, 127, 0)");
  await expect(report.locator("dt")).toHaveText([
    "현재 연속 스트릭",
    "최장 연속 스트릭",
    "현재 레벨",
    "캐릭터 보유 컬렉션",
    "총 운동 일수",
    "가입한지",
  ]);
  await expect(report.locator("dd")).toHaveText([
    "3일",
    "12일",
    "4레벨",
    "2개",
    "28일",
    "26일",
  ]);
  await expect(report.getByText(/EXP/)).toHaveCount(0);
  const avatar = page.getByRole("img", {
    name: "편안하게 숨 쉬는 햄스터 얼굴",
  });
  await expect(avatar).toBeVisible();
  const head = avatar.locator('[data-part="head"]');
  await expect(head).toHaveAttribute("transform", /translate/);
  const pose = await head.getAttribute("transform");
  await expect.poll(() => head.getAttribute("transform")).not.toBe(pose);
  await expect(avatar.locator('[data-part="torso"]')).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(head).toHaveAttribute(
    "transform",
    "translate(0.0000 0.0000) rotate(0.0000 400 610)",
  );
  await expect(
    page.getByRole("heading", { name: "나의 체력 프로필" }),
  ).toHaveCount(0);
  await expect(page.getByText(/최신 측정 기록 기준/)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "이 기록의 상세 리포트 보기" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".radar-legend, .fitness-radar figcaption"),
  ).toHaveCount(0);
  await expect(page.locator(".radar-label")).toHaveText([
    "심폐지구력",
    "근력",
    "근지구력",
    "유연성",
    "민첩성",
    "순발력",
  ]);
  await expect(page.locator(".radar-grade")).toHaveText([
    "평가 미존재",
    "평가 미존재",
    "평가 미존재",
    "2등급",
    "평가 미존재",
    "평가 미존재",
  ]);
  await expect(page.locator('.radar-point[cx="180"][cy="158"]')).toHaveCount(5);
  await expect(page.locator(".radar-shape")).toHaveCSS(
    "stroke",
    "rgb(255, 127, 0)",
  );
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const card = (await page.locator(".profile-card").boundingBox())!;
    const balanceBox = (await balance.boundingBox())!;
    const toolbar = (await page.locator(".profile-toolbar").boundingBox())!;
    expect(balanceBox.y + balanceBox.height).toBeLessThan(card.y);
    expect(balanceBox.x + balanceBox.width).toBeCloseTo(
      toolbar.x + toolbar.width,
      0,
    );
    const avatarBox = (await avatar.boundingBox())!;
    expect(avatarBox.width).toBe(width < 960 ? 80 : 128);
    await expect(avatar).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const chart = (await page.locator(".fitness-radar svg").boundingBox())!;
    const reportBox = (await report.boundingBox())!;
    if (width < 960) {
      expect(reportBox.y).toBeGreaterThanOrEqual(
        avatarBox.y + avatarBox.height,
      );
    } else {
      const identity = (await page.locator(".profile-identity").boundingBox())!;
      const insights = (await page.locator(".profile-insights").boundingBox())!;
      expect(identity.x + identity.width).toBeLessThanOrEqual(insights.x);
    }
    expect(chart.x + chart.width).toBeLessThanOrEqual(reportBox.x);
    expect(reportBox.y + reportBox.height).toBeLessThanOrEqual(
      card.y + card.height,
    );
    expect(chart.y).toBeGreaterThanOrEqual(card.y);
    expect(chart.y + chart.height).toBeLessThanOrEqual(card.y + card.height);
    for (const metric of await report.locator(".profile-report-metric").all()) {
      const box = (await metric.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(reportBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(
        reportBox.x + reportBox.width,
      );
    }
    const labels = await page.locator(".radar-label").all();
    for (const [index, grade] of (
      await page.locator(".radar-grade").all()
    ).entries()) {
      const name = (await labels[index].boundingBox())!;
      const value = (await grade.boundingBox())!;
      expect(value.y).toBeGreaterThan(name.y + name.height);
      expect(value.x).toBeGreaterThanOrEqual(chart.x);
      expect(value.x + value.width).toBeLessThanOrEqual(chart.x + chart.width);
      expect(value.y + value.height).toBeLessThanOrEqual(
        chart.y + chart.height,
      );
    }
    await page.screenshot({
      path: info.outputPath(`account-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("link", { name: "내 측정 기록", exact: true }).click();
  await page.locator(".record-card").click();
  await expect(
    page.locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade"),
  ).toHaveCount(6);
  await page.getByRole("link", { name: "메인", exact: true }).click();
  const fullBody = page.getByRole("img", { name: "편안하게 숨 쉬는 햄스터" });
  await expect(fullBody.locator('[data-part="torso"]')).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "하단 메뉴" }),
  ).not.toHaveClass(/kspo-orange-theme/);
  expect(errors).toEqual([]);
  expect(api.mutations).toEqual([]);
});

test("미측정 계정도 가입 당일 표시와 예시 리포트를 보되 실제 등급을 만들지 않는다", async ({
  page,
}) => {
  const api = await installApi(page);
  await page.clock.setFixedTime(new Date("2026-09-01T01:00:00Z"));
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "닉네임", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".profile-tenure dd")).toHaveText("0일");
  await expect(page.getByRole("group", { name: "보유 재화" })).toHaveText("0");
  await expect(page.getByRole("region", { name: "활동 리포트" })).toBeVisible();
  await expect(page.locator(".fitness-radar")).toHaveCount(0);
  await page.getByRole("link", { name: "계정 설정", exact: true }).click();
  await page.getByRole("button", { name: "생년월일", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "생년월일", exact: true }),
  ).toBeVisible();
  expect(api.mutations).toEqual([]);
});

test("프로필 조회 오류에는 재화와 리포트를 숨기고 재시도로 복구한다", async ({
  page,
}) => {
  const api = await installApi(page);
  let failed = true;
  await page.route("**/auth/me", (route) =>
    route.fulfill(
      failed
        ? {
            status: 503,
            json: { message: "프로필 일시 오류" },
          }
        : {
            json: {
              ...testUser,
              nickname: null,
              isOnboarded: false,
              currency: { balance: 25 },
              currentCurriculum: null,
            },
          },
    ),
  );
  await page.goto("/account");
  await expect(
    page.getByRole("button", { name: "다시 불러오기", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "보유 재화" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "활동 리포트" })).toHaveCount(
    0,
  );
  failed = false;
  await page
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await expect(page.getByRole("group", { name: "보유 재화" })).toHaveText("25");
  await expect(page.getByRole("region", { name: "활동 리포트" })).toBeVisible();
  expect(api.mutations).toEqual([]);
});

test("프로필의 운동 이력·다시보기·날짜 이동은 Orange와 프로필 메뉴를 유지한다", async ({
  page,
}, info) => {
  const api = await installApi(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-09-27T12:00:00+09:00"));
  const completed = {
    ...testWorkout,
    status: "completed",
    completedAt: "2026-09-27T09:00:00+09:00",
    progress: { ...testWorkout.progress, watchedSeconds: 45, ratio: 0.75 },
  };
  const yesterday = {
    ...completed,
    id: "yesterday",
    completedAt: "2026-09-26T09:00:00+09:00",
  };
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({
      json: { items: [completed, yesterday], nextCursor: null },
    }),
  );
  await page.route(`**/api/v1/workouts/${completed.id}`, (route) =>
    route.fulfill({ json: completed }),
  );
  await page.goto("/account");
  await page.getByRole("link", { name: "내 운동 이력", exact: true }).click();
  await expect(page).toHaveURL("/account/workouts");
  const nav = page.getByRole("navigation", { name: "하단 메뉴" });
  async function expectProfile() {
    await expect(page.getByRole("main")).toHaveCSS("color", "rgb(51, 37, 28)");
    await expect(
      nav.getByRole("link", { name: "내 프로필", exact: true }),
    ).toHaveAttribute("aria-current", "location");
    await expect(nav).toHaveCSS("background-color", "rgb(255, 248, 241)");
  }
  await expectProfile();
  await page
    .getByRole("link", { name: "운동 다시보기", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(`/account/workouts/${completed.id}/replay`);
  await expect(
    page.getByRole("heading", { name: "운동 다시보기", exact: true }),
  ).toBeVisible();
  await expectProfile();
  await expect(page.getByRole("progressbar")).toHaveCSS(
    "accent-color",
    "rgb(255, 127, 0)",
  );
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`profile-replay-${width}.png`),
      fullPage: true,
    });
  }
  await page.reload();
  await expectProfile();
  await page.getByRole("link", { name: "운동 기록으로", exact: true }).click();
  await expect(page).toHaveURL("/account/workouts/history/2026-09-27");
  await expectProfile();
  const calendar = page.getByRole("region", { name: "운동 기록", exact: true });
  await calendar
    .getByRole("link", { name: "9월 26일, 운동함", exact: true })
    .click();
  await expect(page).toHaveURL("/account/workouts/history/2026-09-26");
  await expectProfile();
  await expect(
    page
      .getByRole("list", { name: "선택한 날짜의 운동 기록" })
      .getByRole("link"),
  ).toHaveAttribute("href", "/account/workouts/yesterday/replay");
  await page.reload();
  await expectProfile();
  await expect(
    page
      .getByRole("list", { name: "선택한 날짜의 운동 기록" })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page).toHaveURL("/account/workouts");
  await expectProfile();
  await nav.getByRole("link", { name: "운동", exact: true }).click();
  await expect(page).toHaveURL("/workout");
  await expect(nav).toHaveClass(/kspo-sky-theme/);
  await expect(page.getByRole("main")).toHaveCSS("color", "rgb(16, 46, 58)");
  await page.goBack();
  await expectProfile();
  expect(api.mutations).toEqual([]);
});
