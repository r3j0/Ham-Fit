"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useState, type CSSProperties } from "react";
import { getGroup, getGroups, groupError, type MyGroup } from "@/lib/groups";
import { MascotPose } from "./mascot/MascotPose";
import { useApiResource } from "./use-api-resource";
import { useSession } from "./session-provider";
import { Loading, Notice } from "./ui";
import styles from "./home-groups.module.css";

function GroupSlide({
  group,
  direction,
}: {
  group: MyGroup;
  direction: number;
}) {
  const { user } = useSession();
  const load = useCallback(
    (signal: AbortSignal) => getGroup(group.id, signal),
    [group.id],
  );
  const resource = useApiResource(load);
  if (resource.error !== undefined)
    return (
      <div className={styles.state}>
        <Notice>{groupError(resource.error)}</Notice>
        <button className="text-button" onClick={resource.reload}>
          그룹원 다시 불러오기
        </button>
      </div>
    );
  if (!resource.data) return <Loading label="그룹원을 불러오고 있어요" />;
  const row = resource.data;
  const members = row.members.filter((member) => member.userId !== user?.id);
  return (
    <Link
      href={`/groups/${row.id}`}
      aria-label={`${row.name} 그룹 보기`}
      className={`${styles.slide} ${direction ? styles.entering : ""}`}
      style={
        { "--slide-from": direction > 0 ? "45%" : "-45%" } as CSSProperties
      }
      data-direction={
        direction > 0 ? "next" : direction < 0 ? "previous" : "initial"
      }
    >
      {members.length ? (
        <ul className={styles.members} aria-label={`${row.name} 그룹원`}>
          {members.map((member) => (
            <li className={styles.member} key={member.userId}>
              {/* The server has no saved character yet; use the shared default, never an invented outfit. */}
              <MascotPose
                pose="basic"
                variant="cream"
                size={96}
                label={`${member.nickname ?? "닉네임 미설정"}의 기본 햄스터`}
              />
              <span
                className={styles.nickname}
                title={member.nickname ?? "닉네임 미설정"}
              >
                {member.nickname ?? "닉네임 미설정"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`muted ${styles.noCompanions}`}>
          아직 다른 그룹원이 없어요.
        </p>
      )}
      <p className={styles.name} aria-live="polite">
        {row.name}
      </p>
    </Link>
  );
}

export function HomeGroups() {
  const resource = useApiResource(getGroups);
  const [selection, setSelection] = useState<{
    id?: string;
    direction: number;
  }>({ direction: 0 });
  const groups = resource.data ?? [];
  const index = Math.max(
    0,
    groups.findIndex((group) => group.id === selection.id),
  );
  const selected = groups[index];
  function move(direction: -1 | 1) {
    if (groups.length < 2) return;
    const next = groups[(index + direction + groups.length) % groups.length];
    setSelection({ id: next.id, direction });
  }
  return (
    <section className={styles.root} aria-label="내 그룹의 햄스터">
      {resource.error !== undefined ? (
        <div className={styles.state}>
          <Notice>{groupError(resource.error)}</Notice>
          <button className="text-button" onClick={resource.reload}>
            내 그룹 다시 불러오기
          </button>
        </div>
      ) : !resource.data ? (
        <Loading label="내 그룹을 불러오고 있어요" />
      ) : !selected ? (
        <div className={styles.empty}>
          <p className="muted">아직 가입한 그룹이 없어요.</p>
          <Link className="text-link" href="/groups">
            그룹 만들기·가입하기
          </Link>
        </div>
      ) : (
        <div className={styles.carousel} data-multiple={groups.length > 1}>
          {groups.length > 1 && (
            <button
              className="icon-button"
              aria-label="이전 그룹"
              onClick={() => move(-1)}
            >
              <ChevronLeft size={24} aria-hidden="true" />
            </button>
          )}
          <div className={styles.viewport}>
            <GroupSlide
              key={selected.id}
              group={selected}
              direction={selection.direction}
            />
          </div>
          {groups.length > 1 && (
            <button
              className="icon-button"
              aria-label="다음 그룹"
              onClick={() => move(1)}
            >
              <ChevronRight size={24} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
