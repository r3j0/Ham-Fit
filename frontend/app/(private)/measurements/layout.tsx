import type { ReactNode } from "react";

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return <div className="kspo-orange-theme profile-theme">{children}</div>;
}
