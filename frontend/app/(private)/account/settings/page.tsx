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
    tab === "birth" ||
    tab === "nickname" ||
    tab === "password" ||
    tab === "delete"
      ? tab
      : "email";
  return <AccountSettings initialMode={initialMode} />;
}
