export class ApiError extends Error {
  public status: number;
  public fields: Record<string, string>;
  public retryAfter?: number;
  public code?: string;
  constructor(
    status: number,
    message: string,
    fields: Record<string, string> = {},
    retryAfter?: number,
    code?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
    this.retryAfter = retryAfter;
    this.code = code;
  }
}
export type RequestOptions = RequestInit & { allowNull?: boolean };
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; headers: Headers }> {
  const { allowNull = false, ...init } = options;
  let response: Response;
  try {
    // Direct browser requests keep each client's IP visible to the backend.
    const base = (
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api/v1"
    ).replace(/\/$/, "");
    response = await fetch(`${base}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      0,
      "서버에 연결하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.",
    );
  }
  let invalidJson = false;
  const body =
    response.status === 204
      ? null
      : await response.json().catch(() => {
          invalidJson = true;
          return null;
        });
  if (!response.ok) {
    const fields: Record<string, string> = {};
    if (Array.isArray(body?.errors))
      for (const issue of body.errors) {
        if (
          typeof issue.field === "string" &&
          typeof issue.message === "string"
        )
          fields[issue.field] = issue.message;
      }
    const retryAfter =
      Number(body?.retry_after ?? response.headers.get("Retry-After")) ||
      undefined;
    const messages: Record<number, string> = {
      401: "로그인이 만료되었어요. 다시 로그인해 주세요.",
      403: "요청을 확인할 수 없어요. 페이지를 새로고침하거나 관리자에게 알려 주세요.",
      404: "기록을 찾을 수 없어요. 삭제되었거나 접근할 수 없는 기록입니다.",
      409: "이미 처리된 요청과 내용이 달라요. 기록을 확인해 주세요.",
      410: "이 저장 요청으로 만든 기록은 이미 삭제되었어요. 목록에서 확인해 주세요.",
      412: "다른 곳에서 이 기록을 수정했어요. 최신 내용을 먼저 확인해 주세요.",
      429: `요청이 많아요. ${retryAfter ? `${retryAfter}초 후` : "잠시 후"} 다시 시도해 주세요.`,
    };
    const message =
      response.status >= 500
        ? "서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해 주세요."
        : (messages[response.status] ??
          (typeof body?.message === "string"
            ? body.message
            : "입력 내용을 확인해 주세요."));
    throw new ApiError(
      response.status,
      message,
      fields,
      retryAfter,
      typeof body?.code === "string" ? body.code : undefined,
    );
  }
  if (response.status !== 204 && (invalidJson || (body === null && !allowNull)))
    throw new ApiError(0, "서버 응답을 확인하지 못했어요. 다시 시도해 주세요.");
  return { data: body as T, headers: response.headers };
}
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "문제가 발생했어요. 다시 시도해 주세요.";
