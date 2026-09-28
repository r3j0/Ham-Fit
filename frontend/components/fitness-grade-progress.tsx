import { Trophy } from "lucide-react";
import {
  formatInterval,
  itemGradeResult,
  type StoredItemEvaluation,
} from "@/lib/fitness-contract";
import { displayConvertedValue } from "@/lib/conversion-display";
import { gradeTone, reportGradeSteps } from "@/lib/fitness-report-display";
import styles from "./fitness-report.module.css";

export function FitnessGradeProgress({
  evaluation,
}: {
  evaluation: StoredItemEvaluation;
}) {
  const steps = reportGradeSteps(evaluation);
  if (!steps.length || !evaluation.criterion) return null;
  const { criterion, nextTarget, conversion } = evaluation;
  return (
    <div
      className={styles.progress}
      data-grade={gradeTone(itemGradeResult(evaluation))}
    >
      {conversion && (
        <p className={styles.scaleLabel}>
          {conversion.unit === "%"
            ? "상대악력(%)"
            : "추정 최대산소섭취량(ml/kg/min)"}{" "}
          기준
        </p>
      )}
      <ol
        className={styles.steps}
        aria-label="이전 기준과 현재 등급, 다음 목표"
        style={{
          gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
        }}
      >
        {steps.map((step) => (
          <li
            key={step.label + step.title}
            aria-current={step.current ? "step" : undefined}
            className={step.highest ? styles.highest : undefined}
          >
            {step.highest && <Trophy size={20} aria-hidden="true" />}
            <span className={styles.stepLabel}>{step.label}</span>
            <strong>{step.title}</strong>
            {step.intervals.map((interval, index) => (
              <span className={styles.stepValue} key={index}>
                {index > 0 && (
                  <>
                    또는
                    <br />
                  </>
                )}
                {formatInterval(interval, criterion.unit)}
              </span>
            ))}
            {!step.highest && step.intervals.length === 0 && (
              <span className={styles.stepValue}>해당 기준 구간 없음</span>
            )}
          </li>
        ))}
      </ol>
      {nextTarget.status === "available" && (
        <div className={styles.adjustments}>
          {nextTarget.intervals.length > 1 && (
            <p>아래 조건 중 하나를 충족하면 돼요.</p>
          )}
          {nextTarget.intervals.map((interval, index) => (
            <div key={index}>
              {nextTarget.intervals.length > 1 && (
                <p>{formatInterval(interval, criterion.unit)}</p>
              )}
              {(["lower", "upper"] as const).map((side) => {
                const adjustment = nextTarget.adjustments[index][side];
                if (!adjustment || adjustment.change === "none") return null;
                return (
                  <p key={side}>
                    현재 값과의 차이{" "}
                    {conversion
                      ? displayConvertedValue(adjustment.difference)
                      : adjustment.difference}{" "}
                    {adjustment.unit === "%" ? "%p" : adjustment.unit} ·{" "}
                    {adjustment.change === "increase" ? "증가" : "감소"} 필요
                    {adjustment.requiresBeyondBoundary &&
                      ` (${adjustment.threshold} ${adjustment.unit} ${side === "lower" ? "초과" : "미만"} 필요)`}
                  </p>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
