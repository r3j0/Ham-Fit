"use client";
import { useCallback, useState } from "react";
import { errorMessage } from "@/lib/http";
import { getMission, startMission } from "@/lib/group-missions";
import type { MissionStage } from "@/lib/group-mission-contract";
import { useApiResource } from "./use-api-resource";
import { useDurableMutation } from "./use-durable-mutation";
import { Dialog, Loading, Notice, SubmitLabel } from "./ui";
export const stageNames: Record<MissionStage, string> = {
  seed: "씨앗",
  sprout: "새싹",
  stem: "줄기",
  bud: "꽃봉오리",
  sunflower: "해바라기",
};
export function Sunflower({ stage }: { stage: MissionStage }) {
  const grown = stage !== "seed",
    flower = stage === "sunflower";
  return (
    <svg
      className="mission-flower"
      viewBox="0 0 220 200"
      role="img"
      aria-label={stageNames[stage]}
    >
      <ellipse cx="110" cy="182" rx="72" ry="9" fill="#efdfbc" />
      {grown ? (
        <g
          transform={
            stage === "sprout" ? "translate(44 72) scale(.6)" : undefined
          }
        >
          <path
            d="M110 177 Q98 122 110 67"
            fill="none"
            stroke="#63994b"
            strokeWidth="9"
            strokeLinecap="round"
          />
          <path
            d="M106 147 Q60 151 62 112 Q99 111 106 147M107 123 Q145 124 153 86 Q116 85 107 123"
            fill="#89b865"
          />
          {(stage === "bud" || flower) && (
            <>
              {flower &&
                Array.from({ length: 10 }, (_, i) => (
                  <ellipse
                    key={i}
                    cx="110"
                    cy="32"
                    rx="13"
                    ry="25"
                    fill={i % 2 ? "#ffca4c" : "#f3b42e"}
                    transform={`rotate(${i * 36} 110 65)`}
                  />
                ))}
              <circle
                cx="110"
                cy="65"
                r={flower ? 25 : 19}
                fill={flower ? "#86562e" : "#90ae55"}
              />
              {flower && (
                <>
                  <circle cx="102" cy="62" r="2.5" fill="#3c2d24" />
                  <circle cx="118" cy="62" r="2.5" fill="#3c2d24" />
                  <path
                    d="M104 72 Q110 78 116 72"
                    fill="none"
                    stroke="#3c2d24"
                    strokeWidth="2"
                  />
                </>
              )}
            </>
          )}
        </g>
      ) : (
        <ellipse
          cx="110"
          cy="159"
          rx="15"
          ry="23"
          transform="rotate(24 110 159)"
          fill="#855b35"
        />
      )}
    </svg>
  );
}
export function GroupMission({
  id,
  leader,
  memberCount,
  onChanged,
}: {
  id: string;
  leader: boolean;
  memberCount: number;
  onChanged: () => void;
}) {
  const resource = useApiResource(
    useCallback(
      async (signal: AbortSignal) => ({
        mission: await getMission(id, signal),
      }),
      [id],
    ),
  );
  const mutation = useDurableMutation(`mission:start:${id}`);
  const [confirm, setConfirm] = useState(false),
    [error, setError] = useState("");
  async function start() {
    setError("");
    try {
      const result = await mutation.run("{}", (body, key) =>
        startMission(id, body, key),
      );
      if (result) {
        setConfirm(false);
        resource.reload();
        onChanged();
      }
    } catch (e) {
      setError(errorMessage(e));
      setConfirm(false);
      resource.reload();
    }
  }
  const mission = resource.data?.mission;
  return (
    <section className="mission-card stack-sm" aria-label="그룹 해바라기 미션">
      <div className="mission-heading">
        <h2>함께 키우는 해바라기</h2>
        <span>그룹 미션</span>
      </div>
      {error && <Notice>{error}</Notice>}
      {resource.error ? (
        <>
          <Notice>{errorMessage(resource.error)}</Notice>
          <button className="button secondary" onClick={resource.reload}>
            미션 다시 불러오기
          </button>
        </>
      ) : null}
      {!mission && !resource.error && <Loading />}
      {mission?.id ? (
        <>
          <Sunflower stage={mission.stage} />
          <h3>
            {mission.status === "completed"
              ? "해바라기를 다 키웠어요!"
              : `${stageNames[mission.stage]}만큼 자랐어요`}
          </h3>
          <progress
            className="mission-progress"
            value={mission.waterCount}
            max={mission.totalTarget}
            aria-label="물 주기 달성도"
          />
          <p>
            물 {mission.waterCount} / {mission.totalTarget}번 · 시작 인원{" "}
            {mission.memberCount}명
          </p>
          <p className="caption">내가 준 물 {mission.me.waterCount}번</p>
          {!mission.me.eligible && (
            <Notice tone="info">
              {mission.me.reason === "not_in_snapshot"
                ? "미션 시작 후 들어왔어요. 다음 미션부터 참여할 수 있어요."
                : "이전 미션의 참여 자격이 종료되었어요. 다음 미션부터 참여할 수 있어요."}
            </Notice>
          )}
          {mission.status === "in_progress" && mission.me.eligible && (
            <p className="caption">
              오늘의 운동을 모두 마치면 하루 한 번 자동으로 물을 줘요.
            </p>
          )}
        </>
      ) : (
        mission && (
          <>
            <Sunflower stage="seed" />
            <p>함께 운동하고 해바라기를 키워 보세요.</p>
          </>
        )
      )}
      {(mutation.pending ||
        (leader && mission && mission.status !== "in_progress")) && (
        <button
          className="button primary"
          disabled={mutation.busy || (!mutation.pending && memberCount < 2)}
          onClick={() => (mutation.pending ? void start() : setConfirm(true))}
        >
          <SubmitLabel busy={mutation.busy}>
            {mutation.pending
              ? "이전 시작 결과 확인"
              : memberCount < 2
                ? "2명부터 미션을 시작할 수 있어요"
                : "새 미션 시작"}
          </SubmitLabel>
        </button>
      )}
      {!leader && mission?.status === "not_started" && (
        <p className="caption">그룹장이 미션을 시작할 수 있어요.</p>
      )}
      <p className="caption">
        해바라기가 완성되면 내 물 주기 7번마다 룰렛 1회를 받아요.
      </p>
      {confirm && (
        <Dialog
          title="함께 해바라기를 키울까요?"
          busy={mutation.busy}
          onClose={() => setConfirm(false)}
        >
          <p>
            시작하는 순간 그룹에 있는 구성원만 이번 미션에 참여해요. 시작 후에는
            중단하거나 초기화할 수 없어요.
          </p>
          <button
            className="button primary"
            disabled={mutation.busy}
            onClick={() => void start()}
          >
            <SubmitLabel busy={mutation.busy}>미션 시작</SubmitLabel>
          </button>
        </Dialog>
      )}
    </section>
  );
}
