import { ApiError, errorMessage, request } from "./http";
import type { RequestOptions } from "./http";
import type { AuthResponse, User } from "./types";
import { measurementDrafts } from "./measurement-drafts";
type Session = {
  status: "loading" | "authenticated" | "anonymous" | "error";
  user: User | null;
  error?: string;
  generation: number;
};
const initial: Session = { status: "loading", user: null, generation: 0 };
let session = initial;
let accessToken: string | null = null;
let refreshPromise: Promise<void> | undefined;
let startup: Promise<void> | undefined;
let channel: BroadcastChannel | undefined;
const listeners = new Set<() => void>();
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getSession = () => session;
export const getServerSession = () => initial;
function publish(next: Session) {
  session = next;
  for (const listener of listeners) listener();
}
function accept(auth: AuthResponse, broadcast = true, newLogin = false) {
  measurementDrafts.setOwner(auth.user.id);
  accessToken = auth.access_token;
  publish({
    status: "authenticated",
    user: auth.user,
    generation:
      session.generation +
      (newLogin || session.user?.id !== auth.user.id ? 1 : 0),
  });
  if (broadcast)
    channel?.postMessage({ type: "authenticated", auth, newLogin });
}
function clear(reason: "expired" | "logout" = "expired", broadcast = true) {
  if (reason === "logout") measurementDrafts.clear();
  else measurementDrafts.suspend();
  accessToken = null;
  publish({
    status: "anonymous",
    user: null,
    generation: session.generation + 1,
  });
  if (broadcast) channel?.postMessage({ type: "logout", reason });
}
async function locked<T>(action: () => Promise<T>): Promise<T> {
  if (navigator.locks)
    return navigator.locks.request("modu-auth-session", action);
  return action();
}
export function startSession() {
  if (startup) return startup;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("modu-auth-session");
    channel.onmessage = ({ data }) => {
      if (data?.type === "logout")
        clear(data.reason === "expired" ? "expired" : "logout", false);
      if (
        data?.type === "authenticated" &&
        typeof data.auth?.access_token === "string" &&
        typeof data.auth?.user?.id === "string"
      )
        accept(data.auth, false, !!data.newLogin);
    };
  }
  startup = refresh().catch((error) => {
    if (session.status !== "anonymous" && session.status !== "authenticated")
      publish({
        status: "error",
        user: null,
        generation: session.generation,
        error: errorMessage(error),
      });
  });
  return startup;
}
export async function refresh(failedToken?: string | null) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = locked(async () => {
    if (accessToken && accessToken !== failedToken) return;
    // Without cross-tab locking, do not rotate cookies unsafely; explicit login still works.
    if (!navigator.locks) {
      clear("expired", false);
      throw new ApiError(
        401,
        "자동 로그인 유지가 지원되지 않는 환경이에요. 다시 로그인해 주세요.",
      );
    }
    const generation = session.generation;
    try {
      const result = await request<AuthResponse>("/auth/refresh", {
        method: "POST",
        headers: { "X-CSRF-Protection": "1" },
      });
      if (generation === session.generation) accept(result.data);
    } catch (error) {
      if (
        generation === session.generation &&
        error instanceof ApiError &&
        error.status === 401
      )
        clear();
      throw error;
    }
  }).finally(() => {
    refreshPromise = undefined;
  });
  return refreshPromise;
}
export async function authenticate(
  mode: "login" | "register",
  email: string,
  password: string,
  dateOfBirth?: string,
) {
  await startup;
  return locked(async () => {
    const result = await request<AuthResponse>(`/auth/${mode}`, {
      method: "POST",
      headers: { "X-CSRF-Protection": "1" },
      body: JSON.stringify({
        email,
        password,
        ...(mode === "register" && dateOfBirth ? { dateOfBirth } : {}),
      }),
    });
    accept(result.data, true, true);
  });
}
export async function logout() {
  return locked(async () => {
    try {
      await request("/auth/logout", {
        method: "POST",
        headers: {
          "X-CSRF-Protection": "1",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
    } catch (error) {
      // Invalid credentials still end this local session; other failures remain retryable.
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    clear("logout");
  });
}
export async function api<T>(path: string, options: RequestOptions = {}) {
  const generation = session.generation,
    userId = session.user?.id,
    token = accessToken;
  if (!token) throw new ApiError(401, "로그인이 필요해요.");
  const send = () =>
    request<T>(path, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${accessToken}` },
    });
  let result;
  try {
    result = await send();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await refresh(token);
    if (session.user?.id !== userId || session.generation !== generation)
      throw new ApiError(401, "계정이 변경되었어요. 다시 확인해 주세요.");
    result = await send();
  }
  if (session.user?.id !== userId || session.generation !== generation)
    throw new ApiError(401, "로그인 상태가 변경되었어요.");
  return result;
}
