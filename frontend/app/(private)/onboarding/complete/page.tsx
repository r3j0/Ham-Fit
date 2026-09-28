import { OnboardingComplete } from "@/components/onboarding-complete";

export const metadata = { title: "체력 기록 저장 완료" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ record?: string | string[] }>;
}) {
  const { record } = await searchParams;
  const recordId = typeof record === "string" ? record : undefined;
  return <OnboardingComplete key={recordId} recordId={recordId} />;
}
