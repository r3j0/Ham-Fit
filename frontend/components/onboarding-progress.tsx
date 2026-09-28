import styles from "./onboarding-progress.module.css";

export function OnboardingProgress({
  step,
  label,
}: {
  step: 1 | 2 | 3;
  label: string;
}) {
  return (
    <div className={`content ${styles.progress}`}>
      <div className={styles.label} aria-hidden="true">
        <span>{step} / 3</span>
        <span>{label}</span>
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label="체력 기록 진행 단계"
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={step}
        aria-valuetext={`3단계 중 ${step}단계, ${label}`}
      >
        <div
          className={styles.fill}
          style={{ width: `${(step / 3) * 100}%` }}
        />
      </div>
    </div>
  );
}
