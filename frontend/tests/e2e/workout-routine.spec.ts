import { test, expect, type Page } from "@playwright/test";
import { installApi, testRecord } from "./integration-fixtures";
import { prepareAssessment } from "./workout-helpers";

async function start(page: Page) {
  await page.goto("/workout");
  await page.clock.install();
  await page.getByRole("button", { name: "운동 시작", exact: true }).click();
  await expect(
    page.getByRole("timer", { name: "시작 카운트다운" }),
  ).toBeVisible();
  await page.clock.fastForward(3100);
  await expect(
    page.getByRole("button", { name: "세트 완료", exact: true }),
  ).toBeVisible();
}

test("메인 운동 탭부터 네 세트 완료와 메인 복귀까지 배정 데이터와 측정 기록을 변경하지 않는다", async ({
  page,
}) => {
  const api = await installApi(page, testRecord());
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "하단 메뉴" });
  await navigation.getByRole("link", { name: "운동", exact: true }).click();
  await expect(page).toHaveURL("/workout");
  await expect(
    navigation.getByRole("link", { name: "운동", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "내 기존 운동", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("체험 운동", { exact: true })).toBeVisible();
  await page.clock.install();
  const startButton = page.getByRole("button", {
    name: "운동 시작",
    exact: true,
  });
  await startButton.focus();
  await page.keyboard.press("Enter");
  await page.clock.fastForward(3100);
  await expect(navigation).toBeHidden();
  for (let set = 0; set < 4; set++) {
    await expect(
      page.getByRole("heading", {
        name: set < 2 ? "스쿼트" : "푸시업",
        exact: true,
      }),
    ).toBeVisible();
    await page.clock.fastForward(20000);
    await page.getByRole("button", { name: "세트 완료", exact: true }).click();
    if (set < 3) {
      await expect(page.getByRole("status")).toHaveText("잠깐, 편하게 쉬어요");
      await page
        .getByRole("button", { name: "휴식 끝내기", exact: true })
        .click();
      await page.getByRole("button", { name: /세트 시작$/ }).click();
      await page.clock.fastForward(3100);
    }
  }
  await expect(
    page.getByRole("heading", { name: "운동을 마쳤어요" }),
  ).toBeFocused();
  await expect(
    page.getByRole("list", { name: "운동 결과" }).getByText("2 / 2세트 · 완료"),
  ).toHaveCount(2);
  await expect(
    page.getByText("체험 운동은 운동 기록에 저장되지 않아요."),
  ).toBeVisible();
  await page.getByRole("link", { name: "메인으로 돌아가기" }).click();
  await expect(page).toHaveURL("/");
  await expect(navigation).toBeVisible();
  expect(api.mutations).toEqual([]);
});

test("일시정지, 화면 숨김, 휴식 타이머는 시간을 멈추고 명시적으로 이어간다", async ({
  page,
}) => {
  const api = await installApi(page);
  await start(page);
  await page.clock.fastForward(5000);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  const timer = page.getByRole("timer");
  const paused = await timer.textContent();
  await page.clock.fastForward(60000);
  await expect(timer).toHaveText(paused!);
  await page.getByRole("button", { name: "이어서 운동하기" }).click();
  await page.clock.fastForward(2000);
  expect(await timer.textContent()).not.toBe(paused);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("status")).toHaveText("잠시 멈췄어요");
  await page.evaluate(() => {
    delete (document as unknown as Record<string, unknown>).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByRole("button", { name: "이어서 운동하기" }).click();
  await page.getByRole("button", { name: "세트 완료", exact: true }).click();
  await page.clock.fastForward(5000);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  const rest = await timer.textContent();
  await page.clock.fastForward(60000);
  await expect(timer).toHaveText(rest!);
  await page.getByRole("button", { name: "이어서 운동하기" }).click();
  await page.clock.fastForward(25000);
  await expect(page.getByRole("button", { name: "2세트 시작" })).toBeVisible();
  await page.clock.fastForward(60000);
  await expect(page.getByRole("button", { name: "2세트 시작" })).toBeVisible();
  expect(api.mutations).toEqual([]);
});

test("중도 마무리 취소·확정과 운동 건너뛰기는 미완료 세트를 완료로 집계하지 않는다", async ({
  page,
}) => {
  const api = await installApi(page);
  await start(page);
  await page.getByRole("button", { name: "세트 완료", exact: true }).click();
  await page.getByRole("button", { name: "휴식 끝내기" }).click();
  await page.getByRole("button", { name: "이 운동 건너뛰기" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "건너뛰기", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "푸시업", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "운동 세트 진행" }),
  ).toHaveAttribute("value", "1");
  await page.getByRole("button", { name: "이전 단계" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "푸시업", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "운동 마무리하기" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "운동 마무리", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "운동을 마무리했어요" }),
  ).toBeVisible();
  const results = page.getByRole("list", { name: "운동 결과" });
  await expect(results).toContainText("1 / 2세트 · 나머지 건너뜀");
  await expect(results).toContainText("0 / 2세트 · 나머지 건너뜀");
  expect(api.mutations).toEqual([]);
});

for (const width of [320, 390, 430, 1280]) {
  test(`${width}px 준비·진행·완료의 overflow와 터치 영역을 검증한다`, async ({
    page,
  }, info) => {
    await installApi(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
    await page.goto("/workout");
    async function screenshot(name: string) {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${name}-${width}.png`),
        fullPage: true,
      });
    }
    await screenshot("ready");
    const card = page.locator("li").filter({
      has: page.getByRole("heading", { name: "스쿼트", exact: true }),
    });
    await card.getByText("동작 안내", { exact: true }).click();
    await expect(card.locator("ol")).toBeVisible();
    await start(page);
    await screenshot("active");
    const bounds = await page
      .getByRole("button", { name: "세트 완료", exact: true })
      .boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await expect(
      page.getByRole("button", { name: "세트 완료", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "일시정지", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "운동 마무리하기" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "운동 마무리", exact: true })
      .click();
    await expect(page.getByText("0 / 2세트 · 나머지 건너뜀")).toHaveCount(2);
    await screenshot("complete");
  });
}

test("공용 타이머 변경 후에도 간이측정의 고정 시간·중단 재시작 정책을 유지한다", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/workout?mode=assessment");
  await prepareAssessment(page);
  await page.clock.install();
  await page.getByRole("button", { name: "측정 시작", exact: true }).click();
  await page.clock.fastForward(23000);
  await page.getByRole("button", { name: "측정 중단", exact: true }).click();
  await page.getByRole("button", { name: "이 항목 다시 시작" }).click();
  await page.clock.fastForward(3050);
  await expect(page.getByRole("timer", { name: "남은 시간" })).toContainText(
    "1:00",
  );
  await page.clock.fastForward(60000);
  await expect(page.getByLabel("성공한 횟수 (회)")).toBeVisible();
  await page.getByLabel("성공한 횟수 (회)").fill("0");
  await page.getByRole("button", { name: "입력하고 다음으로" }).click();
  await page.getByRole("button", { name: "측정 시작", exact: true }).click();
  await page.clock.fastForward(253000);
  await expect(page.getByLabel("10초 동안 센 맥박 (회)")).toBeVisible();
});
