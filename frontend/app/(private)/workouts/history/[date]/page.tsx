import { notFound } from "next/navigation";
import { WorkoutHistoryDay } from "@/components/workout-history-day";
import { isWorkoutDate } from "@/lib/workout-history";
export const metadata = { title: "운동 기록 상세" };
export default async function Page({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isWorkoutDate(date)) notFound();
  return <WorkoutHistoryDay date={date} />;
}
