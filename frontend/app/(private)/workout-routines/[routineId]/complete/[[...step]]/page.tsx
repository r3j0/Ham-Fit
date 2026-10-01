import { notFound } from "next/navigation";
import { uuid } from "@/lib/api-contract";
import { WorkoutCompletion } from "@/components/workout-completion";
export const metadata = { title: "운동 완료" };
export default async function Page({
  params,
}: {
  params: Promise<{ routineId: string; step?: string[] }>;
}) {
  const { routineId, step } = await params;
  if (
    !uuid(routineId) ||
    (step &&
      (step.length !== 1 || !["streak", "reward", "water"].includes(step[0])))
  )
    notFound();
  return (
    <WorkoutCompletion
      key={`${routineId}:${step?.[0]}`}
      id={routineId}
      step={step?.[0] as "streak" | "reward" | "water" | undefined}
    />
  );
}
