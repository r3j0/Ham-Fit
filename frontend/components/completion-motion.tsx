"use client";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./completion-motion.module.css";

/** One-shot celebration. Navigation waits for the actual animation to finish. */
export function CompletionMotion({
  kind,
  onComplete,
  children,
  className = "",
}: {
  kind: "jump" | "sunflower";
  onComplete: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const completed = useRef(false);
  useEffect(() => {
    const element = ref.current!;
    // Back navigation can restore component state while reconnecting effects.
    if (completed.current) {
      element.style.opacity = "1";
      onComplete();
      return;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let settled = false;
    let animation: Animation | undefined;
    const finish = () => {
      if (disposed || settled) return;
      settled = true;
      completed.current = true;
      element.style.opacity = "1";
      onComplete();
    };
    const reduce = () => {
      if (media.matches) {
        animation?.cancel();
        finish();
      }
    };
    media.addEventListener("change", reduce);
    async function play() {
      if (media.matches) return finish();
      // SVG hamster layers and Next images must be visible before celebrating.
      await Promise.all([
        ...Array.from(element.querySelectorAll("img"), (img) =>
          img.decode().catch(() => {}),
        ),
        ...Array.from(element.querySelectorAll("image"), (layer) => {
          const image = new window.Image();
          image.src = layer.getAttribute("href") ?? "";
          return image.decode().catch(() => {});
        }),
      ]);
      if (disposed || settled) return;
      if (media.matches || !element.animate) return finish();
      animation = element.animate(
        kind === "jump"
          ? [
              { transform: "translateY(0) scale(1)", offset: 0 },
              { transform: "translateY(3px) scale(1.04, .96)", offset: 0.18 },
              { transform: "translateY(-24px) scale(.98, 1.03)", offset: 0.48 },
              { transform: "translateY(2px) scale(1.03, .97)", offset: 0.78 },
              { transform: "translateY(0) scale(1)", offset: 1 },
            ]
          : [
              {
                opacity: 0,
                transform: "translateY(12px) scale(.25) rotate(-18deg)",
                offset: 0,
              },
              {
                opacity: 1,
                transform: "translateY(-4px) scale(1.2) rotate(8deg)",
                offset: 0.6,
              },
              {
                opacity: 1,
                transform: "translateY(0) scale(.94) rotate(-3deg)",
                offset: 0.82,
              },
              {
                opacity: 1,
                transform: "translateY(0) scale(1) rotate(0)",
                offset: 1,
              },
            ],
        {
          duration: kind === "jump" ? 850 : 900,
          delay: 150,
          easing: "ease-in-out",
          fill: "both",
        },
      );
      void animation.finished.then(finish, finish);
    }
    void play();
    return () => {
      disposed = true;
      media.removeEventListener("change", reduce);
      animation?.cancel();
    };
  }, [kind, onComplete]);
  return (
    <span
      ref={ref}
      className={`${styles.motion} ${className}`}
      data-completion-motion={kind}
    >
      {children}
    </span>
  );
}
