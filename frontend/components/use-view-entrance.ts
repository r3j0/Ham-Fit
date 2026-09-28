"use client";
import { useLayoutEffect, useRef } from "react";

// Animate complete reading/interaction units, never both a unit and its text.
const units = [
  ".page-header",
  ".auth-header",
  ".artwork-slot",
  ".field",
  ".choice-card",
  ".menu-row",
  ".record-card",
  ".record-meta",
  ".result-heading",
  ".value-row",
  ".section-heading",
  ".button-row",
  ".segmented",
  ".stepper",
  ".workout-progress",
  ".workout-clock",
  ".status-badge",
  ".eyebrow",
  ".notice",
  ".auth-footer",
  ".icon-button",
  ".button",
  ".text-link",
  ".text-button",
  "h1",
  "h2",
  "h3",
  "p",
  "details",
].join(",");
const excluded =
  '.sr-only, .loading, [hidden], dialog, [role="alert"], [aria-live]';

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
      const candidates = Array.from(root.querySelectorAll<HTMLElement>(units))
        .filter((element) => !element.closest(excluded))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      const elements = new Set(candidates.map(({ element }) => element));
      const targets = candidates
        .filter(({ element }) => {
          for (
            let parent = element.parentElement;
            parent && parent !== root;
            parent = parent.parentElement
          ) {
            if (elements.has(parent)) return false;
          }
          return true;
        })
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
      // Keep the whole view quick even when it contains a long form/list.
      const interval = Math.min(28, 180 / Math.max(targets.length - 1, 1));
      targets.forEach(({ element }, index) => {
        animations.push(
          element.animate(
            [
              { opacity: 0, transform: "translateY(6px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            {
              id: "view-entrance",
              duration: 240,
              delay: index * interval,
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
