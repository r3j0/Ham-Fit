"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { api } from "@/lib/session";
import { errorMessage } from "@/lib/http";
import type { MeasurementPage } from "@/lib/types";
import { ArtworkSlot, Loading, Notice, Shell } from "./ui";
export function RecordList() {
  const [filters, setFilters] = useState({ from: "", to: "" }),
    [open, setOpen] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  return (
    <Shell className="record-list-shell">
      <h1 className="sr-only">내 측정 기록</h1>
      <div className="content">
        <div className="between list-heading">
          <div className="row">
            <h2>최근 기록</h2>
            <Link
              href="/onboarding"
              className="icon-button"
              aria-label="새 기록 등록"
              title="새 기록 등록"
            >
              <Plus size={20} aria-hidden="true" />
            </Link>
          </div>
          <button
            className="button secondary inline"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="filters"
          >
            <SlidersHorizontal size={16} />
            기간
            <ChevronDown size={16} />
          </button>
        </div>
        {open && (
          <form
            id="filters"
            className="filter-box stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              setFilters({ from, to });
            }}
          >
            <div className="field-grid">
              <div className="field">
                <label htmlFor="from">시작일</label>
                <input
                  id="from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="to">종료일</label>
                <input
                  id="to"
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
            {from && to && from > to && (
              <Notice>종료일은 시작일 이후로 선택해 주세요.</Notice>
            )}
            <div className="button-row">
              <button
                className="button secondary compact"
                type="button"
                onClick={() => {
                  setFrom("");
                  setTo("");
                  setFilters({ from: "", to: "" });
                }}
              >
                초기화
              </button>
              <button
                className="button primary compact"
                disabled={!!(from && to && from > to)}
              >
                기간 적용
              </button>
            </div>
          </form>
        )}
        <RecordFeed key={JSON.stringify(filters)} filters={filters} />
        <p className="support-copy">입력한 결과만 저장돼요.</p>
      </div>
    </Shell>
  );
}
function RecordFeed({ filters }: { filters: { from: string; to: string } }) {
  const [page, setPage] = useState<MeasurementPage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  const query = new URLSearchParams({
    limit: "20",
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  }).toString();
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    api<MeasurementPage>(`/measurements?${query}`, { signal: abort.signal })
      .then((r) => setPage(r.data))
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorMessage(e));
      });
    return () => abort.abort();
  }, [query]);
  async function loadMore(retry = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const cursor =
        !retry && page?.nextCursor
          ? `&cursor=${encodeURIComponent(page.nextCursor)}`
          : "";
      const response = await api<MeasurementPage>(
        `/measurements?${query}${cursor}`,
        { signal: controller.current?.signal },
      );
      setPage((previous) =>
        cursor && previous
          ? {
              ...response.data,
              items: [
                ...previous.items,
                ...response.data.items.filter(
                  (item) => !previous.items.some((p) => p.id === item.id),
                ),
              ],
            }
          : response.data,
      );
    } catch (e) {
      if (!controller.current?.signal.aborted) setError(errorMessage(e));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  if (!page)
    return error ? (
      <div className="stack">
        <Notice>{error}</Notice>
        <button
          className="button secondary"
          onClick={() => void loadMore(true)}
          disabled={busy}
        >
          다시 불러오기
        </button>
      </div>
    ) : (
      <Loading />
    );
  if (!page.items.length)
    return (
      <div className="empty-state">
        <ArtworkSlot />
        <h2>
          {filters.from || filters.to
            ? "이 기간에는 기록이 없어요"
            : "첫 기록을 기다리고 있어요"}
        </h2>
        <p>
          {filters.from || filters.to
            ? "다른 기간을 선택해 보세요."
            : "측정한 항목 하나부터 가볍게 시작해요. 나머지는 나중에 채워도 괜찮아요."}
        </p>
        {!filters.from && !filters.to && (
          <Link href="/onboarding" className="button secondary">
            첫 측정 기록 등록
          </Link>
        )}
      </div>
    );
  return (
    <div className="stack">
      <ul className="record-list">
        {page.items.map((record) => (
          <li key={record.id}>
            <Link className="record-card" href={`/measurements/${record.id}`}>
              <div>
                <span className="date-chip">
                  {record.measuredOn.replaceAll("-", ".")}
                </span>
                <h2>
                  {record.entryMethod === "self_assessment"
                    ? "간이측정"
                    : record.centerName || "국민체력100 측정"}
                </h2>
                <p>
                  만 {record.ageAtMeasurement}세 · {record.itemCount}개 항목
                  입력
                </p>
              </div>
              <ChevronRight className="card-arrow" size={22} />
            </Link>
          </li>
        ))}
      </ul>
      {error && <Notice>{error}</Notice>}
      {page.nextCursor && (
        <button
          className="button secondary"
          onClick={() => void loadMore()}
          disabled={busy}
        >
          {busy ? "불러오는 중" : "이전 기록 더 보기"}
          <ChevronDown size={18} />
        </button>
      )}
    </div>
  );
}
