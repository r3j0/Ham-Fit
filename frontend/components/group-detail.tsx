"use client";
import { GroupMission } from "./group-mission";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarCheck,
  CalendarDays,
  Check,
  Crown,
  Droplet,
  Flame,
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
} from "@/lib/groups";
import { useSession } from "./session-provider";
import { useApiResource } from "./use-api-resource";
import { useOperationScope } from "./use-operation-scope";
import { Dialog, Header, Loading, Notice, Shell } from "./ui";
import { GroupFields } from "./groups";
import { ProfileCharacter } from "./profile-character";
import styles from "./groups.module.css";
import memberStyles from "./group-member-profile.module.css";

function Applications({
  id,
  onChanged,
  onBusyChange,
  full,
}: {
  id: string;
  onChanged: () => void;
  onBusyChange: (busy: boolean) => void;
  full: boolean;
}) {
  const load = useCallback(
    (signal: AbortSignal) => getRequests(id, "pending", signal),
    [id],
  );
  const resource = useApiResource(load, {
      refreshIntervalMs: 120000,
      staleTimeMs: 60000,
    }),
    begin = useOperationScope();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    guard = useRef(false);
  const pendingRequests =
    resource.data?.filter((request) => request.status === "pending") ?? [];
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  async function decide(requestId: string, action: "approve" | "reject") {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    onBusyChange(true);
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
        onBusyChange(false);
      }
    }
  }
  return (
    <section className="stack" aria-label="가입 신청 관리">
      {full && (
        <Notice tone="info">
          정원이 가득 찼어요. 정원을 늘리거나 빈자리가 생기면 승인할 수 있어요.
        </Notice>
      )}
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
            {pendingRequests.map((request) => (
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
                  · 대기
                </p>
                {request.status === "pending" && (
                  <div className={styles.requestActions}>
                    <button
                      className="icon-button"
                      aria-label="가입 승인"
                      title="가입 승인"
                      disabled={busy || full}
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
          {!pendingRequests.length && (
            <p className="muted">대기 중인 신청이 없어요.</p>
          )}
        </>
      )}
    </section>
  );
}

type Action = { kind: "leave" | "delete" };
function GroupView({ row, refresh }: { row: Detail; refresh: () => void }) {
  const userId = useSession().user!.id,
    router = useRouter(),
    begin = useOperationScope();
  const leader = row.members.some(
    (member) => member.userId === userId && member.role === "leader",
  );
  const [action, setAction] = useState<Action>(),
    [editing, setEditing] = useState(false),
    [applicationsOpen, setApplicationsOpen] = useState(false),
    [applicationsBusy, setApplicationsBusy] = useState(false),
    [name, setName] = useState(row.name),
    [description, setDescription] = useState(row.description),
    [maxMembers, setMaxMembers] = useState(String(row.maxMembers));
  const editBase = useRef({
    name: row.name,
    description: row.description,
    maxMembers: row.maxMembers,
  });
  const settingsButton = useRef<HTMLButtonElement>(null);
  function closeSettings() {
    setEditing(false);
    setInvite("");
    queueMicrotask(() => settingsButton.current?.focus());
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
      const input = groupInput(name, description, Number(maxMembers));
      if (
        input.maxMembers! < row.currentMembers &&
        input.maxMembers !== editBase.current.maxMembers
      )
        throw new Error(
          `현재 그룹원 ${row.currentMembers}명보다 정원을 줄일 수 없어요.`,
        );
      body = {
        ...(input.name !== editBase.current.name ? { name: input.name } : {}),
        ...(input.description !== editBase.current.description
          ? { description: input.description }
          : {}),
        ...(input.maxMembers !== editBase.current.maxMembers
          ? { maxMembers: input.maxMembers }
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
          saved.description !== body.description) ||
        (body.maxMembers !== undefined && saved.maxMembers !== body.maxMembers)
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
      await groupMutation(
        target.kind === "leave" ? `${base}/members/me` : base,
        "DELETE",
      );
      if (!current()) return;
      setAction(undefined);
      setEditing(false);
      router.replace("/groups");
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
          {leader && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setApplicationsOpen(true)}
            >
              가입 신청 관리
            </button>
          )}
          <button
            ref={settingsButton}
            className="button secondary"
            disabled={busy}
            onClick={() => {
              editBase.current = {
                name: row.name,
                description: row.description,
                maxMembers: row.maxMembers,
              };
              setName(row.name);
              setDescription(row.description);
              setMaxMembers(String(row.maxMembers));
              setInvite("");
              setMessage("");
              setError("");
              setEditing(true);
            }}
          >
            그룹 설정
          </button>
        </div>
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
                size={75.6}
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
            </li>
          ))}
        </ul>
      </section>
      {leader && applicationsOpen && (
        <Dialog
          title="가입 신청 관리"
          busy={applicationsBusy}
          onClose={() => setApplicationsOpen(false)}
        >
          <Applications
            id={row.id}
            onChanged={refresh}
            onBusyChange={setApplicationsBusy}
            full={row.currentMembers >= row.maxMembers}
          />
        </Dialog>
      )}
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
                <div className="field">
                  <label htmlFor="group-capacity">정원</label>
                  <input
                    id="group-capacity"
                    type="number"
                    min={1}
                    max={5}
                    required
                    disabled={busy}
                    value={maxMembers}
                    onChange={(event) => setMaxMembers(event.target.value)}
                    aria-describedby="group-capacity-hint"
                  />
                  <p id="group-capacity-hint" className="caption">
                    그룹장 포함 최대 5명 · 현재 {row.currentMembers}명
                  </p>
                </div>
                <button className="button primary" disabled={busy}>
                  그룹 정보 저장
                </button>
              </form>
            )}
            <section className="stack" aria-label="그룹 초대">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void loadInvite()}
              >
                초대 코드 보기
              </button>
              {invite && (
                <div className="field">
                  <label>
                    그룹 초대 코드
                    <input
                      className={styles.code}
                      readOnly
                      value={invite}
                      onFocus={(event) => event.target.select()}
                    />
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void copyInvite()}
                  >
                    초대 코드 복사
                  </button>
                </div>
              )}
              {message && <Notice tone="success">{message}</Notice>}
            </section>
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
      {action && (action.kind === "leave" || leader) && (
        <Dialog
          title={
            action.kind === "leave"
              ? "그룹에서 탈퇴할까요?"
              : "그룹을 삭제할까요?"
          }
          busy={busy}
          onClose={() => setAction(undefined)}
        >
          <div className="stack">
            <p>
              {action.kind === "delete"
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
    resource = useApiResource(load, {
      refreshIntervalMs: 120000,
      staleTimeMs: 60000,
    });
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
function GroupMemberActions({
  group,
  member,
  onChanged,
}: {
  group: Detail;
  member: Member;
  onChanged: () => void;
}) {
  const viewerId = useSession().user!.id,
    router = useRouter(),
    begin = useOperationScope();
  const canManage =
    member.userId !== viewerId &&
    group.members.some(
      (row) => row.userId === viewerId && row.role === "leader",
    ) &&
    group.members.some(
      (row) => row.userId === member.userId && row.role === "member",
    );
  const [action, setAction] = useState<"transfer" | "kick">(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const guard = useRef(false);
  async function confirm() {
    if (!canManage || !action || guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    const current = begin();
    try {
      if (action === "transfer")
        await groupMutation(
          `/${group.id}/leadership`,
          "POST",
          JSON.stringify({ userId: member.userId }),
        );
      else
        await groupMutation(`/${group.id}/members/${member.userId}`, "DELETE");
      if (current()) router.replace(`/groups/${group.id}`);
    } catch (e) {
      if (current()) {
        setError(groupError(e));
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
    <>
      {error && <Notice>{error}</Notice>}
      {canManage && (
        <section className={memberStyles.management} aria-label="그룹원 관리">
          <h3>그룹원 관리</h3>
          <div className={styles.actions}>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setAction("transfer")}
            >
              그룹장 위임
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setAction("kick")}
            >
              내보내기
            </button>
          </div>
        </section>
      )}
      {canManage && action && (
        <Dialog
          title={
            action === "transfer"
              ? "그룹장을 위임할까요?"
              : "그룹원을 내보낼까요?"
          }
          busy={busy}
          onClose={() => setAction(undefined)}
        >
          <div className="stack">
            <p>
              {action === "transfer"
                ? `${member.nickname ?? "선택한 그룹원"}에게 관리 권한이 넘어가요.`
                : `${member.nickname ?? "선택한 그룹원"}의 그룹 참여가 종료돼요.`}
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
export function GroupMember({ id, userId }: { id: string; userId: string }) {
  const load = useCallback(
      async (signal: AbortSignal) => {
        const [member, group] = await Promise.all([
          getMember(id, userId, signal),
          getGroup(id, signal),
        ]);
        return { member, group };
      },
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
                {resource.data.member.role === "leader" ? (
                  <Crown size={16} aria-hidden="true" />
                ) : (
                  <UserRound size={16} aria-hidden="true" />
                )}
                {resource.data.member.role === "leader" ? "그룹장" : "그룹원"}
              </span>
              <ProfileCharacter
                outfit={resource.data.member.profileCharacter}
                size={168}
                label={`${resource.data.member.nickname ?? "닉네임 미설정"}의 햄스터`}
              />
              <h2 id="group-member-name">
                {resource.data.member.nickname ?? "닉네임 미설정"}
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
                    <strong>{resource.data.member.streak}</strong>
                    <span>일</span>
                  </dd>
                </div>
                {resource.data.member.longestStreak !== undefined && (
                  <div className={memberStyles.stat}>
                    <dt>
                      <Trophy size={20} aria-hidden="true" />
                      최장 연속 운동
                    </dt>
                    <dd>
                      <strong>{resource.data.member.longestStreak}</strong>
                      <span>일</span>
                    </dd>
                  </div>
                )}
                {resource.data.member.totalWorkoutDays !== undefined && (
                  <div className={memberStyles.stat}>
                    <dt>
                      <CalendarCheck size={20} aria-hidden="true" />총 운동
                    </dt>
                    <dd>
                      <strong>{resource.data.member.totalWorkoutDays}</strong>
                      <span>일</span>
                    </dd>
                  </div>
                )}
              </dl>
              <p className={memberStyles.joined}>
                <CalendarDays size={18} aria-hidden="true" />
                <span>그룹 가입일</span>
                <time dateTime={resource.data.member.joinedAt}>
                  {new Date(resource.data.member.joinedAt).toLocaleDateString(
                    "ko-KR",
                    {
                      timeZone: "Asia/Seoul",
                    },
                  )}
                </time>
              </p>
            </div>
            <GroupMemberActions
              group={resource.data.group}
              member={resource.data.member}
              onChanged={resource.reload}
            />
          </section>
        ) : (
          <Loading />
        )}
      </div>
    </Shell>
  );
}
