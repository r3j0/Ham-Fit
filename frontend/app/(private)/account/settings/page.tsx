import {
  AccountSettings,
  type AccountSettingsMode,
} from "@/components/account-settings";
export const metadata = { title: "계정 설정" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  const initialMode: AccountSettingsMode =
    tab === "email" ||
    tab === "birth" ||
    tab === "nickname" ||
    tab === "password" ||
    tab === "delete"
      ? tab
      : "birth";
  return <AccountSettings initialMode={initialMode} />;
}
