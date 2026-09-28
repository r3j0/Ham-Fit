import { BookOpen, ChevronDown } from "lucide-react";
import type { ReportItem } from "@/lib/fitness-contract";
import { collectReportSources } from "@/lib/fitness-report-sources";
import styles from "./fitness-report.module.css";

export function FitnessReportSources({
  items,
  labels,
}: {
  items: ReportItem[];
  labels: Record<string, string>;
}) {
  const sources = collectReportSources(items);
  const names = (codes: string[]) =>
    codes.map((code) => labels[code] ?? code).join(", ");
  return (
    <details className={styles.sources}>
      <summary>
        <BookOpen size={16} aria-hidden="true" />
        <span>판정 기준 및 출처</span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className={styles.sourceContent}>
        {sources.links.length > 0 ? (
          <ul className={styles.sourceLinks}>
            {sources.links.map((source) => (
              <li key={source.url}>
                <a
                  className="text-link"
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.titles.join(" · ")} (새 창)
                </a>
                <p className="caption">적용 종목: {names(source.codes)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="caption">이 기록에 적용된 판정 기준이 없어요.</p>
        )}
        {sources.rules.map((group, index) => (
          <div className={styles.sourceMetadata} key={index}>
            <h3>판정 기준 {sources.rules.length > 1 ? index + 1 : "정보"}</h3>
            <p className="caption">적용 종목: {names(group.codes)}</p>
            <p className="caption">
              공식 기준: {group.criterion.officialVersion ?? "개정번호 미제공"}
              <br />
              판정 기준 버전: {group.criterion.internalVersion}
              <br />
              적용 기간: {group.criterion.effectiveFrom ??
                "시작일 미지정"} ~{" "}
              {group.criterion.effectiveUntil ?? "종료일 미지정"}
              <br />
              출처 개정: {group.criterion.source.revision ?? "미제공"}
              <br />
              출처 확인일: {group.criterion.source.checkedOn}
            </p>
          </div>
        ))}
        {sources.conversions.map((group, index) => (
          <div className={styles.sourceMetadata} key={index}>
            <h3>환산 기준</h3>
            <p className="caption">
              적용 종목: {names(group.codes)}
              <br />
              환산 버전: {group.conversion.formulaVersion}
              {group.conversion.formulaVersion ===
                "nfa100-adult-step-vo2max-v1" && (
                <>
                  <br />
                  측정 프로토콜: {group.conversion.protocol}
                </>
              )}
            </p>
          </div>
        ))}
        {sources.times.map((group) => (
          <p key={group.value} className="caption">
            평가 시각{" "}
            {new Intl.DateTimeFormat("ko-KR", {
              timeZone: "Asia/Seoul",
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(group.value))}
            {sources.times.length > 1 && <> · {names(group.codes)}</>}
          </p>
        ))}
      </div>
    </details>
  );
}
