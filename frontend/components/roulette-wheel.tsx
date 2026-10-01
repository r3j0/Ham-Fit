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
      const destination = -(resultIndex(result) * 60 + 30);
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
