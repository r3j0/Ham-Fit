import type { ReactNode } from "react";
export default function Layout({ children }: { children: ReactNode }) {
  return <div className="kspo-orange-theme profile-theme">{children}</div>;
}
