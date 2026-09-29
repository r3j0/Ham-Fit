import { test, expect } from "@playwright/test";
import { parseRoutine } from "../../lib/workout-routine";
import { shiftDay } from "../../lib/workout-history";

const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
test("실제 추천 엔진: 준비 조건, 내일 루틴 생성, 중복 방지와 저장된 처방 복원", async ({
  page,
}) => {
  const password = "routine-live-test-2026!";
  const headers = {
    Origin: new URL(test.info().project.use.baseURL as string).origin,
    "X-CSRF-Protection": "1",
    Authorization: "",
  };
  const register = await page.request.post(`${api}/auth/register`, {
    headers,
    data: {
      email: `routine-${crypto.randomUUID()}@example.test`,
      password,
      dateOfBirth: "2000-02-29",
    },
  });
  expect(register.status()).toBe(201);
  headers.Authorization = `Bearer ${(await register.json()).access_token}`;
  try {
    await page.goto("/workout");
    await page
      .getByRole("button", { name: "내일 운동 준비하기", exact: true })
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
        sexAtMeasurement: null,
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
        ],
      },
    });
    expect(record.status()).toBe(201);
    const preferences = await page.request.patch(
      `${api}/users/me/preferences`,
      {
        headers,
        data: { exerciseGoal: "general_fitness_improvement", ownedTools: [] },
      },
    );
    expect(preferences.status()).toBe(200);
    const generated = page.waitForResponse((r) =>
      r.url().endsWith("/workout-routines/next"),
    );
    await page
      .getByRole("button", { name: "내일 운동 준비하기", exact: true })
      .click();
    const response = await generated;
    expect(response.status()).toBe(201);
    const routine = parseRoutine(await response.json());
    expect(routine.koreanDate).toBe(shiftDay(routine.serverKoreanDate, 1));
    expect(routine.routine.length).toBeGreaterThan(1);
    await expect(
      page.getByRole("region", { name: "내일의 운동" }),
    ).toContainText(routine.routine[0].prescription.text);
    await page.reload();
    await expect(
      page.getByRole("region", { name: "내일의 운동" }).getByRole("listitem"),
    ).toHaveCount(routine.routine.length);
    const repeat = await page.request.post(`${api}/workout-routines/next`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {},
    });
    expect(repeat.status()).toBe(200);
    expect(parseRoutine(await repeat.json())).toEqual(routine);
    const event = await page.request.post(
      `${api}/workout-routines/${routine.id}/items/${routine.routine[0].id}/events`,
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
    expect(event.status()).toBe(409);
    await page.goto(
      `/workout-routines/${routine.id}/items/${routine.routine[0].id}`,
    );
    await expect(
      page.getByText(`${routine.koreanDate}에 시작할 운동이에요.`),
    ).toBeVisible();
    await expect(page.locator("video")).toHaveCount(0);
  } finally {
    expect(
      (
        await page.request.delete(`${api}/users/me`, {
          headers,
          data: { password },
        })
      ).status(),
    ).toBe(204);
  }
});
