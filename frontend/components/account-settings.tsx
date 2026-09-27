"use client";
import { useEffect, useRef, useState } from "react";
import {
  AccountChangeUncertainError,
  changeAccount,
  resetAccountSession,
} from "@/lib/session";
import { ApiError, errorMessage } from "@/lib/http";
import { Dialog, FieldError, Header, Notice, Shell, SubmitLabel } from "./ui";
import { useOperationScope } from "./use-operation-scope";
import { useUnsaved } from "./use-unsaved";

type Mode = "email" | "password" | "delete";
const titles: Record<Mode, string> = {
  email: "이메일 변경",
  password: "비밀번호 변경",
  delete: "회원 탈퇴",
};
export function AccountSettings() {
  const [mode, setMode] = useState<Mode>("email");
  const [currentPassword, setCurrentPassword] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [canReauthenticate, setCanReauthenticate] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const guard = useRef(false);
  const beginOperation = useOperationScope();
  const savedRef = useUnsaved(
    !!(email || currentPassword || newPassword || confirmation),
  );
  useEffect(() => {
    if (!remaining) return;
    const timer = window.setTimeout(
      () => setRemaining((n) => Math.max(0, n - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [remaining]);
  function select(next: Mode) {
    if (uncertain || mode === next) return;
    setCanReauthenticate(false);
    setMode(next);
    setCurrentPassword("");
    setEmail("");
    setNewPassword("");
    setConfirmation("");
    setError("");
    setFieldError("");
  }
  async function perform() {
    if (guard.current || remaining || uncertain) return;
    guard.current = true;
    setBusy(true);
    setError("");
    const isCurrent = beginOperation();
    try {
      await changeAccount(
        mode === "delete" ? "DELETE" : "PATCH",
        mode === "delete"
          ? { password: currentPassword }
          : {
              currentPassword,
              ...(mode === "email" ? { email: email.trim() } : { newPassword }),
            },
      );
      // RequireSession redirects after the session is cleared, including other tabs.
      savedRef.current = true;
    } catch (e) {
      if (!isCurrent()) return;
      setError(errorMessage(e));
      const outcomeUnknown = e instanceof AccountChangeUncertainError;
      setUncertain(outcomeUnknown);
      setCanReauthenticate(
        outcomeUnknown || (e instanceof ApiError && e.status === 401),
      );
      if (outcomeUnknown) setCurrentPassword("");
      setConfirmDelete(false);
      if (e instanceof ApiError && e.status === 429)
        setRemaining(e.retryAfter ?? 60);
    } finally {
      if (isCurrent()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (guard.current || remaining || uncertain) return;
    setFieldError("");
    if (mode === "password" && newPassword !== confirmation) {
      setFieldError("새 비밀번호가 일치하지 않아요.");
      return;
    }
    if (mode === "delete") setConfirmDelete(true);
    else void perform();
  }
  return (
    <Shell className="settings-shell">
      <Header title="계정 설정" back="/account" />
      <div className="content stack">
        <div className="segmented" role="group" aria-label="설정 항목">
          {(Object.keys(titles) as Mode[]).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              disabled={busy || uncertain}
              onClick={() => select(item)}
            >
              {titles[item]}
            </button>
          ))}
        </div>
        <div className="stack">
          <h2>{titles[mode]}</h2>
          <p className="muted">
            {mode === "delete"
              ? "탈퇴하면 측정 기록과 재화, 운동 이력이 함께 삭제되며 복구할 수 없어요."
              : "변경하면 모든 기기에서 로그아웃돼요. 변경된 정보로 다시 로그인해 주세요."}
          </p>
        </div>
        <form className="stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor="current-password">현재 비밀번호</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              maxLength={128}
              disabled={busy || uncertain}
            />
          </div>
          {mode === "email" && (
            <div className="field">
              <label htmlFor="new-email">새 이메일</label>
              <input
                id="new-email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
                disabled={busy || uncertain}
              />
            </div>
          )}
          {mode === "password" && (
            <>
              <div className="field">
                <label htmlFor="new-password">새 비밀번호</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={15}
                  maxLength={128}
                  disabled={busy || uncertain}
                  aria-describedby="new-password-hint"
                />
                <p id="new-password-hint" className="caption">
                  15~128자 · 공백도 사용할 수 있어요
                </p>
              </div>
              <div className="field">
                <label htmlFor="confirm-password">새 비밀번호 확인</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                  maxLength={128}
                  disabled={busy || uncertain}
                  aria-invalid={!!fieldError}
                  aria-describedby="confirm-error"
                />
                <FieldError id="confirm-error" message={fieldError} />
              </div>
            </>
          )}
          {error && <Notice>{error}</Notice>}
          {canReauthenticate && (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                savedRef.current = true;
                void resetAccountSession();
              }}
            >
              다시 로그인하기
            </button>
          )}
          <button
            className={`button ${mode === "delete" ? "danger" : "primary"}`}
            disabled={busy || remaining > 0 || uncertain}
          >
            <SubmitLabel busy={busy}>
              {remaining
                ? `${remaining}초 후 다시 시도`
                : busy
                  ? "처리 중"
                  : titles[mode]}
            </SubmitLabel>
          </button>
        </form>
      </div>
      {confirmDelete && (
        <Dialog
          title="정말 탈퇴할까요?"
          onClose={() => setConfirmDelete(false)}
          busy={busy}
        >
          <div className="stack">
            <p>
              계정과 모든 개인 기록이 영구 삭제돼요. 이 작업은 되돌릴 수 없어요.
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={busy || uncertain}
                onClick={() => setConfirmDelete(false)}
              >
                취소
              </button>
              <button
                className="button danger"
                disabled={busy || uncertain}
                onClick={() => void perform()}
              >
                {busy ? "탈퇴 처리 중" : "영구 탈퇴하기"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </Shell>
  );
}
