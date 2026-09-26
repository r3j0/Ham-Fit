"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, UserRound, Dumbbell } from "lucide-react";

export function BottomNavigation() {
  const pathname = usePathname();
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/"))
    return null;
  const theme =
    pathname === "/account" || pathname === "/account/preferences"
      ? " kspo-orange-theme"
      : "";
  const tabs = [
    { href: "/", label: "메인", icon: House, active: pathname === "/" },
    {
      href: "/workout",
      label: "운동",
      icon: Dumbbell,
      active: pathname === "/workout",
    },
    {
      href: "/account",
      label: "내 프로필",
      icon: UserRound,
      active:
        pathname === "/account" ||
        pathname.startsWith("/account/") ||
        pathname.startsWith("/measurements"),
    },
  ];

  return (
    <nav className={`bottom-navigation${theme}`} aria-label="하단 메뉴">
      {tabs.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          className="bottom-tab"
          aria-current={
            active ? (pathname === href ? "page" : "location") : undefined
          }
        >
          <Icon size={22} aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
