import { GroupDetail } from "@/components/group-detail";
import { uuid } from "@/lib/api-contract";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!uuid(id)) notFound();
  return <GroupDetail key={id} id={id} />;
}
