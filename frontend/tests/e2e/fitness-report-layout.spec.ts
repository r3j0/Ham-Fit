import { test, expect } from "@playwright/test";
import { installApi } from "./integration-fixtures";
import {
  storedRecordFixture,
  storedCatalogFixture,
  unscoredRecordFixture,
} from "../fixtures/measurement-evaluation";
import {
  gripRecordFixture,
  gripCatalogFixture,
} from "../fixtures/grip-evaluation";

for (const grade of [null, 3, 2, 1] as const) {
  test(`등급 단계·색상·접힌 기준표를 표시한다: ${grade ?? "기준 미달"}`, async ({
    page,
  }) => {
    const record = storedRecordFixture();
    const item = record.items[0],
      e = item.evaluation;
    const value =
      grade === null ? "3" : grade === 3 ? "7" : grade === 2 ? "10.1" : "16";
    item.value = value;
    e.grade = grade;
    e.status = grade === null ? "below_standard" : "graded";
    record.axes[3].grade = grade;
    record.axes[3].status = e.status;
    if (grade === 1)
      e.nextTarget = {
        status: "highest_grade",
        grade: null,
        intervals: [],
        adjustments: [],
        reasonCode: "highest_grade_reached",
      };
    else {
      const nextGrade = grade === null ? 3 : grade === 3 ? 2 : 1;
      const interval = e.thresholds.find((t) => t.grade === nextGrade)!
        .intervals[0];
      e.nextTarget = {
        status: "available",
        grade: nextGrade,
        intervals: [interval],
        reasonCode: null,
        adjustments: [
          {
            lower: {
              threshold: interval.lower!.value,
              inclusive: true,
              difference: String(
                Number(
                  (Number(interval.lower!.value) - Number(value)).toFixed(1),
                ),
              ),
              unit: "cm",
              change: "increase",
              requiresBeyondBoundary: false,
            },
            upper: null,
          },
        ],
      };
    }
    await installApi(page, record, storedCatalogFixture);
    await page.goto(`/measurements/${record.id}`);
    const report = page.getByRole("region", { name: "측정 상세 리포트" });
    await report.locator('summary[aria-label^="유연성"]').click();
    const progress = report.getByRole("list", {
      name: "이전 기준과 현재 등급, 다음 목표",
    });
    await expect(progress.locator(":scope > li")).toHaveCount(
      grade === null ? 2 : 3,
    );
    const current = progress.locator('[aria-current="step"]');
    await expect(current).toContainText(grade ? `${grade}등급` : "기준 미달");
    await expect(current).toHaveCSS(
      "background-color",
      grade === null
        ? "rgb(255, 228, 230)"
        : grade === 3
          ? "rgb(255, 127, 0)"
          : grade === 2
            ? "rgb(189, 82, 0)"
            : "rgb(166, 73, 0)",
    );
    if (grade === null || grade === 3)
      await expect(progress).toContainText("5.3 cm 미만");
    if (grade === 1) await expect(progress).toContainText("최고 등급!");
    await expect(report.getByRole("table")).toBeHidden();
    await report.getByText("전체 등급 기준 보기", { exact: true }).click();
    await expect(report.getByRole("table")).toBeVisible();
    await expect(report.getByRole("link").first()).toBeHidden();
    await report.getByText("판정 기준 및 출처", { exact: true }).click();
    await expect(report.getByRole("link").first()).toBeVisible();
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("복수 종목은 대표 종목을 먼저 표시하고 공통·개별 기준표 없이 단계와 단일 출처를 제공한다", async ({
  page,
}) => {
  const record = gripRecordFixture();
  const relative = structuredClone(record.items[0]);
  relative.measurementCode = relative.evaluation.measurementCode =
    "relative_grip_strength";
  relative.unit = "%";
  relative.value = "51.6";
  relative.evaluation.grade = 3;
  delete relative.evaluation.conversion;
  relative.evaluation.nextTarget = {
    status: "available",
    grade: 2,
    reasonCode: null,
    intervals: structuredClone(relative.evaluation.thresholds[1].intervals),
    adjustments: [
      {
        lower: {
          threshold: "57",
          inclusive: true,
          difference: "5.4",
          unit: "%",
          change: "increase",
          requiresBeyondBoundary: false,
        },
        upper: null,
      },
    ],
  };
  record.items.unshift(relative);
  record.axes[1].measuredMeasurementCodes.push("relative_grip_strength");
  const catalog = structuredClone(gripCatalogFixture);
  catalog.definitions.push({
    ...catalog.definitions[0],
    code: "relative_grip_strength",
    label: "상대악력",
    unit: "%",
  });
  await installApi(page, record, catalog);
  await page.goto(`/measurements/${record.id}`);
  const report = page.getByRole("region", { name: "측정 상세 리포트" });
  await report.locator('summary[aria-label="근력 · 2등급"]').click();
  const items = report.locator(".evaluation-item");
  await expect(
    items.first().getByRole("heading", { name: "절대악력" }),
  ).toBeVisible();
  await expect(
    items.first().getByText("대표 등급 반영", { exact: true }),
  ).toBeVisible();
  await expect(items.nth(1)).toBeHidden();
  await report
    .locator("summary")
    .filter({ hasText: /상대악력.*51.6/ })
    .click();
  await expect(items.nth(1)).toBeVisible();
  await expect(items.nth(1)).toContainText("3등급");
  await expect(
    report.getByText(/공통 등급 기준 보기|전체 등급 기준 보기/),
  ).toHaveCount(0);
  await expect(report.getByRole("table")).toHaveCount(0);
  await report.getByText("판정 기준 및 출처", { exact: true }).click();
  const links = await report
    .getByRole("link")
    .evaluateAll((elements) => elements.map((el) => el.getAttribute("href")));
  expect(links.length).toBe(new Set(links).size);
  await expect(report.getByText("판정 기준 정보", { exact: true })).toHaveCount(
    1,
  );
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("평가 불가 사유는 한 번만 표시하고 등급 단계를 만들지 않는다", async ({
  page,
}) => {
  const record = unscoredRecordFixture("insufficient_information");
  await installApi(page, record, storedCatalogFixture);
  await page.goto(`/measurements/${record.id}`);
  const report = page.getByRole("region", { name: "측정 상세 리포트" });
  await report.locator('summary[aria-label^="유연성"]').click();
  await expect(
    report.getByText("측정 당시 성별 정보가 필요합니다.", { exact: true }),
  ).toHaveCount(1);
  await expect(
    report.getByRole("list", { name: "이전 기준과 현재 등급, 다음 목표" }),
  ).toHaveCount(0);
  await expect(
    report.getByText("전체 등급 기준 보기", { exact: true }),
  ).toHaveCount(0);
});

test("다각형 제외 항목은 수치 높이의 한 행으로 표시하고 상세 사유를 펼친다", async ({
  page,
}, info) => {
  const record = gripRecordFixture();
  const bodyFat = structuredClone(record.items[1]);
  bodyFat.measurementCode = bodyFat.evaluation.measurementCode =
    "body_fat_percentage";
  bodyFat.value = "32";
  bodyFat.unit = "%";
  record.items.push(bodyFat);
  const catalog = structuredClone(gripCatalogFixture);
  catalog.definitions.push({
    ...catalog.definitions[1],
    code: "body_fat_percentage",
    label: "체지방률",
    unit: "%",
  });
  await installApi(page, record, catalog);
  await page.goto(`/measurements/${record.id}`);
  await expect(page.locator(".radar-legend")).toHaveCount(0);
  await expect(page.locator(".radar-grade")).toHaveCount(6);
  await page.getByText("다각형에 포함하지 않는 항목", { exact: true }).click();
  const summary = page.locator('summary[aria-label^="체지방률:"]');
  const item = summary.locator("..");
  await expect(summary).toContainText("32");
  await expect(summary).toContainText("%");
  await expect(
    item.getByText(bodyFat.evaluation.message, { exact: true }),
  ).toBeHidden();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect((await summary.boundingBox())!.height).toBeLessThanOrEqual(48);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page
      .getByRole("heading", { name: "이 기록의 체력 프로필" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`record-summary-${width}.png`),
      fullPage: true,
    });
  }
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(
    item.getByText(bodyFat.evaluation.message, { exact: true }),
  ).toBeVisible();
});
