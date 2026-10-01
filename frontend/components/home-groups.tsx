"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { getGroupOverview, groupError, type GroupOverview } from "@/lib/groups";
import { ProfileCharacter } from "./profile-character";
import { useApiResource } from "./use-api-resource";
import { useSession } from "./session-provider";
import { Loading, Notice } from "./ui";
import styles from "./home-groups.module.css";

function GroupSlide({
  group,
  direction,
}: {
  group: GroupOverview;
  direction: number;
}) {
  const { user } = useSession();
  const row = group;
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
            <li
              className={styles.member}
              key={member.userId}
              data-workout-completed={member.todayWorkoutCompleted}
            >
              <ProfileCharacter
                outfit={member.profileCharacter}
                size={96}
                label={`${member.nickname ?? "닉네임 미설정"}의 햄스터`}
              />
              <span
                className={styles.nickname}
                title={member.nickname ?? "닉네임 미설정"}
              >
                {member.nickname ?? "닉네임 미설정"}
              </span>
              {member.todayWorkoutCompleted === undefined && (
                <span className="caption">오늘 확인 불가</span>
              )}
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
  const resource = useApiResource(getGroupOverview);
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
  if (resource.data && resource.error === undefined && !selected) return null;
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
      ) : selected ? (
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
      ) : null}
    </section>
  );
}
