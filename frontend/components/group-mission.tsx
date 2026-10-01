"use client";
import { useCallback, useState } from "react";
import { errorMessage } from "@/lib/http";
import { getMission, startMission } from "@/lib/group-missions";
import { Check, Droplets, Ticket } from "lucide-react";
import { SunflowerIcon } from "./sunflower-icon";
import styles from "./group-mission.module.css";
import { missionStages, type MissionStage } from "@/lib/group-mission-contract";
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
    <section className={styles.card} aria-label="그룹 해바라기 미션">
      <div className={styles.heading}>
        <h2>함께 키우는 해바라기</h2>
        <span>
          {mission?.status === "in_progress"
            ? "진행 중"
            : mission?.status === "completed"
              ? "완성"
              : "그룹 미션"}
        </span>
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
          <div className={styles.summary}>
            <div className={styles.flower}>
              <SunflowerIcon size={104} alt="그룹 해바라기" />
            </div>
            <div className={styles.summaryInfo}>
              <span className={styles.stage}>
                {stageNames[mission.stage]} 단계
              </span>
              <h3>
                {mission.status === "completed"
                  ? "해바라기를 다 키웠어요!"
                  : `완성까지 물 ${mission.totalTarget - mission.waterCount}회`}
              </h3>
              <p>시작 인원 {mission.memberCount}명이 함께 키우고 있어요.</p>
            </div>
          </div>
          <div className={styles.progressHeading}>
            <span>
              <Droplets size={16} aria-hidden="true" /> 함께 준 물
            </span>
            <strong>
              {mission.waterCount} / {mission.totalTarget}회
            </strong>
          </div>
          <progress
            className={styles.progress}
            value={mission.waterCount}
            max={mission.totalTarget}
            aria-label="물 주기 달성도"
          />
          <ol className={styles.stages} aria-label="해바라기 성장 단계">
            {missionStages.map((stage, index) => {
              const reached = mission.waterCount >= mission.stageTargets[stage];
              return (
                <li
                  key={stage}
                  data-reached={reached || undefined}
                  aria-current={stage === mission.stage ? "step" : undefined}
                >
                  <span>
                    {reached ? (
                      <Check size={13} aria-hidden="true" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <strong>{stageNames[stage]}</strong>
                  <small>{mission.stageTargets[stage]}회</small>
                </li>
              );
            })}
          </ol>
          <div className={styles.personal}>
            <span>
              <Droplets size={18} aria-hidden="true" /> 내가 준 물
            </span>
            <strong>{mission.me.waterCount}회</strong>
            <small>
              {mission.me.eligible
                ? `${mission.status === "completed" ? "이번 회차 룰렛" : "완성 후 룰렛"} ${Math.floor(mission.me.waterCount / 7)}회`
                : "참여 자격 종료 · 이번 회차 보상 제외"}
              {mission.me.eligible &&
              mission.status === "in_progress" &&
              mission.me.waterCount % 7
                ? ` · 다음 룰렛까지 ${7 - (mission.me.waterCount % 7)}회`
                : ""}
            </small>
          </div>
          {!mission.me.eligible && (
            <Notice tone="info">
              {mission.me.reason === "not_in_snapshot"
                ? "미션 시작 후 들어왔어요. 다음 미션부터 참여할 수 있어요."
                : "이전 미션의 참여 자격이 종료되었어요. 다음 미션부터 참여할 수 있어요."}
            </Notice>
          )}
          {mission.status === "in_progress" && mission.me.eligible && (
            <p className="caption">
              오늘의 운동을 모두 마치고 하루 한 그룹에 물을 주세요.
            </p>
          )}
        </>
      ) : (
        mission && (
          <>
            <div className={styles.emptyFlower}>
              <SunflowerIcon size={96} alt="함께 키울 해바라기" />
            </div>
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
      <p className={styles.rewardHint}>
        <Ticket size={16} aria-hidden="true" /> 해바라기 완성 후, 내 물 주기
        7회마다 룰렛 1회
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
