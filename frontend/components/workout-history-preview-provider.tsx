"use client";
import { createContext, useContext, useState } from "react";
import {
  createPreviewHistory,
  localDateKey,
} from "@/lib/workout-history-preview";

type HistoryPreview = {
  today: string;
  completed: ReadonlySet<string>;
  toggleDay: (day: string) => void;
};
const HistoryContext = createContext<HistoryPreview | null>(null);

/** Shared across client navigation, reset on reload or authenticated user change. */
export function WorkoutHistoryPreviewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [today] = useState(() => localDateKey(new Date()));
  const [completed, setCompleted] = useState(() => createPreviewHistory(today));
  function toggleDay(day: string) {
    if (day > today) return;
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }
  return (
    <HistoryContext.Provider value={{ today, completed, toggleDay }}>
      {children}
    </HistoryContext.Provider>
  );
}

export function useWorkoutHistoryPreview() {
  const history = useContext(HistoryContext);
  if (!history)
    throw new Error("Workout history preview requires its provider");
  return history;
}
