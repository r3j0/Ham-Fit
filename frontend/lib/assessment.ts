import type { WorkoutDefinition } from "./workout.ts";
import { resultValue, type WorkoutState } from "./workout.ts";
import type { Catalog, MeasurementInput } from "./types.ts";
import { buildInput, type FormItem } from "./measurement-form.ts";

export const assessmentId = "adult-self-assessment-v1";
export const assessmentSource =
  "https://nfa.kspo.or.kr/measure/self/selectSelfMeasureItem.kspo";
export type AssessmentSetup = {
  age: string;
  sex: "" | "male" | "female";
  measuredOn: string;
  height: string;
  weight: string;
  waist: string;
};
export function adultAssessment(): WorkoutDefinition {
  return {
    id: assessmentId,
    version: 2,
    title: "성인 간이측정",
    sourceUrl: assessmentSource,
    description: "내가 직접 측정한 근지구력·심폐지구력·유연성을 기록해요.",
    steps: [
      {
        id: "endurance",
        title: "교차 윗몸일으키기",
        factor: "근지구력",
        equipment: ["매트", "발목을 잡아 줄 보조자 또는 발걸이"],
        instructions: [
          "무릎을 굽혀 누운 뒤 발목을 고정하고, 팔을 가슴 앞에 교차해 손을 어깨에 놓아요.",
          "일어날 때 팔꿈치가 허벅지에 닿고, 내려갈 때 등과 어깨가 바닥에 닿아야 해요.",
          "팔꿈치가 허벅지에 닿으면 1회로 세고, 60초 동안의 횟수를 입력해요.",
        ],
        videoUrl: "https://www.youtube.com/watch?v=j5sktGOVq1c",
        segments: [
          { id: "sit-ups", title: "60초 동안 측정", durationSeconds: 60 },
        ],
        result: {
          code: "cross_sit_up",
          label: "성공한 횟수",
          unit: "회",
          storedUnit: "회",
          kind: "integer",
          minimum: 0,
          hint: "올바른 자세로 마친 횟수만 입력해 주세요.",
        },
      },
      {
        id: "cardio",
        title: "YMCA 스텝검사",
        factor: "심폐지구력",
        equipment: ["안정적인 30cm 스텝박스", "간편한 복장"],
        instructions: [
          "가볍게 몸을 풀고 호흡이 편안한 상태에서 시작해요.",
          "96bpm 안내에 맞춰 올라가기·모으기·내려가기·모으기를 3분간 반복해요.",
          "자동으로 이어지는 1분 회복 후, 손목 맥박을 10초 동안 세어요. 입력한 횟수에 6을 곱해 bpm으로 기록해요.",
        ],
        videoUrl: "https://www.youtube.com/watch?v=xFtWEPFp5wM",
        segments: [
          {
            id: "steps",
            shortLabel: "운동 3분",
            title: "스텝 운동",
            durationSeconds: 180,
            cadence: {
              intervalMs: 625,
              cues: ["올라가기", "모으기", "내려가기", "모으기"],
            },
          },
          {
            id: "recovery",
            shortLabel: "회복 1분",
            title: "회복 · 편안히 쉬어요",
            durationSeconds: 60,
          },
          {
            id: "pulse",
            shortLabel: "맥박 10초",
            title: "손목 맥박을 세어 주세요",
            durationSeconds: 10,
          },
        ],
        result: {
          code: "ymca_recovery_heart_rate",
          label: "10초 동안 센 맥박",
          unit: "회",
          storedUnit: "bpm",
          kind: "integer",
          minimum: 1,
          multiplier: 6,
          hint: "검지와 중지로 손목 안쪽 맥박을 세어요. 10초 동안 센 횟수를 입력하면 분당 심박수로 환산해요.",
        },
      },
      {
        id: "flexibility",
        title: "앉아 윗몸 앞으로 굽히기",
        factor: "유연성",
        equipment: ["줄자 또는 막대자"],
        instructions: [
          "무릎을 편 채 앉고 발뒤꿈치에 줄자의 30cm 눈금을 맞춰요.",
          "무릎을 굽히지 않고 양손을 앞으로 뻗어 닿은 눈금을 확인해요.",
          "닿은 눈금에서 30cm를 뺀 값을 기록해요. 예: 33cm는 3, 28cm는 -2예요.",
        ],
        videoUrl: "https://www.youtube.com/watch?v=ydKH9ybDUZ4",
        segments: [],
        result: {
          code: "sit_and_reach",
          label: "기준선에서 도달한 거리",
          unit: "cm",
          storedUnit: "cm",
          kind: "decimal",
          hint: "발뒤꿈치 기준선을 넘지 못했다면 음수도 입력할 수 있어요.",
        },
      },
    ],
  };
}
export function bmiFrom(height: string, weight: string): string | null {
  const h = Number(height),
    w = Number(weight);
  if (
    !height ||
    !weight ||
    !Number.isFinite(h) ||
    !Number.isFinite(w) ||
    h <= 0 ||
    w <= 0
  )
    return null;
  const bmi = (w * 10000) / (h * h);
  return Number.isFinite(bmi) && bmi >= 0.1 && bmi < 1e9
    ? bmi.toFixed(1)
    : null;
}
export function setupErrors(setup: AssessmentSetup): Record<string, string> {
  const errors: Record<string, string> = {};
  if (
    !/^\d{2}$/.test(setup.age) ||
    Number(setup.age) < 19 ||
    Number(setup.age) > 64
  )
    errors.age = "성인 만 19~64세의 간이측정을 지원해요.";
  for (const key of ["height", "weight", "waist"] as const) {
    const value = setup[key];
    if (
      value &&
      (value.length > 16 ||
        !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ||
        Number(value) <= 0)
    )
      errors[key] =
        "0보다 큰 숫자를 입력하거나, 측정하지 않았다면 비워 주세요.";
  }
  if (
    setup.height &&
    setup.weight &&
    !errors.height &&
    !errors.weight &&
    !bmiFrom(setup.height, setup.weight)
  )
    errors.weight =
      "BMI를 계산할 수 없어요. 신장과 체중의 값·단위를 확인해 주세요.";
  return errors;
}
export function assessmentInput(
  setup: AssessmentSetup,
  state: WorkoutState,
  catalog: Catalog,
  today: string,
) {
  const definition = adultAssessment();
  const items: FormItem[] = [];
  for (const [code, value] of [
    ["height", setup.height],
    ["weight", setup.weight],
    ["waist_circumference", setup.waist],
    ["bmi", bmiFrom(setup.height, setup.weight) ?? ""],
  ]) {
    if (value) items.push({ code, value, grade: "" });
  }
  for (const step of definition.steps) {
    const raw = state.results[step.id];
    if (raw !== undefined)
      items.push({
        code: step.result.code,
        value: resultValue(step, raw),
        grade: "",
      });
  }
  const result = buildInput(
    {
      measuredOn: setup.measuredOn,
      age: setup.age,
      sex: setup.sex,
      kind: "unknown",
      center: "",
      grade: "",
    },
    items,
    catalog,
    today,
  );
  return {
    errors: { ...setupErrors(setup), ...result.errors },
    input: {
      ...result.input,
      entryMethod: "self_assessment" as const,
    } satisfies MeasurementInput,
  };
}

/** BMI is derived only from the currently entered body measurements. */
export function calculateBodyItems(items: FormItem[]): FormItem[] {
  const next = items.filter((item) => item.code !== "bmi");
  const height = items.find((item) => item.code === "height")?.value ?? "";
  const weight = items.find((item) => item.code === "weight")?.value ?? "";
  const bmi = bmiFrom(height, weight);
  if (bmi) next.push({ code: "bmi", value: bmi, grade: "" });
  return next;
}
