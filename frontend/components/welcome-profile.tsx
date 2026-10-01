"use client";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/session";
import { errorMessage } from "@/lib/http";
import {
  nicknameError,
  normalizeNickname,
  parseNicknameProfile,
} from "@/lib/nickname";
import { getOutfit, saveOutfit } from "@/lib/shop";
import { sameSelection } from "@/lib/shop-contract";
import type { AvatarOutfit } from "@/lib/avatar-outfit";
import { MascotPose } from "./mascot/MascotPose";
import { useApiResource } from "./use-api-resource";
import { useOperationScope } from "./use-operation-scope";
import { Header, Loading, Notice, Shell, SubmitLabel } from "./ui";

export function WelcomeProfile() {
  const resource = useApiResource(
    useCallback(async (signal: AbortSignal) => {
      const [profile, outfit] = await Promise.all([
        api<unknown>("/users/me/profile", { signal }).then(({ data }) =>
          parseNicknameProfile(data),
        ),
        getOutfit(signal),
      ]);
      return { ...profile, outfit };
    }, []),
  );
  return (
    <Shell>
      <Header title="나만의 프로필" />
      <div className="content stack">
        <div className="intro">
          <p className="eyebrow">처음 만나 반가워요</p>
          <h1>어떤 모습으로 시작할까요?</h1>
          <p>함께 운동할 이름과 햄스터를 골라 주세요.</p>
        </div>
        {resource.error ? (
          <>
            <Notice>{errorMessage(resource.error)}</Notice>
            <button className="button secondary" onClick={resource.reload}>
              다시 불러오기
            </button>
          </>
        ) : null}
        {resource.data ? (
          <ProfileChoice initial={resource.data} />
        ) : (
          !resource.error && <Loading />
        )}
      </div>
    </Shell>
  );
}
function ProfileChoice({
  initial,
}: {
  initial: { nickname: string | null; outfit: AvatarOutfit };
}) {
  const router = useRouter(),
    begin = useOperationScope(),
    guard = useRef(false);
  const [nickname, setNickname] = useState(initial.nickname ?? ""),
    [variant, setVariant] = useState(initial.outfit.rendering.variant);
  const [base, setBase] = useState(initial.outfit),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (guard.current) return;
    const validation = nicknameError(nickname);
    if (validation) {
      setError(validation);
      return;
    }
    guard.current = true;
    setBusy(true);
    setError("");
    const current = begin();
    const selection = {
      characterId: `character.${variant}`,
      poseId: base.poseId,
      clothingIds: base.clothingIds,
    };
    try {
      const saved = parseNicknameProfile(
        (
          await api<unknown>("/users/me/profile", {
            method: "PATCH",
            headers: { "X-CSRF-Protection": "1" },
            body: JSON.stringify({ nickname: normalizeNickname(nickname) }),
          })
        ).data,
      );
      if (!current()) return;
      if (saved.nickname !== normalizeNickname(nickname))
        throw new Error("저장된 닉네임을 다시 확인해 주세요.");
      if (!sameSelection(selection, base)) {
        try {
          await saveOutfit(selection, base.revision);
        } catch (e) {
          // A lost PUT response can already have saved this exact choice.
          const latest = await getOutfit();
          if (!current()) return;
          setBase(latest);
          if (!sameSelection(latest, selection)) {
            setVariant(latest.rendering.variant);
            throw e;
          }
        }
      }
      if (current()) router.replace("/onboarding");
    } catch (e) {
      if (current()) setError(errorMessage(e));
    } finally {
      if (current()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <form className="stack" onSubmit={save}>
      <div className="field">
        <label htmlFor="welcome-nickname">닉네임</label>
        <input
          id="welcome-nickname"
          autoComplete="nickname"
          required
          value={nickname}
          disabled={busy}
          onChange={(e) => setNickname(e.target.value)}
          aria-describedby="welcome-nickname-hint"
        />
        <p id="welcome-nickname-hint" className="caption">
          한글·영문·숫자·밑줄(_) 2~20자
        </p>
      </div>
      <div className="character-choices" role="group" aria-label="햄스터 선택">
        {(["cream", "gray"] as const).map((v) => (
          <button
            type="button"
            className="character-choice"
            key={v}
            aria-pressed={variant === v}
            disabled={busy}
            onClick={() => setVariant(v)}
          >
            <MascotPose variant={v} pose="basic" size={140} label="" />
            <strong>{v === "cream" ? "햄돌이" : "햄콩이"}</strong>
          </button>
        ))}
      </div>
      <p className="caption">
        두 햄스터와 기본 자세는 모두 제공돼요. 코디는 나중에 옷장에서 바꿀 수
        있어요.
      </p>
      {error && <Notice>{error}</Notice>}
      <button className="button primary" disabled={busy}>
        <SubmitLabel busy={busy}>저장하고 다음으로</SubmitLabel>
      </button>
    </form>
  );
}
