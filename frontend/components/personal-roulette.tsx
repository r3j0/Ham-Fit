"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import {
  getPersonalTickets,
  personalRouletteEnabled,
  spinPersonal,
} from "@/lib/personal-rewards";
import { getCatalog, getInventory } from "@/lib/shop";
import { productName } from "@/lib/avatar-preview";
import {
  personalPolicy,
  personalPolicyVersion,
  type PersonalDraw,
} from "@/lib/personal-reward-contract";
import { errorMessage } from "@/lib/http";
import { useApiResource } from "./use-api-resource";
import { useDurableMutation } from "./use-durable-mutation";
import { Header, Loading, Notice, Shell, SubmitLabel } from "./ui";
import { useUnsaved } from "./use-unsaved";
import { SeedIcon } from "./seed-icon";
import { SeedBalance } from "./seed-balance";
import {
  RouletteWheel,
  RouletteRewardPopup,
  RouletteProbabilities,
  useRouletteMotion,
  useRouletteLayout,
  useRouletteReward,
  type RoulettePrize,
} from "./roulette-wheel";
import styles from "./roulette-wheel.module.css";
const prizes: RoulettePrize[] = [
  { label: "해바라기씨 1개", kind: "seeds", amount: 1 },
  { label: "해바라기씨 3개", kind: "seeds", amount: 3 },
  { label: "해바라기씨 5개", kind: "seeds", amount: 5 },
  { label: "해바라기씨 10개", kind: "seeds", amount: 10 },
  { label: "랜덤 의상", kind: "clothing" },
  { label: "랜덤 자세", kind: "pose" },
];
const results = [
  "seeds_1",
  "seeds_3",
  "seeds_5",
  "seeds_10",
  "clothing",
  "pose",
];

export function PersonalRoulette() {
  return (
    <Shell className={styles.page}>
      <Header title="스트릭 보상 룰렛" back="/" />
      <div className="content stack roulette-page">
        {personalRouletteEnabled ? (
          <PersonalWheel />
        ) : (
          <>
            <div className="reward-symbol" aria-hidden="true">
              <SeedIcon height={100} />
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
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        );
      const policy =
        !available.length ||
        available[0]?.policyVersion === personalPolicyVersion
          ? personalPolicy
          : undefined;
      return { tickets: available, inventory, catalog, policy };
    }, []),
  );
  const mutation = useDurableMutation("roulette:personal"),
    [draw, setDraw] = useState<PersonalDraw>(),
    [error, setError] = useState("");
  const tickets =
    resource.data?.tickets.filter((t) => t.id !== draw?.ticketId) ?? [];
  const motion = useRouletteMotion();
  const layout = useRouletteLayout(prizes, "personal");
  const reward = useRouletteReward(
    resource.data && !resource.loading && !resource.error
      ? tickets.length
      : undefined,
  );
  const busy = mutation.busy || motion.busy;
  useUnsaved(busy);
  async function spin() {
    setError("");
    try {
      const result = await motion.play(
        () =>
          mutation.run(
            JSON.stringify({ ticketId: tickets[0]?.id }),
            spinPersonal,
          ),
        (value) =>
          layout.prizes.indexOf(prizes[results.indexOf(value.originalResult)]),
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
  const wonProduct = resource.data?.catalog.products.find(
    (p) => p.id === draw?.actualReward.productId,
  );
  return (
    <>
      <div className="intro">
        <h1>나만의 행운 룰렛</h1>
        <p>
          남은 룰렛{" "}
          <strong>{resource.data ? `${tickets.length}회` : "확인 중"}</strong>
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
        {resource.data?.policy && (
          <RouletteProbabilities
            prizes={prizes}
            probabilities={resource.data.policy.map((r) => r.probability)}
            label="스트릭 룰렛 보상 확률"
          />
        )}
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
      {draw && reward.visible && (
        <RouletteRewardPopup
          prize={{
            label: "받은 선물",
            kind: draw.actualReward.kind,
            amount:
              draw.actualReward.kind === "seeds"
                ? draw.actualReward.amount
                : undefined,
          }}
          title={
            draw.actualReward.kind === "seeds"
              ? `해바라기씨 ${draw.actualReward.amount}개를 받았어요!`
              : `${wonProduct ? productName(wonProduct) : draw.actualReward.kind === "pose" ? "새로운 자세" : "새로운 의상"}를 받았어요!`
          }
          description={
            draw.fallback.applied
              ? `받을 수 있는 ${draw.originalResult === "clothing" ? "의상" : "자세"}이 없어 해바라기씨로 지급됐어요.`
              : draw.actualReward.kind !== "seeds"
                ? "받은 아이템은 내 옷장에서 확인할 수 있어요."
                : undefined
          }
          onClose={reward.dismiss}
        />
      )}
      {mutation.pending && !mutation.busy && (
        <Notice tone="info">이전 추첨 결과를 다시 확인해 주세요.</Notice>
      )}
      <button
        className="button primary"
        disabled={
          busy ||
          !layout.ready ||
          reward.visible ||
          (!mutation.pending &&
            (!tickets.length || !!resource.error || resource.loading))
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
      {!tickets.length && resource.data && !mutation.pending && (
        <p>사용할 룰렛이 없어요. 연속 운동 5일마다 선물을 받을 수 있어요.</p>
      )}
      <Link className="button secondary" href="/">
        메인으로
      </Link>
    </>
  );
}
