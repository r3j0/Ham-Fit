"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, UserRound } from "lucide-react";

export function BottomNavigation() {
  const pathname = usePathname();
  const tabs = [
    {
      href: "/",
      label: "메인",
      icon: House,
      active: pathname === "/" || pathname.startsWith("/workouts/"),
    },
    {
      href: "/account",
      label: "내 프로필",
      icon: UserRound,
      active:
        pathname === "/account" ||
        pathname === "/workouts" ||
        pathname.startsWith("/measurements"),
    },
  ];

  return (
    <nav className="bottom-navigation" aria-label="하단 메뉴">
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
