import { notFound } from "next/navigation";
import { uuid } from "@/lib/api-contract";
import { GroupRoulette } from "@/components/group-roulette";
export const metadata = { title: "그룹 룰렛" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!uuid(id)) notFound();
  return <GroupRoulette key={id} id={id} />;
}
