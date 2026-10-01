"use client";
import { GroupMission } from "./group-mission";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarCheck,
  CalendarDays,
  Check,
  Crown,
  Droplet,
  Flame,
  MoreHorizontal,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
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
import { ProfileCharacter } from "./profile-character";
import styles from "./groups.module.css";
import memberStyles from "./group-member-profile.module.css";

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
      <div
        className={`segmented ${styles.statusFilter}`}
        role="group"
        aria-label="신청 상태"
      >
        {(["pending", "approved"] as const).map((value) => (
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
              <li className={styles.applicationRow} key={request.id}>
                <strong
                  className={styles.nickname}
                  title={request.nickname ?? "닉네임 미설정"}
                >
                  {request.nickname ?? "닉네임 미설정"}
                </strong>
                <p className={`${styles.meta} ${styles.requestMeta}`}>
                  {new Date(request.createdAt).toLocaleDateString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}{" "}
                  · {statusLabels[request.status]}
                </p>
                {request.status === "pending" && (
                  <div className={styles.requestActions}>
                    <button
                      className="icon-button"
                      aria-label="가입 승인"
                      title="가입 승인"
                      disabled={busy}
                      onClick={() => void decide(request.id, "approve")}
                    >
                      <Check size={20} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="가입 거절"
                      title="가입 거절"
                      disabled={busy}
                      onClick={() => void decide(request.id, "reject")}
                    >
                      <X size={20} aria-hidden="true" />
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
    [managed, setManaged] = useState<Member>(),
    [editing, setEditing] = useState(false),
    [name, setName] = useState(row.name),
    [description, setDescription] = useState(row.description);
  const editBase = useRef({ name: row.name, description: row.description });
  const settingsButton = useRef<HTMLButtonElement>(null),
    memberButton = useRef<HTMLButtonElement | null>(null);
  function closeSettings() {
    setEditing(false);
    queueMicrotask(() => settingsButton.current?.focus());
  }
  function closeManaged() {
    setManaged(undefined);
    queueMicrotask(() => memberButton.current?.focus());
  }
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
      setManaged(undefined);
      setEditing(false);
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
      <GroupMission
        id={row.id}
        leader={leader}
        memberCount={row.currentMembers}
        onChanged={refresh}
      />
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
          <button
            ref={settingsButton}
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
            그룹 설정
          </button>
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
            <li key={member.userId} className={styles.memberRow}>
              <ProfileCharacter
                outfit={member.profileCharacter}
                size={50.4}
                label=""
              />
              <Link
                href={`/groups/${row.id}/members/${member.userId}`}
                className={styles.memberName}
                title={`${member.nickname ?? "닉네임 미설정"}${member.userId === userId ? " (나)" : ""}`}
              >
                {member.role === "leader" && (
                  <Crown
                    size={16}
                    aria-label="그룹장"
                    role="img"
                    className={styles.crown}
                  />
                )}
                <span className={styles.nickname}>
                  {member.nickname ?? "닉네임 미설정"}
                  {member.userId === userId ? " (나)" : ""}
                </span>
              </Link>
              <div className={styles.memberActivity}>
                {member.missionContribution && (
                  <span
                    className={styles.waterCount}
                    aria-label={`현재 미션 물 주기 ${member.missionContribution.waterCount}회`}
                    title="현재 미션에 물을 준 횟수"
                  >
                    <Droplet size={16} aria-hidden="true" />
                    {member.missionContribution.waterCount}회
                  </span>
                )}
                <span>연속 운동 {member.streak}일</span>
                <span>
                  {member.todayWorkoutCompleted === undefined
                    ? "오늘 확인 불가"
                    : member.todayWorkoutCompleted
                      ? "오늘 운동 완료"
                      : "오늘 운동 미완료"}
                </span>
              </div>
              {leader && member.userId !== userId && (
                <button
                  className="icon-button"
                  aria-label={`${member.nickname ?? "닉네임 미설정"} 관리`}
                  disabled={busy}
                  onClick={(event) => {
                    memberButton.current = event.currentTarget;
                    setManaged(member);
                  }}
                >
                  <MoreHorizontal size={20} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      {leader && <Applications id={row.id} onChanged={refresh} />}
      {editing && !action && (
        <Dialog title="그룹 설정" busy={busy} onClose={closeSettings}>
          <div className="stack">
            {leader && (
              <form className="stack" onSubmit={(e) => void save(e)}>
                <GroupFields
                  name={name}
                  description={description}
                  onName={setName}
                  onDescription={setDescription}
                  disabled={busy}
                />
                <button className="button primary" disabled={busy}>
                  그룹 정보 저장
                </button>
              </form>
            )}
            {error && <Notice>{error}</Notice>}
            {leader && row.currentMembers > 1 && (
              <p className="caption">
                탈퇴하려면 다른 그룹원에게 그룹장을 먼저 위임해 주세요.
              </p>
            )}
            <div className={styles.actions}>
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
          </div>
        </Dialog>
      )}
      {managed &&
        leader &&
        !action &&
        row.members.some((member) => member.userId === managed.userId) && (
          <Dialog title="그룹원 관리" busy={busy} onClose={closeManaged}>
            <div className="stack">
              <p>{managed.nickname ?? "닉네임 미설정"}</p>
              <div className={styles.actions}>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    setAction({ kind: "transfer", member: managed })
                  }
                >
                  그룹장 위임
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setAction({ kind: "kick", member: managed })}
                >
                  내보내기
                </button>
              </div>
            </div>
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
          <section
            className={memberStyles.profile}
            aria-labelledby="group-member-name"
          >
            <div className={memberStyles.identity}>
              <span className={memberStyles.role}>
                {resource.data.role === "leader" ? (
                  <Crown size={16} aria-hidden="true" />
                ) : (
                  <UserRound size={16} aria-hidden="true" />
                )}
                {resource.data.role === "leader" ? "그룹장" : "그룹원"}
              </span>
              <ProfileCharacter
                outfit={resource.data.profileCharacter}
                size={168}
                label={`${resource.data.nickname ?? "닉네임 미설정"}의 햄스터`}
              />
              <h2 id="group-member-name">
                {resource.data.nickname ?? "닉네임 미설정"}
              </h2>
            </div>
            <div className={memberStyles.activity}>
              <h3>함께 운동한 기록</h3>
              <dl className={memberStyles.stats}>
                <div className={memberStyles.stat}>
                  <dt>
                    <Flame size={20} aria-hidden="true" />
                    연속 운동
                  </dt>
                  <dd>
                    <strong>{resource.data.streak}</strong>
                    <span>일</span>
                  </dd>
                </div>
                {resource.data.longestStreak !== undefined && (
                  <div className={memberStyles.stat}>
                    <dt>
                      <Trophy size={20} aria-hidden="true" />
                      최장 연속 운동
                    </dt>
                    <dd>
                      <strong>{resource.data.longestStreak}</strong>
                      <span>일</span>
                    </dd>
                  </div>
                )}
                {resource.data.totalWorkoutDays !== undefined && (
                  <div className={memberStyles.stat}>
                    <dt>
                      <CalendarCheck size={20} aria-hidden="true" />총 운동
                    </dt>
                    <dd>
                      <strong>{resource.data.totalWorkoutDays}</strong>
                      <span>일</span>
                    </dd>
                  </div>
                )}
              </dl>
              <p className={memberStyles.joined}>
                <CalendarDays size={18} aria-hidden="true" />
                <span>그룹 가입일</span>
                <time dateTime={resource.data.joinedAt}>
                  {new Date(resource.data.joinedAt).toLocaleDateString(
                    "ko-KR",
                    {
                      timeZone: "Asia/Seoul",
                    },
                  )}
                </time>
              </p>
            </div>
          </section>
        ) : (
          <Loading />
        )}
      </div>
    </Shell>
  );
}
