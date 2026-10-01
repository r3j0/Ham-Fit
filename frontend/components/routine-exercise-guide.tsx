import { Clock3, Dumbbell, Repeat2 } from "lucide-react";
import type { Prescription } from "@/lib/workout-routine";
import { MemberMascot } from "./member-mascot";
import styles from "./routine-exercise-guide.module.css";

export function RoutineExerciseGuide({
  prescription,
  highlighted = false,
}: {
  prescription: Prescription;
  highlighted?: boolean;
}) {
  const dose = `${prescription.value}${prescription.unit}`;
  const summary = `${dose} × ${prescription.sets}세트`;
  const hasExtraInstructions =
    prescription.text.replace(/\s/g, "") !== summary.replace(/\s/g, "");
  return (
    <section
      className={styles.guide}
      aria-label="운동 방법"
      data-highlighted={highlighted || undefined}
    >
      <h3>운동 방법</h3>
      <div className={styles.mascot}>
        <MemberMascot pose="pushup" size={140} label="푸시업하는 내 햄스터" />
      </div>
      <p className={styles.instruction}>아래와 같은 방식으로 운동하세요!</p>
      <ol className={styles.steps}>
        <li>
          <Dumbbell size={22} aria-hidden="true" />
          <div>
            <span>한 세트</span>
            <strong>
              {dose}
              {prescription.doseType === "hold" &&
              !prescription.unit.includes("유지")
                ? " 유지"
                : ""}
            </strong>
          </div>
        </li>
        <li>
          <Clock3 size={22} aria-hidden="true" />
          <div>
            <span>세트 사이 휴식</span>
            <strong>
              {prescription.restSec ? `${prescription.restSec}초` : "휴식 없이"}
            </strong>
          </div>
        </li>
        <li>
          <Repeat2 size={22} aria-hidden="true" />
          <div>
            <span>총 반복</span>
            <strong>{prescription.sets}세트</strong>
          </div>
        </li>
      </ol>
      {hasExtraInstructions && <p className="caption">{prescription.text}</p>}
    </section>
  );
}
