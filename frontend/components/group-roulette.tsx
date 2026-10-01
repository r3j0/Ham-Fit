"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { errorMessage } from "@/lib/http";
import {
  getGroupDraws,
  getGroupTickets,
  spinGroup,
} from "@/lib/group-missions";
import { getInventory } from "@/lib/shop";
import { groupResults, type GroupDraw } from "@/lib/group-mission-contract";
import { useApiResource } from "./use-api-resource";
import { useDurableMutation } from "./use-durable-mutation";
import { Header, Loading, Notice, Shell, SubmitLabel } from "./ui";
import { useUnsaved } from "./use-unsaved";
import { SeedBalance } from "./seed-balance";
import {
  RouletteWheel,
  RouletteRewardPopup,
  RoulettePrizeIcon,
  RouletteProbabilities,
  useRouletteMotion,
  useRouletteLayout,
  useRouletteReward,
  type RoulettePrize,
} from "./roulette-wheel";
import styles from "./roulette-wheel.module.css";

const labels = [
  "나에게 1개",
  "나에게 3개",
  "나에게 5개",
  "나에게 7개",
  "기여자마다 3개",
  "기여자마다 7개",
];
const prizes: RoulettePrize[] = labels.map((label, index) => ({
  label,
  kind: index < 4 ? "seeds" : "contributors",
  amount: [1, 3, 5, 7, 3, 7][index],
}));
const probabilities = [50, 25, 13, 7, 4, 1];
export function GroupRoulette({ id }: { id: string }) {
  const resource = useApiResource(
    useCallback(
      async (signal: AbortSignal) => {
        const [tickets, draws, inventory] = await Promise.all([
          getGroupTickets(id, signal),
          getGroupDraws(id, signal),
          getInventory(signal),
        ]);
        return {
          tickets,
          draws: draws.sort((a, b) => b.drawnAt.localeCompare(a.drawnAt)),
          inventory,
        };
      },
      [id],
    ),
  );
  const mutation = useDurableMutation(`roulette:group:${id}`);
  const [draw, setDraw] = useState<GroupDraw>(),
    [error, setError] = useState("");
  const motion = useRouletteMotion();
  const layout = useRouletteLayout(prizes, `group:${id}`);
  const available =
    resource.data?.tickets
      .filter((t) => t.usable && t.id !== draw?.ticketId)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ) ?? [];
  const reward = useRouletteReward(
    resource.data && !resource.loading && !resource.error
      ? available.length
      : undefined,
  );
  const busy = mutation.busy || motion.busy;
  useUnsaved(busy, "룰렛 결과를 확인 중이에요. 이 화면을 나갈까요?");
  async function spin() {
    setError("");
    try {
      const result = await motion.play(
        () =>
          mutation.run(
            JSON.stringify({ ticketId: available[0]?.id }),
            (body, key) => spinGroup(id, body, key),
          ),
        (value) =>
          layout.prizes.indexOf(prizes[groupResults.indexOf(value.result)]),
      );
      if (result) {
        setDraw(result);
        reward.show();
        resource.reload();
      }
    } catch (e) {
      setError(errorMessage(e));
      resource.reload();
    }
  }
  return (
    <Shell className={`${styles.page} ${styles.group}`}>
      <Header title="해바라기 미션 보상 룰렛" back="/account/notifications" />
      <div className="content stack roulette-page">
        <div className="intro">
          <h1>행운을 돌려 보세요</h1>
          <p>
            남은 룰렛{" "}
            <strong>
              {resource.data ? `${available.length}회` : "확인 중"}
            </strong>
          </p>
        </div>
        <div className={styles.layout}>
          <div className={styles.wheelColumn}>
            <RouletteWheel
              prizes={layout.prizes}
              phase={motion.phase}
              attachWheel={motion.attachWheel}
            />
            {resource.data && !resource.error && (
              <SeedBalance balance={resource.data.inventory.currency.balance} />
            )}
          </div>
          <RouletteProbabilities
            prizes={prizes}
            probabilities={probabilities}
            label="그룹 룰렛 보상 확률"
            description="공동 보상은 해당 회차에 물을 준 참여 자격을 유지한 구성원에게 각각 지급돼요."
          />
        </div>
        {error && <Notice>{error}</Notice>}
        {resource.error ? (
          <>
            <Notice>{errorMessage(resource.error)}</Notice>
            <button className="button secondary" onClick={resource.reload}>
              다시 불러오기
            </button>
          </>
        ) : null}
        {resource.loading && !resource.data && <Loading />}
        {mutation.pending && !mutation.busy && (
          <Notice tone="info">
            이전 추첨의 결과를 확인해 주세요. 다시 돌려도 같은 추첨 결과를
            불러와요.
          </Notice>
        )}
        {draw && reward.visible && (
          <RouletteRewardPopup
            prize={{
              label: "받은 선물",
              kind: draw.result.startsWith("contributors_")
                ? "contributors"
                : "seeds",
              amount: draw.amountPerRecipient,
            }}
            title={`해바라기씨 ${draw.amountPerRecipient}개를 받았어요!`}
            description={`${draw.result.startsWith("contributors_") ? "함께 운동한 기여자에게 각각 지급됐어요. " : ""}내가 받은 해바라기씨 ${draw.myReward.reduce((sum, r) => sum + r.amount, 0)}개`}
            onClose={reward.dismiss}
          />
        )}
        <button
          className="button primary"
          disabled={
            busy ||
            !layout.ready ||
            reward.visible ||
            (!mutation.pending &&
              (!available.length || !!resource.error || resource.loading))
          }
          onClick={() => void spin()}
        >
          <SubmitLabel busy={busy}>
            {mutation.pending && !mutation.busy
              ? "이전 추첨 결과 확인"
              : busy
                ? "선물을 확인하고 있어요"
                : "룰렛 돌리기"}
          </SubmitLabel>
        </button>
        {!available.length && resource.data && !mutation.pending && (
          <p className="muted">
            사용할 룰렛이 없어요. 그룹 미션을 완성하면 기여한 만큼 받을 수
            있어요.
          </p>
        )}
        <Link href="/account/notifications" className="button secondary">
          알림으로
        </Link>
        {!!resource.data?.draws.length && (
          <section className={styles.history} aria-label="최근 받은 선물">
            <h2>최근 받은 선물</h2>
            <table>
              <thead>
                <tr>
                  <th scope="col">받은 날짜</th>
                  <th scope="col">당첨 선물</th>
                  <th scope="col">내 보상</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.draws.slice(0, 10).map((d) => (
                  <tr key={d.id}>
                    <td>
                      <time dateTime={d.drawnAt}>
                        {new Date(d.drawnAt).toLocaleDateString("ko-KR")}
                      </time>
                    </td>
                    <td>
                      <span className={styles.historyPrize}>
                        <RoulettePrizeIcon
                          {...prizes[groupResults.indexOf(d.result)]}
                        />
                        <span>{labels[groupResults.indexOf(d.result)]}</span>
                      </span>
                    </td>
                    <td>
                      <strong>
                        {d.myReward.reduce((sum, r) => sum + r.amount, 0)}개
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </Shell>
  );
}
