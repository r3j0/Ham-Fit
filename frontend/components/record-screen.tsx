"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { getCatalog, getRecord, displayDate } from "@/lib/measurements";
import { api } from "@/lib/session";
import { isRetiredMeasurement } from "@/lib/measurement-form";
import { ApiError, errorMessage } from "@/lib/http";
import type { Catalog, RecordResponse } from "@/lib/types";
import { RecordForm } from "./record-form";
import { FitnessReport } from "./fitness-report";
import { RecordValues } from "./record-values";
import { useOperationScope } from "./use-operation-scope";
import { Dialog, Header, Loading, Notice, Shell } from "./ui";
type RecordScreenProps = { id: string; edit?: boolean; saved?: boolean };
export function RecordScreen(props: RecordScreenProps) {
  return <RecordLoader key={`${props.id}:${!!props.edit}`} {...props} />;
}
function RecordLoader({
  id,
  edit = false,
  saved = false,
}: {
  id: string;
  edit?: boolean;
  saved?: boolean;
}) {
  const [loaded, setLoaded] = useState<{
      record: RecordResponse;
      catalog: Catalog;
    } | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const record = await getRecord(id, abort.signal);
        const catalog = await getCatalog(
          record.data.catalogVersion,
          abort.signal,
        );
        if (!abort.signal.aborted) setLoaded({ record, catalog });
      } catch (e) {
        if (!abort.signal.aborted) setError(errorMessage(e));
      }
    }
    void load();
    return () => abort.abort();
  }, [id, retry]);
  if (loaded)
    return edit ? (
      <RecordForm
        key={`${loaded.record.data.id}:${loaded.record.etag}`}
        initial={loaded.record}
        initialCatalog={loaded.catalog}
      />
    ) : (
      <RecordDetail
        key={`${loaded.record.etag}:${retry}`}
        record={loaded.record}
        catalog={loaded.catalog}
        saved={saved}
        onReload={() => {
          setLoaded(null);
          setError("");
          setRetry((v) => v + 1);
        }}
      />
    );
  return (
    <Shell className="record-detail-shell">
      <Header
        title={edit ? "측정 기록 수정" : "측정 기록"}
        back="/measurements"
      />
      <div className="content">
        {error ? (
          <div className="stack">
            <Notice>{error}</Notice>
            <button
              className="button secondary"
              onClick={() => {
                setError("");
                setRetry((v) => v + 1);
              }}
            >
              다시 불러오기
            </button>
            <Link className="text-link" href="/measurements">
              기록 목록으로
            </Link>
          </div>
        ) : (
          <Loading />
        )}
      </div>
    </Shell>
  );
}
function RecordDetail({
  record,
  catalog,
  saved,
  onReload,
}: {
  record: RecordResponse;
  catalog: Catalog;
  saved: boolean;
  onReload: () => void;
}) {
  const r = record.data,
    router = useRouter();
  const missingCodes = r.missingMeasurementCodes.filter(
    (code) => !isRetiredMeasurement(code),
  );
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false);
  const guard = useRef(false);
  const beginOperation = useOperationScope();
  async function remove() {
    if (guard.current) return;
    guard.current = true;
    const isCurrent = beginOperation();
    setBusy(true);
    setError("");
    try {
      await api(`/measurements/${r.id}`, {
        method: "DELETE",
        headers: { "If-Match": record.etag },
      });
      if (!isCurrent()) return;
      router.replace("/measurements");
    } catch (e) {
      if (!isCurrent()) return;
      setError(errorMessage(e));
      setConfirm(false);
      if (e instanceof ApiError && [412, 404].includes(e.status))
        setStale(true);
    } finally {
      if (isCurrent()) {
        setBusy(false);
        guard.current = false;
      }
    }
  }
  return (
    <Shell className="record-detail-shell">
      <Header title="측정 기록" back="/measurements" />
      <div className="content stack">
        {saved && <Notice tone="success">측정 기록을 저장했어요.</Notice>}
        <section>
          <p className="eyebrow">
            {r.entryMethod === "self_assessment" ? "간이측정" : "국민체력100"}
          </p>
          <h2 style={{ fontSize: 26 }}>{displayDate(r.measuredOn)}</h2>
          <div className="record-meta">
            <span>만 {r.ageAtMeasurement}세</span>
            <span>
              {r.entryMethod === "self_assessment" ? "자가측정" : "직접 입력"}
            </span>
            {r.centerName && <span>{r.centerName}</span>}
          </div>
        </section>
        <FitnessReport record={r} catalog={catalog} />
        <RecordValues record={r} catalog={catalog} />
        <details className="accordion">
          <summary>
            미입력 항목 보기{" "}
            <span className="optional-label">({missingCodes.length})</span>
          </summary>
          <p className="caption summary-hint">
            측정하지 않은 검사는 입력하지 않아도 괜찮아요.
          </p>
          <ul className="missing-list">
            {missingCodes.map((code) => (
              <li key={code}>
                {catalog.definitions.find((d) => d.code === code)?.label ??
                  code}{" "}
                · 미입력
              </li>
            ))}
          </ul>
          {!missingCodes.length && (
            <p className="caption">미입력 항목이 없어요.</p>
          )}
        </details>
        {(r.sexAtMeasurement ||
          r.reportKind !== "unknown" ||
          r.reportedOverallGrade) && (
          <details className="accordion">
            <summary>
              {r.entryMethod === "self_assessment"
                ? "측정 정보"
                : "결과표 추가 정보"}
            </summary>
            <dl className="value-list">
              {r.sexAtMeasurement && (
                <div className="value-row">
                  <dt>성별</dt>
                  <dd>{r.sexAtMeasurement === "male" ? "남성" : "여성"}</dd>
                </div>
              )}
              {r.reportKind !== "unknown" && (
                <div className="value-row">
                  <dt>측정 유형</dt>
                  <dd>
                    {r.entryMethod === "self_assessment"
                      ? "성인 간이측정"
                      : r.reportKind === "standard"
                        ? "일반 체력측정"
                        : "공식 간편측정"}
                  </dd>
                </div>
              )}
              {r.reportedOverallGrade && (
                <div className="value-row">
                  <dt>결과표 종합등급</dt>
                  <dd>
                    {r.reportedOverallGrade}
                    <small>결과표에서 직접 입력</small>
                  </dd>
                </div>
              )}
            </dl>
          </details>
        )}
        <p className="caption">
          {r.entryMethod === "self_assessment"
            ? "직접 측정한 값을 보관했어요."
            : "결과표에 적힌 값을 그대로 보관했어요."}
        </p>
        {error && <Notice>{error}</Notice>}
        {stale && (
          <button className="button secondary" onClick={onReload}>
            최신 기록 불러오기
          </button>
        )}
        <div className="sticky-actions stack-sm">
          <Link className="button primary" href={`/measurements/${r.id}/edit`}>
            <Pencil size={18} />
            기록 수정
          </Link>
          <button
            className="text-button danger-text"
            onClick={() => setConfirm(true)}
            disabled={busy || stale}
          >
            기록 삭제
          </button>
        </div>
      </div>
      {confirm && (
        <Dialog
          title="이 기록을 삭제할까요?"
          busy={busy}
          onClose={() => setConfirm(false)}
        >
          <div className="stack">
            <p>
              <strong>{displayDate(r.measuredOn)}</strong>의 측정값{" "}
              {r.items.length}개와 결과표 정보를 삭제합니다.
            </p>
            <p className="muted">삭제한 기록은 되돌릴 수 없어요.</p>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => setConfirm(false)}
                disabled={busy}
              >
                취소
              </button>
              <button
                className="button danger"
                onClick={() => void remove()}
                disabled={busy}
              >
                <Trash2 size={18} />
                {busy ? "삭제 중" : "기록 삭제"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </Shell>
  );
}
