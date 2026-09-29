"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/http";
import {
  getGroups,
  groupError,
  groupInput,
  groupMutation,
  parseMyGroup,
  parseJoinRequest,
} from "@/lib/groups";
import {
  workoutJournal,
  type WorkoutWriter,
  type PendingWorkoutRequest,
} from "@/lib/workout-journal";
import { useSession } from "./session-provider";
import { useOperationScope } from "./use-operation-scope";
import { useApiResource } from "./use-api-resource";
import { Header, Loading, Notice, Shell } from "./ui";
import styles from "./groups.module.css";

export function GroupFields({
  name,
  description,
  onName,
  onDescription,
  disabled = false,
}: {
  name: string;
  description: string;
  onName: (s: string) => void;
  onDescription: (s: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className={styles.fields} disabled={disabled}>
      <div className="field">
        <label>
          그룹 이름
          <input
            value={name}
            onChange={(e) => onName(e.target.value)}
            required
            maxLength={50}
          />
        </label>
      </div>
      <div className="field">
        <label>
          그룹 소개
          <input
            value={description}
            onChange={(e) => onDescription(e.target.value)}
            maxLength={500}
          />
        </label>
      </div>
    </fieldset>
  );
}

function GroupRequestForm({
  kind,
  onSuccess,
}: {
  kind: "create" | "join";
  onSuccess: () => void;
}) {
  const userId = useSession().user!.id,
    router = useRouter(),
    begin = useOperationScope();
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [max, setMax] = useState("10"),
    [code, setCode] = useState("");
  const [pending, setPending] = useState<PendingWorkoutRequest>(),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [remaining, setRemaining] = useState(0),
    writer = useRef<WorkoutWriter | null>(null),
    guard = useRef(false);
  // Reuse the session-owned durable request store; logout and account changes erase it.
  useEffect(() => {
    const lease = workoutJournal.acquire(userId, `group:${kind}`);
    writer.current = lease;
    queueMicrotask(() => {
      if (lease.active()) {
        setPending(lease.read()[0]);
        setReady(true);
      }
    });
    return () => {
      lease.release();
      writer.current = null;
    };
  }, [userId, kind]);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const lease = writer.current;
    if (guard.current || !lease?.active() || remaining) return;
    setError("");
    setMessage("");
    let request = pending;
    try {
      if (!request) {
        const body =
          kind === "create"
            ? groupInput(name, description, Number(max))
            : { inviteCode: code.trim() };
        if (kind === "join" && !/^[A-Za-z0-9_-]{43}$/.test(code.trim()))
          throw new Error("43자리 초대 코드를 정확히 입력해 주세요.");
        request = { key: crypto.randomUUID(), body: JSON.stringify(body) };
      }
    } catch (e) {
      setError(groupError(e));
      return;
    }
    lease.save([request]);
    setPending(request);
    guard.current = true;
    setBusy(true);
    const current = begin();
    try {
      const result = await groupMutation(
        kind === "create" ? "" : "/join-requests",
        "POST",
        request.body,
        request.key,
      );
      const row =
        kind === "create" ? parseMyGroup(result) : parseJoinRequest(result);
      if (!current() || !lease.active()) return;
      lease.save([]);
      setPending(undefined);
      setCode("");
      onSuccess();
      if (kind === "create") router.push(`/groups/${row.id}`);
      else {
        const status = parseJoinRequest(result).status;
        setMessage(
          status === "pending"
            ? "가입을 신청했어요. 그룹장 승인 후 참여할 수 있어요."
            : status === "approved"
              ? "가입이 승인됐어요. 내 그룹을 확인해 주세요."
              : "이 신청은 거절됐어요. 새로 신청할 수 있어요.",
        );
      }
    } catch (e) {
      if (!current() || !lease.active()) return;
      setError(groupError(e));
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 429
      ) {
        lease.save([]);
        setPending(undefined);
      }
      if (e instanceof ApiError && e.status === 429)
        setRemaining(e.retryAfter ?? 60);
    } finally {
      if (current()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section
      className={styles.card}
      aria-label={kind === "create" ? "그룹 만들기" : "초대 코드로 가입 신청"}
    >
      <h2>{kind === "create" ? "그룹 만들기" : "초대 코드로 가입 신청"}</h2>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {pending ? (
          <Notice tone="info">
            이전 요청의 처리 결과를 확인해야 해요. 입력한 내용 그대로 다시
            확인해 주세요.
          </Notice>
        ) : kind === "create" ? (
          <>
            <GroupFields
              name={name}
              description={description}
              onName={setName}
              onDescription={setDescription}
              disabled={busy}
            />
            <div className="field">
              <label>
                정원
                <input
                  type="number"
                  min={1}
                  max={100}
                  required
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                  disabled={busy}
                />
              </label>
              <p className="caption">
                그룹장을 포함해 최대 100명 · 생성 후 정원은 변경할 수 없어요.
              </p>
            </div>
          </>
        ) : (
          <div className="field">
            <label>
              초대 코드
              <input
                className={styles.code}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                maxLength={43}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
            </label>
            <p className="caption">
              그룹원에게 받은 코드를 입력해 주세요. 그룹장이 승인하면 가입돼요.
            </p>
          </div>
        )}
        {error && <Notice>{error}</Notice>}
        {message && <Notice tone="success">{message}</Notice>}
        <button
          className="button primary"
          disabled={!ready || busy || remaining > 0}
        >
          {busy
            ? "처리 중이에요"
            : remaining
              ? `${remaining}초 후 다시 시도`
              : pending
                ? "이전 요청 확인하기"
                : kind === "create"
                  ? "그룹 만들기"
                  : "가입 신청하기"}
        </button>
      </form>
    </section>
  );
}
export function Groups() {
  const resource = useApiResource(getGroups);
  return (
    <Shell>
      <Header title="내 그룹" back="/" />
      <div className="content stack">
        {resource.error !== undefined ? (
          <>
            <Notice>{groupError(resource.error)}</Notice>
            <button className="button secondary" onClick={resource.reload}>
              다시 불러오기
            </button>
          </>
        ) : resource.data ? (
          <>
            <ul className={styles.list} aria-label="가입한 그룹">
              {resource.data.map((row) => (
                <li key={row.id}>
                  <Link className={styles.card} href={`/groups/${row.id}`}>
                    <h2>{row.name}</h2>
                    <p>{row.description}</p>
                    <p className={styles.meta}>
                      {row.role === "leader" ? "그룹장" : "그룹원"} ·{" "}
                      {row.currentMembers}/{row.maxMembers}명
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            {!resource.data.length && (
              <p className="muted">아직 가입한 그룹이 없어요.</p>
            )}
          </>
        ) : (
          <Loading />
        )}
        <div className={styles.requestGrid}>
          <GroupRequestForm kind="create" onSuccess={resource.reload} />
          <GroupRequestForm kind="join" onSuccess={resource.reload} />
        </div>
      </div>
    </Shell>
  );
}
