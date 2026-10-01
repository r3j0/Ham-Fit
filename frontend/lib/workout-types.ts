export interface BirthProfile {
  dateOfBirth: string | null;
  currentAge: number | null;
}
export type WorkoutStatus =
  "assigned" | "in_progress" | "not_performed" | "interrupted" | "completed";
export type WorkoutResult = "not_performed" | "interrupted" | "completed";
export interface PlaybackInterval {
  start: number;
  end: number;
}
export interface PlaybackEvent {
  type: "start" | "progress" | "pause" | "end" | "complete";
  deviceId: string;
  sequence: number;
  intervals: PlaybackInterval[];
  positionSeconds: number;
}
export interface Workout {
  recording?: {
    allowed: boolean;
    serverTime: string;
    expiresAt: string;
    deadline: number;
  };
  routine?: {
    id: string;
    itemId: string;
    order: number;
    totalItems: number;
    prescription: import("./workout-routine.ts").Prescription;
  };
  id: string;
  koreanDate: string;
  serverKoreanDate: string;
  status: WorkoutStatus;
  resultStatus: WorkoutResult | null;
  revision: number;
  assignedAt: string;
  performedAt: string | null;
  completedAt: string | null;
  video: {
    id: string;
    title: string;
    originalUrl: string;
    durationSeconds: number;
    equipment: string[];
    ageGroup: string;
    catalogVersion: string;
    fitnessWeights: Record<string, number>;
    playbackUrl: string | null;
    playbackStatus: "verified" | "unavailable" | "duration_mismatch";
    verifiedDurationSeconds: number | null;
  };
  progress: {
    durationSeconds: number;
    watchedSeconds: number;
    positionSeconds: number;
    intervals: PlaybackInterval[];
    ratio: number;
  };
  algorithmVersion: string;
  inputSnapshot: unknown;
  weightAdjustment: unknown;
}
export interface WorkoutPage {
  items: Workout[];
  nextCursor: string | null;
}
