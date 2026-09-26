"use client";
import { useEffect, useRef, useState } from "react";
import type { WorkoutSegment } from "@/lib/workout-timing";

export function useWorkoutTicker(
  running: boolean,
  dispatch: (action: { type: "tick" | "interrupt"; now: number }) => void,
) {
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => dispatch({ type: "tick", now: Date.now() }),
      100,
    );
    const interrupt = () => {
      if (document.hidden) dispatch({ type: "interrupt", now: Date.now() });
    };
    const pageHide = () => dispatch({ type: "interrupt", now: Date.now() });
    document.addEventListener("visibilitychange", interrupt);
    window.addEventListener("pagehide", pageHide);
    return () => {
      clearInterval(timer);
      dispatch({ type: "interrupt", now: Date.now() });
      document.removeEventListener("visibilitychange", interrupt);
      window.removeEventListener("pagehide", pageHide);
    };
  }, [running, dispatch]);
}

export function useWorkoutSound(
  state: {
    phase: string;
    index: number;
    segmentIndex: number;
    elapsedMs: number;
  },
  segment?: WorkoutSegment,
) {
  const [sound, setSound] = useState(false);
  const [audioError, setAudioError] = useState("");
  const audio = useRef<AudioContext | null>(null);
  const lastBeat = useRef("");
  const beat =
    state.phase === "countdown"
      ? Math.floor(state.elapsedMs / 1000)
      : segment?.cadence
        ? Math.floor(state.elapsedMs / segment.cadence.intervalMs)
        : 0;
  const cue =
    state.phase === "active" && segment?.cadence
      ? segment.cadence.cues[beat % segment.cadence.cues.length]
      : "";
  useEffect(() => {
    const id = `${state.index}:${state.phase}:${state.segmentIndex}:${beat}`;
    if (lastBeat.current === id) return;
    lastBeat.current = id;
    if (
      !sound ||
      !audio.current ||
      !["countdown", "active", "record"].includes(state.phase)
    )
      return;
    const context = audio.current;
    if (context.state !== "running") return;
    const tone = context.createOscillator(),
      gain = context.createGain();
    tone.frequency.value =
      state.phase === "record" ? 880 : beat % 4 === 0 ? 660 : 440;
    gain.gain.setValueAtTime(0.12, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
    tone.connect(gain).connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.13);
  }, [sound, state.index, state.phase, state.segmentIndex, beat]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  async function toggleSound() {
    if (sound) {
      setSound(false);
      return;
    }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      setSound(true);
      setAudioError("");
    } catch {
      setAudioError("소리를 켤 수 없어요. 화면의 박자 안내를 따라 주세요.");
    }
  }
  return { sound, audioError, toggleSound, cue };
}

export const formatWorkoutTime = (ms: number) =>
  `${Math.floor(Math.ceil(ms / 1000) / 60)}:${String(Math.ceil(ms / 1000) % 60).padStart(2, "0")}`;

export function WorkoutTimer({
  phase,
  remainingMs,
  elapsedMs,
  segment,
}: {
  phase: "countdown" | "active";
  remainingMs: number;
  elapsedMs: number;
  segment: WorkoutSegment;
}) {
  const countdown = phase === "countdown";
  const total = countdown ? 3000 : (segment.durationSeconds ?? 0) * 1000;
  const progress = total ? 1 - remainingMs / total : 1;
  const label = countdown
    ? "시작 카운트다운"
    : segment.durationSeconds === null
      ? "경과 시간"
      : "남은 시간";
  return (
    <div
      className="timer-ring"
      style={
        {
          "--timer-progress": `${Math.round(progress * 100)}%`,
        } as React.CSSProperties
      }
    >
      <div role="timer" aria-label={label}>
        <strong>
          {countdown
            ? Math.ceil(remainingMs / 1000)
            : formatWorkoutTime(
                segment.durationSeconds === null ? elapsedMs : remainingMs,
              )}
        </strong>
        <span>{countdown ? "곧 시작해요" : label}</span>
      </div>
    </div>
  );
}
