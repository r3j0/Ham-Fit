"use client";
import Link from "next/link";
import { useCallback } from "react";
import { CircleDot } from "lucide-react";
import { getGroups } from "@/lib/groups";
import { getGroupTickets } from "@/lib/group-missions";
import {
  getPersonalTicketCount,
  personalRouletteEnabled,
} from "@/lib/personal-rewards";
import { errorMessage } from "@/lib/http";
import { useApiResource } from "./use-api-resource";
import { useDurableMutation } from "./use-durable-mutation";
import { Loading, Notice } from "./ui";
import styles from "./notifications.module.css";

async function loadGroups(signal: AbortSignal) {
  const groups = await getGroups(signal);
  const counts = await Promise.allSettled(
    groups.map((group) => getGroupTickets(group.id, signal)),
  );
  return groups.map((group, index) => {
    const result = counts[index];
    return {
      ...group,
      count:
        result.status === "fulfilled"
          ? result.value.filter((ticket) => ticket.usable).length
          : undefined,
    };
  });
}

function RouletteAction({
  resource,
  href,
  count,
  enabled = true,
}: {
  resource: string;
  href: string;
  count: number | undefined;
  enabled?: boolean;
}) {
  const { pending } = useDurableMutation(resource);
  return enabled && (pending || (count !== undefined && count > 0)) ? (
    <Link className="button primary" href={href}>
      {pending ? "이전 추첨 결과 확인" : "룰렛 돌리기"}
    </Link>
  ) : (
    <button className="button secondary" disabled>
      룰렛 돌리기
    </button>
  );
}

export function RouletteNotifications() {
  const personal = useApiResource(
    useCallback(
      (signal: AbortSignal) =>
        personalRouletteEnabled
          ? getPersonalTicketCount(signal)
          : Promise.resolve(null),
      [],
    ),
  );
  const groups = useApiResource(loadGroups);
  const rows = groups.error === undefined ? groups.data : undefined;
  const groupCount = rows?.every((group) => group.count !== undefined)
    ? rows.reduce((total, group) => total + group.count!, 0)
    : undefined;
  const personalCount =
    personal.error === undefined ? (personal.data ?? undefined) : undefined;
  return (
    <section className="stack" aria-label="룰렛 알림">
      <section className={styles.card} aria-label="개인 룰렛">
        <div className={styles.rouletteHeading}>
          <h2>
            <CircleDot size={20} aria-hidden="true" />
            개인 룰렛
          </h2>
          <span className={styles.count} aria-label="개인 룰렛 사용 가능 횟수">
            {!personalRouletteEnabled
              ? "준비 중"
              : personalCount !== undefined
                ? `${personalCount}회`
                : personal.loading
                  ? "확인 중"
                  : "확인 필요"}
          </span>
        </div>
        <RouletteAction
          resource="roulette:personal"
          href="/roulette/personal"
          count={personalCount}
          enabled={personalRouletteEnabled}
        />
        {personal.error !== undefined && (
          <>
            <Notice>{errorMessage(personal.error)}</Notice>
            <button className="text-button" onClick={personal.reload}>
              개인 룰렛 횟수 다시 확인
            </button>
          </>
        )}
      </section>
      <section className={styles.card} aria-label="그룹 룰렛">
        <div className={styles.rouletteHeading}>
          <h2>
            <CircleDot size={20} aria-hidden="true" />
            그룹 룰렛
          </h2>
          <span className={styles.count} aria-label="그룹 룰렛 사용 가능 횟수">
            {groupCount !== undefined
              ? `${groupCount}회`
              : groups.loading
                ? "확인 중"
                : "확인 필요"}
          </span>
        </div>
        {rows ? (
          rows.length ? (
            rows.map((group) => (
              <div className={styles.rouletteGroup} key={group.id}>
                <div className={styles.rouletteHeading}>
                  <h3>{group.name}</h3>
                  <span className={styles.count}>
                    {group.count !== undefined
                      ? `${group.count}회`
                      : "확인 필요"}
                  </span>
                </div>
                <RouletteAction
                  resource={`roulette:group:${group.id}`}
                  href={`/groups/${group.id}/roulette`}
                  count={group.count}
                />
              </div>
            ))
          ) : (
            <p className="caption">가입한 그룹이 없어요.</p>
          )
        ) : groups.error === undefined ? (
          <Loading />
        ) : (
          <Notice>{errorMessage(groups.error)}</Notice>
        )}
        {(groups.error !== undefined ||
          rows?.some((group) => group.count === undefined)) && (
          <>
            {rows && (
              <p className="caption" role="status">
                일부 그룹의 룰렛 횟수를 불러오지 못했어요.
              </p>
            )}
            <button className="text-button" onClick={groups.reload}>
              그룹 룰렛 횟수 다시 확인
            </button>
          </>
        )}
      </section>
    </section>
  );
}
