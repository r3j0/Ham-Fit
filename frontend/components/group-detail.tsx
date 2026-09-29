"use client";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/session";
import { object, invalid } from "@/lib/api-contract";
import {
  getGroup,
  getMember,
  getRequests,
  groupError,
  groupInput,
  parseGroup,
  groupMutation,
  type GroupDetail as Detail,
  type Member,
  type RequestStatus,
} from "@/lib/groups";
import { useSession } from "./session-provider";
import { useApiResource } from "./use-api-resource";
import { useOperationScope } from "./use-operation-scope";
import { Dialog, Header, Loading, Notice, Shell } from "./ui";
import { GroupFields } from "./groups";
import styles from "./groups.module.css";

const statusLabels = { pending: "대기", approved: "승인", rejected: "거절" };
function Applications({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<RequestStatus>("pending");
  const load = useCallback(
    (signal: AbortSignal) => getRequests(id, status, signal),
    [id, status],
  );
  const resource = useApiResource(load),
    begin = useOperationScope();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    guard = useRef(false);
  async function decide(requestId: string, action: "approve" | "reject") {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    const current = begin();
    try {
      await groupMutation(
        `/${id}/join-requests/${requestId}/${action}`,
        "POST",
      );
      if (current()) {
        resource.reload();
        onChanged();
      }
    } catch (e) {
      if (current()) {
        setError(groupError(e));
        resource.reload();
        onChanged();
      }
    } finally {
      if (current()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="stack" aria-label="가입 신청 관리">
      <h2>가입 신청 관리</h2>
      <div className="segmented" role="group" aria-label="신청 상태">
        {(Object.keys(statusLabels) as RequestStatus[]).map((value) => (
          <button
            key={value}
            disabled={busy}
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
          >
            {statusLabels[value]}
          </button>
        ))}
      </div>
      {error && <Notice>{error}</Notice>}
      {resource.error !== undefined ? (
        <>
          <Notice>{groupError(resource.error)}</Notice>
          <button className="text-button" onClick={resource.reload}>
            신청 다시 불러오기
          </button>
        </>
      ) : resource.loading ? (
        <Loading />
      ) : (
        <>
          <ul className={styles.list}>
            {resource.data?.map((request) => (
              <li className={styles.card} key={request.id}>
                <strong>{request.nickname ?? "닉네임 미설정"}</strong>
                <p className={styles.meta}>
                  {new Date(request.createdAt).toLocaleDateString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}{" "}
                  · {statusLabels[request.status]}
                </p>
                {request.status === "pending" && (
                  <div className={styles.actions}>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => void decide(request.id, "approve")}
                    >
                      가입 승인
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void decide(request.id, "reject")}
                    >
                      가입 거절
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!resource.data?.length && (
            <p className="muted">{statusLabels[status]} 중인 신청이 없어요.</p>
          )}
        </>
      )}
    </section>
  );
}

type Action =
  { kind: "transfer" | "kick"; member: Member } | { kind: "leave" | "delete" };
function GroupView({ row, refresh }: { row: Detail; refresh: () => void }) {
  const userId = useSession().user!.id,
    router = useRouter(),
    begin = useOperationScope();
  const leader = row.members.some(
    (member) => member.userId === userId && member.role === "leader",
  );
  const [action, setAction] = useState<Action>(),
    [editing, setEditing] = useState(false),
    [name, setName] = useState(row.name),
    [description, setDescription] = useState(row.description);
  const editBase = useRef({ name: row.name, description: row.description });
  const [invite, setInvite] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    guard = useRef(false);
  async function run(work: (current: () => boolean) => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const current = begin();
    try {
      await work(current);
    } catch (e) {
      if (current()) {
        setError(groupError(e));
        refresh();
      }
    } finally {
      if (current()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  async function loadInvite() {
    await run(async (current) => {
      const { data } = await api<unknown>(`/groups/${row.id}/invite-code`);
      if (!current()) return;
      const value = object(data);
      if (
        typeof value.inviteCode !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.inviteCode)
      )
        invalid();
      setInvite(value.inviteCode);
    });
  }
  async function copyInvite() {
    await run(async (current) => {
      try {
        await navigator.clipboard.writeText(invite);
        if (!current()) return;
        setMessage("초대 코드를 복사했어요.");
      } catch {
        if (!current()) return;
        setMessage("복사할 수 없어요. 아래 코드를 선택해 복사해 주세요.");
      }
    });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    let body;
    try {
      const input = groupInput(name, description);
      body = {
        ...(input.name !== editBase.current.name ? { name: input.name } : {}),
        ...(input.description !== editBase.current.description
          ? { description: input.description }
          : {}),
      };
      if (!Object.keys(body).length) {
        setEditing(false);
        return;
      }
    } catch (e) {
      setError(groupError(e));
      return;
    }
    await run(async (current) => {
      const saved = parseGroup(
        await groupMutation(`/${row.id}`, "PATCH", JSON.stringify(body)),
      );
      if (!current()) return;
      if (
        saved.id !== row.id ||
        (body.name !== undefined && saved.name !== body.name) ||
        (body.description !== undefined &&
          saved.description !== body.description)
      )
        invalid();
      setEditing(false);
      setMessage("그룹 정보를 저장했어요.");
      refresh();
    });
  }
  async function confirm() {
    if (!action) return;
    const target = action;
    await run(async (current) => {
      const base = `/${row.id}`;
      if (target.kind === "transfer")
        await groupMutation(
          `${base}/leadership`,
          "POST",
          JSON.stringify({ userId: target.member.userId }),
        );
      else if (target.kind === "kick")
        await groupMutation(
          `${base}/members/${target.member.userId}`,
          "DELETE",
        );
      else
        await groupMutation(
          target.kind === "leave" ? `${base}/members/me` : base,
          "DELETE",
        );
      if (!current()) return;
      setAction(undefined);
      if (target.kind === "leave" || target.kind === "delete")
        router.replace("/groups");
      else {
        setMessage("그룹 변경을 반영했어요.");
        refresh();
      }
    });
  }
  return (
    <>
      <section className={styles.card}>
        <h2>{row.name}</h2>
        <p>{row.description || "그룹 소개가 없어요."}</p>
        <p className={styles.meta}>
          {row.currentMembers}/{row.maxMembers}명 ·{" "}
          {leader ? "그룹장" : "그룹원"}
        </p>
        <div className={styles.actions}>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void loadInvite()}
          >
            초대 코드 보기
          </button>
          {leader && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                editBase.current = {
                  name: row.name,
                  description: row.description,
                };
                setName(row.name);
                setDescription(row.description);
                setEditing(true);
              }}
            >
              그룹 정보 수정
            </button>
          )}
        </div>
        {invite && (
          <div className="field">
            <label>
              그룹 초대 코드
              <input
                className={styles.code}
                readOnly
                value={invite}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void copyInvite()}
            >
              초대 코드 복사
            </button>
          </div>
        )}
      </section>
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      <section className="stack" aria-label="그룹원">
        <h2>그룹원</h2>
        <ul className={styles.list}>
          {row.members.map((member) => (
            <li key={member.userId} className={styles.card}>
              <Link
                href={`/groups/${row.id}/members/${member.userId}`}
                className="text-link"
              >
                {member.nickname ?? "닉네임 미설정"}
                {member.userId === userId ? " (나)" : ""} ·{" "}
                {member.role === "leader" ? "그룹장" : "그룹원"}
              </Link>
              <p>연속 운동 {member.streak}일</p>
              {leader && member.userId !== userId && (
                <div className={styles.actions}>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setAction({ kind: "transfer", member })}
                  >
                    그룹장 위임
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setAction({ kind: "kick", member })}
                  >
                    내보내기
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="caption">
          연속 운동은 서버 집계 기준이며, 새 루틴 완료 기록은 아직 포함되지
          않아요.
        </p>
      </section>
      {leader && <Applications id={row.id} onChanged={refresh} />}
      <div className="stack-sm">
        {leader && row.currentMembers > 1 && (
          <p className="caption">
            탈퇴하려면 다른 그룹원에게 그룹장을 먼저 위임해 주세요.
          </p>
        )}
        <button
          className="button secondary"
          disabled={busy || (leader && row.currentMembers > 1)}
          onClick={() => setAction({ kind: "leave" })}
        >
          그룹 탈퇴
        </button>
        {leader && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setAction({ kind: "delete" })}
          >
            그룹 삭제
          </button>
        )}
      </div>
      {editing && leader && (
        <Dialog
          title="그룹 정보 수정"
          busy={busy}
          onClose={() => setEditing(false)}
        >
          <form className="stack" onSubmit={(e) => void save(e)}>
            <GroupFields
              name={name}
              description={description}
              onName={setName}
              onDescription={setDescription}
              disabled={busy}
            />
            {error && <Notice>{error}</Notice>}
            <button className="button primary" disabled={busy}>
              그룹 정보 저장
            </button>
          </form>
        </Dialog>
      )}
      {action && (action.kind === "leave" || leader) && (
        <Dialog
          title={
            action.kind === "transfer"
              ? "그룹장을 위임할까요?"
              : action.kind === "kick"
                ? "그룹원을 내보낼까요?"
                : action.kind === "leave"
                  ? "그룹에서 탈퇴할까요?"
                  : "그룹을 삭제할까요?"
          }
          busy={busy}
          onClose={() => setAction(undefined)}
        >
          <div className="stack">
            <p>
              {action.kind === "transfer"
                ? `${action.member.nickname ?? "선택한 그룹원"}에게 관리 권한이 넘어가요.`
                : action.kind === "kick"
                  ? `${action.member.nickname ?? "선택한 그룹원"}의 그룹 참여가 종료돼요.`
                  : action.kind === "delete"
                    ? "모든 그룹원의 참여가 종료되며 그룹을 복구할 수 없어요."
                    : leader
                      ? "마지막 그룹원이 탈퇴하면 그룹도 삭제돼요."
                      : "다시 참여하려면 가입 신청과 승인이 필요해요."}
            </p>
            {error && <Notice>{error}</Notice>}
            <div className="button-row">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setAction(undefined)}
              >
                취소
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void confirm()}
              >
                확인
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
export function GroupDetail({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => getGroup(id, signal), [id]),
    resource = useApiResource(load);
  return (
    <Shell>
      <Header title="그룹" back="/groups" />
      <div className="content stack">
        {resource.error !== undefined ? (
          <>
            <Notice>{groupError(resource.error)}</Notice>
            <button className="button secondary" onClick={resource.reload}>
              다시 불러오기
            </button>
            <Link className="text-link" href="/groups">
              내 그룹으로
            </Link>
          </>
        ) : resource.data ? (
          <GroupView row={resource.data} refresh={resource.reload} />
        ) : (
          <Loading />
        )}
      </div>
    </Shell>
  );
}
export function GroupMember({ id, userId }: { id: string; userId: string }) {
  const load = useCallback(
      (signal: AbortSignal) => getMember(id, userId, signal),
      [id, userId],
    ),
    resource = useApiResource(load);
  return (
    <Shell>
      <Header title="그룹원 프로필" back={`/groups/${id}`} />
      <div className="content stack">
        {resource.error !== undefined ? (
          <>
            <Notice>{groupError(resource.error)}</Notice>
            <button className="button secondary" onClick={resource.reload}>
              다시 불러오기
            </button>
          </>
        ) : resource.data ? (
          <section className={styles.card}>
            <h2>{resource.data.nickname ?? "닉네임 미설정"}</h2>
            <p>{resource.data.role === "leader" ? "그룹장" : "그룹원"}</p>
            <p>연속 운동 {resource.data.streak}일</p>
            <p>
              가입일{" "}
              {new Date(resource.data.joinedAt).toLocaleDateString("ko-KR", {
                timeZone: "Asia/Seoul",
              })}
            </p>
            <p className="caption">
              연속 운동은 서버 집계 기준이며, 새 루틴 완료 기록은 아직 포함되지
              않아요.
            </p>
          </section>
        ) : (
          <Loading />
        )}
      </div>
    </Shell>
  );
}
