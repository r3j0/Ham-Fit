"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import {
  getPersonalPolicy,
  getPersonalTickets,
  personalRouletteEnabled,
  spinPersonal,
} from "@/lib/personal-rewards";
import { getGroups } from "@/lib/groups";
import { getGroupTickets } from "@/lib/group-missions";
import { getCatalog, getInventory } from "@/lib/shop";
import { productName } from "@/lib/avatar-preview";
import type { PersonalDraw } from "@/lib/personal-reward-contract";
import { errorMessage } from "@/lib/http";
import { useApiResource } from "./use-api-resource";
import { useDurableMutation } from "./use-durable-mutation";
import { Header, Loading, Notice, Shell, SubmitLabel } from "./ui";
import { useUnsaved } from "./use-unsaved";

export function PersonalRoulette() {
  return (
    <Shell>
      <Header title="개인 룰렛" back="/" />
      <div className="content stack roulette-page">
        {personalRouletteEnabled ? (
          <PersonalWheel />
        ) : (
          <>
            <div className="reward-symbol" aria-hidden="true">
              🌻
            </div>
            <h1>개인 룰렛을 준비하고 있어요</h1>
            <p>5일씩 쌓아 가는 연속 운동에 선물을 더할 예정이에요.</p>
            <Link className="button primary" href="/">
              메인으로
            </Link>
          </>
        )}
      </div>
    </Shell>
  );
}
function PersonalWheel() {
  const resource = useApiResource(
    useCallback(async (signal: AbortSignal) => {
      const [tickets, inventory, catalog] = await Promise.all([
        getPersonalTickets(signal),
        getInventory(signal),
        getCatalog(signal),
      ]);
      const available = tickets
        .filter((t) => t.usable)
        .sort(
          (a, b) =>
            a.earnedAt.localeCompare(b.earnedAt) || a.id.localeCompare(b.id),
        );
      const policy = available.length
        ? await getPersonalPolicy(available[0].policyVersion, signal)
        : null;
      return { tickets: available, inventory, catalog, policy };
    }, []),
  );
  const mutation = useDurableMutation("roulette:personal"),
    [draw, setDraw] = useState<PersonalDraw>(),
    [error, setError] = useState("");
  const tickets =
    resource.data?.tickets.filter((t) => t.id !== draw?.ticketId) ?? [];
  useUnsaved(mutation.busy);
  async function spin() {
    setError("");
    try {
      const result = await mutation.run(
        JSON.stringify({ ticketId: tickets[0]?.id }),
        spinPersonal,
      );
      if (result) {
        setDraw(result);
        resource.reload();
      }
    } catch (e) {
      setError(errorMessage(e));
      resource.reload();
    }
  }
  const wonProduct = resource.data?.catalog.products.find(
    (p) => p.id === draw?.result.productId,
  );
  return (
    <>
      <div className="intro">
        <p className="eyebrow">꾸준함이 가져온 선물</p>
        <h1>나만의 행운 룰렛</h1>
        <p>
          남은 룰렛{" "}
          <strong>{resource.data ? `${tickets.length}회` : "확인 중"}</strong>
        </p>
      </div>
      <div
        className={`personal-wheel${mutation.busy ? " is-spinning" : ""}`}
        aria-hidden="true"
      >
        <span>🌻</span>
      </div>
      {resource.error ? (
        <>
          <Notice>{errorMessage(resource.error)}</Notice>
          <button className="button secondary" onClick={resource.reload}>
            다시 불러오기
          </button>
        </>
      ) : null}
      {error && <Notice>{error}</Notice>}
      {resource.loading && !resource.data && <Loading />}
      {draw && (
        <div className="reward-result" role="status">
          <h2>
            {draw.result.kind === "currency"
              ? `해바라기씨 ${draw.result.amount}개를 받았어요!`
              : `${wonProduct ? productName(wonProduct) : draw.result.kind === "pose" ? "새로운 자세" : "새로운 의상"}를 받았어요!`}
          </h2>
          <p>보유 해바라기씨 {draw.currency.balance}개</p>
          {draw.result.kind !== "currency" && (
            <Link href="/shop/wardrobe">옷장에서 확인하기</Link>
          )}
        </div>
      )}
      {mutation.pending && !mutation.busy && (
        <Notice tone="info">이전 추첨 결과를 다시 확인해 주세요.</Notice>
      )}
      <button
        className="button primary"
        disabled={
          mutation.busy ||
          (!mutation.pending &&
            (!tickets.length || !!resource.error || resource.loading))
        }
        onClick={() => void spin()}
      >
        <SubmitLabel busy={mutation.busy}>
          {mutation.pending && !mutation.busy
            ? "이전 추첨 결과 확인"
            : "룰렛 돌리기"}
        </SubmitLabel>
      </button>
      {!tickets.length && resource.data && !mutation.pending && (
        <p>사용할 룰렛이 없어요. 연속 운동 5일마다 선물을 받을 수 있어요.</p>
      )}
      {resource.data?.policy && (
        <details>
          <summary>이번 룰렛의 보상 확률</summary>
          <ul>
            {resource.data.policy.rewards.map((r) => (
              <li key={r.id}>
                {r.kind === "currency"
                  ? `해바라기씨 ${r.amount}개`
                  : r.kind === "clothing"
                    ? "랜덤 의상"
                    : "랜덤 자세"}{" "}
                · {r.probability}%
              </li>
            ))}
          </ul>
        </details>
      )}
      <Link className="button secondary" href="/">
        메인으로
      </Link>
    </>
  );
}
export function RewardLinks() {
  const resource = useApiResource(
    useCallback(async (signal: AbortSignal) => {
      const groups = await getGroups(signal);
      const [personal, ...counts] = await Promise.all([
        personalRouletteEnabled
          ? getPersonalTickets(signal).then(
              (t) => t.filter((x) => x.usable).length,
            )
          : Promise.resolve(null),
        ...groups.map((g) =>
          getGroupTickets(g.id, signal).then((t) => ({
            id: g.id,
            name: g.name,
            count: t.filter((x) => x.usable).length,
          })),
        ),
      ]);
      return { personal, groups: counts };
    }, []),
  );
  return (
    <div className="stack-sm reward-links">
      <Link className="button secondary" href="/roulette/personal">
        개인 룰렛
        {resource.data?.personal != null
          ? ` · ${resource.data.personal}회`
          : ""}
      </Link>
      {resource.data?.groups
        .filter((g) => g.count > 0)
        .map((g) => (
          <Link
            key={g.id}
            className="button primary"
            href={`/groups/${g.id}/roulette`}
          >
            {g.name} 룰렛 · {g.count}회
          </Link>
        ))}
      {resource.error ? (
        <button className="text-button" onClick={resource.reload}>
          룰렛 횟수 다시 확인
        </button>
      ) : null}
    </div>
  );
}
