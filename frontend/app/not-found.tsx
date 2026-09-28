import Link from "next/link";
import { Shell } from "@/components/ui";
export default function NotFound() {
  return (
    <Shell>
      <div className="content empty-state">
        <p className="eyebrow">404</p>
        <h1>찾으시는 화면이 없어요</h1>
        <p style={{ marginTop: 16 }}>
          주소를 확인하거나 내 기록으로 돌아가 주세요.
        </p>
        <Link href="/measurements" className="button primary">
          내 기록으로
        </Link>
      </div>
    </Shell>
  );
}
