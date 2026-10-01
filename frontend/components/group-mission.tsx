"use client";
import { useCallback, useState } from "react";
import { errorMessage } from "@/lib/http";
import { getMission, startMission } from "@/lib/group-missions";
import { Droplets, Info } from "lucide-react";
import { MissionGrowthImage, stageNames } from "./mission-growth-image";
import styles from "./group-mission.module.css";
import { missionStages } from "@/lib/group-mission-contract";
import { useApiResource } from "./use-api-resource";
import { useDurableMutation } from "./use-durable-mutation";
import { Dialog, Loading, Notice, SubmitLabel } from "./ui";
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
    [guide, setGuide] = useState(false),
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
        <button
          type="button"
          className={styles.infoButton}
          aria-label="해바라기 미션 안내"
          aria-haspopup="dialog"
          aria-expanded={guide}
          onClick={() => setGuide(true)}
        >
          <Info size={18} aria-hidden="true" />
        </button>
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
          <div className={styles.visual}>
            <div className={styles.plantFrame}>
              <MissionGrowthImage stage={mission.stage} />
            </div>
            <div className={styles.meter}>
              <p className={styles.stageLabel}>
                {mission.status === "completed"
                  ? "해바라기 완성!"
                  : `${stageNames[mission.stage]} 단계`}
              </p>
              <p className={styles.waterCount}>
                <Droplets size={18} aria-hidden="true" />
                <strong>{mission.waterCount}</strong>
                <span>/ {mission.totalTarget}회</span>
              </p>
              <progress
                className={styles.progress}
                value={mission.waterCount}
                max={mission.totalTarget}
                aria-label="물 주기 달성도"
                aria-valuetext={`함께 준 물 ${mission.waterCount}회 / ${mission.totalTarget}회`}
              />
            </div>
          </div>
          <p className={styles.contribution}>
            내가 준 물 <strong>{mission.me.waterCount}회</strong>
          </p>
          {!mission.me.eligible && (
            <Notice tone="info">
              {mission.me.reason === "not_in_snapshot"
                ? "미션 시작 후 들어왔어요. 다음 미션부터 참여할 수 있어요."
                : "이전 미션의 참여 자격이 종료되었어요. 다음 미션부터 참여할 수 있어요."}
            </Notice>
          )}
        </>
      ) : (
        mission && (
          <>
            <div className={styles.visual}>
              <div className={styles.plantFrame}>
                <MissionGrowthImage stage="seed" />
              </div>
              <p className={styles.notStartedText}>
                물을 주며 해바라기를 키워 보세요.
              </p>
            </div>
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
      {guide && (
        <Dialog title="해바라기 미션 안내" onClose={() => setGuide(false)}>
          <ol className={styles.guideStages} aria-label="해바라기 성장 단계">
            {missionStages.map((stage) => (
              <li key={stage}>
                <MissionGrowthImage stage={stage} size={44} decorative />
                <span>{stageNames[stage]}</span>
              </li>
            ))}
          </ol>
          <p>운동을 완료하면 하루 한 그룹에 물 1회를 줄 수 있어요.</p>
          <p>
            미션이 시작될 때 함께한 그룹원이 해바라기를 키워요. 시작 후 들어온
            그룹원은 다음 미션부터 참여할 수 있어요.
          </p>
          <p>해바라기 완성 후, 내가 준 물 7회마다 룰렛 1회를 받아요.</p>
        </Dialog>
      )}
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
