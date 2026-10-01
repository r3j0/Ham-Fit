"use client";
import Link from "next/link";
import { MemberMascot } from "./member-mascot";
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
import { BirthProfileForm } from "./birth-profile-form";
import { NicknameForm } from "./nickname-form";
import styles from "./account-settings.module.css";

export type AccountSettingsMode =
  "email" | "password" | "delete" | "birth" | "nickname";
type Mode = AccountSettingsMode;
type CredentialMode = "email" | "password" | "delete";
const credentialModes: CredentialMode[] = ["email", "password", "delete"];
const titles: Record<Mode, string> = {
  email: "이메일 변경",
  password: "비밀번호 변경",
  birth: "생년월일",
  nickname: "닉네임 변경",
  delete: "회원 탈퇴",
};
export function AccountSettings({
  initialMode = "birth",
}: {
  initialMode?: Mode;
}) {
  const [birthDirty, setBirthDirty] = useState(false);
  const [nicknameDirty, setNicknameDirty] = useState(false);
  const [birthBusy, setBirthBusy] = useState(false);
  const [nicknameBusy, setNicknameBusy] = useState(false);
  const [mode, setMode] = useState<CredentialMode>("email");
  const [passwords, setPasswords] = useState({
    email: "",
    password: "",
    delete: "",
  });
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [leadershipRequired, setLeadershipRequired] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [canReauthenticate, setCanReauthenticate] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const guard = useRef(false);
  const beginOperation = useOperationScope();
  const savedRef = useUnsaved(
    birthDirty ||
      nicknameDirty ||
      !!(
        email ||
        Object.values(passwords).some(Boolean) ||
        newPassword ||
        confirmation
      ),
  );
  useEffect(() => {
    if (!remaining) return;
    const timer = window.setTimeout(
      () => setRemaining((n) => Math.max(0, n - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [remaining]);
  // Preserve bookmarked section links without a tab interface.
  useEffect(() => {
    if (!new URL(window.location.href).searchParams.has("tab")) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(`settings-${initialMode}`)?.scrollIntoView(),
    );
    return () => cancelAnimationFrame(frame);
  }, [initialMode]);
  const locked = busy || birthBusy || nicknameBusy || uncertain;
  async function perform(action: CredentialMode) {
    if (guard.current || locked || remaining) return;
    setMode(action);
    const currentPassword = passwords[action];
    guard.current = true;
    setBusy(true);
    setError("");
    setLeadershipRequired(false);
    const isCurrent = beginOperation();
    try {
      await changeAccount(
        action === "delete" ? "DELETE" : "PATCH",
        action === "delete"
          ? { password: currentPassword }
          : {
              currentPassword,
              ...(action === "email"
                ? { email: email.trim() }
                : { newPassword }),
            },
      );
      // RequireSession redirects after the session is cleared, including other tabs.
      savedRef.current = true;
    } catch (e) {
      if (!isCurrent()) return;
      setError(errorMessage(e));
      setLeadershipRequired(
        e instanceof ApiError && e.code === "GROUP_LEADERSHIP_REQUIRED",
      );
      const outcomeUnknown = e instanceof AccountChangeUncertainError;
      setUncertain(outcomeUnknown);
      setCanReauthenticate(
        outcomeUnknown || (e instanceof ApiError && e.status === 401),
      );
      if (outcomeUnknown) setPasswords({ email: "", password: "", delete: "" });
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
  function submit(event: React.FormEvent, action: CredentialMode) {
    event.preventDefault();
    if (guard.current || locked || remaining) return;
    setMode(action);
    setError("");
    setLeadershipRequired(false);
    setCanReauthenticate(false);
    setFieldError("");
    if (action === "password" && newPassword !== confirmation) {
      setFieldError("새 비밀번호가 일치하지 않아요.");
      return;
    }
    if (action === "delete") setConfirmDelete(true);
    else void perform(action);
  }
  return (
    <Shell className="settings-shell">
      <Header title="계정 설정" back="/account" />
      <div className={`content stack ${styles.sections}`}>
        <fieldset
          id="settings-birth"
          className={styles.section}
          disabled={locked}
        >
          <BirthProfileForm
            onDirtyChange={setBirthDirty}
            onBusyChange={setBirthBusy}
          />
        </fieldset>
        <fieldset
          id="settings-nickname"
          className={styles.section}
          disabled={locked}
        >
          <NicknameForm
            onDirtyChange={setNicknameDirty}
            onBusyChange={setNicknameBusy}
          />
        </fieldset>
        {credentialModes.map((action) => (
          <section
            id={`settings-${action}`}
            key={action}
            className={styles.section}
          >
            <div className="stack">
              <div className="stack">
                <h2>{titles[action]}</h2>
                <p className="muted">
                  {action === "delete"
                    ? "탈퇴하면 측정 기록과 재화, 운동 이력이 함께 삭제되며 복구할 수 없어요."
                    : "변경하면 모든 기기에서 로그아웃돼요. 변경된 정보로 다시 로그인해 주세요."}
                </p>
              </div>
              <form
                className="stack"
                aria-label={titles[action]}
                onSubmit={(event) => submit(event, action)}
              >
                <div className="field">
                  <label htmlFor={`current-password-${action}`}>
                    현재 비밀번호
                  </label>
                  <input
                    id={`current-password-${action}`}
                    type="password"
                    autoComplete="current-password"
                    value={passwords[action]}
                    onChange={(e) =>
                      setPasswords((previous) => ({
                        ...previous,
                        [action]: e.target.value,
                      }))
                    }
                    required
                    maxLength={128}
                    disabled={locked}
                  />
                </div>
                {action === "email" && (
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
                      disabled={locked}
                    />
                  </div>
                )}
                {action === "password" && (
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
                        minLength={8}
                        maxLength={128}
                        disabled={locked}
                        aria-describedby="new-password-hint"
                      />
                      <p id="new-password-hint" className="caption">
                        8~128자 · 공백도 사용할 수 있어요
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
                        disabled={locked}
                        aria-invalid={action === mode && !!fieldError}
                        aria-describedby="confirm-error"
                      />
                      <FieldError
                        id="confirm-error"
                        message={action === mode ? fieldError : ""}
                      />
                    </div>
                  </>
                )}
                {action === mode && error && (
                  <Notice>
                    {error}
                    {leadershipRequired && (
                      <Link className="text-link" href="/groups">
                        내 그룹 관리하기
                      </Link>
                    )}
                  </Notice>
                )}
                {action === mode && canReauthenticate && (
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
                  className={`button ${action === "delete" ? "danger" : "primary"}`}
                  disabled={locked || remaining > 0}
                >
                  <SubmitLabel busy={busy && action === mode}>
                    {remaining
                      ? `${remaining}초 후 다시 시도`
                      : busy && action === mode
                        ? "처리 중"
                        : titles[action]}
                  </SubmitLabel>
                </button>
              </form>
            </div>
          </section>
        ))}
      </div>
      {confirmDelete && (
        <Dialog
          title="정말 탈퇴할까요?"
          onClose={() => setConfirmDelete(false)}
          busy={busy}
        >
          <div className="stack">
            <MemberMascot
              pose="cant-hear"
              size={112}
              className="delete-account-mascot"
            />
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
                onClick={() => void perform("delete")}
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
