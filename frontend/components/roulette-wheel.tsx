"use client";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { PersonStanding, Shirt, UsersRound } from "lucide-react";
import { Dialog } from "./ui";
import { SeedIcon } from "./seed-icon";
import styles from "./roulette-wheel.module.css";

export type RoulettePrize = {
  label: string;
  kind: "seeds" | "clothing" | "pose" | "contributors";
  amount?: number;
};

const lastLayouts = new Map<string, string[]>();

/** Shuffle presentation once per visit, independently from server reward odds. */
export function useRouletteLayout(prizes: RoulettePrize[], scope: string) {
  const [layout, setLayout] = useState({ prizes, ready: false });
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const key = `roulette-layout:${scope}`;
      let previous = lastLayouts.get(key);
      try {
        const saved: unknown = JSON.parse(
          sessionStorage.getItem(key) ?? "null",
        );
        if (
          Array.isArray(saved) &&
          saved.every((label) => typeof label === "string")
        )
          previous = saved;
      } catch {
        // A blocked storage API still permits shuffling within this browser tab.
      }
      const shuffled = [...prizes];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      if (
        shuffled.length > 1 &&
        shuffled.every((prize, i) => prize.label === previous?.[i])
      )
        [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
      const labels = shuffled.map((prize) => prize.label);
      lastLayouts.set(key, labels);
      try {
        sessionStorage.setItem(key, JSON.stringify(labels));
      } catch {
        // The in-memory copy remains available when storage is blocked.
      }
      setLayout({ prizes: shuffled, ready: true });
    });
    return () => {
      active = false;
    };
  }, [prizes, scope]);
  return layout;
}
export function RoulettePrizeIcon({ kind, amount }: RoulettePrize) {
  return (
    <span className={styles.prizeIcon} aria-hidden="true">
      {kind === "clothing" ? (
        <Shirt />
      ) : kind === "pose" ? (
        <PersonStanding />
      ) : kind === "contributors" ? (
        <>
          <UsersRound />
          <SeedIcon height={24} />
        </>
      ) : (
        <SeedIcon height={38} />
      )}
      {amount !== undefined && <b>{amount}</b>}
    </span>
  );
}

export function RouletteProbabilities({
  prizes,
  probabilities,
  label,
  description,
}: {
  prizes: RoulettePrize[];
  probabilities: number[];
  label: string;
  description?: string;
}) {
  return (
    <section className={styles.probabilities} aria-label={label}>
      <h2>보상 확률</h2>
      <ul>
        {prizes.map((prize, i) => (
          <li key={prize.label}>
            <RoulettePrizeIcon {...prize} />
            <span>{prize.label}</span>
            <strong>{probabilities[i]}%</strong>
          </li>
        ))}
      </ul>
      {description && <p>{description}</p>}
    </section>
  );
}

/** The server chooses the result; animation only reveals that saved result. */
export function useRouletteMotion() {
  const wheel = useRef<HTMLDivElement>(null),
    animation = useRef<Animation | null>(null),
    rotation = useRef(0),
    active = useRef(true),
    guard = useRef(false);
  const pause = useRef<{
    timer: ReturnType<typeof setTimeout>;
    resolve: () => void;
  } | null>(null);
  const [phase, setPhase] = useState<"idle" | "spinning" | "settling">("idle");
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      animation.current?.cancel();
      if (pause.current) {
        clearTimeout(pause.current.timer);
        pause.current.resolve();
      }
    };
  }, []);
  async function play<T>(
    request: () => Promise<T | undefined>,
    resultIndex: (value: T) => number,
  ): Promise<T | undefined> {
    const element = wheel.current;
    if (!element || guard.current) return;
    guard.current = true;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const started = performance.now();
    setPhase("spinning");
    if (!reduced)
      animation.current = element.animate(
        [
          { transform: `rotate(${rotation.current}deg)` },
          { transform: `rotate(${rotation.current + 360}deg)` },
        ],
        { duration: 90, iterations: Infinity },
      );
    try {
      const result = await request();
      if (!active.current || !result) return;
      if (!reduced) {
        const wait = Math.max(0, 800 - (performance.now() - started));
        await new Promise<void>((resolve) => {
          pause.current = { resolve, timer: setTimeout(resolve, wait) };
        });
        pause.current = null;
      }
      if (!active.current) return;
      const transform = getComputedStyle(element).transform;
      const matrix =
        transform === "none"
          ? new DOMMatrixReadOnly()
          : new DOMMatrixReadOnly(transform);
      const angle = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
      // Keep a small margin so the pointer clearly belongs to the winning sector.
      const destination = -(resultIndex(result) * 60 + 6 + Math.random() * 48);
      const delta = (((destination - angle) % 360) + 360) % 360;
      const end = angle + 2160 + delta;
      animation.current?.cancel();
      setPhase("settling");
      if (!reduced) {
        animation.current = element.animate(
          [
            { transform: `rotate(${angle}deg)` },
            { transform: `rotate(${end}deg)` },
          ],
          {
            duration: 3600,
            easing: "cubic-bezier(0.1, 0.65, 0.13, 1)",
            fill: "forwards",
          },
        );
        await animation.current.finished;
      }
      if (!active.current) return;
      rotation.current = ((destination % 360) + 360) % 360;
      element.style.transform = `rotate(${rotation.current}deg)`;
      return result;
    } catch (error) {
      if (active.current) throw error;
    } finally {
      animation.current?.cancel();
      animation.current = null;
      guard.current = false;
      if (active.current) setPhase("idle");
    }
  }
  const attachWheel = useCallback((element: HTMLDivElement | null) => {
    wheel.current = element;
  }, []);
  return { attachWheel, phase, busy: phase !== "idle", play };
}

export function RouletteWheel({
  prizes,
  phase,
  attachWheel,
}: {
  prizes: RoulettePrize[];
  phase: "idle" | "spinning" | "settling";
  attachWheel: (element: HTMLDivElement | null) => void;
}) {
  return (
    <div
      className={styles.stage}
      data-phase={phase}
      role="img"
      aria-label={`룰렛: ${prizes.map((prize) => prize.label).join(", ")}`}
      aria-busy={phase !== "idle"}
    >
      <span className={styles.pointer} aria-hidden="true" />
      <div ref={attachWheel} className={styles.wheel} aria-hidden="true">
        {prizes.map((prize, index) => (
          <span
            key={prize.label}
            data-prize={prize.label}
            className={styles.sector}
            style={
              { "--sector-angle": `${index * 60 + 30}deg` } as CSSProperties
            }
          >
            <RoulettePrizeIcon {...prize} />
          </span>
        ))}
      </div>
      <span className={styles.hub} aria-hidden="true">
        <SeedIcon height={34} />
      </span>
    </div>
  );
}

export function useRouletteReward(remaining: number | undefined) {
  const router = useRouter();
  const [visible, setVisible] = useState(false),
    [dismissed, setDismissed] = useState(false);
  const dismiss = useCallback(() => {
    setVisible(false);
    setDismissed(true);
  }, []);
  useEffect(() => {
    if (dismissed && remaining === 0) router.replace("/");
  }, [dismissed, remaining, router]);
  return {
    visible,
    dismiss,
    show: () => {
      setDismissed(false);
      setVisible(true);
    },
  };
}

export function RouletteRewardPopup({
  prize,
  title,
  description,
  onClose,
}: {
  prize: RoulettePrize;
  title: string;
  description?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <Dialog title="선물이 도착했어요!" onClose={onClose}>
      <div className={styles.reward} role="status">
        <RoulettePrizeIcon {...prize} />
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        <button className="button primary" onClick={onClose}>
          확인
        </button>
      </div>
    </Dialog>
  );
}
