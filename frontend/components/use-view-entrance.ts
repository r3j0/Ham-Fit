"use client";
import { useLayoutEffect, useRef } from "react";

const excluded = ".sr-only, [hidden], dialog";

export function useViewEntrance() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!root || motion.matches) return;

    const animations: Animation[] = [];
    const observer = new MutationObserver(reveal);
    const cancel = () => {
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
    };
    function reveal() {
      if (!root || root.querySelector(".loading")) return;
      // Observe only the initial data load. Inputs, filters, timers, and later
      // profile refreshes must never restart an entrance or hide new feedback.
      observer.disconnect();
      // Animate only the page's top-level visual regions. The old descendant
      // scan synchronously measured every candidate and started many staggered
      // animations in the same frame as async content rendered, causing the
      // first movement to hitch on dense pages.
      const targets = Array.from(root.children).filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && !element.matches(excluded),
      );
      targets.forEach((element, index) => {
        animations.push(
          element.animate(
            [
              { opacity: 0, transform: "translateY(4px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            {
              id: "view-entrance",
              duration: 220,
              delay: index * 32,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              fill: "backwards",
            },
          ),
        );
      });
    }
    motion.addEventListener("change", cancel);
    observer.observe(root, { childList: true, subtree: true });
    reveal();
    return () => {
      cancel();
      motion.removeEventListener("change", cancel);
    };
  }, []);
  return ref;
}
