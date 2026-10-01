"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleMinus, Plus } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/http";
import { api, getSession } from "@/lib/session";
import { calculateBodyItems, bmiFrom } from "@/lib/assessment";
import {
  measurementDrafts,
  type MeasurementDraft,
} from "@/lib/measurement-drafts";
import { getCatalog, getRecord, koreaDate } from "@/lib/measurements";
import {
  buildInput,
  isRetiredMeasurement,
  emptyMetadata,
  metadataFrom,
  validateMetadata,
  type FormItem,
  type FormMetadata,
} from "@/lib/measurement-form";
import type { Catalog, Measurement, RecordResponse } from "@/lib/types";
import {
  Dialog,
  FieldError,
  Header,
  Loading,
  Notice,
  Shell,
  SubmitLabel,
} from "./ui";
import { StepAssessmentHelp } from "./step-assessment-help";
import { CatalogPicker } from "./catalog-picker";
import { RecordValues } from "./record-values";
import { OnboardingProgress } from "./onboarding-progress";
import { PhotoInputWorkspace } from "./photo-input-workspace";
import photoStyles from "./photo-input-workspace.module.css";
import { ProfileAge, useProfileAge } from "./use-profile-age";
import { useUnsaved } from "./use-unsaved";
import { useOperationScope } from "./use-operation-scope";
export function RecordForm({
  initial,
  initialCatalog,
  onboarding = false,
  requireSex = false,
  reference,
  draftKey = "new",
  seed,
  onDiscard,
}: {
  initial?: RecordResponse;
  initialCatalog?: Catalog;
  onboarding?: boolean;
  requireSex?: boolean;
  reference?: React.ReactNode;
  draftKey?: string;
  onDiscard?: () => void;
  seed?: {
    meta: FormMetadata;
    items: FormItem[];
    catalogVersion: string;
    extractionNotes: string[];
  };
}) {
  const selfAssessment = initial?.data.entryMethod === "self_assessment";
  const selfCodes = [
    "height",
    "weight",
    "bmi",
    "waist_circumference",
    "cross_sit_up",
    "ymca_recovery_heart_rate",
    "sit_and_reach",
  ];
  const router = useRouter();
  const [owner] = useState(() => getSession().user!.id);
  const [sessionGeneration] = useState(() => getSession().generation);
  const draftId = initial?.data.id ?? draftKey;
  const beginOperation = useOperationScope();
  const draftVersion = useRef<symbol | undefined>(undefined);
  useEffect(() => {
    const version = measurementDrafts.acquire(owner, draftId);
    draftVersion.current = version;
    return () => {
      if (version) measurementDrafts.release(owner, draftId, version);
      draftVersion.current = undefined;
    };
  }, [owner, draftId]);
  const persist = useCallback(
    (draft: MeasurementDraft) => {
      if (
        getSession().generation !== sessionGeneration ||
        !draftVersion.current
      )
        return false;
      return measurementDrafts.save(
        owner,
        draftId,
        draft,
        draftVersion.current,
      );
    },
    [owner, draftId, sessionGeneration],
  );
  function removeDraft() {
    return (
      getSession().generation === sessionGeneration &&
      !!draftVersion.current &&
      measurementDrafts.remove(owner, draftId, draftVersion.current)
    );
  }
  const [restored, setRestored] = useState(() =>
    measurementDrafts.read(owner, draftId),
  );
  const [base, setBase] = useState(
      initial && restored?.etag ? { ...initial, etag: restored.etag } : initial,
    ),
    [meta, setMeta] = useState<FormMetadata>(
      restored?.meta ??
        (initial
          ? metadataFrom(initial.data)
          : (seed?.meta ?? { ...emptyMetadata })),
    );
  const sourceItems =
    restored?.items ??
    (initial
      ? initial.data.items.map((i) => ({
          code: i.measurementCode,
          value: i.value,
          grade: i.reportedGrade ?? "",
        }))
      : (seed?.items ?? []));
  // Stored records and uncertain requests retain their original values.
  const excludeRetired = !initial && !restored?.pending && !restored?.uncertain;
  const [removedRetiredItems] = useState(
    () =>
      excludeRetired && sourceItems.some((i) => isRetiredMeasurement(i.code)),
  );
  const [items, setItems] = useState<FormItem[]>(() =>
    excludeRetired
      ? sourceItems.filter((i) => !isRetiredMeasurement(i.code))
      : sourceItems,
  );
  const [catalog, setCatalog] = useState(initialCatalog),
    [step, setStep] = useState(restored?.step ?? (initial ? 2 : 1)),
    [catalogRetry, setCatalogRetry] = useState(0),
    [picker, setPicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(restored?.dirty ?? !!seed);
  const [uncertain, setUncertain] = useState(restored?.uncertain ?? false),
    [gone, setGone] = useState(restored?.gone ?? false),
    [latest, setLatest] = useState<RecordResponse | null>(null),
    [conflict, setConflict] = useState(false);
  const extractionNotes = restored?.extractionNotes ?? seed?.extractionNotes;
  const pending = useRef<{ body: string; key: string } | null>(
      restored?.pending ?? null,
    ),
    saveInFlight = useRef(false),
    guard = useRef(false),
    notice = useRef<HTMLDivElement>(null);
  const savedRef = useUnsaved(dirty || uncertain);
  const snapshot = useCallback(
    (saving = false): MeasurementDraft => ({
      meta,
      items,
      step,
      catalogVersion:
        catalog?.version ?? restored?.catalogVersion ?? seed?.catalogVersion,
      etag: base?.etag,
      pending: pending.current,
      uncertain: uncertain || saving || saveInFlight.current,
      gone,
      dirty: dirty || saving,
      extractionNotes,
    }),
    [
      meta,
      items,
      step,
      catalog,
      restored,
      base,
      uncertain,
      gone,
      dirty,
      seed,
      extractionNotes,
    ],
  );
  useEffect(() => {
    if (!savedRef.current && (dirty || uncertain || saveInFlight.current))
      persist(snapshot());
  }, [snapshot, busy, dirty, uncertain, persist, savedRef]);
  useEffect(() => {
    if (!restored?.catalogVersion || restored.step !== 2 || initialCatalog)
      return;
    const abort = new AbortController();
    getCatalog(restored.catalogVersion, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setCatalog(value);
      })
      .catch((error) => {
        if (!abort.signal.aborted) setMessage(errorMessage(error));
      });
    return () => abort.abort();
  }, [restored, initialCatalog, catalogRetry]);
  const locked = busy || uncertain || gone;
  // Existing records and photo results retain their recorded measurement age.
  const deriveAge = !initial && !seed && draftKey !== "photo";
  const profileAge = useProfileAge(meta.measuredOn);
  const age = profileAge.available ? String(profileAge.age) : "";
  useEffect(() => {
    if (locked || pending.current || !deriveAge) return;
    queueMicrotask(() =>
      setMeta((current) =>
        current.age === age ? current : { ...current, age },
      ),
    );
  }, [age, deriveAge, locked]);
  const validItems = items.filter((i) => i.value !== "");
  function update<K extends keyof FormMetadata>(
    key: K,
    value: FormMetadata[K],
  ) {
    setMeta((m) => ({ ...m, [key]: value }));
    setDirty(true);
  }
  function updateItem(code: string, key: "value" | "grade", value: string) {
    setItems((current) => {
      const next = current.map((i) =>
        i.code === code ? { ...i, [key]: value } : i,
      );
      return selfAssessment ? calculateBodyItems(next) : next;
    });
    setDirty(true);
  }
  function scrollError() {
    setTimeout(() => {
      notice.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      notice.current?.focus();
    }, 0);
  }
  async function advance(event: React.FormEvent) {
    event.preventDefault();
    if (guard.current || (deriveAge && !profileAge.available)) return;
    const next = validateMetadata(meta, koreaDate(), { requireSex });
    if (selfAssessment && Number(meta.age) < 19)
      next.ageAtMeasurement = "성인 간이측정은 만 19~64세를 지원해요.";
    setErrors(next);
    setMessage("");
    if (Object.keys(next).length) {
      setMessage("기본 정보를 확인해 주세요.");
      scrollError();
      return;
    }
    guard.current = true;
    const isCurrent = beginOperation();
    setBusy(true);
    try {
      if (!catalog) {
        const value = await getCatalog(
          base?.data.catalogVersion ??
            restored?.catalogVersion ??
            seed?.catalogVersion,
        );
        if (!isCurrent()) return;
        setCatalog(value);
      }
      setStep(2);
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (!isCurrent()) return;
      setMessage(errorMessage(e));
      scrollError();
    } finally {
      if (isCurrent()) {
        setBusy(false);
        guard.current = false;
      }
    }
  }
  async function readLatest() {
    const isCurrent = beginOperation();
    setBusy(true);
    try {
      const value = await getRecord(base!.data.id);
      if (!isCurrent()) return;
      setLatest(value);
      setConflict(true);
    } catch (e) {
      if (!isCurrent()) return;
      setMessage(errorMessage(e));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (guard.current || savedRef.current || !catalog || gone) return;
    const built = buildInput(
      meta,
      selfAssessment ? calculateBodyItems(items) : items,
      catalog,
      koreaDate(),
      // Reconfirm an already-sent request with its original body and key.
      { requireSex: requireSex && !uncertain },
    );
    if (selfAssessment) {
      const height = items.find((i) => i.code === "height")?.value ?? "";
      const weight = items.find((i) => i.code === "weight")?.value ?? "";
      if (height && weight && !bmiFrom(height, weight))
        built.errors.items =
          "BMI를 계산할 수 없어요. 신장과 체중을 확인해 주세요.";
    }
    if (selfAssessment && Number(meta.age) < 19)
      built.errors.ageAtMeasurement = "성인 간이측정은 만 19~64세를 지원해요.";
    setErrors(built.errors);
    setMessage("");
    if (Object.keys(built.errors).length) {
      if (built.errors.sexAtMeasurement) setStep(1);
      setMessage("입력한 항목을 확인해 주세요.");
      scrollError();
      return;
    }
    const patch = { ...built.input };
    if (base) Reflect.deleteProperty(patch, "catalogVersion");
    const body = JSON.stringify(base ? patch : built.input);
    if (
      !base &&
      (!pending.current || (!uncertain && pending.current.body !== body))
    )
      pending.current = { body, key: crypto.randomUUID() };
    const isCurrent = beginOperation();
    // Persist before awaiting: a 401 can unmount this form during reauthentication.
    if (!persist(snapshot(true))) return;
    guard.current = true;
    saveInFlight.current = true;
    setBusy(true);
    try {
      const result = await api<Measurement>(
        base ? `/measurements/${base.data.id}` : "/measurements",
        {
          method: base ? "PATCH" : "POST",
          body: !base ? pending.current!.body : body,
          headers: base
            ? { "If-Match": base.etag }
            : { "Idempotency-Key": pending.current!.key },
        },
      );
      if (!isCurrent()) return;
      if (!result.data?.id)
        throw new ApiError(
          0,
          "저장 결과를 확인하지 못했어요. 다시 확인해 주세요.",
        );
      if (!removeDraft()) return;
      savedRef.current = true;
      setDirty(false);
      setUncertain(false);
      router.replace(
        onboarding
          ? `/onboarding/complete?record=${encodeURIComponent(result.data.id)}`
          : `/measurements/${result.data.id}?saved=1`,
      );
    } catch (e) {
      if (!isCurrent()) return;
      setMessage(errorMessage(e));
      const resolved =
        e instanceof ApiError &&
        (base ? [404, 412].includes(e.status) : e.status === 410);
      const stillUncertain =
        !resolved &&
        (uncertain ||
          !(e instanceof ApiError) ||
          e.status === 0 ||
          e.status >= 500);
      setUncertain(stillUncertain);
      persist({
        ...snapshot(),
        uncertain: stillUncertain,
      });
      if (e instanceof ApiError) {
        if (!stillUncertain) {
          if (e.status === 410 || (base && e.status === 404)) setGone(true);
          if (e.status === 412 && base) {
            setConflict(true);
            setLatest(null);
            getRecord(base.data.id)
              .then((value) => {
                if (isCurrent()) setLatest(value);
              })
              .catch((error) => {
                if (isCurrent()) setMessage(errorMessage(error));
              });
          }
          const fields: Record<string, string> = {};
          for (const [field, text] of Object.entries(e.fields)) {
            const match = /^items\.(\d+)\.(.+)$/.exec(field);
            if (match) {
              const code = built.input.items[Number(match[1])]?.measurementCode;
              if (code)
                fields[
                  `${match[2] === "reportedGrade" ? "grade" : "item"}.${code}`
                ] = text;
            } else fields[field] = text;
          }
          if (Object.keys(fields).length) {
            setErrors(fields);
            if (
              Object.keys(fields).some((k) =>
                [
                  "measuredOn",
                  "ageAtMeasurement",
                  "sexAtMeasurement",
                  "reportKind",
                  "centerName",
                  "reportedOverallGrade",
                ].includes(k),
              )
            )
              setStep(1);
          }
        }
      }
      scrollError();
    } finally {
      if (isCurrent()) {
        saveInFlight.current = false;
        setBusy(false);
        guard.current = false;
      }
    }
  }
  function useLatest() {
    if (!latest) return;
    if (
      !window.confirm(
        "작성 중인 입력을 최신 기록으로 바꿉니다. 최신 기록으로 다시 편집할까요?",
      )
    )
      return;
    setBase(latest);
    setMeta(metadataFrom(latest.data));
    setItems(
      latest.data.items.map((i) => ({
        code: i.measurementCode,
        value: i.value,
        grade: i.reportedGrade ?? "",
      })),
    );
    setLatest(null);
    setConflict(false);
    setMessage("");
    setErrors({});
    setDirty(false);
    setUncertain(false);
    removeDraft();
    setRestored(undefined);
  }
  function discardDraft() {
    if (
      busy ||
      uncertain ||
      !window.confirm(
        onDiscard
          ? "저장하지 않은 입력을 버리고 사진 선택 화면으로 돌아갈까요?"
          : "작성 중인 임시 입력을 지울까요? 서버에 저장된 기록은 바뀌지 않아요.",
      )
    )
      return;
    if (!removeDraft()) return;
    pending.current = null;
    if (onDiscard) {
      // Do not let the departing form restore the discarded photo draft.
      savedRef.current = true;
      onDiscard();
      return;
    }
    setRestored(undefined);
    setBase(initial);
    setMeta(
      initial
        ? metadataFrom(initial.data)
        : (seed?.meta ?? { ...emptyMetadata }),
    );
    setItems(
      initial
        ? initial.data.items.map((item) => ({
            code: item.measurementCode,
            value: item.value,
            grade: item.reportedGrade ?? "",
          }))
        : [],
    );
    setCatalog(initialCatalog);
    setStep(initial ? 2 : 1);
    setDirty(false);
    setGone(false);
    setMessage("");
    setErrors({});
  }
  function backToMetadata() {
    setStep(1);
    setMessage("");
    window.scrollTo({ top: 0 });
  }
  const textField = (
    id: string,
    label: string,
    key: "center" | "grade",
    max: number,
    field: string,
  ) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={meta[key]}
        maxLength={max}
        onChange={(e) => update(key, e.target.value)}
        aria-invalid={!!errors[field]}
      />
      <FieldError message={errors[field]} />
    </div>
  );
  const sexField = (
    <div className="field">
      <label htmlFor="sex">
        {requireSex
          ? "성별"
          : selfAssessment
            ? "측정 당시 성별"
            : "결과표의 성별"}
      </label>
      <select
        id="sex"
        required={requireSex}
        value={meta.sex}
        onChange={(e) => update("sex", e.target.value)}
        aria-invalid={!!errors.sexAtMeasurement}
        aria-describedby="sex-error"
      >
        <option value="">{requireSex ? "선택해 주세요" : "선택 안 함"}</option>
        <option value="male">남성</option>
        <option value="female">여성</option>
      </select>
      <FieldError id="sex-error" message={errors.sexAtMeasurement} />
    </div>
  );
  if (step === 2 && !catalog)
    return (
      <Shell
        className={`record-form-shell ${onboarding ? "onboarding-shell" : ""} ${reference ? photoStyles.shell : ""}`}
      >
        <Header
          title="입력 복원"
          back="/measurements"
          onBack={onboarding ? backToMetadata : undefined}
          backDisabled={locked}
        />
        {onboarding && <OnboardingProgress step={3} label="측정값 확인" />}
        <RecordFormContent
          reference={reference}
          step={step}
          attention={message}
        >
          {message ? (
            <>
              <Notice>{message}</Notice>
              <button
                className="button secondary"
                onClick={() => {
                  setMessage("");
                  setCatalogRetry((value) => value + 1);
                }}
              >
                다시 불러오기
              </button>
            </>
          ) : (
            <Loading label="작성 중이던 입력을 불러오고 있어요" />
          )}
        </RecordFormContent>
      </Shell>
    );
  return (
    <Shell
      className={`record-form-shell ${onboarding ? "onboarding-shell" : ""} ${reference ? photoStyles.shell : ""}`}
    >
      <Header
        onBack={
          onboarding && step === 2
            ? backToMetadata
            : onDiscard
              ? discardDraft
              : undefined
        }
        backDisabled={locked}
        title={
          base ? "측정 기록 수정" : step === 1 ? "새 측정 기록" : "측정값 입력"
        }
        back={
          base
            ? `/measurements/${base.data.id}`
            : onboarding
              ? "/onboarding"
              : "/measurements"
        }
      />
      {onboarding && (
        <OnboardingProgress
          step={step === 1 ? 2 : 3}
          label={step === 1 ? "기본 정보 입력" : "측정값 확인"}
        />
      )}
      <RecordFormContent reference={reference} step={step} attention={message}>
        {reference && (
          <p className="caption" style={{ marginBottom: 20 }}>
            결과표와 기본 정보·측정값을 비교하고 저장해 주세요.
          </p>
        )}
        {removedRetiredItems && (
          <Notice tone="info">
            성인 윗몸말아올리기는 새 기록에서 지원하지 않아 임시 입력에서
            제외했어요.
          </Notice>
        )}
        {!!extractionNotes?.length && (
          <details className="accordion" open>
            <summary>
              사진에서 확인이 필요한 항목 ({extractionNotes.length})
            </summary>
            <ul>
              {extractionNotes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </details>
        )}
        {!onboarding && (
          <div className="stepper" aria-label={`${step}단계 / 2단계`}>
            <span className={`step ${step === 1 ? "active" : ""}`}>
              <b>1</b>기본 정보
            </span>
            <span className="step-line" />
            <span className={`step ${step === 2 ? "active" : ""}`}>
              <b>2</b>측정값
            </span>
          </div>
        )}
        <div
          ref={notice}
          tabIndex={-1}
          className={message ? "stack-sm" : ""}
          style={message ? { marginBottom: 20 } : undefined}
        >
          {restored && (
            <Notice tone="info">이전에 작성하던 입력을 복원했어요.</Notice>
          )}
          {(restored || gone || onDiscard) && !uncertain && !busy && (
            <button
              type="button"
              className="text-button"
              onClick={discardDraft}
            >
              {onDiscard ? "입력 지우고 다른 사진 선택" : "임시 입력 지우기"}
            </button>
          )}
          {message && <Notice>{message}</Notice>}
          {uncertain && (
            <Notice tone="info">
              저장 결과를 아직 확인하지 못했어요. 중복 등록을 막기 위해 같은
              내용으로 다시 확인해 주세요. 확인 전까지 입력은 잠시 잠겨요.
            </Notice>
          )}
          {gone && (
            <Link className="text-link" href="/measurements">
              기록 목록으로 이동
            </Link>
          )}
        </div>
        {step === 1 ? (
          <form onSubmit={advance} className="metadata-form">
            <div className="intro">
              <h2>언제 측정하셨나요?</h2>
              <p>결과표의 정보를 입력해 주세요.</p>
            </div>
            <fieldset disabled={locked} className="stack">
              <div className="field">
                <label htmlFor="measuredOn">측정일</label>
                <input
                  id="measuredOn"
                  type="date"
                  required
                  value={meta.measuredOn}
                  max={koreaDate()}
                  onChange={(e) => update("measuredOn", e.target.value)}
                  aria-invalid={!!errors.measuredOn}
                  aria-describedby="measuredOn-error"
                />
                <FieldError id="measuredOn-error" message={errors.measuredOn} />
              </div>
              {deriveAge ? (
                <>
                  <ProfileAge profile={profileAge} />
                  <FieldError
                    id="age-error"
                    message={errors.ageAtMeasurement}
                  />
                </>
              ) : (
                <div className="field">
                  <label htmlFor="age">측정 당시 만 나이</label>
                  <div className="input-wrap">
                    <input
                      id="age"
                      inputMode="numeric"
                      pattern="[0-9]{1,2}"
                      maxLength={2}
                      required
                      value={meta.age}
                      onChange={(e) => update("age", e.target.value)}
                      placeholder="예: 25"
                      aria-invalid={!!errors.ageAtMeasurement}
                      aria-describedby="age-hint age-error"
                    />
                    <span className="input-unit">세</span>
                  </div>
                  <p className="caption" id="age-hint">
                    {selfAssessment
                      ? "성인 간이측정은 만 19~64세를 지원해요."
                      : "만 13~64세의 기록을 등록할 수 있어요."}
                  </p>
                  <FieldError
                    id="age-error"
                    message={errors.ageAtMeasurement}
                  />
                </div>
              )}
              {requireSex && sexField}
              <details className="accordion">
                <summary>
                  추가 정보 <span className="optional-label">(선택)</span>
                </summary>
                <p className="caption summary-hint">
                  {selfAssessment
                    ? "측정 당시 성별"
                    : requireSex
                      ? "측정 유형 · 센터 · 결과표 종합등급"
                      : "성별 · 측정 유형 · 센터 · 결과표 종합등급"}
                </p>
                <div className="stack">
                  {!requireSex && sexField}
                  {!selfAssessment && (
                    <>
                      <div className="field">
                        <label htmlFor="kind">측정 유형</label>
                        <select
                          id="kind"
                          value={meta.kind}
                          onChange={(e) =>
                            update(
                              "kind",
                              e.target.value as FormMetadata["kind"],
                            )
                          }
                        >
                          <option value="unknown">모름 / 선택 안 함</option>
                          <option value="standard">일반 체력측정</option>
                          <option value="simple">공식 간편측정</option>
                        </select>
                      </div>
                      {textField(
                        "center",
                        "측정 센터",
                        "center",
                        200,
                        "centerName",
                      )}
                    </>
                  )}
                  {!selfAssessment &&
                    textField(
                      "grade",
                      "결과표 종합등급",
                      "grade",
                      100,
                      "reportedOverallGrade",
                    )}
                  <p className="caption">
                    {selfAssessment
                      ? "측정 당시 성별은 등급 판정에 사용돼요."
                      : "결과표에 적힌 그대로 입력해 주세요. 서비스가 계산한 등급이 아니에요."}
                  </p>
                </div>
              </details>
            </fieldset>
            <div className="sticky-actions">
              <p className="caption center">
                나이에 맞는 검사 항목을 보여드려요.
              </p>
              <button
                className="button primary"
                disabled={locked || (deriveAge && !profileAge.available)}
              >
                <SubmitLabel busy={busy}>
                  {busy ? "검사 항목 확인 중" : "측정값 입력하기"}
                </SubmitLabel>
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={submit}>
            <div className="summary-strip">
              <span>
                {meta.measuredOn.replaceAll("-", ".")} · 만 {meta.age}세
              </span>
              <button
                type="button"
                className="text-button"
                onClick={backToMetadata}
                disabled={locked}
              >
                변경
              </button>
            </div>
            <div className="intro">
              <h2>측정한 항목만 입력해요</h2>
              <p>하나만 입력해도 저장할 수 있어요.</p>
            </div>
            <fieldset disabled={locked} className="stack">
              {!items.length && (
                <Notice tone="info">
                  아래 버튼을 눌러 결과표에 있는 항목을 추가해 주세요.
                </Notice>
              )}
              <div className="form-items">
                {items.map((item) => {
                  const definition = catalog?.definitions.find(
                      (d) => d.code === item.code,
                    ),
                    label = definition?.label ?? item.code;
                  return (
                    <div key={item.code} className="measurement-field">
                      <div className="between">
                        <label htmlFor={`value-${item.code}`}>{label}</label>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`${label} 항목 삭제`}
                          disabled={selfAssessment && item.code === "bmi"}
                          onClick={() => {
                            if (
                              (item.value || item.grade) &&
                              !window.confirm(`${label}의 입력값을 삭제할까요?`)
                            )
                              return;
                            setItems((old) => {
                              const next = old.filter(
                                (i) => i.code !== item.code,
                              );
                              return selfAssessment
                                ? calculateBodyItems(next)
                                : next;
                            });
                            setDirty(true);
                          }}
                        >
                          <CircleMinus size={20} />
                        </button>
                      </div>
                      <div className="input-wrap has-unit">
                        <input
                          className="input"
                          id={`value-${item.code}`}
                          readOnly={selfAssessment && item.code === "bmi"}
                          type="text"
                          inputMode={
                            definition?.minValue === null
                              ? "text"
                              : definition?.valueType === "integer"
                                ? "numeric"
                                : "decimal"
                          }
                          autoComplete="off"
                          maxLength={128}
                          value={item.value}
                          placeholder="측정값 입력"
                          onChange={(e) =>
                            updateItem(item.code, "value", e.target.value)
                          }
                          aria-invalid={!!errors[`item.${item.code}`]}
                          aria-describedby={`error-${item.code}${item.code === "absolute_grip_strength" ? " grip-help" : item.code === "ymca_recovery_heart_rate" ? " step-help" : ""}`}
                        />
                        <span className="input-unit">{definition?.unit}</span>
                      </div>
                      {item.code === "ymca_recovery_heart_rate" && (
                        <div id="step-help" className="stack-sm">
                          <p className="caption">
                            1분 회복 후 10초간 센 맥박에 6을 곱한 분당
                            심박수(bpm)를 입력해 주세요.
                          </p>
                          <StepAssessmentHelp
                            sex={meta.sex}
                            height={
                              items.find((i) => i.code === "height")?.value ??
                              ""
                            }
                            weight={
                              items.find((i) => i.code === "weight")?.value ??
                              ""
                            }
                          />
                          {(
                            [
                              ["height", "신장"],
                              ["weight", "체중"],
                            ] as const
                          )
                            .filter(
                              ([code]) =>
                                !items.some((i) => i.code === code) &&
                                catalog?.definitions.some(
                                  (d) => d.code === code,
                                ),
                            )
                            .map(([code, label]) => (
                              <button
                                key={code}
                                type="button"
                                className="text-link"
                                onClick={() => {
                                  setItems((old) =>
                                    old.some((i) => i.code === code)
                                      ? old
                                      : [
                                          ...old,
                                          { code, value: "", grade: "" },
                                        ],
                                  );
                                  setDirty(true);
                                }}
                              >
                                측정 당시 {label} 추가
                              </button>
                            ))}
                        </div>
                      )}
                      {item.code === "absolute_grip_strength" && (
                        <div id="grip-help" className="stack-sm caption">
                          <p>
                            결과표의 대표 악력을 kg으로 입력해 주세요. 같은 측정
                            기록의 체중으로 상대악력(%)을 환산해 근력 등급에
                            반영해요.
                          </p>
                          {!items.some(
                            (i) => i.code === "weight" && i.value !== "",
                          ) && (
                            <p>
                              체중이 없으면 절대악력만 저장되고 이 항목의 등급은
                              평가할 수 없어요.
                            </p>
                          )}
                          {!items.some((i) => i.code === "weight") &&
                            catalog?.definitions.some(
                              (d) => d.code === "weight",
                            ) && (
                              <button
                                type="button"
                                className="text-link"
                                onClick={() => {
                                  setItems((old) =>
                                    old.some((i) => i.code === "weight")
                                      ? old
                                      : [
                                          ...old,
                                          {
                                            code: "weight",
                                            value: "",
                                            grade: "",
                                          },
                                        ],
                                  );
                                  setDirty(true);
                                }}
                              >
                                측정 당시 체중 추가
                              </button>
                            )}
                        </div>
                      )}
                      <FieldError
                        id={`error-${item.code}`}
                        message={errors[`item.${item.code}`]}
                      />
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => setPicker(true)}
              >
                <Plus size={19} />
                측정 항목 추가
              </button>
              <FieldError message={errors.items} />
              {!selfAssessment && !!items.length && (
                <details className="accordion">
                  <summary>
                    항목별 결과표 등급{" "}
                    <span className="optional-label">(선택)</span>
                  </summary>
                  <div className="stack">
                    {items.map((item) => (
                      <div className="field" key={item.code}>
                        <label htmlFor={`grade-${item.code}`}>
                          {catalog?.definitions.find(
                            (d) => d.code === item.code,
                          )?.label ?? item.code}{" "}
                          등급
                        </label>
                        <input
                          id={`grade-${item.code}`}
                          maxLength={100}
                          value={item.grade}
                          onChange={(e) =>
                            updateItem(item.code, "grade", e.target.value)
                          }
                          placeholder="결과표에 적힌 등급"
                        />
                        <FieldError message={errors[`grade.${item.code}`]} />
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <p className="caption center">
                모르는 값은 비워 두세요. 실제 0은 0으로 입력해요.
              </p>
            </fieldset>
            <div className="sticky-actions">
              <button
                className="button primary"
                disabled={busy || gone || conflict}
              >
                <SubmitLabel busy={busy}>
                  {busy
                    ? "저장 확인 중"
                    : uncertain
                      ? "같은 내용으로 다시 확인"
                      : base
                        ? "수정 내용 저장"
                        : `${validItems.length}개 항목 저장하기`}
                </SubmitLabel>
              </button>
            </div>
          </form>
        )}
        {picker && catalog && (
          <CatalogPicker
            definitions={catalog.definitions.filter(
              (d) =>
                !isRetiredMeasurement(d.code) &&
                Number(meta.age) >= d.minAge &&
                Number(meta.age) <= d.maxAge &&
                (!selfAssessment ||
                  (selfCodes.includes(d.code) &&
                    d.code !== "bmi" &&
                    !(
                      d.code === "cross_sit_up" &&
                      items.some((i) => i.code === "self_curl_up")
                    ))),
            )}
            selected={items.map((i) => i.code)}
            onSelect={(code) => {
              setItems((old) => [...old, { code, value: "", grade: "" }]);
              setDirty(true);
            }}
            onClose={() => setPicker(false)}
          />
        )}
        {conflict && (
          <Dialog
            title="최신 기록을 확인해 주세요"
            onClose={() => setConflict(false)}
          >
            <div className="stack">
              <p className="muted">
                다른 곳에서 기록이 바뀌었어요. 작성한 입력은 유지되어 있어요.
                아래는 서버에 저장된 최신 내용입니다.
              </p>
              {latest && catalog ? (
                <>
                  <p className="caption">
                    {latest.data.measuredOn} · 만 {latest.data.ageAtMeasurement}
                    세 · {latest.data.centerName || "센터 미입력"}
                  </p>
                  <RecordValues record={latest.data} catalog={catalog} />
                  <button className="button primary" onClick={useLatest}>
                    최신 기록으로 다시 편집
                  </button>
                </>
              ) : (
                <button
                  className="button secondary"
                  onClick={() => void readLatest()}
                  disabled={busy}
                >
                  최신 기록 불러오기
                </button>
              )}
              <button
                className="button secondary"
                onClick={() => setConflict(false)}
              >
                내 입력으로 돌아가기
              </button>
              <p className="caption">
                최신 기록으로 다시 편집하면 작성 중인 입력이 바뀝니다. 자동으로
                덮어쓰지 않아요.
              </p>
            </div>
          </Dialog>
        )}
      </RecordFormContent>
    </Shell>
  );
}

function RecordFormContent({
  reference,
  step,
  attention,
  children,
}: {
  reference?: React.ReactNode;
  step: number;
  attention: string;
  children: React.ReactNode;
}) {
  const content = <div className="content">{children}</div>;
  return reference ? (
    <PhotoInputWorkspace photo={reference} step={step} attention={attention}>
      {content}
    </PhotoInputWorkspace>
  ) : (
    content
  );
}
