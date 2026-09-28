export const exerciseVolumeOptions = [
  { value: "less", label: "가볍게" },
  { value: "standard", label: "기본" },
  { value: "more", label: "충분히" },
] as const;

export const exerciseGoalOptions = [
  {
    value: "fitness_grade_improvement",
    label: "국민체력100 등급 개선",
    description: "종목별 등급 향상",
  },
  {
    value: "body_composition_management",
    label: "체형 관리",
    description: "체지방·근육 관리",
  },
  {
    value: "general_fitness_improvement",
    label: "기본 체력 증진",
    description: "일상 체력 기르기",
  },
] as const;

export type ExerciseVolume = (typeof exerciseVolumeOptions)[number]["value"];
export type ExerciseGoal = (typeof exerciseGoalOptions)[number]["value"];
export interface ExercisePreferences {
  exerciseVolume: ExerciseVolume;
  exerciseGoal: ExerciseGoal | null;
}

export interface StoredExercisePreferences extends ExercisePreferences {
  updatedAt: string;
}
export type ExercisePreferencesPatch = {
  exerciseVolume?: ExerciseVolume;
  exerciseGoal?: ExerciseGoal;
};

/** Missing or incompatible responses must never become editable defaults. */
export function parseExercisePreferences(
  value: unknown,
): StoredExercisePreferences {
  if (typeof value === "object" && value !== null) {
    const data = value as Record<string, unknown>;
    if (
      exerciseVolumeOptions.some(
        (option) => option.value === data.exerciseVolume,
      ) &&
      (data.exerciseGoal === null ||
        exerciseGoalOptions.some(
          (option) => option.value === data.exerciseGoal,
        )) &&
      typeof data.updatedAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.updatedAt) &&
      Number.isFinite(Date.parse(data.updatedAt))
    ) {
      return {
        exerciseVolume: data.exerciseVolume as ExerciseVolume,
        exerciseGoal: data.exerciseGoal as ExerciseGoal | null,
        updatedAt: data.updatedAt,
      };
    }
  }
  throw new Error("운동 설정을 확인할 수 없어요. 다시 불러와 주세요.");
}

/** Send only edits so another tab's changes to untouched fields survive. */
export function buildPreferencesPatch(
  saved: ExercisePreferences,
  draft: ExercisePreferences,
): ExercisePreferencesPatch | null {
  const patch: ExercisePreferencesPatch = {};
  if (saved.exerciseVolume !== draft.exerciseVolume)
    patch.exerciseVolume = draft.exerciseVolume;
  // null is a valid initial response, but clearing a goal is not an API operation.
  if (draft.exerciseGoal !== null && saved.exerciseGoal !== draft.exerciseGoal)
    patch.exerciseGoal = draft.exerciseGoal;
  return Object.keys(patch).length ? patch : null;
}
