"use client";
import { getActivityProfile } from "@/lib/activity-profile";
import { useApiResource } from "./use-api-resource";
import { Loading, Notice } from "./ui";
import { errorMessage } from "@/lib/http";
import {
  CalendarCheck,
  CalendarDays,
  Flame,
  Images,
  Star,
  Trophy,
} from "lucide-react";
import { daysSinceJoined } from "@/lib/user-profile";

export function ProfileActivityReport({ createdAt }: { createdAt: string }) {
  const activity = useApiResource(getActivityProfile);
  const metrics = [
    {
      label: "현재 연속 스트릭",
      value: activity.error === undefined ? activity.data?.streak : undefined,
      unit: "일",
      Icon: Flame,
    },
    {
      label: "최장 연속 스트릭",
      value:
        activity.error === undefined ? activity.data?.longestStreak : undefined,
      unit: "일",
      Icon: Trophy,
    },
    { label: "현재 레벨", value: undefined, unit: "레벨", Icon: Star },
    { label: "캐릭터 보유 컬렉션", value: undefined, unit: "개", Icon: Images },
    {
      label: "총 운동 일수",
      value:
        activity.error === undefined
          ? activity.data?.totalWorkoutDays
          : undefined,
      unit: "일",
      Icon: CalendarCheck,
    },
    {
      label: "가입한지",
      value: daysSinceJoined(createdAt),
      unit: "일",
      Icon: CalendarDays,
    },
  ];
  return (
    <section className="profile-report" aria-label="활동 리포트">
      {activity.error !== undefined && (
        <div className="stack-sm">
          <Notice>{errorMessage(activity.error)}</Notice>
          <button className="text-button" onClick={activity.reload}>
            활동 정보 다시 불러오기
          </button>
        </div>
      )}
      {!activity.data && activity.error === undefined && (
        <Loading label="활동 정보를 불러오고 있어요" />
      )}
      <dl className="profile-report-metrics">
        {metrics.map(({ label, value, unit, Icon }) => (
          <div
            className={`profile-report-metric${label === "가입한지" ? " profile-tenure" : ""}`}
            title={
              label === "가입한지"
                ? `가입일: ${new Date(createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}`
                : undefined
            }
            key={label}
          >
            <dt>
              <Icon size={18} aria-hidden="true" />
              {label}
            </dt>
            <dd>
              <strong>{value ?? "—"}</strong>
              <span>
                {value === undefined
                  ? label === "현재 연속 스트릭"
                    ? "확인 필요"
                    : "집계 준비 중"
                  : unit}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
