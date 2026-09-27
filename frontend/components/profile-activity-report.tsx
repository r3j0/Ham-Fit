import { CalendarCheck, Flame, Images, Star, Trophy } from "lucide-react";

// Profile-only preview until activity, level, and collection APIs are available.
// These values never participate in workout progress, rewards, or recommendations.
const mockActivity = {
  currentStreak: 3,
  longestStreak: 12,
  level: 4,
  collectionCount: 2,
  totalWorkoutDays: 28,
};
const metrics = [
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

export function ProfileActivityReport() {
  return (
    <section className="profile-report" aria-labelledby="profile-report-title">
      <div className="profile-report-heading">
        <h2 id="profile-report-title">활동 리포트</h2>
        <span className="profile-report-preview">예시</span>
      </div>
      <dl className="profile-report-metrics">
        {metrics.map(({ label, value, unit, Icon }) => (
          <div className="profile-report-metric" key={label}>
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
      <p className="profile-report-total">
        <CalendarCheck size={20} aria-hidden="true" />
        <span>
          총 <strong>{mockActivity.totalWorkoutDays}일</strong> 운동함
        </span>
      </p>
    </section>
  );
}
