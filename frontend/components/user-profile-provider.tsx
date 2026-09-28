"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { api, invalidateUserProfile } from "@/lib/session";
import { errorMessage } from "@/lib/http";
import { isUserProfile } from "@/lib/user-profile";
import type { UserProfile } from "@/lib/types";
import { useSession } from "./session-provider";

type ProfileState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: UserProfile; error: null }
  | { status: "error"; data: null; error: string };
const loading: ProfileState = { status: "loading", data: null, error: null };
const ProfileContext = createContext<ProfileState>(loading);

export function UserProfileProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = useSession();
  const version = `${session.generation}:${session.profileRevision}`;
  const [snapshot, setSnapshot] = useState<{
    version: string;
    state: ProfileState;
  } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    api<UserProfile>("/auth/me", { signal: abort.signal })
      .then(({ data }) => {
        if (!isUserProfile(data))
          throw new Error(
            "사용자 정보를 확인할 수 없어요. 다시 불러와 주세요.",
          );
        if (!abort.signal.aborted)
          setSnapshot({
            version,
            state: { status: "ready", data, error: null },
          });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setSnapshot({
            version,
            state: { status: "error", data: null, error: errorMessage(error) },
          });
      });
    return () => abort.abort();
  }, [version]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") invalidateUserProfile();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <ProfileContext.Provider
      value={snapshot?.version === version ? snapshot.state : loading}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useUserProfile() {
  return {
    ...useContext(ProfileContext),
    reload: () => invalidateUserProfile(),
  };
}
