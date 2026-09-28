import { test, expect, type Page } from "@playwright/test";
import {
  catalog,
  installApi,
  testRecord,
  testUser,
} from "./integration-fixtures";
import { initialWorkout } from "../../lib/workout";
import { prepareAssessment, skipToFlexibility } from "./workout-helpers";

const legacyDraft = () => ({
  setup: {
    age: "25",
    sex: "male",
    height: "",
    weight: "",
    waist: "",
    measuredOn: "2026-09-01",
    endurance: "curl",
  },
  stage: "session",
  catalogVersion: catalog.version,
  pending: null as null | { key: string; body: string },
  state: {
    ...initialWorkout(),
    phase: "review" as const,
    index: 2,
    results: { endurance: "20", flexibility: "-2" },
    skipped: ["cardio"],
  },
});
async function seedWorkout(page: Page, draft: unknown) {
  await page.addInitScript(
    ({ owner, draft }) => {
      const key = "modu-workout-session-v2";
      if (!sessionStorage.getItem(key))
        sessionStorage.setItem(
          key,
          JSON.stringify({ owner, draft, expiresAt: Date.now() + 86400000 }),
        );
    },
    { owner: testUser.id, draft },
  );
}
async function manual(page: Page, age = "25") {
  await page.goto("/onboarding");
  await page.getByRole("link", { name: "직접 입력하기" }).click();
  await page.getByLabel("측정일", { exact: true }).fill("2026-09-01");
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill(age);
  await page.getByLabel("성별", { exact: true }).selectOption("male");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
}

test("간이측정은 삭제된 종목 없는 카탈로그에서도 시작하고 부분 저장한다", async ({
  page,
}, info) => {
  const server = await installApi(page, undefined, {
    ...catalog,
    definitions: catalog.definitions.filter((d) => d.code !== "self_curl_up"),
  });
  await page.goto("/workout?mode=assessment");
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByText("윗몸말아올리기", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "근지구력 검사 · 교차 윗몸일으키기" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("assessment-setup.png"),
    fullPage: true,
    animations: "disabled",
  });
  await prepareAssessment(page);
  await skipToFlexibility(page);
  await page.getByLabel("기준선에서 도달한 거리 (cm)").fill("0");
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
  expect(server.record?.items.map((i) => i.measurementCode)).toEqual([
    "sit_and_reach",
  ]);
});

test("직접 입력에서 성인 윗몸말아올리기를 숨기고 청소년 공식 종목은 유지한다", async ({
  page,
}) => {
  const youth = {
    ...catalog.definitions.find((d) => d.code === "self_curl_up")!,
    code: "curl_up",
    label: "청소년 윗몸말아올리기",
    minAge: 13,
    maxAge: 18,
  };
  await installApi(page, undefined, {
    ...catalog,
    definitions: [...catalog.definitions, youth],
  });
  await manual(page);
  await page
    .getByRole("button", { name: "측정 항목 추가", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button")
      .filter({ hasText: "윗몸말아올리기" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button")
      .filter({ hasText: "교차 윗몸일으키기" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "닫기", exact: true })
    .click();
  await page.getByRole("button", { name: "변경", exact: true }).click();
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("15");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await page
    .getByRole("button", { name: "측정 항목 추가", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button")
      .filter({ hasText: "청소년 윗몸말아올리기" }),
  ).toBeVisible();
});

test("이전 윗몸말아올리기 초안의 다른 측정값을 보존하고 횟수를 다른 종목으로 저장하지 않는다", async ({
  page,
}) => {
  const server = await installApi(page);
  await seedWorkout(page, legacyDraft());
  let attempts = 0;
  await page.route("**/api/v1/measurements", (route) => {
    if (route.request().method() === "POST" && ++attempts === 1)
      return route.abort("connectionreset");
    return route.fallback();
  });
  await page.goto("/workout?mode=assessment");
  await expect(page.getByText(/해당 임시 측정값은 제외했어요/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "교차 윗몸일으키기 다시 측정" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "같은 내용으로 다시 확인" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "이전 측정 저장 확인" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "이전 측정 저장 확인" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "같은 내용으로 다시 확인" }).click();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
  expect(server.record?.items).toEqual([
    {
      measurementCode: "sit_and_reach",
      value: "-2",
      unit: "cm",
      reportedGrade: null,
    },
  ]);
});

test("이전 윗몸말아올리기 저장 응답이 유실되어도 원래 키와 본문으로 재확인한다", async ({
  page,
}) => {
  const server = await installApi(page);
  const draft = legacyDraft();
  draft.pending = {
    key: "12345678-1234-1234-1234-123456789012",
    body: JSON.stringify({
      catalogVersion: catalog.version,
      entryMethod: "self_assessment",
      reportKind: "unknown",
      measuredOn: "2026-09-01",
      ageAtMeasurement: 25,
      sexAtMeasurement: "male",
      centerName: null,
      reportedOverallGrade: null,
      items: [
        {
          measurementCode: "self_curl_up",
          value: "20",
          unit: "회",
          reportedGrade: null,
        },
        {
          measurementCode: "sit_and_reach",
          value: "-2",
          unit: "cm",
          reportedGrade: null,
        },
      ],
    }),
  };
  await seedWorkout(page, draft);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  await page.route("**/api/v1/measurements", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    if (attempts.length === 1) return route.abort("connectionreset");
    return route.fallback();
  });
  await page.goto("/workout?mode=assessment");
  await expect(
    page.getByRole("heading", { name: "이전 측정 저장 확인" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "교차 윗몸일으키기 다시 측정" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "같은 내용으로 다시 확인" }).click();
  await expect(
    page.getByRole("button", { name: "같은 내용으로 다시 확인" }),
  ).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "같은 내용으로 다시 확인" }).click();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
  expect(attempts).toEqual([draft.pending, draft.pending]);
  expect(server.record?.items[0].measurementCode).toBe("self_curl_up");
});

test("기존 저장 기록을 조회·수정할 때 윗몸말아올리기 원본을 지우지 않는다", async ({
  page,
}) => {
  const record = testRecord({
    items: [
      {
        measurementCode: "self_curl_up",
        value: "20",
        unit: "회",
        reportedGrade: null,
      },
    ],
  });
  const server = await installApi(page, record);
  await page.goto(`/measurements/${record.id}`);
  await expect(page.getByText("20 회", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "기록 수정" }).click();
  await expect(
    page.getByRole("progressbar", { name: "체력 기록 진행 단계" }),
  ).toHaveCount(0);
  await expect(page.locator(".stepper")).toBeVisible();
  await expect(page.getByLabel("윗몸말아올리기", { exact: true })).toHaveValue(
    "20",
  );
  await page
    .getByRole("button", { name: "측정 항목 추가", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button")
      .filter({ hasText: "윗몸말아올리기" }),
  ).toHaveCount(0);
  // The backend still enforces one endurance test per self-assessment record.
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button")
      .filter({ hasText: "교차 윗몸일으키기" }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "닫기", exact: true })
    .click();
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page).toHaveURL(/saved=1/);
  expect(server.record?.items).toEqual(record.items);
});

test("사진 추출로 돌아온 성인 윗몸말아올리기도 신규 입력에서 제외한다", async ({
  page,
}) => {
  const server = await installApi(page);
  await page.route("**/measurements/extract", (route) =>
    route.fulfill({
      json: {
        catalogVersion: catalog.version,
        status: "extracted",
        metadata: {
          measuredOn: "2026-09-01",
          ageAtMeasurement: 25,
          sexAtMeasurement: "male",
          centerName: null,
          reportedOverallGrade: null,
        },
        items: [
          {
            measurementCode: "self_curl_up",
            value: "20",
            unit: "회",
            reportedGrade: null,
            evidence: { label: "윗몸말아올리기", value: "20", unit: "회" },
          },
          {
            measurementCode: "sit_and_reach",
            value: "3",
            unit: "cm",
            reportedGrade: null,
            evidence: { label: "유연성", value: "3", unit: "cm" },
          },
        ],
        reviewItems: [],
        issues: [],
        notDetectedMeasurementCodes: [],
      },
    }),
  );
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles({
    name: "report.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "측정값 읽기" }).click();
  await page.getByRole("button", { name: "결과표 확정" }).click();
  await expect(
    page.getByText(/성인 윗몸말아올리기는 새 기록에서 지원하지 않아/),
  ).toBeVisible();
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(page.getByLabel("윗몸말아올리기", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
  await expect(page).toHaveURL(/\/onboarding\/complete\?record=/);
  expect(server.record?.items.map((i) => i.measurementCode)).toEqual([
    "sit_and_reach",
  ]);
});

test("삭제한 성인 종목은 상세의 미입력 목록에도 표시하지 않는다", async ({
  page,
}) => {
  const record = testRecord({
    missingMeasurementCodes: ["self_curl_up", "cross_sit_up"],
  });
  await installApi(page, record);
  await page.goto(`/measurements/${record.id}`);
  await page.getByText("미입력 항목 보기", { exact: false }).click();
  await expect(page.locator(".missing-list li")).toHaveCount(1);
  await expect(page.locator(".missing-list")).toContainText(
    "교차 윗몸일으키기",
  );
  await expect(page.locator(".missing-list")).not.toContainText(
    "윗몸말아올리기",
  );
});
