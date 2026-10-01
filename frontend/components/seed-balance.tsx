import Image from "next/image";

export function SeedBalance({ balance }: { balance: number }) {
  return (
    <div className="profile-balance" role="group" aria-label="보유 재화">
      <Image
        src="/icons/sunflower-seed.svg"
        width={24}
        height={34}
        alt="해바라기씨"
      />
      <strong>{balance.toLocaleString("ko-KR")}</strong>
    </div>
  );
}
