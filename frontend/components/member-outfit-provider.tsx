"use client";
import { createContext, useContext } from "react";
import type { AvatarOutfit } from "@/lib/avatar-outfit";
import { getOutfit } from "@/lib/shop";
import { useSession } from "./session-provider";
import { useApiResource } from "./use-api-resource";

const MemberOutfitContext = createContext<ReturnType<
  typeof useApiResource<AvatarOutfit>
> | null>(null);

export function MemberOutfitProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = useSession();
  const resource = useApiResource(getOutfit, {
    refreshKey: session.profileRevision,
    // UserProfileProvider already invalidates the profile on window focus.
    staleTimeMs: Infinity,
  });
  return (
    <MemberOutfitContext.Provider value={resource}>
      {children}
    </MemberOutfitContext.Provider>
  );
}

export function useMemberOutfit() {
  const resource = useContext(MemberOutfitContext);
  if (!resource) throw new Error("MemberOutfitProvider is required");
  return resource;
}
