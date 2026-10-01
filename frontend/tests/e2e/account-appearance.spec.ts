import { test, expect } from "@playwright/test";
import {
  installApi,
  testRecord,
  testUser,
  testWorkout,
} from "./integration-fixtures";
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
    "캐릭터 보유 컬렉션",
    "총 운동 일수",
    "가입한지",
  ]);
  await expect(report.locator("dd")).toHaveText([
    "0일",
    "—집계 준비 중",
    "3개",
    "—집계 준비 중",
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
  const fullBody = page.getByRole("img", { name: "나의 대표 캐릭터" });
  await expect(fullBody.locator('[data-part="torso"]')).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "하단 메뉴" }),
  ).not.toHaveClass(/kspo-orange-theme/);
  expect(errors).toEqual([]);
  expect(api.mutations).toEqual([]);
});

test("프로필을 다시 확인하는 동안 기존 카드와 메뉴 위치를 유지한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/account");
  const card = page.locator(".profile-card");
  const actions = page.locator(".profile-actions");
  await expect(card).toBeVisible();
  await expect(page.locator("main > .content > .loading")).toHaveCount(0);
  const beforeCard = (await card.boundingBox())!;
  const beforeActions = (await actions.boundingBox())!;

  const gate = Promise.withResolvers<void>();
  let profileReads = 0;
  await page.route("**/api/v1/auth/me", async (route) => {
    profileReads++;
    await gate.promise;
    await route.fallback();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => profileReads).toBe(1);

  await expect(card).toBeVisible();
  await expect(page.locator("main > .content > .loading")).toHaveCount(0);
  const pendingCard = (await card.boundingBox())!;
  const pendingActions = (await actions.boundingBox())!;
  expect(pendingCard.x).toBeCloseTo(beforeCard.x, 1);
  expect(pendingCard.y).toBeCloseTo(beforeCard.y, 1);
  expect(pendingCard.height).toBeCloseTo(beforeCard.height, 1);
  expect(pendingActions.y).toBeCloseTo(beforeActions.y, 1);

  gate.resolve();
  await expect.poll(() => profileReads).toBe(1);
  await expect(card).toBeVisible();
});

test("로그아웃 확인창을 열고 닫아도 프로필의 가로 위치와 스크롤을 유지한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto("/account");
  const card = page.locator(".profile-card");
  const logout = page.getByRole("button", { name: "로그아웃", exact: true });
  await expect(card).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("scrollbar-gutter", "stable");
  await logout.scrollIntoViewIfNeeded();
  const before = {
    card: (await card.boundingBox())!,
    scrollY: await page.evaluate(() => window.scrollY),
  };

  await logout.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const open = {
    card: (await card.boundingBox())!,
    scrollY: await page.evaluate(() => window.scrollY),
  };
  expect(open.card.x).toBeCloseTo(before.card.x, 1);
  expect(open.scrollY).toBe(before.scrollY);

  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const closed = {
    card: (await card.boundingBox())!,
    scrollY: await page.evaluate(() => window.scrollY),
  };
  expect(closed.card.x).toBeCloseTo(before.card.x, 1);
  expect(closed.scrollY).toBe(before.scrollY);
});

test("미측정 계정도 가입 당일 표시와 지원되는 활동 정보를 보되 실제 등급을 만들지 않는다", async ({
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

test("저장된 프로필 다시보기·날짜 주소는 유지하고 뒤로 가기는 운동 달력으로 이동한다", async ({
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
  await expect(
    page.getByRole("link", { name: "내 운동 이력", exact: true }),
  ).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "하단 메뉴" });
  async function expectProfile() {
    await expect(page.getByRole("main")).toHaveCSS("color", "rgb(51, 37, 28)");
    await expect(
      nav.getByRole("link", { name: "내 프로필", exact: true }),
    ).toHaveAttribute("aria-current", "location");
    await expect(nav).toHaveCSS("background-color", "rgb(255, 248, 241)");
  }
  await page.goto(`/account/workouts/${completed.id}/replay`);
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
  await calendar.getByRole("button", { name: "이전 주" }).click();
  await calendar
    .getByRole("link", {
      name: "9월 26일, 운동함, 총 1분 0초 운동",
      exact: true,
    })
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
  await expect(page).toHaveURL("/workout");
  await expect(nav).toHaveClass(/kspo-sky-theme/);
  await expect(page.getByRole("main")).toHaveCSS("color", "rgb(16, 46, 58)");
  await page.goBack();
  await expectProfile();
  expect(api.mutations).toEqual([]);
});
