import { test, expect, type Page } from "@playwright/test";
import { installApi } from "./integration-fixtures";

async function reportImage(page: Page) {
  const data = await page.evaluate(async () => {
    await document.fonts.ready;
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1280;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 900, 1280);
    ctx.fillStyle = "#0a2a70";
    ctx.fillRect(0, 0, 900, 180);
    ctx.fillStyle = "#fff";
    ctx.font = 'bold 40px "Noto Sans KR Variable"';
    ctx.fillText("국민체력100 결과표 · 테스트", 52, 110);
    ctx.fillStyle = "#0f172a";
    ctx.font = '28px "Noto Sans KR Variable"';
    const rows = [
      "측정일  2026.09.01",
      "만 나이  25세       성별  여성",
      "신장                      170 cm",
      "체중                        60 kg",
      "유연성                       3 cm",
      "검증용 예시 데이터",
    ];
    rows.forEach((row, index) => {
      ctx.fillText(row, 52, 260 + index * 130);
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(52, 295 + index * 130, 796, 2);
      ctx.fillStyle = "#0f172a";
    });
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return {
    name: "test-report.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
}
async function openForm(page: Page) {
  await page.goto("/onboarding/photo");
  const photo = await reportImage(page);
  await page.getByLabel("결과표 파일 선택").setInputFiles(photo);
  await page.getByRole("button", { name: "이 사진을 보며 직접 입력" }).click();
  await page.getByLabel("측정일", { exact: true }).fill("2026-09-01");
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("25");
  await page.getByLabel("성별", { exact: true }).selectOption("female");
  return photo;
}
async function addHeight(page: Page) {
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await page
    .getByRole("button", { name: "측정 항목 추가", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("검사명 검색").fill("신장");
  await page
    .getByRole("dialog")
    .getByRole("button")
    .filter({ hasText: "신장" })
    .click();
  await page.getByLabel("신장", { exact: true }).fill("170");
}

test("사진 입력 패널은 접기·닫기·키보드 재열기와 단계 이동에서 값을 유지한다", async ({
  page,
}, info) => {
  const server = await installApi(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openForm(page);
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const panel = page.getByRole("complementary");
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`photo-input-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "입력 패널 접기" }).click();
  await expect(page.getByLabel("성별", { exact: true })).toBeHidden();
  await page.screenshot({
    path: info.outputPath("photo-collapsed.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "입력 패널 펼치기" }).click();
  await expect(page.getByLabel("성별", { exact: true })).toHaveValue("female");
  await page.getByRole("button", { name: "입력 패널 닫기" }).click();
  const reopen = page.getByRole("button", { name: "입력 패널 열기" });
  await expect(reopen).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "새 측정 기록", exact: true }),
  ).toBeInViewport();
  expect(await page.getByRole("main").evaluate((el) => el.scrollTop)).toBe(0);
  await page.getByRole("button", { name: "사진 확대", exact: true }).click();
  await expect(page.getByRole("button", { name: "사진 크기 맞춤" })).toHaveText(
    "150%",
  );
  await page.getByRole("button", { name: "사진 크기 맞춤" }).click();
  await page.screenshot({
    path: info.outputPath("photo-only.png"),
    fullPage: true,
  });
  await reopen.focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("complementary")
      .getByRole("heading", { name: "기본 정보 입력", exact: true }),
  ).toBeFocused();
  await addHeight(page);
  await page
    .getByRole("button", { name: "측정 항목 추가", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("신장", { exact: true })).toBeVisible();
  await page.getByLabel("신장", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(reopen).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("신장", { exact: true })).toHaveValue("170");
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await expect(page.getByLabel("성별", { exact: true })).toHaveValue("female");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(page.getByLabel("신장", { exact: true })).toHaveValue("170");
  await page.setViewportSize({ width: 390, height: 390 });
  const input = page.getByLabel("신장", { exact: true });
  await input.focus();
  await input.scrollIntoViewIfNeeded();
  const inputBox = await input.boundingBox();
  const saveBox = await page
    .getByRole("button", { name: "1개 항목 저장하기" })
    .boundingBox();
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(saveBox!.y);
  expect(server.mutations).toHaveLength(0);
});

test("새로고침 후 사진을 다시 연결해도 작성값을 보존하고 공통 완료 화면으로 저장한다", async ({
  page,
}) => {
  const server = await installApi(page);
  const photo = await openForm(page);
  await addHeight(page);
  await page.reload();
  await expect(page.getByLabel("신장", { exact: true })).toHaveValue("170");
  await page.getByRole("button", { name: "입력 패널 닫기" }).click();
  await expect(
    page.getByText("입력한 값은 유지되어 있어요.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("결과표 사진 다시 연결").setInputFiles(photo);
  await expect(
    page.getByRole("img", { name: "선택한 국민체력100 결과표" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "입력 패널 열기" }).click();
  await expect(page.getByLabel("신장", { exact: true })).toHaveValue("170");
  await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/complete\?record=/);
  expect(server.mutations).toHaveLength(1);
  expect(server.record?.sexAtMeasurement).toBe("female");
  expect(server.record?.items[0].value).toBe("170");
});

test("패널을 닫은 동안 저장 응답이 유실되면 다시 열고 같은 요청으로 확인한다", async ({
  page,
}) => {
  const server = await installApi(page);
  await openForm(page);
  await addHeight(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: { body: string | null; key: string | undefined }[] = [];
  await page.route("**/measurements", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    requests.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"],
    });
    if (requests.length === 1) {
      await held;
      await route.abort("failed");
    } else await route.fallback();
  });
  const waiting = page.waitForRequest(
    (r) => r.url().endsWith("/measurements") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
  await waiting;
  await page.getByRole("button", { name: "입력 패널 닫기" }).click();
  release();
  await expect(
    page.getByRole("button", { name: "같은 내용으로 다시 확인" }),
  ).toBeVisible();
  await expect(page.getByLabel("신장", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "같은 내용으로 다시 확인" }).click();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(server.mutations).toHaveLength(1);
});

for (const restored of [false, true]) {
  test(`사진 입력 이탈을 취소하면 유지하고 확정하면 사진 선택으로 돌아간다 (복원: ${restored})`, async ({
    page,
  }) => {
    const server = await installApi(page);
    const photo = await openForm(page);
    await addHeight(page);
    if (restored) await page.reload();
    await expect(page.getByLabel("신장", { exact: true })).toHaveValue("170");
    const back = page.getByRole("button", { name: "이전 단계", exact: true });
    await back.click();
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("사진 선택 화면");
      await dialog.dismiss();
    });
    await back.click();
    await expect(
      page.getByLabel("측정 당시 만 나이", { exact: true }),
    ).toHaveValue("25");
    await expect(page.getByLabel("성별", { exact: true })).toHaveValue(
      "female",
    );
    await page.getByRole("button", { name: "측정값 입력하기" }).click();
    await expect(page.getByLabel("신장", { exact: true })).toHaveValue("170");
    await back.click();
    page.once("dialog", (dialog) => dialog.accept());
    await back.click();
    await expect(page).toHaveURL(/\/onboarding\/photo$/);
    await expect(
      page.getByRole("heading", { name: "결과표 사진 선택", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "선택한 국민체력100 결과표" }),
    ).toHaveCount(0);
    await page.reload();
    await page
      .getByLabel("결과표 파일 선택")
      .setInputFiles({ ...photo, name: "new-report.png" });
    await page
      .getByRole("button", { name: "이 사진을 보며 직접 입력" })
      .click();
    await expect(
      page.getByLabel("측정 당시 만 나이", { exact: true }),
    ).toHaveValue("");
    await expect(page.getByLabel("성별", { exact: true })).toHaveValue("");
    expect(server.mutations).toHaveLength(0);
  });
}
