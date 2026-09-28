import { test, expect } from "@playwright/test";
import { installApi } from "./integration-fixtures";
import { prepareAssessment, skipToFlexibility } from "./workout-helpers";
test("간이측정 등록은 기존 사용자 커리큘럼을 보존한다", async ({ page }) => {
  const server = await installApi(page);
  const progress = page.getByRole("progressbar", {
    name: "체력 기록 진행 단계",
  });
  await page.goto("/workout");
  await expect(
    page.getByRole("heading", { name: "내 기존 운동" }),
  ).toBeVisible();
  await expect(page.getByLabel("만 나이", { exact: true })).toHaveCount(0);
  await expect(progress).toHaveCount(0);
  await page.getByRole("link", { name: "체력 기록 시작하기" }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("link", { name: "결과표가 없어요" }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "2");
  await expect(
    page.getByRole("navigation", { name: "하단 메뉴" }),
  ).toBeHidden();
  await prepareAssessment(page);
  await expect(progress).toHaveAttribute(
    "aria-valuetext",
    "3단계 중 3단계, 간이측정 진행",
  );
  await skipToFlexibility(page);
  await page.getByLabel("기준선에서 도달한 거리 (cm)").fill("0");
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  await expect(progress).toHaveAttribute(
    "aria-valuetext",
    "3단계 중 3단계, 측정 결과 확인",
  );
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "2");
  await page.getByRole("button", { name: "변경 완료", exact: true }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "3");
  await page.reload();
  await expect(progress).toHaveAttribute(
    "aria-valuetext",
    "3단계 중 3단계, 측정 결과 확인",
  );
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  await expect(progress).toHaveAttribute(
    "aria-valuetext",
    "3단계 중 3단계, 체력 기록 완료",
  );
  await expect(page).toHaveURL(/\/onboarding\/complete\?record=/);
  await expect(
    page.getByRole("link", { name: "새 체력 기록 시작" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "측정 기록 보기", exact: true }).click();
  await expect(page).toHaveURL(/measurements\/.+saved=1/);
  await expect(progress).toHaveCount(0);
  expect(server.mutations.map((m) => [m.method, m.path])).toEqual([
    ["POST", "/measurements"],
  ]);
  expect(server.record?.entryMethod).toBe("self_assessment");
  expect(server.record?.reportKind).toBe("unknown");
  await page.goto("/workout");
  await expect(
    page.getByRole("heading", { name: "내 기존 운동" }),
  ).toBeVisible();
  await expect(page.getByText("배정됨", { exact: true })).toBeVisible();
  await expect(progress).toHaveCount(0);
});
