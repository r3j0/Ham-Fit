import type { Prescription } from "@/lib/workout-routine";

/** Saved prescriptions are presentation data, never a client-side calculation. */
export function RoutinePrescription({
  prescription,
  className = "caption",
  compact = false,
}: {
  prescription: Prescription;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className="stack-sm" role="group" aria-label="저장된 운동 처방">
      <p className={className}>{prescription.text}</p>
      {!compact && (
        <p className={className}>
          {prescription.value}
          {prescription.unit} × {prescription.sets}세트 · 휴식{" "}
          {prescription.restSec}초
        </p>
      )}
    </div>
  );
}
