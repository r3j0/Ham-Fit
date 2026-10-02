import { expect, test } from "@playwright/test";
import { installStreakCompletion } from "./streak-completion-fixtures";

test.beforeEach(async ({ page }) => {
  test.skip(
    process.env.E2E_PERSONAL_ROULETTE !== "true" ||
      process.env.E2E_PROPOSED_REWARDS !== "true",
    "개인 룰렛과 완료 보상을 활성화한 서버에서 실행",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("메인 개인 룰렛 카드는 사용 가능한 횟수가 있을 때만 표시한다", async ({
  page,
}) => {
  const { state } = await installStreakCompletion(page);
  for (const count of [0, 1, 3, 0]) {
    state.tickets = count;
    const response = page.waitForResponse((r) =>
      r.url().includes("streak-roulette/tickets"),
    );
    await page.goto("/");
    await response;
    await expect(
      page.getByRole("region", { name: "연속 운동", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "개인 룰렛", exact: true }),
    ).toHaveCount(count > 0 ? 1 : 0);
    if (count)
      await expect(page.getByLabel("개인 룰렛 사용 가능 횟수")).toHaveText(
        `${count}회`,
      );
  }
  state.ticketError = true;
  await page.reload();
  await expect(
    page.getByRole("region", { name: "개인 룰렛", exact: true }),
  ).toHaveCount(0);
});

for (const streak of [5, 10])
  test(`${streak}일 달성: 스트릭 → 룰렛 획득 → 그룹 미션 → 씨앗 순서로 진행한다`, async ({
    page,
  }) => {
    const { state, base } = await installStreakCompletion(page);
    state.streak = streak;
    await page.goto(base);
    await page.getByRole("link", { name: "다음", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `현재 ${streak}일 연속!` }),
    ).toBeVisible();
    await page.getByRole("link", { name: "다음", exact: true }).click();
    await expect(page).toHaveURL(`${base}/roulette`);
    await expect(
      page.getByRole("heading", { name: "스트릭 룰렛 1회 획득!" }),
    ).toBeVisible();
    await expect(page.locator('a[href="/roulette/personal"]')).toHaveCount(0);
    await page.getByRole("link", { name: "다음", exact: true }).click();
    await expect(page).toHaveURL(`${base}/water`);
    await expect(
      page.getByRole("heading", {
        name: "매일 함께 운동 그룹에 물을 주었어요!",
      }),
    ).toBeVisible();
    await page.getByRole("link", { name: "다음", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "해바라기씨 1개를 받았어요!" }),
    ).toBeVisible();
  });

for (const groups of [false, true])
  test(`${groups ? "그룹은 있지만 진행 미션 없음" : "그룹 미가입"}: 그룹 미션 화면을 건너뛴다`, async ({
    page,
  }) => {
    const { state, base } = await installStreakCompletion(page);
    state.groups = groups;
    state.mission = "none";
    await page.goto(`${base}/streak`);
    await page.getByRole("link", { name: "다음", exact: true }).click();
    await expect(page).toHaveURL(`${base}/roulette`);
    const next = page.getByRole("link", { name: "다음", exact: true });
    await expect(next).toHaveAttribute("href", `${base}/reward`);
    await next.click();
    await expect(
      page.getByRole("region", { name: "오늘의 그룹 물 주기" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "해바라기씨 1개를 받았어요!" }),
    ).toBeVisible();
    await page.goto(`${base}/water`);
    await expect(page).toHaveURL(`${base}/reward`);
    await expect(
      page.getByRole("region", { name: "오늘의 그룹 물 주기" }),
    ).toHaveCount(0);
  });

for (const streak of [4, 5])
  test(`${streak}일이어도 이번 운동에 지급된 룰렛이 없으면 획득 안내를 하지 않는다`, async ({
    page,
  }) => {
    const { state, base } = await installStreakCompletion(page);
    state.streak = streak;
    state.granted = false;
    await page.goto(`${base}/streak`);
    await expect(
      page.getByRole("link", { name: "다음", exact: true }),
    ).toHaveAttribute("href", `${base}/water`);
    await page.goto(`${base}/roulette`);
    await expect(
      page.getByText("이번 운동에서 획득한 스트릭 룰렛이 없어요."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /1회 획득/ })).toHaveCount(
      0,
    );
  });

test("보상 조회 실패는 재시도로 확인하고 미션 조회 실패를 미참여로 처리하지 않는다", async ({
  page,
}) => {
  const { state, base } = await installStreakCompletion(page);
  state.rewardError = true;
  await page.goto(`${base}/roulette`);
  await expect(
    page.getByRole("button", { name: "보상 다시 확인" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /1회 획득/ })).toHaveCount(0);
  state.rewardError = false;
  await page.getByRole("button", { name: "보상 다시 확인" }).click();
  await expect(
    page.getByRole("heading", { name: "스트릭 룰렛 1회 획득!" }),
  ).toBeVisible();
  state.waterError = true;
  await page.reload();
  await page.getByRole("link", { name: "다음", exact: true }).click();
  await expect(page).toHaveURL(`${base}/water`);
  await expect(
    page.getByRole("button", { name: "물 주기 다시 확인" }),
  ).toBeVisible();
});

test("룰렛 획득 화면은 작은 화면에서도 다음 버튼이 하단 메뉴에 가리지 않는다", async ({
  page,
}) => {
  const { base } = await installStreakCompletion(page);
  await page.goto(`${base}/roulette`);
  const next = page.getByRole("link", { name: "다음", exact: true });
  await expect(next).toBeVisible();
  for (const viewport of [
    { width: 320, height: 664 },
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const button = await next.boundingBox();
    const navigation = await page
      .getByRole("navigation", { name: "하단 메뉴" })
      .boundingBox();
    expect(button!.y + button!.height).toBeLessThanOrEqual(navigation!.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
  }
});
