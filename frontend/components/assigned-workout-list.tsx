"use client";

import Link from "next/link";
import { Check, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Workout } from "@/lib/workout-types";
import { WorkoutPreview } from "./workout-preview";
import styles from "./assigned-workout-list.module.css";

export function AssignedWorkoutList({
  workouts,
}: {
  workouts: readonly Workout[];
}) {
  const list = useRef<HTMLUListElement>(null);
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [requestedPreviews, setRequestedPreviews] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const previewSignature = workouts
    .map(
      ({ id, video }) =>
        `${id}:${video.playbackStatus}:${video.playbackUrl ?? ""}`,
    )
    .join("|");

  useEffect(() => {
    const previews = Array.from(
      list.current?.querySelectorAll<HTMLElement>("[data-preview-id]") ?? [],
    );
    if (!previews.length) return;
    const ratios = new Map(previews.map((preview) => [preview, 0]));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          ratios.set(entry.target as HTMLElement, entry.intersectionRatio);
        let next: HTMLElement | null = null;
        let largest = 0;
        for (const preview of previews) {
          const ratio = ratios.get(preview) ?? 0;
          if (ratio > largest) {
            next = preview;
            largest = ratio;
          }
        }
        const nextId = next?.dataset.previewId ?? null;
        setActivePreview((current) => (current === nextId ? current : nextId));
        if (nextId)
          setRequestedPreviews((current) => {
            if (current.has(nextId)) return current;
            return new Set(current).add(nextId);
          });
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    previews.forEach((preview) => observer.observe(preview));
    return () => observer.disconnect();
  }, [previewSignature]);

  return (
    <ul ref={list} className={styles.list} aria-label="오늘 배정된 운동">
      {workouts.map((workout) => (
        <li key={workout.id} className={styles.item}>
          <div
            className={styles.preview}
            data-preview-id={
              workout.video.playbackStatus === "verified" &&
              workout.video.playbackUrl
                ? workout.id
                : undefined
            }
            aria-hidden="true"
          >
            {workout.video.playbackStatus === "verified" &&
            workout.video.playbackUrl ? (
              <WorkoutPreview
                active={activePreview === workout.id}
                durationSeconds={
                  workout.video.verifiedDurationSeconds ??
                  workout.video.durationSeconds
                }
                playbackUrl={workout.video.playbackUrl}
                requested={requestedPreviews.has(workout.id)}
              />
            ) : (
              <VideoOff size={22} />
            )}
          </div>
          <div className={styles.description}>
            <h3>{workout.video.title}</h3>
            <p className="caption">
              {Math.floor(workout.video.durationSeconds / 60)}분{" "}
              {workout.video.durationSeconds % 60}초
              {workout.video.equipment.length > 0 &&
                ` · ${workout.video.equipment.join(", ")}`}
            </p>
          </div>
          {workout.status === "completed" ? (
            <span className={styles.completed}>
              <Check size={18} aria-hidden="true" />
              완료
            </span>
          ) : (
            <Link
              className={`button secondary ${styles.start}`}
              href={`/workouts/${workout.id}`}
            >
              {workout.status === "assigned"
                ? "운동 시작하기"
                : "운동 이어하기"}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
