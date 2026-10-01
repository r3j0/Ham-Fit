"use client";
import { createContext, useContext } from "react";
import { api } from "@/lib/session";
import { parseRenderCatalog } from "@/lib/avatar-catalog";
import { useApiResource } from "./use-api-resource";
import type { ItemCatalog } from "./hamster/types";
const load = async (signal: AbortSignal) => {
  const { data } = await api<unknown>("/avatar/render-catalog", { signal });
  return parseRenderCatalog(
    data,
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api/v1",
  );
};
const Context = createContext<{
  catalog: ItemCatalog | undefined;
  error: unknown;
  reload: () => void;
}>({ catalog: undefined, error: undefined, reload: () => {} });
export function AvatarCatalogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const resource = useApiResource(load);
  return (
    <Context.Provider
      value={{
        catalog: resource.data?.catalog,
        error: resource.error,
        reload: resource.reload,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAvatarCatalog = () => useContext(Context);
