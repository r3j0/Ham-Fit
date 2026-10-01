import { backendRequest, localRequest } from '@/lib/backend';
import { publishDraft, pullCatalog } from '@/lib/publish';
import { exportFrontendAssets } from '@/lib/frontend-assets';
import { withWorkspaceLock } from '@/lib/workspace-lock';
import { WardrobeStoreError } from '@/lib/wardrobe-errors';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!localRequest(request, false)) return Response.json({ error: '로컬 편집 앱에서만 사용할 수 있습니다.' }, { status: 403 });
  try { return Response.json(await backendRequest('/avatar-manager/catalog', {}, 60000, 2), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : '서버 연결에 실패했습니다.' }, { status: 502 }); }
}
export async function POST(request: Request) {
  if (!localRequest(request)) return Response.json({ error: '로컬 편집 앱에서만 등록할 수 있습니다.' }, { status: 403 });
  try {
    const body = await request.text();
    if (body.length > 200000) throw new Error('등록 요청이 너무 큽니다.');
    const input = JSON.parse(body);
    if (!['pull', 'export', 'publish'].includes(input.action)) throw new Error('지원하지 않는 작업입니다.');
    const result = await withWorkspaceLock(() => input.action === 'pull' ? pullCatalog() : input.action === 'export' ? exportFrontendAssets(input) : publishDraft(input));
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : '등록에 실패했습니다.' }, { status: error instanceof WardrobeStoreError ? error.status : 400 }); }
}
