import type { Workout } from "../../lib/workout-types";
import type { Catalog, Measurement } from "../../lib/types";
import type { Page } from "@playwright/test";
export const testUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "contract@example.test",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};
export const testOutfit = {
  characterId: "character.cream",
  poseId: "pose.basic",
  clothingIds: [],
  revision: 1,
  updatedAt: "2026-10-01T00:00:00.000Z",
  rendering: { variant: "cream", pose: "basic", clothing: [] },
};
export const assignment = {
  id: "00000000-0000-4000-8000-000000000002",
  status: "assigned",
  assignedAt: "2026-09-01T00:00:00Z",
  completedAt: null,
  curriculum: {
    id: "00000000-0000-4000-8000-000000000003",
    name: "내 기존 운동",
  },
};
export const testWorkout: Workout = {
  id: "00000000-0000-4000-8000-000000000005",
  koreanDate: "2026-09-27",
  serverKoreanDate: "2026-09-27",
  status: "assigned",
  resultStatus: null,
  revision: 1,
  assignedAt: "2026-09-27T00:00:00Z",
  performedAt: null,
  completedAt: null,
  video: {
    id: "contract-video",
    title: "내 기존 운동",
    originalUrl: "http://example.test/video.mp4",
    durationSeconds: 60,
    equipment: [],
    ageGroup: "adult",
    catalogVersion: "contract-v1",
    fitnessWeights: {},
    playbackUrl: null,
    playbackStatus: "unavailable",
    verifiedDurationSeconds: null,
  },
  progress: {
    durationSeconds: 60,
    watchedSeconds: 0,
    positionSeconds: 0,
    intervals: [],
    ratio: 0,
  },
  algorithmVersion: "contract-v1",
  inputSnapshot: {},
  weightAdjustment: null,
};
export const catalog: Catalog = {
  version: "contract-test-v1",
  checkedOn: "2026-09-01",
  age: null,
  definitions: (
    [
      ["height", "신장", "cm", "decimal", "physique", "body_composition", "0"],
      ["weight", "체중", "kg", "decimal", "physique", "body_composition", "0"],
      ["bmi", "BMI", "kg/m²", "decimal", "physique", "body_composition", "0"],
      [
        "waist_circumference",
        "허리둘레",
        "cm",
        "decimal",
        "physique",
        "body_composition",
        "0",
      ],
      [
        "cross_sit_up",
        "교차 윗몸일으키기",
        "회",
        "integer",
        "health_fitness",
        "muscular_endurance",
        "0",
      ],
      [
        "self_curl_up",
        "윗몸말아올리기",
        "회",
        "integer",
        "health_fitness",
        "muscular_endurance",
        "0",
      ],
      [
        "ymca_recovery_heart_rate",
        "YMCA 회복 심박수",
        "bpm",
        "decimal",
        "health_fitness",
        "cardiorespiratory_endurance",
        "0",
      ],
      [
        "sit_and_reach",
        "앉아 윗몸 앞으로 굽히기",
        "cm",
        "decimal",
        "health_fitness",
        "flexibility",
        null,
      ],
    ] as const
  ).map(([code, label, unit, valueType, category, factor, minValue]) => ({
    code,
    label,
    unit,
    valueType,
    category,
    factor,
    minValue,
    maxValue: null,
    minInclusive: ![
      "height",
      "weight",
      "bmi",
      "waist_circumference",
      "ymca_recovery_heart_rate",
    ].includes(code),
    minAge: 19,
    maxAge: 64,
    sourceUrls: [],
  })),
};
export function testRecord(
  overrides: Record<string, unknown> = {},
): Measurement {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    catalogVersion: catalog.version,
    revision: 1,
    measuredOn: "2026-09-01",
    ageAtMeasurement: 25,
    sexAtMeasurement: "male",
    reportKind: "unknown",
    centerName: null,
    reportedOverallGrade: null,
    entryMethod: "self_assessment",
    sourceProgram: "nfa100",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    items: [
      {
        measurementCode: "sit_and_reach",
        value: "-2.5",
        unit: "cm",
        reportedGrade: null,
      },
    ],
    missingMeasurementCodes: [],
    evaluation: {
      status: "not_evaluated",
      reason: "evaluation_not_implemented",
    },
    ...overrides,
  };
}
/** HTTP contract doubles exist only in Playwright. No production fallback data. */
export async function installApi(
  page: Page,
  initialRecord?: ReturnType<typeof testRecord>,
  initialCatalog: Catalog = catalog,
) {
  let record = initialRecord;
  let nickname: string | null = null;
  let outfit = structuredClone(testOutfit);
  const mutations: { path: string; method: string; body: unknown }[] = [];
  await page.route(/\/api\/v[12]\//, async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace(/\/api\/v[12]/, "");
    const method = request.method();
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
      !path.startsWith("/auth")
    )
      mutations.push({
        path,
        method,
        body: request.headers()["content-type"]?.includes("application/json")
          ? request.postDataJSON()
          : null,
      });
    const send = (json: unknown, status = 200) =>
      route.fulfill({
        status,
        json,
        headers: { ETag: '\"1\"', "Access-Control-Expose-Headers": "ETag" },
      });
    if (path === "/auth/refresh")
      return send({
        user: testUser,
        access_token: "test-token",
        expires_in: 900,
        token_type: "Bearer",
      });
    if (path === "/auth/me")
      return send({
        ...testUser,
        nickname: null,
        isOnboarded: !!record,
        currency: { balance: 0 },
        currentCurriculum: assignment,
      });
    if (path === "/users/me/profile") {
      if (method === "PATCH") nickname = request.postDataJSON().nickname;
      return send({ dateOfBirth: "2001-01-01", currentAge: 25, nickname });
    }
    if (path === "/users/me/avatar/outfit") {
      if (method === "PUT") {
        const body = request.postDataJSON();
        outfit = {
          ...outfit,
          ...body,
          revision: outfit.revision + 1,
          rendering: {
            ...outfit.rendering,
            variant: body.characterId.split(".")[1],
            pose: body.poseId.split(".")[1],
          },
        };
      }
      return send(outfit);
    }
    if (path === "/users/me/avatar/inventory")
      return send({
        currency: { balance: 0 },
        inventory: ["character.cream", "character.gray", "pose.basic"].map(
          (productId) => ({
            productId,
            source: "default",
            acquiredAt: testOutfit.updatedAt,
          }),
        ),
      });
    if (
      path === "/users/me/streak-roulette/tickets" ||
      /\/groups\/[^/]+\/roulette\/(tickets|draws)$/.test(path)
    )
      return send({ items: [], availableCount: 0, nextCursor: null });
    if (/\/groups\/[^/]+\/missions\/current$/.test(path))
      return send({ id: null, status: "not_started" });
    if (path === "/workouts/current") return send(testWorkout);
    if (path === "/workout-routines/current") return send(null);
    if (path === "/groups" && method === "GET")
      return send({ items: [], nextCursor: null });
    if (path === "/workout-routines/history")
      return send({ items: [], nextCursor: null });
    if (path === "/users/me/profile/activity")
      return send({
        userId: testUser.id,
        nickname: null,
        profileCharacter: null,
        streak: 0,
      });
    if (path === "/workouts/history")
      return send({ items: [testWorkout], nextCursor: null });
    if (path === `/workouts/${testWorkout.id}`) return send(testWorkout);
    if (path === "/measurement-catalog") return send(initialCatalog);
    if (path === "/measurements" && method === "POST") {
      record = testRecord(request.postDataJSON());
      return send(record, 201);
    }
    if (path === "/measurements")
      return send({
        items: record ? [{ ...record, itemCount: record.items.length }] : [],
        nextCursor: null,
      });
    if (record && path === `/measurements/${record.id}`) {
      if (method === "DELETE") {
        record = undefined;
        return route.fulfill({ status: 204 });
      }
      if (method === "PATCH")
        record = testRecord({
          ...record,
          ...request.postDataJSON(),
          revision: record.revision + 1,
        });
      return send(record);
    }
    return send({ message: "API not implemented" }, 404);
  });
  return {
    mutations,
    setRecord(next: ReturnType<typeof testRecord> | undefined) {
      record = next;
    },
    get record() {
      return record;
    },
  };
}
