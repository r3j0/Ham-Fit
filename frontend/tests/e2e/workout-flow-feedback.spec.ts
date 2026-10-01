import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { routineFixture } from "../fixtures/routine";
import { installRoutine } from "./workout-routine-fixtures";

async function playable(page: Page, watched = 0) {
  const row = routineFixture();
  for (const item of row.routine) {
    item.playbackUrl = `https://openapi.kspo.or.kr/web/video/${item.videoId}`;
    item.playbackStatus = "verified";
    item.verifiedDurationSeconds = item.progress.durationSeconds = 12;
    const bytes = await readFile("tests/fixtures/workout.mp4");
    await page.route(item.playbackUrl, (route) => {
      const range = /^bytes=(\d+)-(\d*)$/.exec(
        route.request().headers().range ?? "",
      );
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Number(range[2]) : bytes.length - 1;
      return route.fulfill({
        status: range ? 206 : 200,
        contentType: "video/mp4",
        body: bytes.subarray(start, end + 1),
        headers: {
          "Accept-Ranges": "bytes",
          ...(range
            ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` }
            : {}),
        },
      });
    });
  }
  if (watched) {
    const item = row.routine[0];
    item.status = row.status = "in_progress";
    item.progress.watchedSeconds = item.progress.positionSeconds = watched;
    item.progress.intervals = [{ start: 0, end: watched }];
  }
  const state = await installRoutine(page, row);
  return { row, state };
}

async function reviewGuideAfterPlayback(page: Page) {
  const guide = page.getByRole("region", { name: "운동 방법" });
  await expect(guide).toHaveAttribute("data-highlighted", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "여기서 종료", exact: true }).click();
}

for (const width of [320, 600, 1280]) {
  test(`${width}px 운동/메인 박스는 3열이고 진행 배지는 제목 오른쪽에 있다`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const row = routineFixture();
    row.routine[0].title = "양발 벌려 무릎 밀어내기";
    await installRoutine(page, row);
    for (const route of ["/workout", "/"]) {
      await page.goto(route);
      const title = page.getByRole("heading", {
        name: "오늘의 운동",
        exact: true,
      });
      const summary = page.getByRole("group", { name: "오늘의 운동 요약" });
      await expect(summary).toHaveText("0/3");
      const h = (await title.boundingBox())!,
        badges = (await summary.boundingBox())!;
      expect(badges.x).toBeGreaterThan(h.x + h.width);
      expect(
        Math.abs(badges.y + badges.height / 2 - h.y - h.height / 2),
      ).toBeLessThan(5);
      await expect(summary.locator("svg")).toHaveCount(0);
      const item = page
        .getByRole("list", { name: "오늘 배정된 운동" })
        .getByRole("listitem")
        .first();
      const name = (await item.getByRole("heading").boundingBox())!,
        dose = (await item
          .getByRole("group", { name: "저장된 운동 처방" })
          .boundingBox())!,
        action = (await item.getByRole("link").boundingBox())!;
      expect(dose.x).toBeGreaterThan(name.x + name.width);
      expect(action.x).toBeGreaterThan(dose.x + dose.width);
      expect((await item.boundingBox())!.height).toBeLessThan(
        width === 320 ? 135 : 100,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(
          `workout-row-${width}-${route === "/" ? "home" : "workout"}.png`,
        ),
        fullPage: true,
      });
    }
  });
}

for (const watched of [9.59, 9.6]) {
  test(`${watched}/12초 시청의 종료는 80% 경계에 따라 확인창·완료를 처리하고 다음 영상으로 이동한다`, async ({
    page,
  }) => {
    const { row, state } = await playable(page, watched);
    const item = row.routine[0];
    await page.goto(`/workout-routines/${row.id}/items/${item.id}`);
    await expect(
      page.getByRole("button", { name: "운동 완료", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "여기서 종료" }).click();
    if (watched < 9.6) {
      await expect(page.getByRole("dialog")).toContainText("미완료");
      await page.getByRole("button", { name: "종료 확인" }).click();
    } else {
      const dialog = page.getByRole("dialog", {
        name: "운동 방법대로 운동을 완수했나요?",
      });
      await expect(dialog).toContainText(
        "운동을 완료했다면 완료 처리를 눌러주세요.",
      );
      await expect(
        dialog.getByRole("button", { name: "완료 처리", exact: true }),
      ).toHaveCSS("color", "rgb(255, 255, 255)");
      await expect(
        dialog.getByRole("img", { name: "운동 완료를 응원하는 내 햄스터" }),
      ).toHaveAttribute("data-pose", "passion");
      expect(state.events.filter((event) => event.type === "end")).toHaveLength(
        0,
      );
      await dialog
        .getByRole("button", { name: "완료 처리", exact: true })
        .click();
    }
    await expect(page).toHaveURL(
      `/workout-routines/${row.id}/items/${row.routine[1].id}`,
    );
    expect(item.status).toBe(watched < 9.6 ? "interrupted" : "completed");
    expect(
      state.events
        .filter((event) => event.item === item.id && event.type === "end")
        .map((event) => event.type),
    ).toEqual(["end"]);
  });
}

test("미완료 영상이 있는 한 바퀴는 목록으로 돌아오며 다시 완료한 뒤에만 루틴 완료로 이동한다", async ({
  page,
}) => {
  const { row } = await playable(page, 1);
  await page.goto(`/workout-routines/${row.id}/items/${row.routine[0].id}`);
  await page.getByRole("button", { name: "여기서 종료" }).click();
  await page.getByRole("button", { name: "종료 확인" }).click();
  for (const item of row.routine.slice(1)) {
    await expect(page).toHaveURL(
      `/workout-routines/${row.id}/items/${item.id}`,
    );
    const video = page.getByLabel("운동 영상");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(1);
    await video.evaluate((v: HTMLVideoElement) => {
      v.playbackRate = 8;
      return v.play();
    });
    await reviewGuideAfterPlayback(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "완료 처리" })
      .click();
  }
  await expect(page).toHaveURL("/workout");
  expect(row.status).not.toBe("completed");
  expect(row.progress.completedItems).toBe(2);
  await expect(page.getByLabel("완료한 운동 2/3")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "오늘 운동 완료 확인" }),
  ).toHaveCount(0);
  const unfinished = page
    .getByRole("listitem")
    .filter({ hasText: row.routine[0].title });
  await expect(unfinished).toContainText("미완료");
  await unfinished.getByRole("link", { name: /다시 운동하기/ }).click();
  const video = page.getByLabel("운동 영상");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  await video.evaluate((v: HTMLVideoElement) => {
    v.playbackRate = 8;
    return v.play();
  });
  await reviewGuideAfterPlayback(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "완료 처리" })
    .click();
  await expect(page).toHaveURL(`/workout-routines/${row.id}/complete`);
  expect(row.status).toBe("completed");
});

test("종료 저장 응답 유실은 같은 요청을 확인한 뒤에만 다음 영상으로 이동한다", async ({
  page,
}) => {
  const { row, state } = await playable(page, 10);
  let lost = false;
  const requests: { key: string; body: string }[] = [];
  await page.route("**/api/v2/workout-routines/**/events", async (route) => {
    if (route.request().postDataJSON().type !== "end") return route.fallback();
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData()!,
    });
    if (!lost) {
      lost = true;
      return route.abort();
    }
    await route.fallback();
  });
  const current = `/workout-routines/${row.id}/items/${row.routine[0].id}`;
  await page.goto(current);
  await page.getByRole("button", { name: "여기서 종료" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "완료 처리" })
    .click();
  await expect(
    page.getByRole("button", { name: "저장 다시 확인하기" }),
  ).toBeVisible();
  await expect(page).toHaveURL(current);
  expect(state.events.filter((event) => event.type === "end")).toHaveLength(0);
  await page.getByRole("button", { name: "저장 다시 확인하기" }).click();
  await expect(page).toHaveURL(
    `/workout-routines/${row.id}/items/${row.routine[1].id}`,
  );
  expect(requests[0]).toEqual(requests[1]);
});

test("끝으로 탐색해 영상이 끝나도 실제 시청량이 80% 미만이면 확인 후 미완료로 넘어간다", async ({
  page,
}) => {
  const { row } = await playable(page);
  const item = row.routine[0];
  await page.goto(`/workout-routines/${row.id}/items/${item.id}`);
  const video = page.getByLabel("운동 영상");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "운동 시작", exact: true }).click();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 11.75;
  });
  await reviewGuideAfterPlayback(page);
  await expect(page.getByRole("dialog")).toContainText("미완료");
  await page.getByRole("button", { name: "종료 확인" }).click();
  await expect(page).toHaveURL(
    `/workout-routines/${row.id}/items/${row.routine[1].id}`,
  );
  expect(item.status).toBe("interrupted");
  expect(item.progress.watchedSeconds).toBeLessThan(1);
});

test("종료 저장을 확인하기 전 새로고침해도 원래 요청을 복구한 뒤 다음 영상으로 이동한다", async ({
  page,
}) => {
  const { row } = await playable(page, 10);
  let lost = false;
  const requests: { key: string; body: string }[] = [];
  await page.route("**/api/v2/workout-routines/**/events", async (route) => {
    if (route.request().postDataJSON().type !== "end") return route.fallback();
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData()!,
    });
    if (!lost) {
      lost = true;
      return route.abort();
    }
    return route.fallback();
  });
  await page.goto(`/workout-routines/${row.id}/items/${row.routine[0].id}`);
  await page.getByRole("button", { name: "여기서 종료" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "완료 처리" })
    .click();
  await expect(
    page.getByRole("button", { name: "저장 다시 확인하기" }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(
    `/workout-routines/${row.id}/items/${row.routine[1].id}`,
  );
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
});

test("종료 후 루틴 조회 실패는 종료를 중복 저장하지 않고 조회만 재시도한다", async ({
  page,
}) => {
  const { row, state } = await playable(page, 10);
  let failRead = true;
  await page.route(`**/api/v2/workout-routines/${row.id}`, async (route) => {
    if (failRead && row.routine[0].status === "completed")
      return route.fulfill({
        status: 503,
        json: { message: "잠시 후 다시 확인해 주세요." },
      });
    return route.fallback();
  });
  const current = `/workout-routines/${row.id}/items/${row.routine[0].id}`;
  await page.goto(current);
  await page.getByRole("button", { name: "여기서 종료" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "완료 처리" })
    .click();
  await expect(
    page.getByRole("button", { name: "다음 운동 다시 확인하기" }),
  ).toBeVisible();
  await expect(page).toHaveURL(current);
  failRead = false;
  await page.getByRole("button", { name: "다음 운동 다시 확인하기" }).click();
  await expect(page).toHaveURL(
    `/workout-routines/${row.id}/items/${row.routine[1].id}`,
  );
  expect(state.events.filter((event) => event.type === "end")).toHaveLength(1);
});

for (const dismissal of ["취소", "닫기", "Escape"]) {
  test(`80% 이상 완료 확인의 ${dismissal}는 완료·이동 없이 시청량을 보존한다`, async ({
    page,
  }, info) => {
    const { row, state } = await playable(page, 10);
    await page.setViewportSize({ width: 320, height: 786 });
    const current = `/workout-routines/${row.id}/items/${row.routine[0].id}`;
    await page.goto(current);
    const video = page.getByLabel("운동 영상");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(1);
    // Native pause after 80% must not allow the server's pause event to finalize it.
    await video.evaluate((v: HTMLVideoElement) => {
      v.dispatchEvent(new Event("pause"));
    });
    await page.getByRole("button", { name: "여기서 종료" }).click();
    const dialog = page.getByRole("dialog", {
      name: "운동 방법대로 운동을 완수했나요?",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "완료 처리" }),
    ).toBeEnabled();
    const mascot = dialog.getByRole("img", {
      name: "운동 완료를 응원하는 내 햄스터",
    });
    await expect(mascot).toHaveAttribute("data-pose", "passion");
    await expect(mascot).toHaveAttribute("data-variant", "cream");
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(786);
    await page.screenshot({
      path: info.outputPath(`completion-confirm-${dismissal}.png`),
    });
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else
      await dialog
        .getByRole("button", { name: dismissal, exact: true })
        .click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(current);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "여기서 종료" }),
    ).toBeEnabled();
    expect(row.routine[0].status).not.toBe("completed");
    expect(row.routine[0].progress.watchedSeconds).toBe(10);
    expect(
      state.events.filter((event) =>
        ["end", "complete", "pause"].includes(event.type),
      ),
    ).toHaveLength(0);
    await page.getByRole("button", { name: "여기서 종료" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "완료 처리" })
      .click();
    await expect(page).toHaveURL(
      `/workout-routines/${row.id}/items/${row.routine[1].id}`,
    );
    expect(row.routine[0].status).toBe("completed");
    expect(state.events.filter((event) => event.type === "end")).toHaveLength(
      1,
    );
  });
}

for (const width of [320, 1218]) {
  test(`${width}px 영상 종료는 운동 방법만 강조하고 재생 재개 시 강조를 해제한다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const { row, state } = await playable(page, 9.6);
    const item = row.routine[0];
    const current = `/workout-routines/${row.id}/items/${item.id}`;
    await page.goto(current);
    const video = page.getByLabel("운동 영상");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(1);
    await video.evaluate((v: HTMLVideoElement) => {
      v.playbackRate = 8;
      return v.play();
    });
    const guide = page.getByRole("region", { name: "운동 방법" });
    await expect(guide).toHaveAttribute("data-highlighted", "true");
    await expect
      .poll(() => guide.evaluate((el) => el.getAnimations().length))
      .toBe(1);
    const frames = await guide.evaluate((el) =>
      (el.getAnimations()[0].effect as KeyframeEffect).getKeyframes(),
    );
    expect(frames.every((frame) => frame.boxShadow !== undefined)).toBe(true);
    expect(frames[0].boxShadow).not.toBe(frames[1].boxShadow);
    await expect(guide).toHaveCSS("filter", "none");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(current);
    expect(item.status).toBe("in_progress");
    expect(
      state.events.filter((event) =>
        ["end", "complete", "pause"].includes(event.type),
      ),
    ).toHaveLength(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(guide).toHaveCSS("animation-name", "none");
    await expect(guide).not.toHaveCSS("box-shadow", "none");
    await video.evaluate((v: HTMLVideoElement) => {
      v.currentTime = 0;
      return v.play();
    });
    await expect(guide).not.toHaveAttribute("data-highlighted");
    await video.evaluate((v: HTMLVideoElement) => v.pause());
    await page
      .getByRole("button", { name: "여기서 종료", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "완료 처리", exact: true })
      .click();
    await expect(page).toHaveURL(
      `/workout-routines/${row.id}/items/${row.routine[1].id}`,
    );
    expect(item.status).toBe("completed");
  });
}
