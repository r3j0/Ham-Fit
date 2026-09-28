import { ChevronDown, Info } from "lucide-react";
import type { Catalog, Measurement } from "@/lib/types";
import {
  fitnessFactors,
  gradeLabel,
  type GradeResult,
} from "@/lib/fitness-evaluation";
import {
  itemGradeResult,
  parseMeasurementEvaluation,
  type ReportItem,
} from "@/lib/fitness-contract";
import { gradeTone } from "@/lib/fitness-report-display";
import { displayConvertedValue } from "@/lib/conversion-display";
import { FitnessRadar } from "./fitness-radar";
import { FitnessCriteria } from "./fitness-criteria";
import { FitnessGradeProgress } from "./fitness-grade-progress";
import { FitnessReportSources } from "./fitness-report-sources";
import { Notice } from "./ui";
import { ConversionDetails } from "./conversion-details";
import styles from "./fitness-report.module.css";

const isReference = (item: ReportItem) =>
  item.evaluation.conversion?.formulaVersion === "nfa100-adult-step-vo2max-v1";
function GradeBadge({
  result,
  reference = false,
}: {
  result: GradeResult;
  reference?: boolean;
}) {
  return (
    <span className={styles.badge} data-grade={gradeTone(result)}>
      {gradeLabel(result)}
      {reference && " (참고)"}
    </span>
  );
}
function ItemReport({
  item,
  label,
  criteria,
  representative = false,
  compact = false,
}: {
  item: ReportItem;
  label: string;
  criteria: boolean;
  representative?: boolean;
  compact?: boolean;
}) {
  const { evaluation } = item;
  const conversion = evaluation.conversion;
  const reference = isReference(item);
  const scored =
    evaluation.status === "graded" || evaluation.status === "below_standard";
  const value =
    reference && conversion
      ? displayConvertedValue(conversion.value)
      : item.value;
  const unit = reference && conversion ? conversion.unit : item.unit;
  const information = (
    <>
      {conversion &&
        (reference ? (
          <>
            <p className={styles.conversionValue}>
              입력한 회복 심박수: {item.value} {item.unit}
            </p>
            <p className={styles.reference}>
              <Info size={16} aria-hidden="true" />
              <span>자가측정 기반 참고 등급이며 공식 인증이 아니에요.</span>
            </p>
          </>
        ) : (
          <p className={styles.conversionValue}>
            등급 판정에 사용한 상대악력:{" "}
            {displayConvertedValue(conversion.value)} {conversion.unit}
          </p>
        ))}
      {scored ? (
        <FitnessGradeProgress evaluation={evaluation} />
      ) : (
        <div className={styles.unscored}>
          <strong>{gradeLabel(itemGradeResult(evaluation))}</strong>
          <p>{evaluation.message}</p>
        </div>
      )}
      {conversion && <ConversionDetails conversion={conversion} />}
      {criteria && <FitnessCriteria evaluation={evaluation} />}
    </>
  );
  if (compact)
    return (
      <details className={styles.otherItem}>
        <summary
          aria-label={`${label}: ${value} ${unit}, ${gradeLabel(itemGradeResult(evaluation))}`}
        >
          <span className={styles.otherName}>
            <span>{label}</span>
            <small>
              {gradeLabel(itemGradeResult(evaluation)).split(" · ").at(-1)}
            </small>
          </span>
          <span className={styles.value}>
            <strong>{value}</strong> <span>{unit}</span>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className={styles.otherDetails}>{information}</div>
      </details>
    );
  return (
    <div className={`evaluation-item ${styles.item}`}>
      <div className={styles.itemHeading}>
        <h3>{label}</h3>
        {representative && (
          <span className={styles.representative}>대표 등급 반영</span>
        )}
      </div>
      {reference && <p className="caption">추정 최대산소섭취량</p>}
      <p
        className={styles.value}
        aria-label={
          reference ? `추정 최대산소섭취량: ${value} ${unit}` : undefined
        }
      >
        <strong>{value}</strong> <span>{unit}</span>
      </p>
      {information}
    </div>
  );
}

export function FitnessReport({
  record,
  catalog,
}: {
  record: Measurement;
  catalog: Catalog;
}) {
  let evaluation;
  try {
    evaluation = parseMeasurementEvaluation(record, catalog);
  } catch {
    return (
      <Notice>
        평가 정보를 확인하지 못했어요. 저장한 측정값은 아래에서 확인할 수
        있어요.
      </Notice>
    );
  }
  if (!evaluation)
    return (
      <Notice tone="info">
        아직 평가 결과가 제공되지 않았어요. 저장한 측정값은 아래에서 확인할 수
        있어요.
      </Notice>
    );
  const labels = Object.fromEntries(
    catalog.definitions.map((d) => [d.code, d.label]),
  );
  const label = (code: string) => labels[code] ?? code;
  return (
    <section
      className={`stack ${styles.profile}`}
      aria-labelledby="fitness-report-title"
    >
      <h2 id="fitness-report-title">이 기록의 체력 프로필</h2>
      <FitnessRadar axes={evaluation.axes} />
      <p className="caption">
        이 측정 기록에서 같은 체력 요인에 속한 종목 중 가장 높은 등급을
        표시해요. 종합 인증등급과는 별개예요.
      </p>
      <section className={styles.report} aria-label="측정 상세 리포트">
        <h2>측정 상세 리포트</h2>
        {evaluation.axes.map((axis) => {
          const items = evaluation.items
            .filter((i) => i.factor === axis.factor)
            .sort(
              (a, b) =>
                Number(
                  axis.sourceMeasurementCodes.includes(b.measurementCode),
                ) -
                Number(axis.sourceMeasurementCodes.includes(a.measurementCode)),
            );
          const multiple = items.length > 1;
          const reference = items.some(
            (i) =>
              axis.sourceMeasurementCodes.includes(i.measurementCode) &&
              isReference(i),
          );
          const title = `${fitnessFactors.find((f) => f.code === axis.factor)!.label} · ${gradeLabel(axis)}`;
          return (
            <details className={styles.axis} key={axis.factor}>
              <summary aria-label={`${title}${reference ? " (참고)" : ""}`}>
                <span className={styles.axisName}>
                  {fitnessFactors.find((f) => f.code === axis.factor)!.label}
                  <small>
                    {multiple
                      ? `${items.length}개 종목 · ${axis.status === "evaluated" || axis.status === "below_standard" ? "가장 높은 등급" : "평가 상태 확인"}`
                      : items.length
                        ? label(items[0].measurementCode)
                        : "입력한 종목 없음"}
                  </small>
                </span>
                <GradeBadge result={axis} reference={reference} />
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <div className={styles.axisBody}>
                {!items.length && (
                  <p className={styles.unscored}>
                    {axis.reason ?? "이 체력 요소의 측정 기록이 없어요."}
                  </p>
                )}
                {items.map((item, index) =>
                  index === 0 ? (
                    <ItemReport
                      key={item.measurementCode}
                      item={item}
                      label={label(item.measurementCode)}
                      criteria={!multiple}
                      representative={
                        multiple &&
                        (axis.status === "evaluated" ||
                          axis.status === "below_standard") &&
                        axis.sourceMeasurementCodes.includes(
                          item.measurementCode,
                        )
                      }
                    />
                  ) : (
                    <details
                      className={styles.secondaryItem}
                      key={item.measurementCode}
                    >
                      <summary>
                        <span>
                          {label(item.measurementCode)}
                          <small>
                            {item.value} {item.unit}
                          </small>
                        </span>
                        <GradeBadge
                          result={itemGradeResult(item.evaluation)}
                          reference={isReference(item)}
                        />
                        <ChevronDown size={16} aria-hidden="true" />
                      </summary>
                      <ItemReport
                        item={item}
                        label={label(item.measurementCode)}
                        criteria={false}
                      />
                    </details>
                  ),
                )}
              </div>
            </details>
          );
        })}
        {evaluation.items.some((i) => i.factor === null) && (
          <details className={styles.axis}>
            <summary>
              <span className={styles.axisName}>
                다각형에 포함하지 않는 항목
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className={styles.axisBody}>
              {evaluation.items
                .filter((i) => i.factor === null)
                .map((item) => (
                  <ItemReport
                    key={item.measurementCode}
                    item={item}
                    label={label(item.measurementCode)}
                    criteria={true}
                    compact
                  />
                ))}
            </div>
          </details>
        )}
        <FitnessReportSources items={evaluation.items} labels={labels} />
      </section>
    </section>
  );
}
