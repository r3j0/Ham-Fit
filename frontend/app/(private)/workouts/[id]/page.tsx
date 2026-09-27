import { WorkoutScreen } from "@/components/workout-screen";
export const metadata = { title: "나의 운동" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkoutScreen key={id} id={id} />;
}
