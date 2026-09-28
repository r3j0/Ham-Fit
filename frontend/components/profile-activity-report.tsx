import {
  CalendarCheck,
  CalendarDays,
  Flame,
  Images,
  Star,
  Trophy,
} from "lucide-react";
import { daysSinceJoined } from "@/lib/user-profile";

// Profile-only preview until activity, level, and collection APIs are available.
// These values never participate in workout progress, rewards, or recommendations.
const mockActivity = {
  currentStreak: 3,
  longestStreak: 12,
  level: 4,
  collectionCount: 2,
  totalWorkoutDays: 28,
};
const activityMetrics = [
  {
    label: "현재 연속 스트릭",
    value: mockActivity.currentStreak,
    unit: "일",
    Icon: Flame,
  },
  {
    label: "최장 연속 스트릭",
    value: mockActivity.longestStreak,
    unit: "일",
    Icon: Trophy,
  },
  { label: "현재 레벨", value: mockActivity.level, unit: "레벨", Icon: Star },
  {
    label: "캐릭터 보유 컬렉션",
    value: mockActivity.collectionCount,
    unit: "개",
    Icon: Images,
  },
];

export function ProfileActivityReport({ createdAt }: { createdAt: string }) {
  const metrics = [
    ...activityMetrics,
    {
      label: "총 운동 일수",
      value: mockActivity.totalWorkoutDays,
      unit: "일",
      Icon: CalendarCheck,
    },
    {
      label: "가입한지",
      value: String(daysSinceJoined(createdAt)).padStart(2, "0"),
      unit: "일",
      Icon: CalendarDays,
    },
  ];
  return (
    <section className="profile-report" aria-label="활동 리포트">
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
              <strong>{value}</strong>
              <span>{unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
