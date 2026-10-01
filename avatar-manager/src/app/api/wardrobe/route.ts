import { revalidatePath } from 'next/cache';
import { localRequest } from '@/lib/backend';
import { withWorkspaceLock } from '@/lib/workspace-lock';
import { readWardrobeStore, saveWardrobeChanges, WardrobeStoreError } from '@/lib/wardrobe-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try { return Response.json(await readWardrobeStore(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: '저장된 조정값을 읽을 수 없습니다. 서버 터미널을 확인해 주세요.' }, { status: 500 }); }
}
export async function PUT(request: Request) {
  if (!localRequest(request)) {
    return Response.json({ error: '의상 저장은 localhost의 편집 페이지에서만 가능합니다.' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ error: 'JSON 요청이 필요합니다.' }, { status: 415 });
  }
  try {
    const body = await request.text();
    if (body.length > 2_000_000) return Response.json({ error: '한 번에 저장할 조정값이 너무 많습니다.' }, { status: 413 });
    let payload;
    try { payload = JSON.parse(body); }
    catch { return Response.json({ error: 'JSON 형식이 올바르지 않습니다.' }, { status: 400 }); }
    if (!payload || typeof payload.revision !== 'string' || !Array.isArray(payload.changes) ||
        payload.changes.length === 0 || payload.changes.length > 1000) {
      return Response.json({ error: '저장할 레이어와 버전 정보가 필요합니다.' }, { status: 400 });
    }
    const result = await withWorkspaceLock(() => saveWardrobeChanges(payload.revision, payload.changes));
    revalidatePath('/');
    revalidatePath('/wardrobe');
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof WardrobeStoreError) return Response.json({ error: error.message }, { status: error.status });
    console.error('Wardrobe save failed:', error);
    return Response.json({ error: '프로젝트 파일에 저장하지 못했습니다. 폴더의 쓰기 권한과 서버 터미널을 확인해 주세요.' }, { status: 500 });
  }
}
