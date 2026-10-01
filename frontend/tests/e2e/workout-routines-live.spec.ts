import { test, expect } from "@playwright/test";
import { parseRoutine } from "../../lib/workout-routine";
import { respectRateLimit } from "./live-api-fixtures";

const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
const routines = api.replace(/\/v1$/, "/v2");
test("실제 추천 엔진: 준비 조건, 오늘 루틴 생성, 중복 방지와 저장된 처방 복원", async ({
  page,
}) => {
  const password = "routine-live-test-2026!";
  const headers = {
    Origin: new URL(test.info().project.use.baseURL as string).origin,
    "X-CSRF-Protection": "1",
    Authorization: "",
  };
  const email = `routine-${crypto.randomUUID()}@example.test`;
  const register = await respectRateLimit(() =>
    page.request.post(`${api}/auth/register`, {
      headers,
      data: { email, password, dateOfBirth: "2000-02-29" },
    }),
  );
  expect(register.status()).toBe(201);
  headers.Authorization = `Bearer ${(await register.json()).access_token}`;
  try {
    await page.goto("/workout");
    await page
      .getByRole("button", { name: "오늘 운동 준비하기", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "운동 목적 선택하기" }),
    ).toBeVisible();
    const catalog = await (
      await page.request.get(`${api}/measurement-catalog`)
    ).json();
    const record = await page.request.post(`${api}/measurements`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {
        measuredOn: "2026-09-17",
        ageAtMeasurement: 26,
        sexAtMeasurement: "male",
        reportKind: "standard",
        centerName: null,
        reportedOverallGrade: null,
        catalogVersion: catalog.version,
        items: [
          {
            measurementCode: "height",
            value: "170",
            unit: "cm",
            reportedGrade: null,
          },
          {
            measurementCode: "sit_and_reach",
            value: "0",
            unit: "cm",
            reportedGrade: null,
          },
        ],
      },
    });
    expect(record.status()).toBe(201);
    const measured = await record.json();
    expect(
      measured.axes.find(
        (axis: { axis: string }) => axis.axis === "flexibility",
      ),
    ).toMatchObject({ status: "below_standard", grade: null });
    const preferences = await page.request.patch(
      `${api}/users/me/preferences`,
      {
        headers,
        data: { exerciseGoal: "general_fitness_improvement", ownedTools: [] },
      },
    );
    expect(preferences.status()).toBe(200);
    const generated = page.waitForResponse((r) =>
      r.url().endsWith("/workout-routines/today"),
    );
    await page
      .getByRole("button", { name: "오늘 운동 준비하기", exact: true })
      .click();
    const response = await generated;
    expect(response.status()).toBe(201);
    const routine = parseRoutine(await response.json());
    expect(routine.koreanDate).toBe(routine.serverKoreanDate);
    expect(routine.routine.length).toBeGreaterThan(1);
    expect(routine.routine.every((item) => item.prescription.sets === 3)).toBe(
      true,
    );
    const snapshot = routine.inputSnapshot as {
      axes: { axis: string; status: string; grade: number | null }[];
      fitness100: { fitness: { flexibility: number } };
    };
    expect(snapshot.fitness100.fitness.flexibility).toBe(3);
    expect(
      snapshot.axes.find((axis) => axis.axis === "flexibility"),
    ).toMatchObject({ status: "below_standard", grade: null });
    const guidance = page.getByRole("region", { name: "유산소 운동 안내" });
    expect(routine.cardioRecommendation).not.toBeNull();
    const cardio = routine.cardioRecommendation!;
    await expect(guidance).toContainText(
      `${cardio.activity} ${cardio.minutes}분`,
    );
    await expect(
      guidance.locator("button, input, video, progress"),
    ).toHaveCount(0);
    await expect(
      page.getByLabel(`예상 운동 시간 ${routine.estimatedMinutes}분`),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "오늘 배정된 운동" }).getByRole("heading"),
    ).toHaveText(routine.routine.map((item) => item.title));
    await expect(
      page.getByRole("list", { name: "오늘 배정된 운동" }),
    ).toContainText(routine.routine[0].prescription.text);
    await page.reload();
    await expect(
      page
        .getByRole("list", { name: "오늘 배정된 운동" })
        .getByRole("listitem"),
    ).toHaveCount(routine.routine.length);
    await expect(guidance).toContainText(
      `${cardio.activity} ${cardio.minutes}분`,
    );
    expect(
      (
        await page.request.patch(`${api}/users/me/preferences`, {
          headers,
          data: {
            exerciseVolume: "more",
            exerciseGoal: "body_composition_management",
          },
        })
      ).status(),
    ).toBe(200);
    const repeat = await page.request.post(
      `${routines}/workout-routines/today`,
      {
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        data: {},
      },
    );
    expect(repeat.status()).toBe(200);
    const repeated = parseRoutine(await repeat.json());
    expect(repeated.id).toBe(routine.id);
    expect(repeated.routine).toEqual(routine.routine);
    expect(repeated.cardioRecommendation).toEqual(routine.cardioRecommendation);
    expect(repeated.recordingAllowed).toBe(true);
    const detail = await page.request.get(
      `${routines}/workout-routines/${routine.id}`,
      { headers },
    );
    expect(detail.status()).toBe(200);
    expect(parseRoutine(await detail.json()).cardioRecommendation).toEqual(
      cardio,
    );
    const history = await page.request.get(
      `${routines}/workout-routines/history?limit=20`,
      { headers },
    );
    expect(history.status()).toBe(200);
    expect((await history.json()).items[0].cardioRecommendation).toEqual(
      cardio,
    );
    await page.goto(`/measurements/${measured.id}`);
    await expect(page.locator(".radar-grade").nth(3)).toHaveText("기준 미달");
    const event = await page.request.post(
      `${routines}/workout-routines/${routine.id}/items/${routine.routine[0].id}/events`,
      {
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        data: {
          type: "start",
          deviceId: crypto.randomUUID(),
          sequence: 1,
          intervals: [],
          positionSeconds: 0,
        },
      },
    );
    expect(event.status()).toBe(200);
    const retired = await page.request.get(`${api}/workout-routines/current`, {
      headers,
    });
    expect(retired.status()).toBe(410);
    expect((await retired.json()).code).toBe("ROUTINE_API_RETIRED");
    await page.goto(
      `/workout-routines/${routine.id}/items/${routine.routine[0].id}`,
    );
    await expect(page.getByRole("region", { name: "운동 방법" })).toContainText(
      `${routine.routine[0].prescription.value}${routine.routine[0].prescription.unit}`,
    );

    // Explicit played-range fixtures verify server aggregation, not external media playback.
    const firstItem = routine.routine[0],
      deviceId = crypto.randomUUID();
    let sequence = 0;
    async function send(itemId: string, type: string, end = 0) {
      const response = await page.request.post(
        `${routines}/workout-routines/${routine.id}/items/${itemId}/events`,
        {
          headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
          data: {
            type,
            deviceId,
            sequence: ++sequence,
            intervals: end ? [{ start: 0, end }] : [],
            positionSeconds: end,
          },
        },
      );
      expect(response.status()).toBe(200);
      return parseRoutine(await response.json());
    }
    const stopped = await send(
      firstItem.id,
      "pause",
      firstItem.progress.durationSeconds * 0.3,
    );
    const performedAt = stopped.routine[0].performedAt;
    await send(firstItem.id, "start");
    const unchanged = await send(
      firstItem.id,
      "pause",
      firstItem.progress.durationSeconds * 0.3,
    );
    expect(unchanged.routine[0].performedAt).toBe(performedAt);
    const partialActivity = await (
      await page.request.get(`${api}/users/me/profile/activity`, { headers })
    ).json();
    expect(partialActivity).toMatchObject({
      streak: 0,
      longestStreak: 0,
      totalWorkoutDays: 0,
    });
    // The real server finalizes pause at 80%. FE must keep confirmation/cancel nonterminal.
    await send(firstItem.id, "start");
    const awaitingConfirmation = await send(
      firstItem.id,
      "progress",
      firstItem.progress.durationSeconds * 0.8,
    );
    expect(awaitingConfirmation.routine[0].status).toBe("in_progress");
    const current = `/workout-routines/${routine.id}/items/${firstItem.id}`;
    await page.goto(current);
    await page
      .getByRole("button", { name: "여기서 종료", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: "운동 방법대로 운동했나요?",
    });
    await expect(confirmation).toContainText(
      "운동 방법대로 운동하고 완료하세요.",
    );
    await confirmation
      .getByRole("button", { name: "취소", exact: true })
      .click();
    await page.reload();
    await expect(page).toHaveURL(current);
    await page
      .getByRole("button", { name: "여기서 종료", exact: true })
      .click();
    await confirmation
      .getByRole("button", { name: "완료 처리", exact: true })
      .click();
    await expect(page).toHaveURL(
      `/workout-routines/${routine.id}/items/${routine.routine[1].id}`,
    );
    let final = awaitingConfirmation;
    for (const item of routine.routine.slice(1)) {
      await send(item.id, "start");
      final = await send(
        item.id,
        "complete",
        item.progress.durationSeconds * 0.8,
      );
    }
    expect(final.status).toBe("completed");
    expect(final.cardioRecommendation).toEqual(cardio);
    const activity = await (
      await page.request.get(`${api}/users/me/profile/activity`, { headers })
    ).json();
    expect(activity).toMatchObject({
      streak: 1,
      longestStreak: 1,
      totalWorkoutDays: 1,
    });
    await page.goto("/account");
    const metrics = page.getByRole("region", { name: "활동 리포트" });
    for (const label of [
      "현재 연속 스트릭",
      "최장 연속 스트릭",
      "총 운동 일수",
    ])
      await expect(
        metrics.getByText(label, { exact: true }).locator("..").locator("dd"),
      ).toHaveText("1일");
    await page.goto("/workout");
    await expect(
      page.getByText("오늘의 모든 운동을 완료했어요."),
    ).toBeVisible();
    await expect(guidance).toContainText(
      `${cardio.activity} ${cardio.minutes}분`,
    );
    await expect(
      page.getByRole("button", { name: "오늘 운동 준비하기", exact: true }),
    ).toHaveCount(0);
  } finally {
    expect(
      (
        await respectRateLimit(() =>
          page.request.delete(`${api}/users/me`, {
            headers,
            data: { password },
          }),
        )
      ).status(),
    ).toBe(204);
  }
});
