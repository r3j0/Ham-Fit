import { RecordForm } from "@/components/record-form";
export const metadata = { title: "체력 기록 직접 입력" };
export default function Page() {
  return <RecordForm onboarding requireSex />;
}
