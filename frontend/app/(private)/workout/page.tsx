import { AssessmentWorkout } from "@/components/assessment-workout";
import { WorkoutOverview } from "@/components/workout-overview";
import { resolveWorkoutMode } from "@/lib/workout-mode";
export const metadata = { title: "운동" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string | string[];
    curriculum?: string | string[];
  }>;
}) {
  const { mode, curriculum } = await searchParams;
  const selected = resolveWorkoutMode(mode, curriculum);
  return selected === "assessment" ? (
    <AssessmentWorkout />
  ) : (
    <WorkoutOverview unsupported={selected === "unsupported"} />
  );
}
