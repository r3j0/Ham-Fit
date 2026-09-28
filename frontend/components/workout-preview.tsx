"use client";

import { useEffect, useRef } from "react";
import { workoutPreviewSegment } from "@/lib/workout-preview";

export function WorkoutPreview({
  active,
  durationSeconds,
  playbackUrl,
  requested,
}: {
  active: boolean;
  durationSeconds: number;
  playbackUrl: string;
  requested: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const segment = useRef(workoutPreviewSegment(durationSeconds));

  useEffect(() => {
    const media = video.current;
    if (!media || !requested) return;
    const mediaElement = media;

    function prepare() {
      const duration = Number.isFinite(mediaElement.duration)
        ? mediaElement.duration
        : durationSeconds;
      segment.current = workoutPreviewSegment(duration);
      const { start, end } = segment.current;
      if (mediaElement.currentTime < start || mediaElement.currentTime >= end)
        mediaElement.currentTime = start;
    }
    function sync() {
      if (!active || document.visibilityState !== "visible") {
        mediaElement.pause();
        if (mediaElement.readyState >= HTMLMediaElement.HAVE_METADATA)
          mediaElement.currentTime = segment.current.start;
        return;
      }
      if (mediaElement.readyState >= HTMLMediaElement.HAVE_METADATA) prepare();
      void mediaElement.play().catch(() => {});
    }

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      mediaElement.pause();
    };
  }, [active, durationSeconds, requested]);

  function playFromMiddle(media: HTMLVideoElement) {
    const duration = Number.isFinite(media.duration)
      ? media.duration
      : durationSeconds;
    segment.current = workoutPreviewSegment(duration);
    media.currentTime = segment.current.start;
  }

  function continuePreview(media: HTMLVideoElement) {
    if (!active || document.visibilityState !== "visible") return;
    void media.play().catch(() => {});
  }

  return (
    <video
      ref={video}
      src={requested ? playbackUrl : undefined}
      muted
      playsInline
      preload={active ? "auto" : "metadata"}
      tabIndex={-1}
      aria-hidden="true"
      onLoadedMetadata={(event) => {
        playFromMiddle(event.currentTarget);
      }}
      onSeeked={(event) => {
        continuePreview(event.currentTarget);
      }}
      onCanPlay={(event) => {
        continuePreview(event.currentTarget);
      }}
      onTimeUpdate={(event) => {
        const media = event.currentTarget;
        if (media.currentTime < segment.current.end) return;
        media.currentTime = segment.current.start;
        continuePreview(media);
      }}
      onEnded={(event) => {
        const media = event.currentTarget;
        media.currentTime = segment.current.start;
        continuePreview(media);
      }}
    />
  );
}
