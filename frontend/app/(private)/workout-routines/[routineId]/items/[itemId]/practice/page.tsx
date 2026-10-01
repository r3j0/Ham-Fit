import { notFound } from "next/navigation";
import { uuid } from "@/lib/api-contract";
import { WorkoutPractice } from "@/components/workout-practice";
export const metadata = { title: "처방 따라 하기" };
export default async function Page({
  params,
}: {
  params: Promise<{ routineId: string; itemId: string }>;
}) {
  const { routineId, itemId } = await params;
  if (!uuid(routineId) || !uuid(itemId)) notFound();
  return (
    <WorkoutPractice
      key={`${routineId}:${itemId}`}
      routineId={routineId}
      itemId={itemId}
    />
  );
}
