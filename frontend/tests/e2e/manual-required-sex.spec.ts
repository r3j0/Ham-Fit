import { test, expect } from "@playwright/test";
import { installApi, catalog, testUser } from "./integration-fixtures";
import { buildInput, emptyMetadata } from "../../lib/measurement-form";

const meta = { ...emptyMetadata, measuredOn: "2026-09-01", age: "25" };
const items = [{ code: "height", value: "170", grade: "" }];

test("직접 입력의 성별은 접힌 추가 정보 밖에 표시하며 미선택 시 진행하지 않는다", async ({
  page,
}, info) => {
  const server = await installApi(page);
  const progress = page.getByRole("progressbar", {
    name: "체력 기록 진행 단계",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/onboarding/manual");
  await expect(progress).toHaveAttribute("aria-valuenow", "2");
  await expect(page.locator(".stepper")).toHaveCount(0);
  await page.getByLabel("측정일", { exact: true }).fill(meta.measuredOn);
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill(meta.age);
  const sex = page.getByLabel("성별", { exact: true });
  await expect(sex).toBeVisible();
  await expect(sex).toHaveAttribute("required", "");
  await expect(page.getByLabel("결과표의 성별")).toHaveCount(0);
  await expect(page.locator("details #sex")).toHaveCount(0);
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(sex).toBeFocused();
  await expect(progress).toHaveAttribute("aria-valuenow", "2");
  await expect(
    page.getByRole("heading", { name: "언제 측정하셨나요?" }),
  ).toBeVisible();
  expect(server.mutations).toHaveLength(0);
  // The component also validates if native browser validation is bypassed.
  await page.locator("form").evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
    form.requestSubmit();
  });
  await expect(
    page.getByText("성별을 선택해 주세요.", { exact: true }),
  ).toBeVisible();
  await sex.selectOption("female");
  await page.reload();
  await expect(sex).toHaveValue("female");
  await page.setViewportSize({ width: 320, height: 720 });
  await sex.click({ trial: true });
  await page.screenshot({
    path: info.outputPath("manual-required-sex.png"),
    fullPage: false,
  });
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(
    page.getByRole("heading", { name: "측정한 항목만 입력해요" }),
  ).toBeVisible();
  await expect(progress).toHaveAttribute("aria-valuenow", "3");
  await page.getByRole("button", { name: "이전 단계", exact: true }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "2");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "3");
  await page.reload();
  await expect(progress).toHaveAttribute("aria-valuenow", "3");
  await expect(
    page.getByRole("heading", { name: "측정한 항목만 입력해요" }),
  ).toBeVisible();
  expect(server.mutations).toHaveLength(0);
});

for (const uncertain of [false, true]) {
  test(
    uncertain
      ? "성별이 없던 이전 저장 요청은 원래 본문과 키로 재확인한다"
      : "성별 없는 이전 2단계 초안은 성별을 보완한 뒤 측정값을 유지해 저장한다",
    async ({ page }) => {
      const server = await installApi(page);
      const pending = {
        key: crypto.randomUUID(),
        body: JSON.stringify(
          buildInput(meta, items, catalog, "2026-09-24").input,
        ),
      };
      await page.addInitScript(
        ({ owner, draft }) => {
          sessionStorage.setItem(
            `modu-measurement-draft:v1:${owner}:new`,
            JSON.stringify({ expiresAt: Date.now() + 86400000, draft }),
          );
        },
        {
          owner: testUser.id,
          draft: {
            meta,
            items,
            step: 2,
            catalogVersion: catalog.version,
            pending: uncertain ? pending : null,
            uncertain,
            gone: false,
            dirty: true,
          },
        },
      );
      await page.goto("/onboarding/manual");
      await expect(page.getByLabel("신장", { exact: true })).toHaveValue("170");
      if (uncertain) {
        const request = page.waitForRequest(
          (r) => r.url().endsWith("/measurements") && r.method() === "POST",
        );
        await page
          .getByRole("button", { name: "같은 내용으로 다시 확인" })
          .click();
        const sent = await request;
        expect(sent.postData()).toBe(pending.body);
        expect(sent.headers()["idempotency-key"]).toBe(pending.key);
      } else {
        await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
        const sex = page.getByLabel("성별", { exact: true });
        await expect(sex).toBeVisible();
        await expect(
          page.getByText("성별을 선택해 주세요.", { exact: true }),
        ).toBeVisible();
        expect(server.mutations).toHaveLength(0);
        await sex.selectOption("male");
        await page.getByRole("button", { name: "측정값 입력하기" }).click();
        await expect(page.getByLabel("신장", { exact: true })).toHaveValue(
          "170",
        );
        await page.getByRole("button", { name: "1개 항목 저장하기" }).click();
      }
      await expect(page).toHaveURL(/\/onboarding\/complete\?record=/);
      expect(server.record?.sexAtMeasurement).toBe(uncertain ? null : "male");
      expect(server.record?.items[0].value).toBe("170");
      expect(server.mutations.filter((m) => m.method === "POST")).toHaveLength(
        1,
      );
    },
  );
}
