"use client";
import Link from "next/link";
import { useCallback } from "react";
import { getRoutine } from "@/lib/workout-routines";
import { nextRoutineHref } from "@/lib/workout-practice";
import { errorMessage } from "@/lib/http";
import { useApiResource } from "./use-api-resource";
import { Loading, Notice } from "./ui";
export function RoutineNext({
  routineId,
  itemId,
  practice = true,
}: {
  routineId: string;
  itemId: string;
  practice?: boolean;
}) {
  const resource = useApiResource(
    useCallback(
      (signal: AbortSignal) => getRoutine(routineId, signal),
      [routineId],
    ),
  );
  const row = resource.data,
    completed =
      row?.routine.find((i) => i.id === itemId)?.status === "completed";
  return (
    <div className="stack-sm">
      {practice && (
        <Link
          className="button secondary"
          href={`/workout-routines/${routineId}/items/${itemId}/practice`}
        >
          처방대로 따라 하기 (선택)
        </Link>
      )}
      {resource.error ? (
        <>
          <Notice>{errorMessage(resource.error)}</Notice>
          <button className="button secondary" onClick={resource.reload}>
            진행 상태 다시 확인
          </button>
        </>
      ) : row && completed ? (
        <Link className="button primary" href={nextRoutineHref(row)}>
          {row.status === "completed" ? "오늘 운동 마치기" : "다음 운동으로"}
        </Link>
      ) : row ? (
        <Link
          className="button primary"
          href={`/workout-routines/${routineId}/items/${itemId}`}
        >
          영상으로 돌아가 완료하기
        </Link>
      ) : (
        <Loading />
      )}
    </div>
  );
}
