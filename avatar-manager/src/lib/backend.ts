export function backendBase() {
  const value = process.env.AVATAR_BACKEND_URL ?? 'http://127.0.0.1:3001/api/v1';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/v1')) throw new Error('AVATAR_BACKEND_URL은 /api/v1로 끝나는 HTTP(S) 주소여야 합니다.');
  return value.replace(/\/$/, '');
}
export async function backendRequest(path: string, init: RequestInit = {}, timeoutMs = 60000) {
  const token = process.env.AVATAR_MANAGER_TOKEN;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('avatar-manager/.env.local에 AVATAR_MANAGER_TOKEN을 설정하세요.');
  const headers = new Headers(init.headers); headers.set('X-Avatar-Manager-Token', token);
  const response = await fetch(`${backendBase()}${path}`, { ...init, headers, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? 'NestJS 요청에 실패했습니다.');
  return result;
}
export function localRequest(request: Request, write = true) {
  try {
    const internal = new URL(request.url);
    // Next's internal URL can use localhost while the browser uses 127.0.0.1.
    const publicUrl = new URL(`${internal.protocol}//${request.headers.get('host') ?? internal.host}`);
    return !publicUrl.username && !publicUrl.password && publicUrl.pathname === '/' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname) &&
      (!write || request.headers.get('origin') === publicUrl.origin);
  } catch { return false; }
}
