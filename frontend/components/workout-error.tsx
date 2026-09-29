import Link from "next/link";
import { ApiError, errorMessage } from "@/lib/http";
import { Notice } from "./ui";
export function WorkoutError({ error }: { error: unknown }) {
  const code = error instanceof ApiError ? error.code : undefined;
  const help = {
    RECOMMENDATION_NOT_CONNECTED: [
      "이전 단일 운동은 현재 연결되지 않았어요. 새 루틴을 이용해 주세요.",
      "/workout",
      "새 루틴 보기",
    ],
    EXERCISE_GOAL_REQUIRED: [
      "운동 목적을 선택하면 맞춤 루틴을 준비할 수 있어요.",
      "/account/preferences",
      "운동 목적 선택하기",
    ],
    ROUTINE_NOT_DUE: [
      "배정된 날짜부터 이 운동을 시작할 수 있어요.",
      "/workout",
      "오늘의 운동으로",
    ],
    DATE_OF_BIRTH_REQUIRED: [
      "운동 추천을 받으려면 생년월일을 입력해 주세요.",
      "/account/settings?tab=birth",
      "생년월일 입력하기",
    ],
    MEASUREMENT_REQUIRED: [
      "운동 추천을 받으려면 측정 기록을 한 건 이상 등록해 주세요.",
      "/measurements/new",
      "측정 기록 등록하기",
    ],
    AGE_UNSUPPORTED: [
      "운동 추천은 현재 만 13~64세를 지원해요.",
      "/account/settings?tab=birth",
      "생년월일 확인하기",
    ],
  }[code ?? ""];
  return (
    <Notice>
      <p>
        {help?.[0] ??
          (code === "ROUTINE_ALGORITHM_UNAVAILABLE"
            ? "맞춤 운동을 준비할 수 없어요. 잠시 후 다시 시도해 주세요."
            : code === "WORKOUT_CATALOG_UNAVAILABLE"
              ? "운동 영상을 준비하고 있어요. 잠시 후 다시 시도해 주세요."
              : code === "WORKOUT_CONFLICT"
                ? "다른 화면에서 운동 상태가 변경되었어요. 저장된 최신 상태를 확인해 주세요."
                : error instanceof ApiError && error.status === 404
                  ? "운동을 찾을 수 없거나 접근할 수 없어요."
                  : errorMessage(error))}
      </p>
      {help && (
        <Link className="text-link" href={help[1]}>
          {help[2]}
        </Link>
      )}
    </Notice>
  );
}
