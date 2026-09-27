"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { authDestination } from "@/lib/auth-destination";
import { birthDateError } from "@/lib/birth-profile";
import { koreaDate } from "@/lib/measurements";
import { authenticate } from "@/lib/session";
import { ApiError, errorMessage } from "@/lib/http";
import { Brand, FieldError, Notice, Shell, SubmitLabel } from "./ui";
import { BreathingMascot } from "./mascot/BreathingMascot";
import { useSession } from "./session-provider";
function destination(mode: "login" | "register") {
  if (mode === "register") return "/onboarding";
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return authDestination(next);
}
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const register = mode === "register",
    router = useRouter(),
    session = useSession();
  const [email, setEmail] = useState(""),
    [dateOfBirth, setDateOfBirth] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({}),
    [remaining, setRemaining] = useState(0);
  const guard = useRef(false);
  useEffect(() => {
    if (session.status === "authenticated") router.replace(destination(mode));
  }, [session.status, router, mode]);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(
      () => setRemaining((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [remaining]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current || remaining) return;
    const next: Record<string, string> = {};
    if (!email.trim()) next.email = "이메일을 입력해 주세요.";
    if (!password) next.password = "비밀번호를 입력해 주세요.";
    if (register && (password.length < 15 || password.length > 128))
      next.password = "비밀번호는 15~128자로 입력해 주세요.";
    if (register && password !== confirm)
      next.confirm = "비밀번호가 일치하지 않아요.";
    if (register) {
      const error = birthDateError(dateOfBirth, koreaDate());
      if (error) next.dateOfBirth = error;
    }
    setFields(next);
    setError("");
    if (Object.keys(next).length) return;
    guard.current = true;
    setBusy(true);
    try {
      await authenticate(
        mode,
        email.trim(),
        password,
        register ? dateOfBirth : undefined,
      );
      router.replace(destination(mode));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401)
        setError("이메일 또는 비밀번호를 확인해 주세요.");
      else if (e instanceof ApiError && e.status === 409 && register)
        setError("이미 가입된 이메일이에요. 로그인해 주세요.");
      else if (e instanceof ApiError && e.code === "INVALID_DATE_OF_BIRTH")
        setFields({
          dateOfBirth: "미래가 아닌 실제 생년월일을 입력해 주세요.",
        });
      else setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 429)
        setRemaining(e.retryAfter ?? 60);
    } finally {
      setBusy(false);
      guard.current = false;
    }
  }
  return (
    <Shell className="auth-shell">
      <header className="auth-header">
        <Brand />
      </header>
      <div className="auth-content">
        {!register && (
          <div className="login-mascot">
            <BreathingMascot size={192} label="편안하게 숨 쉬는 햄스터" />
          </div>
        )}
        <div className="intro">
          <h1>{register ? "가볍게 시작해요" : "다시 만나 반가워요"}</h1>
          <p>
            {register
              ? "이메일로 간단하게 가입해요."
              : "내 체력 기록을 이어가세요."}
          </p>
        </div>
        <form onSubmit={submit} className="stack">
          {register && (
            <div className="field">
              <label htmlFor="dateOfBirth">생년월일</label>
              <input
                id="dateOfBirth"
                name="dateOfBirth"
                type="date"
                autoComplete="bday"
                required
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                disabled={busy}
                aria-invalid={!!fields.dateOfBirth}
                aria-describedby="birth-hint birth-error"
              />
              <p id="birth-hint" className="caption">
                맞춤 운동 추천에 사용해요. 운동 추천은 현재 만 13~64세를
                지원해요.
              </p>
              <FieldError id="birth-error" message={fields.dateOfBirth} />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">이메일</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              required
              maxLength={254}
              placeholder="이메일을 입력해 주세요"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              aria-invalid={!!fields.email}
              aria-describedby={fields.email ? "email-error" : undefined}
            />
            <FieldError id="email-error" message={fields.email} />
          </div>
          <div className="field">
            <label htmlFor="password">비밀번호</label>
            <div className="input-wrap">
              <input
                id="password"
                name="password"
                type={visible ? "text" : "password"}
                autoComplete={register ? "new-password" : "current-password"}
                required
                maxLength={128}
                minLength={register ? 15 : undefined}
                placeholder={
                  register
                    ? "15자 이상 입력해 주세요"
                    : "비밀번호를 입력해 주세요"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                aria-invalid={!!fields.password}
                aria-describedby={
                  register ? "password-hint password-error" : "password-error"
                }
              />
              <button
                className="icon-button"
                type="button"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
                aria-pressed={visible}
              >
                {visible ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {register && (
              <p id="password-hint" className="caption">
                15~128자 · 공백도 사용할 수 있어요
              </p>
            )}
            <FieldError id="password-error" message={fields.password} />
          </div>
          {register && (
            <div className="field">
              <label htmlFor="confirm">비밀번호 확인</label>
              <input
                id="confirm"
                name="confirm"
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                required
                maxLength={128}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="비밀번호를 다시 입력해 주세요"
                disabled={busy}
                aria-invalid={!!fields.confirm}
                aria-describedby={fields.confirm ? "confirm-error" : undefined}
              />
              <FieldError id="confirm-error" message={fields.confirm} />
            </div>
          )}
          {error && <Notice>{error}</Notice>}
          <button
            className="button primary"
            disabled={busy || remaining > 0 || session.status === "loading"}
          >
            <SubmitLabel busy={busy}>
              {remaining
                ? `${remaining}초 후 다시 시도`
                : busy
                  ? "확인하고 있어요"
                  : register
                    ? "가입하고 시작하기"
                    : "로그인"}
            </SubmitLabel>
          </button>
        </form>
        <p className="support-copy">
          {register ? "이미 계정이 있나요? " : "처음이신가요? "}
          <Link className="text-link" href={register ? "/login" : "/register"}>
            {register ? "로그인" : "회원가입"}
          </Link>
        </p>
        <footer className="auth-footer caption">
          {register
            ? "가입 후 바로 기록을 등록할 수 있어요."
            : "나만의 속도로, 함께 건강하게"}
        </footer>
      </div>
    </Shell>
  );
}
