import type { Page } from "@playwright/test";

/** Returning after the freshness window revalidates; adjacent focus events do not. */
export async function refreshOnFocus(page: Page) {
  await page.clock.setSystemTime(
    new Date((await page.evaluate(() => Date.now())) + 300000),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
