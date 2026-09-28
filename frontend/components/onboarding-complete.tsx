"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { getRecord } from "@/lib/measurements";
import { errorMessage } from "@/lib/http";
import { Header, Loading, Notice, Shell } from "./ui";
import { OnboardingProgress } from "./onboarding-progress";

export function OnboardingComplete({ recordId }: { recordId?: string }) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!recordId) return;
    const abort = new AbortController();
    getRecord(recordId, abort.signal)
      .then((record) => {
        if (abort.signal.aborted) return;
        if (record.data.id !== recordId)
          throw new Error("저장된 기록을 확인할 수 없어요.");
        setConfirmed(true);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(errorMessage(cause));
      });
    return () => abort.abort();
  }, [recordId, retry]);
  return (
    <Shell className="onboarding-shell">
      <Header title={confirmed ? "저장 완료" : "저장 결과 확인"} back="/" />
      <OnboardingProgress
        step={3}
        label={confirmed ? "체력 기록 완료" : "저장 기록 확인"}
      />
      <div className="content stack">
        {confirmed ? (
          <section className="feature-card stack assessment-complete">
            <CheckCircle2 size={44} aria-hidden="true" />
            <h2>나의 체력을 기록했어요</h2>
            <p className="muted">
              측정한 항목만 저장했어요. 최근 기록에서 언제든 확인할 수 있어요.
            </p>
            <Link
              className="button primary"
              href={`/measurements/${encodeURIComponent(recordId!)}?saved=1`}
            >
              측정 기록 보기
            </Link>
            <Link className="button secondary" href="/">
              메인으로
            </Link>
          </section>
        ) : !recordId || error ? (
          <>
            <Notice>
              {error ||
                "확인할 기록이 없어요. 최근 기록에서 저장 결과를 확인해 주세요."}
            </Notice>
            {recordId && (
              <button
                className="button primary"
                onClick={() => {
                  setError("");
                  setRetry((value) => value + 1);
                }}
              >
                다시 확인
              </button>
            )}
            <Link className="button secondary" href="/measurements">
              최근 기록 확인
            </Link>
            <Link className="text-link" href="/">
              메인으로
            </Link>
          </>
        ) : (
          <Loading label="저장된 기록을 확인하고 있어요" />
        )}
      </div>
    </Shell>
  );
}
