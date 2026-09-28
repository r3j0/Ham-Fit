import { ChevronDown } from "lucide-react";
import type { MeasurementConversion } from "@/lib/fitness-contract";
import styles from "./fitness-report.module.css";

/** Only receives conversions that passed the report contract boundary. */
export function ConversionDetails({
  conversion,
}: {
  conversion: MeasurementConversion;
}) {
  const input = (code: string) =>
    conversion.inputs.find((i) => i.measurementCode === code)!.value;
  const step = conversion.formulaVersion === "nfa100-adult-step-vo2max-v1";
  return (
    <details className={styles.disclosure}>
      <summary>
        환산 과정 보기
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className={styles.formula}>
        {step ? (
          <>
            <p>
              측정 당시{" "}
              {conversion.sexAtMeasurement === "male" ? "남성" : "여성"} · 만{" "}
              {conversion.ageAtMeasurement}세 · 신장 {input("height")} cm · 체중{" "}
              {input("weight")} kg · 회복 심박수{" "}
              {input("ymca_recovery_heart_rate")} bpm
            </p>
            <p>
              적용 공식:{" "}
              {conversion.sexAtMeasurement === "male"
                ? "70.597 − 0.246×나이 + 0.077×신장 − 0.222×체중 − 0.147×심박수"
                : "54.337 − 0.185×나이 + 0.097×신장 − 0.246×체중 − 0.122×심박수"}
            </p>
            <p>30cm 스텝박스 · 96bpm · 운동 3분 · 회복 1분 후 10초 맥박 × 6</p>
          </>
        ) : (
          <p>
            절대악력 {input("absolute_grip_strength")} kg ÷ 같은 기록의 체중{" "}
            {input("weight")} kg × 100
          </p>
        )}
        <p>
          환산값 표시는 소수점 6자리까지이며, 등급은 반올림하지 않은 계산값으로
          판정해요.
        </p>
      </div>
    </details>
  );
}
