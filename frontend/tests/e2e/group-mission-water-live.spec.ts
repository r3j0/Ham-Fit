import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const count of [1, 2])
  test(`실제 API: 참여 미션 ${count}개에서 스트릭 다음 물 기여를 한 그룹에만 반영한다`, async ({
    page,
    browser,
  }, info) => {
    test.skip(
      !process.env.E2E_WATER_TEST_DATABASE_URL,
      "전용 임시 DB와 테스트 서버에서만 실행",
    );
    const api = process.env.E2E_API_BASE_URL!;
    const origin = new URL(info.project.use.baseURL as string).origin;
    const password = "water-selection-live-test-2026!";
    const memberContext = await browser.newContext();
    const headers = { Origin: origin, "X-CSRF-Protection": "1" };
    const registration = async (client: typeof page.request) => {
      const response = await client.post(`${api}/auth/register`, {
        headers,
        data: {
          email: `water-${crypto.randomUUID()}@example.test`,
          password,
          nickname: "물주기검증",
          dateOfBirth: "2000-01-01",
        },
      });
      expect(response.status()).toBe(201);
      return response.json();
    };
    const owner = await registration(page.request);
    const member = await registration(memberContext.request);
    const ownerHeaders = {
      ...headers,
      Authorization: `Bearer ${owner.access_token}`,
    };
    const memberHeaders = {
      ...headers,
      Authorization: `Bearer ${member.access_token}`,
    };
    const groups: string[] = [];
    try {
      for (let i = 0; i < count; i++) {
        const created = await page.request.post(`${api}/groups`, {
          headers: { ...ownerHeaders, "Idempotency-Key": crypto.randomUUID() },
          data: {
            name: `[TEST ONLY] 함께 운동 ${i + 1}`,
            description: "검증 후 삭제",
            maxMembers: 5,
          },
        });
        expect(created.status()).toBe(201);
        const groupId = (await created.json()).id;
        groups.push(groupId);
        const invite = await (
          await page.request.get(`${api}/groups/${groupId}/invite-code`, {
            headers: ownerHeaders,
          })
        ).json();
        const apply = await memberContext.request.post(
          `${api}/groups/join-requests`,
          {
            headers: {
              ...memberHeaders,
              "Idempotency-Key": crypto.randomUUID(),
            },
            data: { inviteCode: invite.inviteCode },
          },
        );
        expect(apply.status()).toBe(201);
        const request = await apply.json();
        expect(
          (
            await page.request.post(
              `${api}/groups/${groupId}/join-requests/${request.id}/approve`,
              { headers: ownerHeaders },
            )
          ).status(),
        ).toBe(200);
        expect(
          (
            await page.request.post(`${api}/groups/${groupId}/missions/start`, {
              headers: {
                ...ownerHeaders,
                "Idempotency-Key": crypto.randomUUID(),
              },
              data: {},
            })
          ).status(),
        ).toBe(201);
      }
      const seed = resolve("../backend/test/fixtures/seed-water-routine.mjs");
      const { routineId, itemId } = JSON.parse(
        execFileSync(process.execPath, [seed, owner.user.id], {
          env: {
            ...process.env,
            NODE_ENV: "test",
            DATABASE_URL: process.env.E2E_WATER_TEST_DATABASE_URL,
          },
          encoding: "utf8",
        }),
      );
      const deviceId = crypto.randomUUID();
      for (const [sequence, type, intervals, positionSeconds] of [
        [1, "start", [], 0],
        [2, "end", [{ start: 0, end: 80 }], 80],
      ] as const) {
        const response = await page.request.post(
          `${api.replace(/\/v1$/, "/v2")}/workout-routines/${routineId}/items/${itemId}/events`,
          {
            headers: {
              ...ownerHeaders,
              "Idempotency-Key": crypto.randomUUID(),
            },
            data: { deviceId, sequence, type, intervals, positionSeconds },
          },
        );
        expect(response.status(), JSON.stringify(await response.json())).toBe(
          200,
        );
      }
      const base = `/workout-routines/${routineId}/complete`;
      await page.goto(base);
      await expect(
        page.getByRole("heading", { name: "오늘의 운동 완료!" }),
      ).toBeVisible();
      await page.getByRole("link", { name: "다음", exact: true }).click();
      await expect(page).toHaveURL(`${base}/streak`);
      await expect(
        page.getByRole("heading", { name: "현재 1일 연속!" }),
      ).toBeVisible();
      await page.getByRole("link", { name: "다음", exact: true }).click();
      await expect(page).toHaveURL(`${base}/water`);
      if (count > 1) {
        await expect(
          page.getByRole("heading", { name: "어느 그룹에 물을 줄까요?" }),
        ).toBeVisible();
        await page.getByRole("radio", { name: /함께 운동 1/ }).check();
        await page
          .getByRole("button", { name: "선택한 그룹에 물 주기" })
          .click();
      }
      await expect(
        page.getByRole("heading", {
          name: "[TEST ONLY] 함께 운동 1 그룹에 물을 주었어요!",
        }),
      ).toBeVisible();
      for (const width of [390, 1218]) {
        await page.setViewportSize({ width, height: 844 });
        await page.screenshot({
          path: info.outputPath(`live-water-${count}-${width}.png`),
          fullPage: true,
        });
      }
      await page.reload();
      await expect(
        page.getByRole("heading", {
          name: "[TEST ONLY] 함께 운동 1 그룹에 물을 주었어요!",
        }),
      ).toBeVisible();
      for (const [i, groupId] of groups.entries()) {
        const mission = await (
          await page.request.get(`${api}/groups/${groupId}/missions/current`, {
            headers: ownerHeaders,
          })
        ).json();
        expect(mission.waterCount).toBe(i === 0 ? 1 : 0);
      }
    } finally {
      for (const groupId of groups)
        expect(
          (
            await page.request.delete(`${api}/groups/${groupId}`, {
              headers: ownerHeaders,
            })
          ).status(),
        ).toBe(204);
      for (const [client, auth] of [
        [page.request, ownerHeaders],
        [memberContext.request, memberHeaders],
      ] as const)
        expect(
          (
            await client.delete(`${api}/users/me`, {
              headers: auth,
              data: { password },
            })
          ).status(),
        ).toBe(204);
      await memberContext.close();
    }
  });
