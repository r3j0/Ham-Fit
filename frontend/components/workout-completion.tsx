"use client";
import Link from "next/link";
import { useCallback } from "react";
import { getRoutine } from "@/lib/workout-routines";
import { getActivityProfile } from "@/lib/activity-profile";
import { getActivityReward } from "@/lib/personal-rewards";
import { nextRoutineHref } from "@/lib/workout-practice";
import { errorMessage } from "@/lib/http";
import { useApiResource } from "./use-api-resource";
import { Header, Loading, Notice, Shell } from "./ui";
import { MascotPose } from "./mascot/MascotPose";
import { SeedIcon } from "./seed-icon";
import { WorkoutWater } from "./workout-water";
export function WorkoutCompletion({
  id,
  step = "complete",
}: {
  id: string;
  step?: "complete" | "streak" | "reward" | "water";
}) {
  const routine = useApiResource(
    useCallback((signal: AbortSignal) => getRoutine(id, signal), [id]),
  );
  return (
    <Shell>
      <Header title="운동 완료" back="/workout" />
      <div className="content stack completion-page">
        {routine.error ? (
          <>
            <Notice>{errorMessage(routine.error)}</Notice>
            <button className="button secondary" onClick={routine.reload}>
              완료 상태 다시 확인
            </button>
          </>
        ) : routine.data ? (
          routine.data.status === "completed" ? (
            <Completed
              id={id}
              step={step}
              koreanDate={routine.data.koreanDate}
              today={routine.data.serverKoreanDate}
            />
          ) : (
            <>
              <Notice tone="info">아직 마치지 않은 운동이 있어요.</Notice>
              <Link
                className="button primary"
                href={nextRoutineHref(routine.data)}
              >
                운동 이어 하기
              </Link>
            </>
          )
        ) : (
          <Loading />
        )}
      </div>
    </Shell>
  );
}
function Completed({
  id,
  step,
  koreanDate,
  today,
}: {
  id: string;
  step: "complete" | "streak" | "reward" | "water";
  koreanDate: string;
  today: string;
}) {
  const activity = useApiResource(getActivityProfile);
  const reward = useApiResource(
    useCallback(
      (signal: AbortSignal) =>
        getActivityReward(id, signal).then((r) => {
          if (r && r.koreanDate !== koreanDate)
            throw new Error("보상 날짜를 확인하지 못했어요.");
          return r;
        }),
      [id, koreanDate],
    ),
  );
  const receipt = reward.data,
    base = `/workout-routines/${id}/complete`;
  const next =
    step === "complete"
      ? `${base}/streak`
      : step === "streak"
        ? `${base}/water`
        : "/";
  if (step === "water")
    return (
      <WorkoutWater
        id={id}
        next={receipt?.seed.status === "granted" ? `${base}/reward` : "/"}
      />
    );
  return (
    <>
      {step === "complete" && (
        <>
          <MascotPose pose="victory" size={230} label="운동을 마친 햄스터" />
          <h1>
            {koreanDate === today
              ? "오늘의 운동 완료!"
              : `${koreanDate} 운동 완료!`}
          </h1>
          <p>하나씩 해낸 나에게 박수를 보내요.</p>
        </>
      )}
      {step === "streak" && (
        <>
          {activity.error ? (
            <>
              <Notice>{errorMessage(activity.error)}</Notice>
              <button className="button secondary" onClick={activity.reload}>
                스트릭 다시 확인
              </button>
            </>
          ) : activity.data ? (
            <>
              <div className="streak-celebration" aria-hidden="true">
                🔥
              </div>
              <h1>현재 {activity.data.streak}일 연속!</h1>
              <div
                className="streak-marks"
                aria-label={`현재 연속 운동 ${activity.data.streak}일`}
              >
                {Array.from({ length: 5 }, (_, i) => (
                  <span
                    key={i}
                    className={
                      i <
                      (activity.data!.streak === 0
                        ? 0
                        : ((activity.data!.streak - 1) % 5) + 1)
                        ? "filled"
                        : ""
                    }
                    style={{ animationDelay: `${i * 120}ms` }}
                  >
                    ✓
                  </span>
                ))}
              </div>
              <p>꾸준히 쌓아 온 하루하루예요.</p>
            </>
          ) : (
            <Loading />
          )}
        </>
      )}
      {step === "reward" &&
        (receipt?.seed.status === "granted" ? (
          <>
            <div className="reward-symbol" aria-hidden="true">
              <SeedIcon height={100} />
            </div>
            <h1>해바라기씨 1개를 받았어요!</h1>
            <p>오늘의 루틴을 모두 마친 선물이에요.</p>
          </>
        ) : (
          !reward.loading &&
          !reward.error && (
            <Notice tone="info">
              이번 운동의 해바라기씨 지급 내역이 없어요.
            </Notice>
          )
        ))}
      {reward.error ? (
        <>
          <Notice>운동 완료는 저장됐지만 보상 내역을 확인하지 못했어요.</Notice>
          <button className="button secondary" onClick={reward.reload}>
            보상 다시 확인
          </button>
        </>
      ) : null}
      {step !== "complete" && reward.loading && (
        <Loading label="보상 내역을 확인하고 있어요" />
      )}
      {step === "streak" && (reward.loading || activity.loading) ? (
        <button className="button primary" disabled>
          완료 내역 확인 중
        </button>
      ) : (
        <Link className="button primary" href={next}>
          {next === "/" ? "메인으로" : "다음"}
        </Link>
      )}
    </>
  );
}
