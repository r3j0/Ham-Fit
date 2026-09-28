"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  PanelRightOpen,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import styles from "./photo-input-workspace.module.css";
import inputStyles from "./onboarding-inputs.module.css";

export function PhotoInputWorkspace({
  photo,
  step,
  attention,
  children,
}: {
  photo: React.ReactNode;
  step: number;
  attention: string;
  children: React.ReactNode;
}) {
  const [zoom, setZoom] = useState(100);
  const [panel, setPanel] = useState<{
    step: number;
    attention: string;
    mode: "open" | "collapsed" | "closed";
  }>({ step, attention, mode: "open" });
  // A new step or save error must be visible even if the user hid the inputs.
  if (panel.step !== step || panel.attention !== attention)
    setPanel({ step, attention, mode: "open" });
  const { mode } = panel;
  const setMode = (mode: typeof panel.mode) =>
    setPanel({ step, attention, mode });
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode === "open") {
      if (content.current) content.current.scrollTop = 0;
      title.current?.focus({ preventScroll: true });
    } else if (mode === "closed")
      trigger.current?.focus({ preventScroll: true });
  }, [mode, step, attention]);
  return (
    <div className={styles.workspace}>
      <section className={styles.canvas} aria-label="결과표 사진" tabIndex={0}>
        <div className={styles.photo} style={{ width: `${zoom}%` }}>
          {photo}
        </div>
      </section>
      <div className={styles.zoom} role="group" aria-label="사진 확대 비율">
        <button
          type="button"
          className="icon-button"
          aria-label="사진 축소"
          disabled={zoom === 100}
          onClick={() => setZoom((value) => Math.max(100, value - 50))}
        >
          <ZoomOut size={20} />
        </button>
        <button
          type="button"
          className={styles.fit}
          onClick={() => setZoom(100)}
          aria-label="사진 크기 맞춤"
        >
          {zoom}%
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="사진 확대"
          disabled={zoom === 250}
          onClick={() => setZoom((value) => Math.min(250, value + 50))}
        >
          <ZoomIn size={20} />
        </button>
      </div>
      <button
        ref={trigger}
        type="button"
        className={styles.open}
        hidden={mode !== "closed"}
        aria-label="입력 패널 열기"
        aria-expanded={mode !== "closed"}
        aria-controls={id}
        onClick={() => setMode("open")}
      >
        <PanelRightOpen size={22} />
        <span>입력</span>
      </button>
      <aside
        className={`${styles.panel} ${mode === "collapsed" ? styles.collapsed : ""}`}
        hidden={mode === "closed"}
        aria-labelledby={`${id}-title`}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            !event.defaultPrevented &&
            !(event.target as HTMLElement).closest("dialog")
          ) {
            event.preventDefault();
            event.stopPropagation();
            setMode("closed");
          }
        }}
      >
        <div className={styles.toolbar}>
          <h2 ref={title} id={`${id}-title`} tabIndex={-1}>
            {step === 1 ? "기본 정보 입력" : "측정값 입력"}
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label={
              mode === "collapsed" ? "입력 패널 펼치기" : "입력 패널 접기"
            }
            aria-expanded={mode === "open"}
            aria-controls={id}
            onClick={() => setMode(mode === "collapsed" ? "open" : "collapsed")}
          >
            {mode === "collapsed" ? (
              <ChevronDown size={20} />
            ) : (
              <ChevronUp size={20} />
            )}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="입력 패널 닫기"
            onClick={() => setMode("closed")}
          >
            <X size={20} />
          </button>
        </div>
        <div
          ref={content}
          id={id}
          className={`${styles.panelContent} ${inputStyles.compact}`}
          hidden={mode !== "open"}
        >
          {children}
        </div>
      </aside>
    </div>
  );
}
