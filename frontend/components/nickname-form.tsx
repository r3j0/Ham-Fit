"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/session";
import { ApiError, errorMessage } from "@/lib/http";
import {
  nicknameError,
  normalizeNickname,
  parseNicknameProfile,
} from "@/lib/nickname";
import { FieldError, Loading, Notice, SubmitLabel } from "./ui";
import { useOperationScope } from "./use-operation-scope";

export function NicknameForm({
  onDirtyChange,
  onBusyChange,
}: {
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [profile, setProfile] = useState<{ nickname: string | null } | null>(
    null,
  );
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const guard = useRef(false);
  const begin = useOperationScope();
  const dirty =
    !!profile && normalizeNickname(nickname) !== (profile.nickname ?? "");
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (!remaining) return;
    const timer = window.setTimeout(
      () => setRemaining((n) => Math.max(0, n - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [remaining]);
  useEffect(() => {
    const abort = new AbortController();
    const current = begin();
    api<unknown>("/users/me/profile", { signal: abort.signal })
      .then(({ data }) => {
        const saved = parseNicknameProfile(data);
        if (abort.signal.aborted || !current()) return;
        setProfile(saved);
        setNickname(saved.nickname ?? "");
      })
      .catch((e) => {
        if (!abort.signal.aborted && current()) setError(errorMessage(e));
      });
    return () => abort.abort();
  }, [retry, begin]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (guard.current || !dirty || remaining) return;
    const validation = nicknameError(nickname);
    setFieldError(validation);
    if (validation) return;
    const current = begin();
    guard.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api<unknown>("/users/me/profile", {
        method: "PATCH",
        headers: { "X-CSRF-Protection": "1" },
        body: JSON.stringify({ nickname: normalizeNickname(nickname) }),
      });
      const saved = parseNicknameProfile(data);
      if (!current()) return;
      if (saved.nickname !== normalizeNickname(nickname))
        throw new Error(
          "저장된 닉네임을 확인하지 못했어요. 다시 시도해 주세요.",
        );
      setProfile(saved);
      setNickname(saved.nickname ?? "");
      setMessage("닉네임을 저장했어요.");
    } catch (e) {
      if (!current()) return;
      if (
        e instanceof ApiError &&
        (e.code === "INVALID_NICKNAME" || e.fields.nickname)
      )
        setFieldError(e.fields.nickname ?? e.message);
      else setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 429)
        setRemaining(e.retryAfter ?? 60);
    } finally {
      if (current()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="stack-sm" aria-labelledby="nickname-title">
      <h2 id="nickname-title">닉네임 변경</h2>
      {!profile ? (
        error ? (
          <>
            <Notice>{error}</Notice>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setError("");
                setRetry((n) => n + 1);
              }}
            >
              닉네임 다시 불러오기
            </button>
          </>
        ) : (
          <Loading label="닉네임을 불러오는 중이에요" />
        )
      ) : (
        <form className="stack-sm" aria-label="닉네임 변경" onSubmit={submit}>
          <p className="muted">
            내 프로필에 표시할 이름이에요. 변경해도 로그인은 유지돼요.
          </p>
          <div className="field">
            <label htmlFor="profile-nickname">닉네임</label>
            <input
              id="profile-nickname"
              autoComplete="nickname"
              autoCapitalize="none"
              spellCheck={false}
              value={nickname}
              required
              disabled={busy}
              onChange={(e) => {
                setNickname(e.target.value);
                setMessage("");
                setFieldError(undefined);
                setError("");
              }}
              aria-invalid={!!fieldError}
              aria-describedby="nickname-hint nickname-error"
            />
            <p id="nickname-hint" className="caption">
              한글·영문·숫자·밑줄(_) 2~20자
            </p>
            <FieldError id="nickname-error" message={fieldError} />
          </div>
          {error && <Notice>{error}</Notice>}
          {message && <Notice tone="success">{message}</Notice>}
          <button
            className="button primary"
            disabled={busy || !dirty || remaining > 0}
          >
            <SubmitLabel busy={busy}>
              {remaining
                ? `${remaining}초 후 다시 시도`
                : busy
                  ? "저장 중"
                  : "닉네임 저장"}
            </SubmitLabel>
          </button>
        </form>
      )}
    </section>
  );
}
