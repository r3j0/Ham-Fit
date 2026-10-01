import { WorkoutScreen } from "@/components/workout-screen";
import { routineWorkoutId } from "@/lib/workout-routine";
import { uuid } from "@/lib/api-contract";
import { notFound } from "next/navigation";
export const metadata = { title: "운동 다시보기" };
export default async function Page({
  params,
}: {
  params: Promise<{ routineId: string; itemId: string }>;
}) {
  const { routineId, itemId } = await params;
  if (!uuid(routineId) || !uuid(itemId)) notFound();
  const id = routineWorkoutId(routineId, itemId);
  return <WorkoutScreen key={id} id={id} replay />;
}
