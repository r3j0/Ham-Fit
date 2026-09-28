"use client";
import { useEffect, useState } from "react";
import { api, invalidateUserProfile } from "@/lib/session";
import { ApiError, errorMessage } from "@/lib/http";
import {
  latestFitnessPath,
  parseLatestFitness,
  type LatestFitnessProfile,
} from "@/lib/latest-fitness";
import { FitnessRadar } from "./fitness-radar";
import { useSession } from "./session-provider";
import { Loading, Notice } from "./ui";

type State =
  | { status: "ready"; data: LatestFitnessProfile | null }
  | { status: "error" | "unavailable"; error: string };
export function LatestFitness() {
  const session = useSession();
  const version = `${session.generation}:${session.profileRevision}`;
  const [snapshot, setSnapshot] = useState<{
    version: string;
    state: State;
  } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    api<unknown>(latestFitnessPath, { signal: abort.signal })
      .then(({ data }) => {
        const profile = parseLatestFitness(data);
        if (!abort.signal.aborted)
          setSnapshot({ version, state: { status: "ready", data: profile } });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setSnapshot({
            version,
            state:
              error instanceof ApiError && [404, 501].includes(error.status)
                ? {
                    status: "unavailable",
                    error:
                      "체력 프로필을 준비 중이에요. 등록한 기록은 계속 확인할 수 있어요.",
                  }
                : { status: "error", error: errorMessage(error) },
          });
      });
    return () => abort.abort();
  }, [version]);
  const state = snapshot?.version === version ? snapshot.state : null;
  return (
    <section
      className="stack latest-fitness"
      aria-label="최근 측정 기록의 체력 등급"
    >
      {!state ? (
        <Loading label="최근 체력 프로필을 확인하고 있어요" />
      ) : state.status !== "ready" ? (
        <>
          <Notice tone={state.status === "unavailable" ? "info" : "error"}>
            {state.error}
          </Notice>
          <button
            className="text-button"
            onClick={() => invalidateUserProfile()}
          >
            체력 프로필 다시 확인
          </button>
        </>
      ) : state.data === null ? (
        <p className="muted">아직 등록한 측정 기록이 없어요.</p>
      ) : (
        <FitnessRadar axes={state.data.axes} variant="compact" />
      )}
    </section>
  );
}
