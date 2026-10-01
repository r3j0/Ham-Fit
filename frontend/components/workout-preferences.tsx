"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  BicepsFlexed,
  Dumbbell,
  Equal,
  Minus,
  Plus,
  Trophy,
} from "lucide-react";
import {
  buildPreferencesPatch,
  parseExercisePreferences,
  exerciseGoalOptions,
  exerciseVolumeOptions,
  ownedToolOptions,
  normalizeOwnedTools,
  type ExercisePreferences,
  type ExercisePreferencesPatch,
  type StoredExercisePreferences,
} from "@/lib/user-preferences";
import { api } from "@/lib/session";
import { ApiError, errorMessage } from "@/lib/http";
import { FieldError, Header, Loading, Notice, Shell, SubmitLabel } from "./ui";
import { useOperationScope } from "./use-operation-scope";
import { useUnsaved } from "./use-unsaved";
import styles from "./workout-preferences.module.css";

const volumeIcons = { less: Minus, standard: Equal, more: Plus };
const goalIcons = {
  fitness_grade_improvement: Trophy,
  body_composition_management: BicepsFlexed,
  general_fitness_improvement: Dumbbell,
};

export function WorkoutPreferenceFields({
  value,
  onChange,
  disabled = false,
  errors = {},
}: {
  value: ExercisePreferences;
  disabled?: boolean;
  errors?: Record<string, string>;
  onChange: (next: ExercisePreferences) => void;
}) {
  const id = useId();
  return (
    <div className={styles.fields}>
      <fieldset
        className={styles.group}
        disabled={disabled}
        aria-invalid={!!errors.exerciseVolume}
        aria-describedby={`${id}-volume-hint${errors.exerciseVolume ? ` ${id}-volume-error` : ""}`}
      >
        <legend>운동량</legend>
        <p id={`${id}-volume-hint`} className={styles.hint}>
          나에게 맞는 운동량을 선택해 주세요.
        </p>
        <div className={styles.choices}>
          {exerciseVolumeOptions.map((option) => {
            const Icon = volumeIcons[option.value];
            return (
              <label key={option.value} className={styles.choice}>
                <input
                  className="sr-only"
                  type="radio"
                  name={`${id}-exerciseVolume`}
                  value={option.value}
                  checked={value.exerciseVolume === option.value}
                  onChange={() =>
                    onChange({ ...value, exerciseVolume: option.value })
                  }
                />
                <Icon size={22} aria-hidden="true" />
                <span className={styles.label}>{option.label}</span>
              </label>
            );
          })}
        </div>
        <FieldError id={`${id}-volume-error`} message={errors.exerciseVolume} />
      </fieldset>
      <fieldset
        className={styles.group}
        disabled={disabled}
        aria-invalid={!!errors.exerciseGoal}
        aria-describedby={`${id}-goal-hint${errors.exerciseGoal ? ` ${id}-goal-error` : ""}`}
      >
        <legend>운동 목적</legend>
        <p id={`${id}-goal-hint`} className={styles.hint}>
          가장 이루고 싶은 목표를 하나 골라 주세요.
        </p>
        <div className={styles.choices}>
          {exerciseGoalOptions.map((option) => {
            const Icon = goalIcons[option.value];
            return (
              <label
                key={option.value}
                className={`${styles.choice} ${styles.goalChoice}`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name={`${id}-exerciseGoal`}
                  value={option.value}
                  aria-labelledby={`${id}-${option.value}-label`}
                  aria-describedby={`${id}-${option.value}-description`}
                  checked={value.exerciseGoal === option.value}
                  onChange={() =>
                    onChange({ ...value, exerciseGoal: option.value })
                  }
                />
                <Icon size={22} aria-hidden="true" />
                <span className={styles.goalCopy}>
                  <span
                    id={`${id}-${option.value}-label`}
                    className={styles.goalLabel}
                  >
                    {option.label}
                  </span>
                  <span
                    id={`${id}-${option.value}-description`}
                    className={styles.description}
                  >
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <FieldError id={`${id}-goal-error`} message={errors.exerciseGoal} />
      </fieldset>
      <fieldset
        className={styles.group}
        disabled={disabled}
        aria-invalid={!!errors.ownedTools}
        aria-describedby={`${id}-tools-hint${errors.ownedTools ? ` ${id}-tools-error` : ""}`}
      >
        <legend>보유 운동 도구</legend>
        <p id={`${id}-tools-hint`} className={styles.hint}>
          사용할 수 있는 도구를 모두 골라 주세요. 저장한 도구는 이후 새 운동
          추천에 반영돼요.
        </p>
        <div className={`${styles.choices} ${styles.toolChoices}`}>
          {ownedToolOptions.map((option) => (
            <label
              key={option.value}
              className={`${styles.choice} ${styles.toolChoice}`}
            >
              <input
                type="checkbox"
                name={`${id}-ownedTools`}
                value={option.value}
                checked={value.ownedTools.includes(option.value)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    ownedTools: event.target.checked
                      ? normalizeOwnedTools([...value.ownedTools, option.value])
                      : value.ownedTools.filter(
                          (tool) => tool !== option.value,
                        ),
                  })
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
          <label className={`${styles.choice} ${styles.toolChoice}`}>
            <input
              type="checkbox"
              checked={value.ownedTools.length === 0}
              onChange={() => onChange({ ...value, ownedTools: [] })}
            />
            <span>없음</span>
          </label>
        </div>
        <FieldError id={`${id}-tools-error`} message={errors.ownedTools} />
      </fieldset>
    </div>
  );
}

const preferencesPath = "/users/me/preferences";

export function WorkoutPreferences() {
  const [saved, setSaved] = useState<StoredExercisePreferences | null>(null);
  const [draft, setDraft] = useState<ExercisePreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [pendingPatch, setPendingPatch] =
    useState<ExercisePreferencesPatch | null>(null);
  const guard = useRef(false);
  const beginOperation = useOperationScope();
  const patch = saved && draft ? buildPreferencesPatch(saved, draft) : null;
  useUnsaved(!!patch || !!pendingPatch);

  useEffect(() => {
    const abort = new AbortController();
    const isCurrent = beginOperation();
    api<unknown>(preferencesPath, { signal: abort.signal })
      .then(({ data }) => {
        const preferences = parseExercisePreferences(data);
        if (!isCurrent() || abort.signal.aborted) return;
        setSaved(preferences);
        setDraft(preferences);
      })
      .catch((error) => {
        if (isCurrent() && !abort.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (isCurrent() && !abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [beginOperation, loadAttempt]);

  useEffect(() => {
    if (!remaining) return;
    const timer = window.setTimeout(
      () => setRemaining((n) => Math.max(0, n - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [remaining]);

  function change(next: ExercisePreferences) {
    setDraft(next);
    setErrors({});
    setError("");
    setSuccess(false);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const changes = pendingPatch ?? patch;
    if (!changes || guard.current || remaining) return;
    guard.current = true;
    setBusy(true);
    setError("");
    setErrors({});
    setSuccess(false);
    setPendingPatch(changes);
    const isCurrent = beginOperation();
    try {
      const { data } = await api<unknown>(preferencesPath, {
        method: "PATCH",
        headers: { "X-CSRF-Protection": "1" },
        body: JSON.stringify(changes),
      });
      const preferences = parseExercisePreferences(data);
      if (!isCurrent()) return;
      setSaved(preferences);
      setDraft(preferences);
      setPendingPatch(null);
      setSuccess(true);
    } catch (error) {
      if (!isCurrent()) return;
      // PATCH is idempotent. Keep the exact edit when the response is lost so
      // retrying cannot silently undo a write or overwrite untouched fields.
      const uncertain =
        !(error instanceof ApiError) ||
        error.status === 0 ||
        error.status >= 500;
      if (!uncertain) setPendingPatch(null);
      setError(
        uncertain
          ? "저장 결과를 확인하지 못했어요. 선택한 내용으로 다시 저장해 주세요."
          : errorMessage(error),
      );
      if (error instanceof ApiError) {
        setErrors(error.fields);
        if (error.status === 429) setRemaining(error.retryAfter ?? 60);
      }
    } finally {
      if (isCurrent()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <Shell className="preferences-shell">
      <Header title="운동 설정" back="/account" />
      <div className={`content ${styles.content}`}>
        <p className="muted">나의 속도와 목표에 맞춰 운동을 준비해요.</p>
        {loading ? (
          <Loading label="운동 설정을 불러오고 있어요" />
        ) : !draft ? (
          <div className="stack">
            <Notice>{error}</Notice>
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setError("");
                setLoading(true);
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              다시 불러오기
            </button>
          </div>
        ) : (
          <form
            className={styles.content}
            onSubmit={save}
            aria-busy={busy}
            aria-label="운동 설정"
          >
            <WorkoutPreferenceFields
              value={draft}
              onChange={change}
              disabled={busy || !!pendingPatch}
              errors={errors}
            />
            <div className={styles.save}>
              {error && <Notice>{error}</Notice>}
              {success && (
                <Notice tone="success">운동 설정을 저장했어요.</Notice>
              )}
              <button
                className="button primary"
                type="submit"
                disabled={busy || remaining > 0 || (!patch && !pendingPatch)}
              >
                <SubmitLabel busy={busy}>
                  {busy
                    ? "저장 중이에요"
                    : remaining
                      ? `${remaining}초 후 다시 저장`
                      : pendingPatch
                        ? "다시 저장하기"
                        : "저장하기"}
                </SubmitLabel>
              </button>
            </div>
          </form>
        )}
      </div>
    </Shell>
  );
}
