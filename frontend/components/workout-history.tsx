"use client";
import Link from "next/link";
import { useWorkoutHistoryLinks } from "./use-workout-history-links";
import { useEffect, useRef, useState } from "react";
import { getCombinedHistoryPage } from "@/lib/workouts";
import { workoutHref } from "@/lib/workout-routine";
import type { CombinedHistoryPage } from "@/lib/workouts";
import { Header, Loading, Notice, Shell } from "./ui";
import { WorkoutError } from "./workout-error";
import { WorkoutSummary, workoutLabels } from "./workout-summary";
import { useOperationScope } from "./use-operation-scope";

export function WorkoutHistory() {
  const { basePath } = useWorkoutHistoryLinks();

  const [page, setPage] = useState<CombinedHistoryPage | null>(null);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const guard = useRef(false);
  const begin = useOperationScope();
  useEffect(() => {
    const controller = new AbortController();
    getCombinedHistoryPage(undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setPage(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e);
      });
    return () => controller.abort();
  }, [retry]);
  async function more() {
    if (!page?.nextCursor || guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(undefined);
    const current = begin();
    try {
      const next = await getCombinedHistoryPage(page.nextCursor);
      if (!current()) return;
      setPage((old) => {
        const ids = new Set(old?.items.map((row) => row.id));
        return {
          items: [
            ...(old?.items ?? []),
            ...next.items.filter((row) => !ids.has(row.id)),
          ],
          nextCursor: next.nextCursor,
          legacyUnavailable: next.legacyUnavailable || !!old?.legacyUnavailable,
        };
      });
    } catch (e) {
      if (current()) setError(e);
    } finally {
      if (current()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <Shell>
      <Header title="운동 이력" back="/account" />
      <div className="content stack">
        <p className="muted">
          받았던 운동과 저장된 진행을 확인해요. 미완료 운동은 다시 이어갈 수
          있어요.
        </p>
        {error !== undefined && <WorkoutError error={error} />}
        {!page ? (
          error !== undefined ? (
            <button
              className="button secondary"
              onClick={() => {
                setError(undefined);
                setRetry((n) => n + 1);
              }}
            >
              운동 이력 다시 불러오기
            </button>
          ) : (
            <Loading />
          )
        ) : (
          <>
            {page.legacyUnavailable && (
              <Notice tone="info">
                이전 단일 운동 기록은 지금 불러올 수 없어요. 새 루틴 기록을
                표시하고 있어요.
              </Notice>
            )}
            {!page.items.length ? (
              <>
                <h2>아직 운동 이력이 없어요</h2>
                <Link className="button primary" href="/workout">
                  내일 운동 준비하기
                </Link>
              </>
            ) : (
              <ul className="workout-list stack">
                {page.items.map((row) => (
                  <li className="workout-card stack-sm" key={row.id}>
                    <WorkoutSummary workout={row} />
                    {row.performedAt && (
                      <p className="caption">
                        최근 수행일{" "}
                        {new Intl.DateTimeFormat("ko-KR", {
                          timeZone: "Asia/Seoul",
                          dateStyle: "long",
                        }).format(new Date(row.performedAt))}
                        {row.resultStatus &&
                          ` · ${workoutLabels[row.resultStatus]}`}
                      </p>
                    )}
                    <Link
                      className="button secondary"
                      href={workoutHref(
                        row,
                        row.status === "completed",
                        basePath.startsWith("/account"),
                      )}
                    >
                      {row.koreanDate > row.serverKoreanDate
                        ? "예정된 운동 보기"
                        : row.status === "completed"
                          ? "운동 다시보기"
                          : row.status === "assigned"
                            ? "운동 자세히 보기"
                            : "이 운동 이어하기"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {page.nextCursor && (
              <button
                className="button secondary"
                onClick={() => void more()}
                disabled={busy}
              >
                {busy ? "불러오는 중" : "이전 운동 더 보기"}
              </button>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
