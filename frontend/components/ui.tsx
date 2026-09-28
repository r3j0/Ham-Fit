"use client";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CircleDashed,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useViewEntrance } from "./use-view-entrance";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="햄피트 시작 화면">
      햄피트
      <span className="brand-dot" aria-hidden="true" />
    </Link>
  );
}
/** Replace only the interior of this slot when the illustration asset is approved. */
export function ArtworkSlot({ small = false }: { small?: boolean }) {
  return (
    <div
      className={`artwork-slot ${small ? "small" : ""}`}
      aria-label="캐릭터 이미지 자리"
    >
      <CircleDashed size={small ? 24 : 40} aria-hidden="true" />
      <span>캐릭터</span>
    </div>
  );
}
export function Shell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const entrance = useViewEntrance();
  return (
    <main ref={entrance} id="main" className={`app-shell ${className}`}>
      {children}
    </main>
  );
}
export function Header({
  title,
  back,
  onBack,
  backDisabled = false,
  showBrand = true,
  right,
}: {
  title: string;
  back?: string;
  onBack?: () => void;
  backDisabled?: boolean;
  showBrand?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      {onBack ? (
        <button
          type="button"
          className="icon-button"
          onClick={onBack}
          disabled={backDisabled}
          aria-label="이전 단계"
        >
          <ArrowLeft size={22} />
        </button>
      ) : back ? (
        <Link className="icon-button" href={back} aria-label="이전 화면">
          <ArrowLeft size={22} />
        </Link>
      ) : showBrand ? (
        <Link className="mini-brand" href="/" aria-label="햄피트 메인">
          햄<span>피트</span>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      <h1>{title}</h1>
      <div className="header-right">{right}</div>
    </header>
  );
}
export function Loading({ label = "불러오는 중이에요" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={24} />
      <p>{label}</p>
    </div>
  );
}
export function Notice({
  children,
  tone = "error",
}: {
  children: React.ReactNode;
  tone?: "error" | "info" | "success";
}) {
  return (
    <div
      className={`notice ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function FieldError({ id, message }: { id?: string; message?: string }) {
  return message ? (
    <p id={id} className="field-error" role="alert">
      {message}
    </p>
  ) : null;
}
export function SubmitLabel({
  busy,
  children,
}: {
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {busy ? <LoaderCircle className="spin" size={19} /> : null}
      {children}
      {!busy && <ArrowRight size={18} aria-hidden="true" />}
    </>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  busy = false,
  sheet = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
  sheet?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const dialog = ref.current,
      previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={sheet ? "dialog sheet" : "dialog"}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          disabled={busy}
          aria-label="닫기"
        >
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
