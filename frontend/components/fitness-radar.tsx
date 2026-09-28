"use client";
import { useId } from "react";
import {
  fitnessFactors,
  gradeLabel,
  radarGeometry,
  radarPoint,
  type FitnessAxis,
} from "@/lib/fitness-evaluation";
export function FitnessRadar({
  axes,
  variant = "detailed",
}: {
  axes: FitnessAxis[];
  variant?: "detailed" | "compact";
}) {
  const compact = variant === "compact";
  const hasReferenceGrade = axes.some((axis) =>
    axis.sourceMeasurementCodes.includes("ymca_recovery_heart_rate"),
  );
  const id = useId();
  const { points, path } = radarGeometry(axes);
  return (
    <figure
      className={`fitness-radar${compact ? " fitness-radar-compact" : ""}`}
    >
      <svg
        viewBox="0 0 360 340"
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
      >
        <title id={`${id}-title`}>6가지 체력 요인별 등급</title>
        <desc id={`${id}-description`}>
          위쪽 심폐지구력부터 시계 방향으로 여섯 점을 연결합니다. 바깥쪽일수록
          높은 등급이며 평가가 없는 축은 원점에 표시합니다.
          {fitnessFactors
            .map(
              (f) =>
                `${f.label}: ${gradeLabel(axes.find((a) => a.factor === f.code)!)}.`,
            )
            .join(" ")}
          {hasReferenceGrade && "심폐지구력은 자가측정 기반 참고 등급입니다."}
        </desc>
        {[0.25, 0.5, 0.75, 1].map((radius) => (
          <polygon
            key={radius}
            className="radar-grid"
            points={fitnessFactors
              .map((_, i) => {
                const p = radarPoint(i, radius);
                return `${p.x},${p.y}`;
              })
              .join(" ")}
          />
        ))}
        {fitnessFactors.map((f, i) => {
          const end = radarPoint(i, 1),
            label = radarPoint(i, 1.28);
          // Two-line labels sit outside the grid, including the upper corners.
          const labelY = label.y - (i === 0 ? 8 : i === 1 || i === 5 ? 26 : 0);
          const axis = axes.find((a) => a.factor === f.code)!;
          const reference =
            axis.sourceMeasurementCodes.includes("ymca_recovery_heart_rate") &&
            ["evaluated", "below_standard"].includes(axis.status);
          return (
            <g key={f.code}>
              <line
                className="radar-grid"
                x1="180"
                y1="158"
                x2={end.x}
                y2={end.y}
              />
              <text
                className="radar-label"
                x={label.x}
                y={labelY}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {f.label}
              </text>
              <text
                className="radar-grade"
                data-factor={f.code}
                x={label.x}
                y={labelY + (compact ? 28 : 22)}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {compact ? gradeLabel(axis).split(" · ")[0] : gradeLabel(axis)}
                {reference ? " (참고)" : ""}
              </text>
            </g>
          );
        })}
        <path className="radar-shape" data-testid="radar-path" d={path} />
        {points.map((p) => (
          <circle
            key={p.factor}
            className="radar-point"
            data-factor={p.factor}
            cx={p.x}
            cy={p.y}
            r="3.5"
          />
        ))}
      </svg>
      {!compact && (
        <>
          <figcaption className="caption center">
            원점: 평가 없음 · 안쪽부터 기준 미달 → 3등급 → 2등급 → 1등급
          </figcaption>
          {hasReferenceGrade && (
            <p className="caption center">
              심폐지구력은 자가측정 기반 참고 등급이에요.
            </p>
          )}
        </>
      )}
    </figure>
  );
}
