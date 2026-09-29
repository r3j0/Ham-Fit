"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, UserRound, UsersRound, Dumbbell } from "lucide-react";

export function BottomNavigation() {
  const pathname = usePathname();
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/"))
    return null;
  const workoutRoute =
    pathname === "/workout" ||
    pathname.startsWith("/workout-routines/") ||
    pathname === "/workouts" ||
    pathname.startsWith("/workouts/");
  const groupRoute = pathname === "/groups" || pathname.startsWith("/groups/");
  const profileRoute =
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    pathname === "/measurements" ||
    pathname.startsWith("/measurements/");
  const theme = workoutRoute
    ? " kspo-sky-theme"
    : profileRoute || groupRoute
      ? " kspo-orange-theme"
      : "";
  const tabs = [
    {
      href: "/workout",
      label: "운동",
      icon: Dumbbell,
      active: workoutRoute,
    },
    {
      href: "/",
      label: "메인",
      icon: House,
      active: pathname === "/",
    },
    {
      href: "/groups",
      label: "내 그룹",
      icon: UsersRound,
      active: groupRoute,
    },
    {
      href: "/account",
      label: "내 프로필",
      icon: UserRound,
      active: profileRoute,
    },
  ];

  return (
    <nav className={`bottom-navigation${theme}`} aria-label="하단 메뉴">
      <div className="bottom-navigation-inner">
        {tabs.map(({ href, label, icon: Icon, active }) => (
          <Link
            key={href}
            href={href}
            className={`bottom-tab${href === "/" ? " bottom-tab-main" : ""}`}
            aria-label={label}
            aria-current={
              active ? (pathname === href ? "page" : "location") : undefined
            }
          >
            <span className="bottom-tab-icon" aria-hidden="true">
              <Icon size={href === "/" ? 28 : 22} />
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
