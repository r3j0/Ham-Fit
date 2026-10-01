"use client";
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useState,
} from "react";
import { parseRenderCatalog } from "@/lib/avatar-catalog";
import type { ItemCatalog } from "./hamster/types";
const load = async (signal: AbortSignal) => {
  const response = await fetch("/hamsters/wardrobe/catalog.json", {
    signal,
    cache: "no-cache",
  });
  if (!response.ok)
    throw new Error("프론트엔드 의상 파일을 불러오지 못했습니다.");
  return parseRenderCatalog(await response.json());
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
  const [catalog, setCatalog] = useState<ItemCatalog>();
  const [error, setError] = useState<unknown>();
  const [version, reload] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setCatalog(result.catalog);
          setError(undefined);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause);
      });
    return () => controller.abort();
  }, [version]);
  return (
    <Context.Provider
      value={{
        catalog,
        error,
        reload,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAvatarCatalog = () => useContext(Context);
