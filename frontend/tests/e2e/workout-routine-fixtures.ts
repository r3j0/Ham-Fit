import { expect, type Page } from "@playwright/test";
import { installApi, testRecord } from "./integration-fixtures";
import { routineFixture } from "../fixtures/routine";
import type { WorkoutRoutine } from "../../lib/workout-routine";
export async function installRoutine(
  page: Page,
  row: WorkoutRoutine | null = routineFixture(),
  generated = routineFixture(),
) {
  await installApi(page, testRecord());
  const state = {
    row,
    requests: [] as { key: string; body: string }[],
    events: [] as { item: string; key: string; type: string }[],
  };
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/v2/workout-routines/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const row = state.row;
    if (url.pathname.endsWith("/current"))
      return route.fulfill({
        json: row && row.koreanDate === row.serverKoreanDate ? row : null,
      });
    if (url.pathname.endsWith("/history"))
      return route.fulfill({
        json: { items: row ? [row] : [], nextCursor: null },
      });
    if (url.pathname.endsWith("/today")) {
      state.requests.push({
        key: req.headers()["idempotency-key"],
        body: req.postData()!,
      });
      expect(req.headers()["x-csrf-protection"]).toBe("1");
      if (row && row.koreanDate === row.serverKoreanDate)
        return route.fulfill({ status: 200, json: row });
      state.row = generated;
      return route.fulfill({ status: 201, json: state.row });
    }
    if (url.pathname.endsWith("/events") && row) {
      const itemId = url.pathname.split("/").at(-2)!;
      const item = row.routine.find((item) => item.id === itemId)!;
      const body = req.postDataJSON();
      state.events.push({
        item: itemId,
        key: req.headers()["idempotency-key"],
        type: body.type,
      });
      expect(req.headers()["x-csrf-protection"]).toBe("1");
      item.revision++;
      const intervals = [...item.progress.intervals, ...body.intervals]
        .sort((a, b) => a.start - b.start)
        .reduce<{ start: number; end: number }[]>((merged, interval) => {
          const previous = merged.at(-1);
          if (previous && previous.end >= interval.start)
            previous.end = Math.max(previous.end, interval.end);
          else merged.push({ ...interval });
          return merged;
        }, []);
      item.progress = {
        ...item.progress,
        watchedSeconds: intervals.reduce(
          (sum, range) => sum + range.end - range.start,
          0,
        ),
        positionSeconds: body.positionSeconds,
        intervals,
      };
      item.status = ["pause", "end", "complete"].includes(body.type)
        ? item.progress.watchedSeconds >=
          item.progress.durationSeconds * 0.8 -
            8 * Number.EPSILON * item.progress.durationSeconds
          ? "completed"
          : item.progress.watchedSeconds > 0
            ? "interrupted"
            : "not_performed"
        : "in_progress";
      if (item.status === "completed") {
        item.resultStatus = "completed";
        item.completedAt = "2026-09-29T03:00:00Z";
      }
      item.performedAt = "2026-09-29T03:00:00Z";
      row.progress.completedItems = row.routine.filter(
        (i) => i.status === "completed",
      ).length;
      row.status =
        row.progress.completedItems === row.routine.length
          ? "completed"
          : "in_progress";
      return route.fulfill({ json: row });
    }
    return route.fulfill({ json: row });
  });
  return state;
}
