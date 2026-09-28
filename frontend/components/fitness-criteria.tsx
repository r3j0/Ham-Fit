import { ChevronDown } from "lucide-react";
import {
  formatInterval,
  type StoredItemEvaluation,
} from "@/lib/fitness-contract";
import styles from "./fitness-report.module.css";

export function FitnessCriteria({
  evaluation,
}: {
  evaluation: StoredItemEvaluation;
}) {
  const { criterion, thresholds } = evaluation;
  if (!criterion) return null;
  return (
    <details className={styles.disclosure}>
      <summary>
        전체 등급 기준 보기
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <p className="caption">
        만 {criterion.minAge}~{criterion.maxAge}세 ·{" "}
        {criterion.sex === "male" ? "남성" : "여성"} 기준 ·{" "}
        {
          {
            higher: "높을수록 좋은 값",
            lower: "낮을수록 좋은 값",
            range: "기준 구간에 해당하는 값",
          }[criterion.direction]
        }
      </p>
      <table className={styles.criteriaTable}>
        <thead>
          <tr>
            <th scope="col">등급</th>
            <th scope="col">{criterion.unit} 기준</th>
          </tr>
        </thead>
        <tbody>
          {[...thresholds]
            .sort((a, b) => a.grade - b.grade)
            .map((threshold) => (
              <tr
                key={threshold.grade}
                data-current={threshold.grade === evaluation.grade || undefined}
              >
                <th scope="row">
                  {threshold.grade}등급
                  {threshold.grade === evaluation.grade && (
                    <small>현재 위치</small>
                  )}
                </th>
                <td>
                  {threshold.intervals
                    .map((i) => formatInterval(i, criterion.unit))
                    .join(" 또는 ")}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </details>
  );
}
