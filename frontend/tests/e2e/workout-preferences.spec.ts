import { test, expect, type Page } from "@playwright/test";
import { installApi } from "./integration-fixtures";
import type { StoredExercisePreferences } from "../../lib/user-preferences";
import { ownedToolOptions } from "../../lib/user-preferences";

const path = "**/api/v1/users/me/preferences";
const initial: StoredExercisePreferences = {
  exerciseVolume: "standard",
  exerciseGoal: null,
  ownedTools: [],
  updatedAt: "2026-09-26T00:00:00.000Z",
};
async function installPreferences(page: Page, value = initial) {
  await installApi(page);
  const state = {
    value: { ...value },
    patches: [] as Record<string, unknown>[],
  };
  await page.route(path, async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      expect(request.headers()["authorization"]).toBe("Bearer test-token");
      expect(request.headers()["x-csrf-protection"]).toBe("1");
      expect(request.headers()["content-type"]).toContain("application/json");
      const changes = request.postDataJSON();
      state.patches.push(changes);
      state.value = { ...state.value, ...changes };
    }
    await route.fulfill({ json: state.value });
  });
  return state;
}

test("저장된 설정을 조회하고 변경 필드만 저장해 다른 곳의 설정을 보존한다", async ({
  page,
}, info) => {
  const state = await installPreferences(page, {
    ...initial,
    exerciseVolume: "less",
    exerciseGoal: "body_composition_management",
  });
  await page.goto("/account/preferences");
  await expect(page.getByRole("radio", { name: "가볍게" })).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "체형 관리", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "저장하기", exact: true }),
  ).toBeDisabled();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`preferences-${width}.png`),
      fullPage: true,
    });
  }
  // A concurrent change to the untouched goal must not be overwritten.
  state.value.exerciseGoal = "fitness_grade_improvement";
  await page.getByText("충분히", { exact: true }).click();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  expect(state.patches).toEqual([{ exerciseVolume: "more" }]);
  await expect(
    page.getByRole("radio", { name: "국민체력100 등급 개선", exact: true }),
  ).toBeChecked();
  await page.reload();
  await expect(page.getByRole("radio", { name: "충분히" })).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "국민체력100 등급 개선", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "저장하기", exact: true }),
  ).toBeDisabled();
});

test("보유 도구를 복수 선택·해제하고 없음으로 전체 해제한다", async ({
  page,
}) => {
  const state = await installPreferences(page, {
    ...initial,
    ownedTools: ["band"],
  });
  await page.goto("/account/preferences");
  await expect(
    page.getByRole("checkbox", { name: "밴드", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "없음", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("checkbox", { name: "덤벨·아령", exact: true }).check();
  await page.getByRole("checkbox", { name: "짐볼", exact: true }).check();
  await page.getByRole("checkbox", { name: "밴드", exact: true }).uncheck();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  expect(state.patches).toEqual([{ ownedTools: ["dumbbell", "gym_ball"] }]);
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "덤벨·아령", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "짐볼", exact: true }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: "없음", exact: true }).check();
  await expect(
    page.getByRole("group", { name: "보유 운동 도구" }).locator(":checked"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  expect(state.patches[1]).toEqual({ ownedTools: [] });
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "없음", exact: true }),
  ).toBeChecked();
});

test("도구 저장 실패 후 선택을 보존하고 동일한 요청으로 재시도한다", async ({
  page,
}) => {
  const state = await installPreferences(page);
  await page.goto("/account/preferences");
  await page.getByRole("checkbox", { name: "밴드", exact: true }).check();
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  await page.route(
    path,
    async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await pending;
      await route.fulfill({
        status: 503,
        json: { message: "temporary test failure" },
      });
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  try {
    await expect(
      page.getByRole("button", { name: "저장 중이에요" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("checkbox", { name: "밴드", exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(
    page.getByRole("form", { name: "운동 설정" }).getByRole("alert"),
  ).toContainText("저장 결과를 확인하지 못했어요");
  await expect(
    page.getByRole("checkbox", { name: "밴드", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "다시 저장하기", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  expect(state.patches).toEqual([{ ownedTools: ["band"] }]);
});

test("지원 6종만 선택·저장·재조회하고 없음으로 전부 해제한다", async ({
  page,
}) => {
  const state = await installPreferences(page);
  await page.goto("/account/preferences");
  const tools = page.getByRole("group", { name: "보유 운동 도구" });
  await expect(tools.getByRole("checkbox")).toHaveCount(7);
  await expect(
    tools.getByText(/폼롤러|보슈|사다리|콘/, { exact: true }),
  ).toHaveCount(0);
  for (const option of ownedToolOptions)
    await tools
      .getByRole("checkbox", { name: option.label, exact: true })
      .check();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("form").getByRole("status")).toHaveText(
    "운동 설정을 저장했어요.",
  );
  expect(state.patches).toEqual([
    { ownedTools: ownedToolOptions.map(({ value }) => value) },
  ]);
  await page.reload();
  for (const option of ownedToolOptions)
    await expect(
      tools.getByRole("checkbox", { name: option.label, exact: true }),
    ).toBeChecked();
  await tools.getByRole("checkbox", { name: "없음", exact: true }).check();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("form").getByRole("status")).toHaveText(
    "운동 설정을 저장했어요.",
  );
  expect(state.patches[1]).toEqual({ ownedTools: [] });
  await page.reload();
  await expect(tools.locator(":checked")).toHaveCount(1);
  await expect(
    tools.getByRole("checkbox", { name: "없음", exact: true }),
  ).toBeChecked();
});

test("운동량과 도구의 동시 PATCH가 400이면 모든 편집을 미저장으로 유지한다", async ({
  page,
}) => {
  const state = await installPreferences(page);
  await page.goto("/account/preferences");
  await page.getByRole("checkbox", { name: "밴드", exact: true }).check();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("form").getByRole("status")).toHaveText(
    "운동 설정을 저장했어요.",
  );
  await page.getByText("충분히", { exact: true }).click();
  await page.getByRole("checkbox", { name: "덤벨·아령", exact: true }).check();
  await page.route(
    path,
    async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      state.patches.push(route.request().postDataJSON());
      await route.fulfill({
        status: 400,
        json: {
          message: "설정 전체를 저장하지 못했어요.",
          errors: [
            {
              field: "ownedTools.0",
              message: "지원하는 도구를 선택해 주세요.",
            },
          ],
        },
      });
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  const form = page.getByRole("form", { name: "운동 설정" });
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(form.getByRole("status")).toHaveCount(0);
  await expect(
    page.getByRole("radio", { name: "충분히", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "덤벨·아령", exact: true }),
  ).toBeChecked();
  expect(state.value).toEqual({ ...initial, ownedTools: ["band"] });
  expect(state.patches[1]).toEqual({
    exerciseVolume: "more",
    ownedTools: ["band", "dumbbell"],
  });
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(form.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  expect(state.patches[2]).toEqual(state.patches[1]);
  expect(state.value.exerciseVolume).toBe("more");
  expect(state.value.ownedTools).toEqual(["band", "dumbbell"]);
});

test("목적 미선택을 유지하면서 운동량을 저장하고 키보드로 목적을 선택한다", async ({
  page,
}) => {
  const state = await installPreferences(page);
  await page.goto("/account/preferences");
  await expect(
    page.getByRole("radio", { name: "기본", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("group", { name: "운동 목적" }).locator(":checked"),
  ).toHaveCount(0);
  await page.getByText("가볍게", { exact: true }).click();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  expect(state.patches).toEqual([{ exerciseVolume: "less" }]);
  await page
    .getByRole("radio", { name: "국민체력100 등급 개선", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "체형 관리", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  expect(state.patches[1]).toEqual({
    exerciseGoal: "body_composition_management",
  });
});

test("조회 실패나 잘못된 응답은 기본 선택으로 대체하지 않고 다시 불러온다", async ({
  page,
}) => {
  await installPreferences(page);
  let stage = 0;
  await page.route(path, (route) => {
    if (stage === 0)
      return route.fulfill({
        status: 503,
        json: { message: "missing preference row" },
      });
    if (stage === 1) return route.fulfill({ json: { exerciseVolume: "more" } });
    return route.fallback();
  });
  await page.goto("/account/preferences");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "서버가 잠시 응답하지 않아요",
  );
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "저장하기" })).toHaveCount(0);
  stage++;
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "운동 설정을 확인할 수 없어요",
  );
  stage++;
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(
    page.getByRole("radio", { name: "기본", exact: true }),
  ).toBeChecked();
});

test("검증 오류와 요청 제한에서 선택을 유지하고 제한 시간 뒤 다시 저장한다", async ({
  page,
}) => {
  const state = await installPreferences(page);
  await page.clock.install();
  let attempts = 0;
  await page.route(path, (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 400,
        json: {
          message: "입력 내용을 확인해 주세요.",
          errors: [
            {
              field: "exerciseGoal",
              message: "운동 목적을 다시 선택해 주세요.",
            },
          ],
        },
      });
    if (attempts === 2)
      return route.fulfill({ status: 429, json: { retry_after: 2 } });
    return route.fallback();
  });
  await page.goto("/account/preferences");
  await page.getByText("체형 관리", { exact: true }).click();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("group", { name: "운동 목적" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    page.getByRole("radio", { name: "체형 관리", exact: true }),
  ).toBeChecked();
  await page.getByText("기본 체력 증진", { exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "2초 후 다시 저장" }),
  ).toBeDisabled();
  await page.clock.runFor(2100);
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  expect(state.patches).toEqual([
    { exerciseGoal: "general_fitness_improvement" },
  ]);
});

test("응답 유실은 동일한 변경분으로 재시도하고 저장 중 중복 제출을 막는다", async ({
  page,
}) => {
  const state = await installPreferences(page);
  let attempts = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(path, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    attempts++;
    if (attempts === 1) {
      state.patches.push(route.request().postDataJSON());
      state.value.exerciseVolume = "more";
      await held;
      return route.abort("failed");
    }
    return route.fallback();
  });
  await page.goto("/account/preferences");
  await page.getByText("충분히", { exact: true }).click();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "저장 중이에요" }),
  ).toBeDisabled();
  await expect(page.getByRole("radio", { name: "가볍게" })).toBeDisabled();
  await page
    .getByRole("form", { name: "운동 설정" })
    .evaluate((form: HTMLFormElement) => form.requestSubmit());
  expect(attempts).toBe(1);
  release();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "저장 결과를 확인하지 못했어요",
  );
  await expect(page.getByRole("radio", { name: "가볍게" })).toBeDisabled();
  state.value.exerciseGoal = "body_composition_management";
  await page.getByRole("button", { name: "다시 저장하기" }).click();
  await expect(page.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  expect(state.patches).toEqual([
    { exerciseVolume: "more" },
    { exerciseVolume: "more" },
  ]);
  await expect(
    page.getByRole("radio", { name: "체형 관리", exact: true }),
  ).toBeChecked();
});

test("저장 전 이탈을 확인하고 저장 후 재수정도 보호한다", async ({ page }) => {
  const state = await installPreferences(page);
  await page.goto("/account/preferences");
  await page.getByText("충분히", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "이전 화면" }).click();
  await expect(page).toHaveURL("/account/preferences");
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  await page.getByText("가볍게", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "이전 화면" }).click();
  await expect(page).toHaveURL("/account");
  await page.getByRole("link", { name: "운동 설정" }).click();
  await expect(page.getByRole("radio", { name: "충분히" })).toBeChecked();
  expect(state.patches).toEqual([{ exerciseVolume: "more" }]);
});

test("저장 중 세션이 만료되면 기존 로그인 복귀 경로로 이동한다", async ({
  page,
}) => {
  const state = await installPreferences(page);
  await page.goto("/account/preferences");
  await page.getByText("충분히", { exact: true }).click();
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { message: "expired" } }),
  );
  await page.route(path, (route) =>
    route.fulfill({ status: 401, json: { message: "expired" } }),
  );
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fpreferences/);
  expect(state.patches).toEqual([]);
  await expect(page.getByText("운동 설정을 저장했어요.")).toHaveCount(0);
});
