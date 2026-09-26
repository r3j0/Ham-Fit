"use client";
import { useEffect, useRef } from "react";
export function useUnsaved(
  active: boolean,
  message = "저장하지 않은 입력이 있어요. 이 화면을 나갈까요?",
) {
  const saved = useRef(false);
  useEffect(() => {
    if (!active) return;
    const before = (event: BeforeUnloadEvent) => {
      if (!saved.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      const target =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (
        saved.current ||
        !target ||
        target.target === "_blank" ||
        target.href === location.href ||
        !target.getAttribute("href") ||
        target.getAttribute("href")?.startsWith("#")
      )
        return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", before);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("click", click, true);
    };
  }, [active, message]);
  return saved;
}
