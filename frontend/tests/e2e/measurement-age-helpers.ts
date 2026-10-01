import { refreshOnFocus } from "./resource-refresh";
import { expect, type Page } from "@playwright/test";

/** Existing records keep their recorded age; all new records calculate it from DOB. */
export async function setMeasurementAge(page: Page, value: string) {
  const input = page.locator("input#age, input#assessment-age");
  if (await input.count()) {
    await input.fill(value);
    return;
  }
  const calculated = page.getByLabel("측정 당시 나이");
  if (
    (await calculated.count()) &&
    (await calculated.textContent())?.includes(`만 ${Number(value)}세`)
  )
    return;
  const measured = page.locator("#measuredOn");
  const date = (await measured.count())
    ? await measured.inputValue()
    : await page.evaluate(() =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(
          new Date(),
        ),
      );
  const birth =
    value && /^\d+$/.test(value)
      ? `${Number((date || "2026-09-30").slice(0, 4)) - Number(value)}-01-01`
      : null;
  await page.route("**/users/me/profile", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            dateOfBirth: birth,
            currentAge: Number(value),
            nickname: null,
          },
          headers: {
            "Access-Control-Allow-Origin":
              route.request().headers().origin ?? "*",
            "Access-Control-Allow-Credentials": "true",
          },
        })
      : route.fallback(),
  );
  await refreshOnFocus(page);
  if (value && date)
    await expect(page.getByLabel("측정 당시 나이")).toContainText(
      `만 ${Number(value)}세`,
    );
}
export async function expectMeasurementAge(page: Page, value: string) {
  const input = page.locator("input#age, input#assessment-age");
  if (await input.count()) await expect(input).toHaveValue(value);
  else if (!value && !(await page.locator("#measuredOn").inputValue()))
    await expect(page.getByLabel("측정 당시 나이")).toHaveCount(0);
  else
    await expect(page.getByLabel("측정 당시 나이")).toContainText(
      `만 ${value || "25"}세`,
    );
}
