"use client";
import { useSelectedLayoutSegment } from "next/navigation";

export default function Layout({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  // The choice screen uses the shared Figma foundations; nested forms keep their theme.
  return (
    <div className={segment ? "kspo-sky-theme" : undefined}>{children}</div>
  );
}
