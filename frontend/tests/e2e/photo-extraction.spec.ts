import { test, expect } from "@playwright/test";
import { installApi, catalog } from "./integration-fixtures";
const png = {
  name: "report.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  ),
};
const extraction = {
  catalogVersion: catalog.version,
  status: "partial",
  metadata: {
    measuredOn: "2026-09-01",
    ageAtMeasurement: 25,
    sexAtMeasurement: "male",
    centerName: null,
    reportedOverallGrade: null,
  },
  items: [
    {
      measurementCode: "sit_and_reach",
      value: "-3.12345678901234567890",
      unit: "cm",
      reportedGrade: null,
      evidence: {
        label: "유연성",
        value: "-3.12345678901234567890",
        unit: "cm",
      },
    },
  ],
  reviewItems: [
    {
      measurementCode: null,
      value: "32",
      unit: "kg",
      reportedGrade: null,
      evidence: { label: "악력", value: "32", unit: "kg" },
      reasons: ["UNKNOWN_TEST"],
    },
  ],
  issues: [
    {
      code: "ITEM_REVIEW_REQUIRED",
      field: "reviewItems",
      requiresInput: false,
    },
  ],
  notDetectedMeasurementCodes: [],
};
test("사진 추출은 저장하지 않고 확인한 값만 기존 API로 저장한다", async ({
  page,
}) => {
  const server = await installApi(page);
  const progress = page.getByRole("progressbar", {
    name: "체력 기록 진행 단계",
  });
  let extractions = 0;
  await page.route("**/measurements/extract", async (route) => {
    extractions++;
    expect(route.request().headers()["content-type"]).toContain(
      "multipart/form-data; boundary=",
    );
    expect(route.request().postDataBuffer()?.toString()).toContain(
      'name="image"',
    );
    await route.fulfill({ json: extraction });
  });
  await page.goto("/onboarding/photo");
  await expect(progress).toHaveAttribute("aria-valuenow", "2");
  await expect(page.getByLabel("결과표 촬영")).toHaveCount(0);
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  await expect(page.getByLabel("결과표 파일 선택")).toHaveCount(0);
  await expect(page.getByText("선택한 결과표 보기")).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "선택한 국민체력100 결과표" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "측정값 읽기" }).click();
  await expect(
    page.getByText("일부 내용을 확인해야 해요.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "읽은 측정값", exact: true }),
  ).toContainText("-3.12345678901234567890 cm");
  await expect(
    page.getByRole("list", { name: "확인할 항목", exact: true }),
  ).toContainText("악력32 kg");
  await expect(
    page.getByText("읽은 값과 누락 정보를 확인해 주세요.", { exact: false }),
  ).toHaveCount(0);
  await expect(progress).toHaveAttribute(
    "aria-valuetext",
    "3단계 중 2단계, 분석 결과 확인",
  );
  expect(server.mutations).toHaveLength(0);
  await page.getByRole("button", { name: "결과표 확정" }).click();
  await expect(progress).toHaveAttribute(
    "aria-valuetext",
    "3단계 중 2단계, 기본 정보 입력",
  );
  await expect(page.getByText(/악력: 32 kg/)).toBeVisible();
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "3");
  await expect(
    page.getByLabel("앉아 윗몸 앞으로 굽히기", { exact: true }),
  ).toHaveValue(extraction.items[0].value);
  await page.reload();
  await expect(progress).toHaveAttribute("aria-valuenow", "3");
  await expect(
    page.getByLabel("앉아 윗몸 앞으로 굽히기", { exact: true }),
  ).toHaveValue(extraction.items[0].value);
  await expect(page.getByText(/악력: 32 kg/)).toBeVisible();
  await page
    .getByRole("button", { name: "1개 항목 저장하기", exact: true })
    .click();
  await expect(page).toHaveURL(/\/onboarding\/complete\?record=/);
  await expect(progress).toHaveAttribute(
    "aria-valuetext",
    "3단계 중 3단계, 체력 기록 완료",
  );
  expect(extractions).toBe(1);
  expect(server.mutations).toHaveLength(1);
  expect(server.record?.items).toEqual([
    {
      measurementCode: "sit_and_reach",
      value: extraction.items[0].value,
      unit: "cm",
      reportedGrade: null,
    },
  ]);
  expect(server.mutations[0].body).not.toHaveProperty("evidence");
});
test("사진 분석 실패 후 직접 입력 가능하며 여러 사람 결과는 자동 입력하지 않는다", async ({
  page,
}) => {
  await installApi(page);
  let count = 0;
  await page.route("**/measurements/extract", (route) =>
    route.fulfill(
      ++count === 1
        ? { status: 503, json: { code: "EXTRACTION_UNAVAILABLE" } }
        : {
            json: {
              ...extraction,
              status: "multiple_people",
              items: [],
              reviewItems: [],
              metadata: {
                ...extraction.metadata,
                measuredOn: null,
                ageAtMeasurement: null,
                sexAtMeasurement: null,
              },
            },
          },
    ),
  );
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  await page.getByRole("button", { name: "측정값 읽기" }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "아직 사용할 수 없어요",
  );
  await expect(
    page.getByRole("button", { name: "이 사진을 보며 직접 입력" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "측정값 읽기" }).click();
  await expect(page.getByText(/여러 사람의 결과가 섞여/)).toBeVisible();
  await expect(page.getByRole("button", { name: "결과표 확정" })).toHaveCount(
    0,
  );
});
test("분석 취소 후 늦은 응답으로 입력 화면이 바뀌지 않는다", async ({
  page,
}) => {
  await installApi(page);
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/measurements/extract", async (route) => {
    await pending;
    await route.fulfill({ json: extraction }).catch(() => {});
  });
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  const sent = page.waitForRequest("**/measurements/extract");
  await page.getByRole("button", { name: "측정값 읽기" }).click();
  await sent;
  await page.getByRole("button", { name: "분석 취소" }).click();
  release();
  await expect(page.locator(".notice[role=alert]")).toContainText("취소했어요");
  await expect(page.getByRole("button", { name: "결과표 확정" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "측정값 읽기" })).toBeEnabled();
});

test("사진을 다시 선택해도 서버의 재요청 제한을 유지한다", async ({ page }) => {
  await installApi(page);
  await page.clock.install();
  let requests = 0;
  await page.route("**/measurements/extract", (route) => {
    requests++;
    return route.fulfill({
      status: 429,
      json: { code: "EXTRACTION_RATE_LIMITED", retry_after: 10 },
    });
  });
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  const analyze = page.getByRole("button", { name: "측정값 읽기" });
  await analyze.click();
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "요청이 많아요",
  );
  await expect(analyze).toBeDisabled();
  await page.getByRole("button", { name: "사진 지우기" }).click();
  await page
    .getByLabel("결과표 파일 선택")
    .setInputFiles({ ...png, name: "another.png" });
  await expect(analyze).toBeDisabled();
  expect(requests).toBe(1);
  await page.clock.fastForward(10050);
  await expect(analyze).toBeEnabled();
});

test("사진 초안을 지우고 다시 선택해도 직접 입력 초안은 유지한다", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/onboarding/manual");
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("30");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await page.getByRole("link", { name: "결과표가 있어요" }).click();
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  await page.getByRole("button", { name: "이 사진을 보며 직접 입력" }).click();
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("25");
  await page
    .getByRole("button", { name: "입력 지우고 다른 사진 선택" })
    .click();
  await expect(page.getByLabel("결과표 파일 선택")).toBeAttached();
  await expect(
    page.getByRole("img", { name: "선택한 국민체력100 결과표" }),
  ).toHaveCount(0);
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  await page.getByRole("button", { name: "이 사진을 보며 직접 입력" }).click();
  await expect(
    page.getByLabel("측정 당시 만 나이", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await expect(page.getByLabel("결과표 파일 선택")).toBeAttached();
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await page.getByRole("link", { name: "직접 입력하기" }).click();
  await expect(
    page.getByLabel("측정 당시 만 나이", { exact: true }),
  ).toHaveValue("30");
});

test("서버 처리 제한 안의 느린 사진 분석도 조기 취소하지 않는다", async ({
  page,
}) => {
  await installApi(page);
  await page.route("**/measurements/extract", async (route) => {
    // Native AbortSignal.timeout uses real time. Exceed the old 50s client
    // deadline while remaining inside the backend's 75s processing budget.
    await new Promise((resolve) => setTimeout(resolve, 55000));
    await route.fulfill({ json: extraction }).catch(() => {});
  });
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  await page.getByRole("button", { name: "측정값 읽기" }).click();
  await expect(page.getByRole("button", { name: "결과표 확정" })).toBeVisible({
    timeout: 65000,
  });
  await expect(page.locator(".notice[role=alert]")).toHaveCount(0);
});

test("사진을 보며 직접 입력해도 성별을 선택해야 측정값으로 진행한다", async ({
  page,
}) => {
  const server = await installApi(page);
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  await page.getByRole("button", { name: "이 사진을 보며 직접 입력" }).click();
  await page.getByLabel("측정일", { exact: true }).fill("2026-09-01");
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("25");
  const sex = page.getByLabel("성별", { exact: true });
  await expect(sex).toBeVisible();
  await expect(sex).toHaveAttribute("required", "");
  await expect(page.locator("details #sex")).toHaveCount(0);
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(sex).toBeFocused();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  await page.locator("form").evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
    form.requestSubmit();
  });
  await expect(
    page.getByText("성별을 선택해 주세요.", { exact: true }),
  ).toBeVisible();
  expect(server.mutations).toHaveLength(0);
  await sex.selectOption("female");
  await page.reload();
  await expect(sex).toHaveValue("female");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(
    page.getByRole("heading", { name: "측정한 항목만 입력해요" }),
  ).toBeVisible();
});

for (const status of ["extracted", "needs_review"] as const) {
  test(`사진 추출 결과는 확인 안내와 실제 항목을 표시한다: ${status}`, async ({
    page,
  }, info) => {
    await installApi(page);
    const readItems = [
      ...extraction.items,
      ...[
        ["height", "신장", "170", "cm"],
        ["weight", "체중", "65", "kg"],
        ["bmi", "BMI", "22.5", "kg/m²"],
        ["waist_circumference", "허리둘레", "80", "cm"],
        ["cross_sit_up", "교차 윗몸일으키기", "40", "회"],
      ].map(([measurementCode, label, value, unit]) => ({
        measurementCode,
        value,
        unit,
        reportedGrade: null,
        evidence: { label, value, unit },
      })),
    ];
    await page.route("**/measurements/extract", (route) =>
      route.fulfill({
        json: {
          ...extraction,
          status,
          items: status === "extracted" ? readItems : [],
          reviewItems: status === "extracted" ? [] : extraction.reviewItems,
        },
      }),
    );
    await page.goto("/onboarding/photo");
    await page.getByLabel("결과표 파일 선택").setInputFiles(png);
    await page
      .getByRole("button", { name: "측정값 읽기", exact: true })
      .click();
    await expect(
      page.getByText("일부 내용을 확인해야 해요.", { exact: true }),
    ).toBeVisible();
    const list = page.getByRole("list", {
      name: status === "extracted" ? "읽은 측정값" : "확인할 항목",
      exact: true,
    });
    await expect(list.getByRole("listitem")).toHaveCount(
      status === "extracted" ? 6 : 1,
    );
    await expect(list.getByRole("listitem").first()).toHaveCSS(
      "border-left-color",
      status === "extracted" ? "rgb(27, 153, 196)" : "rgb(255, 127, 0)",
    );
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(`extraction-${status}-${width}.png`),
        fullPage: true,
      });
    }
    await page
      .getByRole("button", { name: "결과표 확정", exact: true })
      .click();
    await expect(
      page.getByLabel("측정 당시 만 나이", { exact: true }),
    ).toHaveValue("25");
  });
}
