import { test, expect } from "@playwright/test";
import { installApi } from "./integration-fixtures";
import {
  storedRecordFixture,
  storedCatalogFixture,
  unscoredRecordFixture,
  recordIdentity,
} from "../fixtures/measurement-evaluation";

test("실제 계약의 종목별 평가로 6축과 상세 기준을 표시하고 원문 등급을 구분한다", async ({
  page,
}) => {
  const record = storedRecordFixture();
  record.items[0].reportedGrade = "결과표 직접 입력 등급";
  await installApi(page, record, storedCatalogFixture);
  await page.goto(`/measurements/${recordIdentity.id}`);
  await expect(
    page.getByRole("img", { name: "6가지 체력 요인별 등급" }),
  ).toBeVisible();
  await expect(page.locator(".radar-point")).toHaveCount(6);
  await expect(page.locator('.radar-point[cx="180"][cy="158"]')).toHaveCount(5);
  await expect(page.getByTestId("radar-path")).toHaveAttribute("d", / Z$/);
  await page.locator('summary[aria-label^="유연성 · 2등급"]').click();
  await expect(
    page
      .locator(".evaluation-item")
      .getByRole("heading", { name: "앉아 윗몸 앞으로 굽히기" }),
  ).toBeVisible();
  await expect(page.getByText(/현재 값과의 차이 4.8 cm/)).toBeVisible();
  await expect(
    page.getByText("14.9 cm 이상", { exact: true }).first(),
  ).toBeVisible();
  await page.getByText("판정 기준 및 출처", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: /국민체력100 성인기 인증기준/ }),
  ).toHaveAttribute("href", /^https:\/\/nfa.kspo.or.kr/);
  await expect(
    page.getByText("결과표 등급: 결과표 직접 입력 등급"),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("오래된 평가 응답에서는 원본 기록과 편집 진입을 유지한다", async ({
  page,
}) => {
  const record = storedRecordFixture();
  record.items[0].evaluation.recordRevision = 2;
  await installApi(page, record, storedCatalogFixture);
  await page.goto(`/measurements/${recordIdentity.id}`);
  await expect(page.getByText(/평가 정보를 확인하지 못했어요/)).toBeVisible();
  await expect(page.locator(".radar-point")).toHaveCount(0);
  await expect(page.getByText("10.1 cm", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "기록 수정", exact: true }).click();
  await expect(
    page.getByLabel("앉아 윗몸 앞으로 굽히기", { exact: true }),
  ).toHaveValue("10.1");
});
for (const status of [
  "not_evaluated",
  "insufficient_information",
  "criteria_unavailable",
] as const) {
  test(`평가 없음도 원점 6개를 연결하고 사유를 구분한다: ${status}`, async ({
    page,
  }) => {
    await installApi(page, unscoredRecordFixture(status), storedCatalogFixture);
    await page.goto(`/measurements/${recordIdentity.id}`);
    await expect(page.locator('.radar-point[cx="180"][cy="158"]')).toHaveCount(
      6,
    );
    await expect(page.getByTestId("radar-path")).toHaveAttribute(
      "d",
      "M 180 158 L 180 158 L 180 158 L 180 158 L 180 158 L 180 158 Z",
    );
    await expect(
      page
        .locator(".fitness-radar:not(.fitness-radar-compact) .radar-grade")
        .nth(3),
    ).toHaveText(
      {
        not_evaluated: "평가 미존재 · 미평가",
        insufficient_information: "평가 불가 · 정보 부족",
        criteria_unavailable: "평가 불가 · 기준 없음",
      }[status],
    );
  });
}
test("범위와 열린 경계·대안 목표를 원래 조건대로 안내한다", async ({
  page,
}) => {
  const record = storedRecordFixture(),
    e = record.items[0].evaluation;
  e.criterion!.direction = "range";
  const intervals = [
    {
      lower: { value: "10.1", inclusive: false },
      upper: { value: "20", inclusive: true },
    },
    { lower: null, upper: { value: "-2", inclusive: false } },
  ];
  e.thresholds[0].intervals = intervals;
  e.nextTarget.intervals = structuredClone(intervals);
  e.nextTarget.adjustments = [
    {
      lower: {
        threshold: "10.1",
        inclusive: false,
        difference: "0",
        unit: "cm",
        change: "increase",
        requiresBeyondBoundary: true,
      },
      upper: {
        threshold: "20",
        inclusive: true,
        difference: "0",
        unit: "cm",
        change: "none",
        requiresBeyondBoundary: false,
      },
    },
    {
      lower: null,
      upper: {
        threshold: "-2",
        inclusive: false,
        difference: "12.1",
        unit: "cm",
        change: "decrease",
        requiresBeyondBoundary: true,
      },
    },
  ];
  await installApi(page, record, storedCatalogFixture);
  await page.goto(`/measurements/${record.id}`);
  await page.locator('summary[aria-label^="유연성 · 2등급"]').click();
  await expect(
    page.getByText("아래 조건 중 하나를 충족하면 돼요."),
  ).toBeVisible();
  await expect(
    page.getByText("10.1 cm 초과 · 20 cm 이하", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/0 cm · 증가 필요.*10.1 cm 초과 필요/),
  ).toBeVisible();
  await expect(
    page.getByText(/12.1 cm · 감소 필요.*-2 cm 미만 필요/),
  ).toBeVisible();
});
