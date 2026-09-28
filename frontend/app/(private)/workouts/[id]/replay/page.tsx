import { WorkoutScreen } from "@/components/workout-screen";
export const metadata = { title: "운동 다시보기" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkoutScreen key={id} id={id} replay />;
}
