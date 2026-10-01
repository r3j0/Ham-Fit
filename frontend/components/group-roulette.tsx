"use client";
import Link from "next/link";
import { useCallback, useState, type CSSProperties } from "react";
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

const labels = [
  "나에게 1개",
  "나에게 3개",
  "나에게 5개",
  "나에게 7개",
  "기여자마다 3개",
  "기여자마다 7개",
];
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
  const [turns, setTurns] = useState(0);
  const available =
    resource.data?.tickets
      .filter((t) => t.usable && t.id !== draw?.ticketId)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ) ?? [];
  useUnsaved(mutation.busy, "룰렛 결과를 확인 중이에요. 이 화면을 나갈까요?");
  async function spin() {
    setError("");
    try {
      const result = await mutation.run(
        JSON.stringify({ ticketId: available[0]?.id }),
        (body, key) => spinGroup(id, body, key),
      );
      if (result) {
        setTurns((n) => n + 1);
        setDraw(result);
        resource.reload();
      }
    } catch (e) {
      setError(errorMessage(e));
      resource.reload();
    }
  }
  return (
    <Shell>
      <Header title="그룹 룰렛" back={`/groups/${id}`} />
      <div className="content stack roulette-page">
        <div className="intro">
          <p className="eyebrow">함께 키운 해바라기의 선물</p>
          <h1>행운을 돌려 보세요</h1>
          <p>
            남은 룰렛{" "}
            <strong>
              {resource.data ? `${available.length}회` : "확인 중"}
            </strong>
          </p>
        </div>
        {resource.data && (
          <p className="shop-balance">
            🌻 내 해바라기씨 {resource.data.inventory.currency.balance}개
          </p>
        )}
        <div className="roulette-stage">
          <span className="roulette-pointer" aria-hidden="true">
            ▼
          </span>
          <div
            className={`roulette-wheel${mutation.busy ? " is-spinning" : ""}`}
            style={
              {
                "--wheel-angle": `${draw ? turns * 2160 - groupResults.indexOf(draw.result) * 60 - 30 : 0}deg`,
              } as CSSProperties
            }
            aria-hidden="true"
          >
            {labels.map((label, i) => (
              <span
                key={label}
                style={{
                  transform: `translate(-50%, -50%) rotate(${i * 60 + 30}deg) translateY(-90px) rotate(${-i * 60 - 30}deg)`,
                }}
              >
                {label}
              </span>
            ))}
            <b>🌻</b>
          </div>
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
        {draw && (
          <div className="reward-result" role="status">
            <p>
              {draw.result.startsWith("contributors_")
                ? "함께 운동한 기여자에게 선물!"
                : "행운의 선물이 도착했어요!"}
            </p>
            <h2>해바라기씨 {draw.amountPerRecipient}개</h2>
            <p>
              내가 받은 해바라기씨{" "}
              {draw.myReward.reduce((sum, r) => sum + r.amount, 0)}개
            </p>
          </div>
        )}
        <button
          className="button primary"
          disabled={
            mutation.busy ||
            (!mutation.pending &&
              (!available.length || !!resource.error || resource.loading))
          }
          onClick={() => void spin()}
        >
          <SubmitLabel busy={mutation.busy}>
            {mutation.pending && !mutation.busy
              ? "이전 추첨 결과 확인"
              : mutation.busy
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
        <details>
          <summary>그룹 룰렛 보상 확률</summary>
          <ul>
            {labels.map((label, i) => (
              <li key={label}>
                {label} · {[50, 25, 13, 7, 4, 1][i]}%
              </li>
            ))}
          </ul>
          <p className="caption">
            공동 보상은 원래 회차에 물을 주고 참여 자격을 유지한 구성원에게 각각
            지급돼요.
          </p>
        </details>
        {!!resource.data?.draws.length && (
          <section className="stack-sm">
            <h2>최근 받은 선물</h2>
            {resource.data.draws.slice(0, 10).map((d) => (
              <div className="reward-history" key={d.id}>
                <time>{new Date(d.drawnAt).toLocaleDateString("ko-KR")}</time>
                <span>{labels[groupResults.indexOf(d.result)]}</span>
                <strong>
                  내 보상 {d.myReward.reduce((sum, r) => sum + r.amount, 0)}개
                </strong>
              </div>
            ))}
          </section>
        )}
        <Link href={`/groups/${id}`} className="button secondary">
          그룹으로 돌아가기
        </Link>
      </div>
    </Shell>
  );
}
