"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import {
  adultAssessment,
  assessmentInput,
  assessmentSource,
  bmiFrom,
  setupErrors,
  type AssessmentSetup,
} from "@/lib/assessment";
import {
  advanceWorkout,
  initialWorkout,
  type WorkoutAction,
} from "@/lib/workout";
import {
  clearWorkoutProgress,
  readWorkoutProgress,
  saveWorkoutProgress,
  type WorkoutDraft,
} from "@/lib/workout-progress";
import { getCatalog, koreaDate } from "@/lib/measurements";
import { api, getSession } from "@/lib/session";
import { ApiError, errorMessage } from "@/lib/http";
import type { Catalog, Measurement } from "@/lib/types";
import { StepAssessmentHelp } from "./step-assessment-help";
import { WorkoutRunner } from "./workout-runner";
import { MascotPose } from "./mascot/MascotPose";
import { OnboardingProgress } from "./onboarding-progress";
import inputStyles from "./onboarding-inputs.module.css";
import { useOperationScope } from "./use-operation-scope";
import {
  Dialog,
  FieldError,
  Header,
  Loading,
  Notice,
  Shell,
  SubmitLabel,
} from "./ui";

const freshDraft = (): WorkoutDraft => ({
  stage: "setup",
  setup: {
    age: "",
    sex: "",
    measuredOn: koreaDate(),
    height: "",
    weight: "",
    waist: "",
  },
  state: initialWorkout(),
  pending: null,
});
/** Registration adapter: never assigns or completes a user curriculum. */
export function AssessmentWorkout() {
  const router = useRouter();
  const [owner] = useState(() => getSession().user!.id);
  const [generation] = useState(() => getSession().generation);
  const [draft, setDraft] = useState(
    () => readWorkoutProgress(owner) ?? freshDraft(),
  );
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveBlocked, setSaveBlocked] = useState(false);
  const [reset, setReset] = useState(false);
  const [complete, setComplete] = useState<string | null>(null);
  const guard = useRef(false),
    saved = useRef(false);
  const beginOperation = useOperationScope();
  const definition = adultAssessment();
  const locked = busy || !!draft.pending;
  const persist = useCallback(
    (next: WorkoutDraft) =>
      getSession().generation === generation &&
      saveWorkoutProgress(owner, next),
    [generation, owner],
  );
  useEffect(() => {
    if (!saved.current) persist(draft);
  }, [draft, persist]);
  useEffect(() => {
    const abort = new AbortController();
    getCatalog(draft.catalogVersion, abort.signal)
      .then((value) => {
        if (abort.signal.aborted) return;
        if (
          !["cross_sit_up", "ymca_recovery_heart_rate", "sit_and_reach"].every(
            (code) => value.definitions.some((item) => item.code === code),
          )
        ) {
          setLoadError(
            "간이측정 저장 기능이 아직 연결되지 않았어요. 잠시 후 다시 확인해 주세요.",
          );
          return;
        }
        setCatalog(value);
        setLoadError("");
      })
      .catch((error) => {
        if (!abort.signal.aborted) setLoadError(errorMessage(error));
      });
    return () => abort.abort();
  }, [draft.catalogVersion, retry]);
  const dispatch = useCallback(
    (action: WorkoutAction) =>
      setDraft((current) =>
        current.pending
          ? current
          : {
              ...current,
              state: advanceWorkout(adultAssessment(), current.state, action),
            },
      ),
    [],
  );
  function update<K extends keyof AssessmentSetup>(
    key: K,
    value: AssessmentSetup[K],
  ) {
    setErrors({});
    setMessage("");
    setDraft((current) => ({
      ...current,
      setup: { ...current.setup, [key]: value },
    }));
  }
  function start(event: React.FormEvent) {
    event.preventDefault();
    const problems = setupErrors(draft.setup);
    setErrors(problems);
    if (Object.keys(problems).length || !catalog) return;
    const next = {
      ...draft,
      stage: "session" as const,
      catalogVersion: catalog.version,
    };
    persist(next);
    setDraft(next);
    window.scrollTo({ top: 0 });
  }
  async function save() {
    if (
      guard.current ||
      saved.current ||
      saveBlocked ||
      !catalog ||
      draft.state.phase !== "review"
    )
      return;
    let pending = draft.pending;
    if (!pending) {
      const built = assessmentInput(
        draft.setup,
        draft.state,
        catalog,
        koreaDate(),
      );
      setErrors(built.errors);
      if (Object.keys(built.errors).length) {
        setMessage("아래 내용을 확인해 주세요.");
        return;
      }
      pending = { key: crypto.randomUUID(), body: JSON.stringify(built.input) };
    }
    const next = {
      ...draft,
      pending,
      // A new save contains only current tests; the legacy recovery UI is done.
      removedEndurance: draft.pending ? draft.removedEndurance : undefined,
    };
    if (!persist(next)) return;
    setDraft(next);
    guard.current = true;
    setBusy(true);
    setMessage("");
    const isCurrent = beginOperation();
    try {
      const result = await api<Measurement>("/measurements", {
        method: "POST",
        headers: { "Idempotency-Key": pending.key },
        body: pending.body,
      });
      if (!isCurrent()) return;
      if (!result.data?.id)
        throw new ApiError(
          0,
          "저장 결과를 확인하지 못했어요. 같은 내용으로 다시 확인해 주세요.",
        );
      saved.current = true;
      clearWorkoutProgress();
      setComplete(result.data.id);
      router.replace(
        `/onboarding/complete?record=${encodeURIComponent(result.data.id)}`,
      );
    } catch (error) {
      if (!isCurrent()) return;
      setMessage(errorMessage(error));
      if (error instanceof ApiError && [409, 410].includes(error.status))
        setSaveBlocked(true);
      // A lost/invalid response may already have committed: keep the exact key/body.
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 409, 410].includes(error.status)
      ) {
        const editable = { ...next, pending: null };
        persist(editable);
        setDraft(editable);
        setErrors(error.fields);
      }
    } finally {
      if (isCurrent()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  function backToSetup() {
    setDraft((current) => ({
      ...current,
      stage: "setup",
      state: advanceWorkout(definition, current.state, { type: "interrupt" }),
    }));
    setMessage("");
    setErrors({});
    window.scrollTo({ top: 0 });
  }
  function resetSession() {
    clearWorkoutProgress();
    setDraft(freshDraft());
    setErrors({});
    setMessage("");
    setReset(false);
    setSaveBlocked(false);
  }
  const bmi = bmiFrom(draft.setup.height, draft.setup.weight);
  const bodyFields = [
    ["height", "신장", "cm"],
    ["weight", "체중", "kg"],
    ["waist", "허리둘레", "cm"],
  ] as const;
  const setupForm = (
    <>
      <div className="assessment-hero">
        <MascotPose
          pose="situp"
          variant="gray"
          size={128}
          className="assessment-mascot"
        />
        <span className="eyebrow">KNOW YOUR BODY</span>
        <h2>
          지금의 내 몸을
          <br />
          알아가는 시간
        </h2>
        <p>
          만 19~64세 성인 간이측정
          <br />
          신체정보와 세 가지 체력 항목을 기록해요.
        </p>
      </div>
      <form
        className={`stack assessment-setup ${inputStyles.compact}`}
        onSubmit={start}
        noValidate
      >
        <section className="feature-card stack">
          <h3>측정 전 확인</h3>
          <div className="field">
            <label htmlFor="assessment-age">만 나이</label>
            <input
              id="assessment-age"
              inputMode="numeric"
              maxLength={2}
              placeholder="19~64"
              value={draft.setup.age}
              onChange={(e) => update("age", e.target.value)}
              aria-invalid={!!errors.age}
              aria-describedby="assessment-age-error"
            />
            <FieldError id="assessment-age-error" message={errors.age} />
          </div>
          <div className="field">
            <label htmlFor="assessment-sex">
              성별 <span className="optional-label">(선택)</span>
            </label>
            <select
              id="assessment-sex"
              value={draft.setup.sex}
              onChange={(e) =>
                update("sex", e.target.value as AssessmentSetup["sex"])
              }
            >
              <option value="">선택 안 함</option>
              <option value="male">남성</option>
              <option value="female">여성</option>
            </select>
          </div>
        </section>
        <section className="feature-card stack">
          <div>
            <h3>
              신체정보 <span className="optional-label">(선택)</span>
            </h3>
            <p className="caption">측정하지 못한 항목은 비워 두세요.</p>
            <StepAssessmentHelp
              sex={draft.setup.sex}
              height={draft.setup.height}
              weight={draft.setup.weight}
            />
          </div>
          {bodyFields.map(([key, label, unit]) => (
            <div className="field" key={key}>
              <label htmlFor={`assessment-${key}`}>
                {label} ({unit})
              </label>
              <input
                id={`assessment-${key}`}
                inputMode="decimal"
                maxLength={16}
                autoComplete="off"
                value={draft.setup[key]}
                onChange={(e) => update(key, e.target.value)}
                aria-invalid={!!errors[key]}
                aria-describedby={`assessment-${key}-error`}
              />
              <FieldError
                id={`assessment-${key}-error`}
                message={errors[key]}
              />
            </div>
          ))}
          <div className="bmi-preview">
            <span>
              BMI <small>자동 계산</small>
            </span>
            <strong>
              {bmi ?? "—"}
              <small> kg/m²</small>
            </strong>
          </div>
          <p className="caption">
            허리둘레는 편안히 숨을 쉰 뒤 배꼽 높이에서 재요.
          </p>
        </section>
        <section className="stack-sm">
          <h3>근지구력 검사 · 교차 윗몸일으키기</h3>
          <p className="caption">
            60초 동안 올바른 자세로 마친 횟수를 기록해요.
          </p>
        </section>
        <p className="caption">
          매트, 30cm 스텝박스, 줄자를 준비해 주세요. 장비가 없는 항목은 건너뛸
          수 있어요. 측정 중 통증이나 어지러움이 있으면 중단하고 쉬어 주세요.
        </p>
        <button className="button primary">
          {draft.catalogVersion ? "변경 완료" : "측정 준비 완료"}
          <ArrowRight size={18} />
        </button>
      </form>
    </>
  );
  return (
    <Shell
      className={`${inputStyles.assessment} assessment-shell ${["active", "countdown"].includes(draft.state.phase) && draft.stage === "session" && !complete ? "is-running" : ""}`}
    >
      <Header
        title="간이측정"
        back="/onboarding"
        onBack={
          !complete && draft.stage === "session" ? backToSetup : undefined
        }
        backDisabled={locked}
      />
      <OnboardingProgress
        step={!complete && draft.stage === "setup" ? 2 : 3}
        label={
          complete
            ? "체력 기록 완료"
            : draft.stage === "setup"
              ? "기본 정보 입력"
              : draft.state.phase === "review"
                ? "측정 결과 확인"
                : "간이측정 진행"
        }
      />
      <div className="content stack">
        {!complete && draft.removedEndurance && (
          <Notice tone="info">
            {draft.pending
              ? "이전 버전의 윗몸말아올리기 저장 결과를 확인하고 있어요. 중복 저장을 막기 위해 원래 요청으로 확인해 주세요."
              : "윗몸말아올리기 지원이 종료되어 해당 임시 측정값은 제외했어요. 다른 측정값은 유지되며, 근지구력은 교차 윗몸일으키기로 측정할 수 있어요."}
          </Notice>
        )}
        {complete ? (
          <Loading label="저장 결과를 확인하고 있어요" />
        ) : loadError ? (
          <>
            <Notice>{loadError}</Notice>
            <button
              className="button secondary"
              onClick={() => {
                setLoadError("");
                setRetry((value) => value + 1);
              }}
            >
              다시 확인
            </button>
          </>
        ) : !catalog ? (
          <Loading />
        ) : draft.stage === "setup" ? (
          setupForm
        ) : (
          <>
            {draft.removedEndurance && draft.pending ? (
              <h2>이전 측정 저장 확인</h2>
            ) : (
              <WorkoutRunner
                definition={definition}
                state={draft.state}
                dispatch={dispatch}
                disabled={locked}
              />
            )}
            {draft.state.phase === "review" && (
              <>
                <section className="feature-card stack-sm">
                  <div className="between">
                    <h3>신체정보</h3>
                    <button
                      className="text-button"
                      disabled={locked}
                      onClick={backToSetup}
                    >
                      수정
                    </button>
                  </div>
                  <p className="caption">
                    {draft.setup.measuredOn} · 만 {draft.setup.age}세
                  </p>
                  {draft.state.results.cardio !== undefined && (
                    <StepAssessmentHelp
                      sex={draft.setup.sex}
                      height={draft.setup.height}
                      weight={draft.setup.weight}
                    />
                  )}
                  <dl className="value-list">
                    <div className="value-row">
                      <dt>성별</dt>
                      <dd>
                        {draft.setup.sex === "male"
                          ? "남성"
                          : draft.setup.sex === "female"
                            ? "여성"
                            : "미입력"}
                      </dd>
                    </div>
                    {bodyFields.map(([key, label, unit]) => (
                      <div className="value-row" key={key}>
                        <dt>{label}</dt>
                        <dd>
                          {draft.setup[key]
                            ? `${draft.setup[key]} ${unit}`
                            : "미측정"}
                        </dd>
                      </div>
                    ))}
                    <div className="value-row">
                      <dt>BMI</dt>
                      <dd>{bmi ? `${bmi} kg/m²` : "미계산"}</dd>
                    </div>
                  </dl>
                </section>
                {draft.pending && (
                  <Notice tone="info">
                    저장 결과를 확인 중이에요. 확인 전까지 입력은 잠겨요. 연결이
                    끊겼다면 같은 내용으로 다시 확인해 주세요.
                  </Notice>
                )}
                {message && <Notice>{message}</Notice>}
                {saveBlocked && (
                  <div className="stack-sm">
                    <Link className="button secondary" href="/measurements">
                      최근 기록 확인
                    </Link>
                    <button
                      className="text-button"
                      onClick={() => setReset(true)}
                    >
                      이 요청을 닫고 새로 측정
                    </button>
                  </div>
                )}
                {Object.values(errors).map((value, index) => (
                  <FieldError message={value} key={index} />
                ))}
                <button
                  className="button primary"
                  disabled={busy || saveBlocked}
                  onClick={() => void save()}
                >
                  <SubmitLabel busy={busy}>
                    {busy
                      ? "저장 확인 중"
                      : draft.pending
                        ? "같은 내용으로 다시 확인"
                        : "측정 기록 저장"}
                  </SubmitLabel>
                </button>
                <p className="caption center">
                  직접 측정한 값으로 참고 등급을 계산해요. 국민체력100의 공식
                  인증을 부여하는 것은 아니에요.
                </p>
              </>
            )}
            {!["active", "countdown"].includes(draft.state.phase) && (
              <div className="assessment-footer">
                <Link className="text-link" href="/">
                  나중에 이어하기
                </Link>
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={() => setReset(true)}
                >
                  처음부터
                </button>
                <p className="caption">
                  진행 상황은 이 계정·탭에서 24시간 보관돼요.
                </p>
              </div>
            )}
          </>
        )}
        {!complete && (
          <a
            className="caption assessment-source"
            href={assessmentSource}
            target="_blank"
            rel="noopener noreferrer"
          >
            측정 방법 출처 · 국민체력100 간이측정
          </a>
        )}
      </div>
      {reset && (
        <Dialog title="측정을 처음부터 할까요?" onClose={() => setReset(false)}>
          <div className="stack">
            <p>아직 저장하지 않은 측정값과 진행 상황을 지워요.</p>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => setReset(false)}
              >
                취소
              </button>
              <button className="button primary" onClick={resetSession}>
                처음부터 시작
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </Shell>
  );
}
