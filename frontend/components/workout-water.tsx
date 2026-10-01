"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Check, Droplets } from "lucide-react";
import { getMissionWater, selectMissionWater } from "@/lib/group-mission-water";
import { errorMessage } from "@/lib/http";
import type { MissionWater } from "@/lib/group-mission-water-contract";
import { useApiResource } from "./use-api-resource";
import { useDurableMutation } from "./use-durable-mutation";
import { useUnsaved } from "./use-unsaved";
import { Loading, Notice, SubmitLabel } from "./ui";
import { SunflowerIcon } from "./sunflower-icon";
import styles from "./group-mission.module.css";

const reasons = {
  no_eligible_missions: "운동을 마칠 때 참여 중인 그룹 미션이 없었어요.",
  not_first_completion:
    "오늘의 첫 운동 완료에서만 물을 받을 수 있어요. 이전에 완료한 운동의 물 주기 내역을 확인해 주세요.",
  expired: "물 주기는 운동을 완료한 날에만 할 수 있어요.",
  missions_ended: "참여했던 미션이 종료되었거나 참여 자격이 변경됐어요.",
};
export function WorkoutWater({
  id,
  next,
  sourceKind = "routine",
}: {
  id: string;
  next: string;
  sourceKind?: "routine" | "daily_assignment";
}) {
  const resource = useApiResource(
    useCallback(
      (signal: AbortSignal) => getMissionWater(id, signal, sourceKind),
      [id, sourceKind],
    ),
  );
  const mutation = useDurableMutation(`mission:water:${sourceKind}:${id}`);
  const [selected, setSelected] = useState("");
  const [saved, setSaved] = useState<MissionWater>();
  const [error, setError] = useState("");
  const water = saved ?? resource.data;
  useUnsaved(
    mutation.busy,
    "물 주기 결과를 확인 중이에요. 이 화면을 나갈까요?",
  );
  async function choose() {
    setError("");
    try {
      const result = await mutation.run(
        JSON.stringify({
          sourceKind,
          sourceId: id,
          groupId: selected,
        }),
        selectMissionWater,
      );
      if (result) {
        setSaved(result);
        resource.reload();
      }
    } catch (e) {
      setError(errorMessage(e));
      resource.reload();
    }
  }
  return (
    <section className={styles.waterPage} aria-label="오늘의 그룹 물 주기">
      <div className={styles.waterHero}>
        <SunflowerIcon size={120} />
        <span className={styles.waterDrop}>
          <Droplets size={24} aria-hidden="true" />
        </span>
      </div>
      {error && <Notice>{error}</Notice>}
      {resource.error ? (
        <>
          <Notice>{errorMessage(resource.error)}</Notice>
          <button className="button secondary" onClick={resource.reload}>
            물 주기 다시 확인
          </button>
        </>
      ) : null}
      {!water && !resource.error && (
        <Loading label="오늘의 물 주기를 확인하고 있어요" />
      )}
      {water?.status === "contributed" && (
        <>
          <span className={styles.success}>
            <Check size={16} aria-hidden="true" /> 물 1회 반영 완료
          </span>
          <h1>{water.contribution.groupName} 그룹에 물을 주었어요!</h1>
          <p>오늘의 운동이 함께 키우는 해바라기를 자라게 했어요.</p>
          <Link
            className={styles.groupLink}
            href={`/groups/${water.contribution.groupId}`}
          >
            그룹 해바라기 보기
          </Link>
        </>
      )}
      {water?.status === "pending" && (
        <>
          <h1>어느 그룹에 물을 줄까요?</h1>
          <p>오늘 얻은 물 1회는 한 그룹에만 줄 수 있어요.</p>
          <fieldset
            className={styles.choices}
            disabled={
              mutation.busy ||
              !!mutation.pending ||
              !!resource.error ||
              resource.loading
            }
          >
            <legend className={styles.visuallyHidden}>물을 줄 그룹 선택</legend>
            {water.options.map((option) => (
              <label
                key={option.groupId}
                className={styles.choice}
                data-selected={selected === option.groupId || undefined}
              >
                <input
                  type="radio"
                  name="water-group"
                  value={option.groupId}
                  checked={selected === option.groupId}
                  onChange={() => setSelected(option.groupId)}
                />
                <SunflowerIcon size={42} />
                <span className={styles.choiceInfo}>
                  <strong>{option.groupName}</strong>
                  <span>
                    물 {option.waterCount} / {option.totalTarget}회
                  </span>
                  <progress
                    aria-label={`${option.groupName} 미션 달성도`}
                    value={option.waterCount}
                    max={option.totalTarget}
                  />
                </span>
              </label>
            ))}
          </fieldset>
          <button
            className="button primary"
            disabled={
              mutation.busy ||
              (!mutation.pending &&
                (!water.options.some((o) => o.groupId === selected) ||
                  !!resource.error ||
                  resource.loading))
            }
            onClick={() => void choose()}
          >
            <SubmitLabel busy={mutation.busy}>
              {mutation.pending
                ? "이전 물 주기 결과 확인"
                : "선택한 그룹에 물 주기"}
            </SubmitLabel>
          </button>
          <p className={styles.hint}>
            물 주기는 운동을 완료한 날에만 가능해요. 반영한 물은 다른 그룹으로
            옮길 수 없어요.
          </p>
        </>
      )}
      {water?.status === "unavailable" && (
        <>
          <h1>오늘의 물 주기를 확인했어요</h1>
          <p>{reasons[water.reason]}</p>
          <Link className={styles.groupLink} href="/groups">
            내 그룹 보기
          </Link>
        </>
      )}
      {mutation.pending && water?.status !== "pending" && (
        <button
          className="button secondary"
          disabled={mutation.busy}
          onClick={() => void choose()}
        >
          <SubmitLabel busy={mutation.busy}>이전 물 주기 결과 확인</SubmitLabel>
        </button>
      )}
      {water && !mutation.busy && (
        <Link className="button secondary" href={next}>
          {water.status === "pending"
            ? "나중에 선택하기"
            : next === "/"
              ? "메인으로"
              : "다음"}
        </Link>
      )}
    </section>
  );
}
