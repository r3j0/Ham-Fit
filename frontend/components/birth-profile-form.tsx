"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "@/lib/http";
import { birthDateError } from "@/lib/birth-profile";
import { koreaDate } from "@/lib/measurements";
import { getBirthProfile, saveBirthProfile } from "@/lib/workouts";
import type { BirthProfile } from "@/lib/workout-types";
import { FieldError, Loading, Notice } from "./ui";
import { useOperationScope } from "./use-operation-scope";
import { useUnsaved } from "./use-unsaved";

export function BirthProfileForm() {
  const [profile, setProfile] = useState<BirthProfile | null>(null);
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const begin = useOperationScope();
  const dirty = !!profile && date !== (profile.dateOfBirth ?? "");
  useUnsaved(dirty);
  useEffect(() => {
    const controller = new AbortController();
    getBirthProfile(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setProfile(data);
        setDate(data.dateOfBirth ?? "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [retry]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (guard.current) return;
    const validation = birthDateError(date, koreaDate());
    setFieldError(validation);
    if (validation) return;
    const current = begin();
    guard.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await saveBirthProfile(date);
      if (!current()) return;
      setProfile(saved);
      setDate(saved.dateOfBirth ?? "");
      setMessage("생년월일을 저장했어요.");
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && e.code === "INVALID_DATE_OF_BIRTH")
        setFieldError("미래가 아닌 실제 생년월일을 입력해 주세요.");
      else setError(errorMessage(e));
    } finally {
      if (current()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="stack-sm" aria-labelledby="birth-profile-title">
      <h2 id="birth-profile-title">생년월일</h2>
      {!profile ? (
        error ? (
          <>
            <Notice>{error}</Notice>
            <button
              className="button secondary"
              onClick={() => {
                setError("");
                setRetry((n) => n + 1);
              }}
            >
              생년월일 다시 불러오기
            </button>
          </>
        ) : (
          <Loading label="생년월일을 불러오는 중이에요" />
        )
      ) : (
        <form className="stack-sm" onSubmit={submit}>
          <p className="muted">
            맞춤 운동 추천에 사용해요. 저장한 측정 당시 나이와 이미 받은 운동은
            바뀌지 않아요.
          </p>
          <div className="field">
            <label htmlFor="profile-birth">생년월일 입력</label>
            <input
              id="profile-birth"
              type="date"
              autoComplete="bday"
              required
              disabled={busy}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setMessage("");
              }}
              aria-invalid={!!fieldError}
              aria-describedby="profile-birth-error"
            />
            <FieldError id="profile-birth-error" message={fieldError} />
          </div>
          {profile.currentAge !== null && (
            <p className="caption">
              현재 만 {profile.currentAge}세 · 한국 날짜 기준
            </p>
          )}
          {profile.currentAge !== null &&
            (profile.currentAge < 13 || profile.currentAge > 64) && (
              <Notice tone="info">
                운동 추천은 현재 만 13~64세를 지원해요. 측정 기록은 계속 확인할
                수 있어요.
              </Notice>
            )}
          {error && <Notice>{error}</Notice>}
          {message && <Notice tone="success">{message}</Notice>}
          <button className="button secondary" disabled={busy || !dirty}>
            {busy ? "저장 중" : "생년월일 저장"}
          </button>
        </form>
      )}
    </section>
  );
}
