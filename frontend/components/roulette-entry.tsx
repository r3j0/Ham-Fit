"use client";
import Link from "next/link";
import { useCallback } from "react";
import { ArrowRight } from "lucide-react";
import { getGroupTickets } from "@/lib/group-missions";
import {
  getPersonalTicketCount,
  personalRouletteEnabled,
} from "@/lib/personal-rewards";
import { errorMessage } from "@/lib/http";
import { useApiResource } from "./use-api-resource";
import { useDurableMutation } from "./use-durable-mutation";
import { SeedIcon } from "./seed-icon";
import { Notice } from "./ui";
import wheelStyles from "./roulette-wheel.module.css";
import styles from "./roulette-entry.module.css";

export function PersonalRouletteEntry() {
  return <RouletteEntry />;
}

export function GroupRouletteEntry({ id }: { id: string }) {
  return <RouletteEntry key={id} groupId={id} />;
}

function RouletteEntry({ groupId }: { groupId?: string }) {
  const group = groupId !== undefined;
  const enabled = group || personalRouletteEnabled;
  const title = group ? "그룹 룰렛" : "개인 룰렛";
  const resource = useApiResource(
    useCallback(
      async (signal: AbortSignal) => {
        if (groupId !== undefined) {
          const tickets = await getGroupTickets(groupId, signal);
          return tickets.filter((ticket) => ticket.usable).length;
        }
        return getPersonalTicketCount(signal);
      },
      [groupId],
    ),
    { enabled },
  );
  const { pending } = useDurableMutation(
    group ? `roulette:group:${groupId}` : "roulette:personal",
  );
  const count = resource.error === undefined ? resource.data : undefined;
  const canEnter = enabled && (pending || (count !== undefined && count > 0));
  if (!group && (!enabled || count === undefined || count < 1)) {
    return enabled && pending ? (
      <Notice tone="info">
        확인이 끝나지 않은 추첨이 있어요.{" "}
        <Link className="text-link" href="/roulette/personal">
          이전 추첨 결과 확인
        </Link>
      </Notice>
    ) : null;
  }
  return (
    <section
      className={`${styles.card} ${wheelStyles.page} ${group ? wheelStyles.group : ""}`}
      aria-label={title}
    >
      <div className={styles.heading}>
        <div
          className={`${wheelStyles.stage} ${styles.preview}`}
          aria-hidden="true"
        >
          <div className={wheelStyles.wheel} />
          <div className={wheelStyles.pointer} />
          <div className={wheelStyles.hub}>
            <SeedIcon height={24} />
          </div>
        </div>
        <div className={styles.copy}>
          <h2>{title}</h2>
          <p>
            {group
              ? "함께 채운 미션, 함께 나누는 행운"
              : "꾸준히 운동한 나에게 주는 선물"}
          </p>
          <span className={styles.hint}>
            {group
              ? "미션을 완성하고 해바라기씨를 받아요"
              : "연속 운동 5일마다 룰렛 기회를 받아요"}
          </span>
        </div>
      </div>
      <div className={styles.footer}>
        <div className={styles.count}>
          <strong aria-label={`${title} 사용 가능 횟수`} aria-live="polite">
            {!enabled
              ? "준비 중"
              : count !== undefined
                ? `${count}회`
                : resource.loading
                  ? "확인 중"
                  : "확인 필요"}
          </strong>
          {enabled && count !== undefined && (
            <span aria-hidden="true"> 사용 가능</span>
          )}
        </div>
        {canEnter ? (
          <Link
            className={`button ${styles.action}`}
            href={group ? `/groups/${groupId}/roulette` : "/roulette/personal"}
          >
            {pending ? "이전 추첨 결과 확인" : "룰렛 돌리기"}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          <button className={`button ${styles.action}`} disabled>
            룰렛 돌리기
          </button>
        )}
      </div>
      {resource.error !== undefined && (
        <>
          <Notice>{errorMessage(resource.error)}</Notice>
          <button className="text-button" onClick={resource.reload}>
            {title} 횟수 다시 확인
          </button>
        </>
      )}
    </section>
  );
}
