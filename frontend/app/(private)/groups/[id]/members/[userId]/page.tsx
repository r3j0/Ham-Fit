import { GroupMember } from "@/components/group-detail";
import { uuid } from "@/lib/api-contract";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; userId: string }>;
}) {
  const { id, userId } = await params;
  if (!uuid(id) || !uuid(userId)) notFound();
  return <GroupMember key={`${id}:${userId}`} id={id} userId={userId} />;
}
