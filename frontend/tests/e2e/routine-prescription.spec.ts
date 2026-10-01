import { test, expect, type Page } from "@playwright/test";
import { installApi } from "./integration-fixtures";
import { routineFixture } from "../fixtures/routine";
import {
  storedCatalogFixture,
  storedRecordFixture,
} from "../fixtures/measurement-evaluation";

async function installRoutine(
  page: Page,
  row: ReturnType<typeof routineFixture>,
) {
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/v2/workout-routines/**", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith("/history")
        ? { items: [row], nextCursor: null }
        : row,
    });
  });
}

for (const sets of [2, 3])
  test(`저장된 ${sets}세트·수량·단위·설명·휴식과 order를 목록·상세·재조회에서 보존한다`, async ({
    page,
  }) => {
    await installApi(page);
    const row = routineFixture();
    row.cardioRecommendation =
      sets === 2 ? null : { activity: "뛰기", minutes: 17 };
    row.routine[0].slot = "cooldown";
    row.routine[1].slot = "strength_group";
    row.routine[2].slot = "flexibility_group";
    for (const item of row.routine)
      item.prescription = {
        doseType: "reps",
        sets,
        value: "12.5",
        unit: "회",
        restSec: 45,
        text: `저장된 설명 ${item.order}`,
      };
    const snapshot = JSON.stringify(row);
    await installRoutine(page, row);
    await page.goto("/workout");
    const list = page.getByRole("list", { name: "오늘 배정된 운동" });
    await expect(list.getByRole("heading")).toHaveText([row.routine[0].title]);
    for (const [index, item] of [row.routine[0]].entries()) {
      const prescription = list
        .getByRole("listitem")
        .nth(index)
        .getByRole("group", { name: "저장된 운동 처방" });
      await expect(prescription).toContainText(item.prescription.text);
      await expect(prescription).toContainText(
        `12.5회 × ${sets}세트 · 휴식 45초`,
      );
    }
    await list.getByRole("link", { name: "운동 시작하기" }).first().click();
    await expect(page).toHaveURL(
      `/workout-routines/${row.id}/items/${row.routine[0].id}`,
    );
    await expect(
      page.getByRole("heading", { name: "운동 중", exact: true }),
    ).toBeVisible();
    const prescription = page.getByRole("group", { name: "저장된 운동 처방" });
    await expect(prescription).toContainText("저장된 설명 1");
    await expect(prescription).toContainText(
      `12.5회 × ${sets}세트 · 휴식 45초`,
    );
    await page.reload();
    await expect(prescription).toContainText(
      `12.5회 × ${sets}세트 · 휴식 45초`,
    );
    expect(JSON.stringify(row)).toBe(snapshot);
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

test("추천 스냅샷의 계산용 3은 측정 기준 미달과 grade:null 표시를 바꾸지 않는다", async ({
  page,
}) => {
  const record = storedRecordFixture();
  const item = record.items[0],
    evaluation = item.evaluation;
  item.value = "3";
  evaluation.status = "below_standard";
  evaluation.grade = null;
  evaluation.message = "공식 종목별 기준 미달입니다.";
  evaluation.nextTarget = {
    status: "available",
    grade: 3,
    reasonCode: null,
    intervals: evaluation.thresholds.find((threshold) => threshold.grade === 3)!
      .intervals,
    adjustments: [
      {
        lower: {
          threshold: "5.3",
          inclusive: true,
          difference: "2.3",
          unit: "cm",
          change: "increase",
          requiresBeyondBoundary: false,
        },
        upper: null,
      },
    ],
  };
  record.axes[3].status = "below_standard";
  record.axes[3].grade = null;
  const row = routineFixture();
  row.inputSnapshot = {
    axes: record.axes,
    fitness100: { fitness: { flexibility: 3 } },
  };
  const snapshot = JSON.stringify(row.inputSnapshot);
  await installApi(page, record, storedCatalogFixture);
  await installRoutine(page, row);
  await page.goto("/workout");
  await expect(
    page.getByRole("list", { name: "오늘 배정된 운동" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page.goto(`/measurements/${record.id}`);
  await expect(page.locator(".radar-grade").nth(3)).toHaveText("기준 미달");
  const report = page.getByRole("region", { name: "측정 상세 리포트" });
  await report.locator('summary[aria-label="유연성 · 기준 미달"]').click();
  const current = report.locator('[aria-current="step"]');
  await expect(current).toContainText("기준 미달");
  await expect(current).not.toContainText("3등급");
  expect(record.axes[3].grade).toBeNull();
  expect(JSON.stringify(row.inputSnapshot)).toBe(snapshot);
});
