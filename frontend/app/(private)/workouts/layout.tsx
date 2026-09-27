import type { ReactNode } from "react";

export default function WorkoutLayout({ children }: { children: ReactNode }) {
  return <div className="kspo-sky-theme workout-theme">{children}</div>;
}
