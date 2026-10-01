import { SeedIcon } from "./seed-icon";

export function SeedBalance({ balance }: { balance: number }) {
  return (
    <div className="profile-balance" role="group" aria-label="보유 재화">
      <SeedIcon height={34} alt="해바라기씨" />
      <strong>{balance.toLocaleString("ko-KR")}</strong>
    </div>
  );
}
