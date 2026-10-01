import { revalidatePath } from 'next/cache';
import { localRequest } from '@/lib/backend';
import { withWorkspaceLock } from '@/lib/workspace-lock';
import { MAX_ARTWORK_BYTES, readArtworkContext, saveArtwork } from '@/lib/artwork-store';
import { WardrobeStoreError } from '@/lib/wardrobe-store';
import type { PlacementTarget } from '@/components/hamster/placements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function failed(error: unknown) {
  if (error instanceof WardrobeStoreError) return Response.json({ error: error.message }, { status: error.status });
  console.error('Artwork operation failed:', error);
  return Response.json({ error: '의상 파일을 읽거나 저장하지 못했습니다. 서버 터미널과 폴더 권한을 확인해 주세요.' }, { status: 500 });
}
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const target = { itemId: search.get('itemId'), pose: search.get('pose'), variant: search.get('variant'), group: search.get('group'), index: Number(search.get('index')) } as PlacementTarget;
  try { return Response.json(await readArtworkContext(target), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failed(error); }
}
export async function PUT(request: Request) {
  if (!localRequest(request)) return Response.json({ error: '의상 세부 저장은 localhost의 편집 페이지에서만 가능합니다.' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) return Response.json({ error: 'PNG 파일 요청이 필요합니다.' }, { status: 415 });
  try {
    const length = Number(request.headers.get('content-length'));
    if (length > MAX_ARTWORK_BYTES + 65536) return Response.json({ error: '요청이 너무 큽니다.' }, { status: 413 });
    const form = await request.formData();
    const png = form.get('png');
    const metadata = form.get('metadata');
    if (!(png instanceof File) || png.size > MAX_ARTWORK_BYTES || typeof metadata !== 'string' || metadata.length > 10000) return Response.json({ error: 'PNG와 편집 정보가 필요합니다.' }, { status: 400 });
    let payload;
    try { payload = JSON.parse(metadata); } catch { return Response.json({ error: '편집 정보가 올바르지 않습니다.' }, { status: 400 }); }
    if (!payload || typeof payload.revision !== 'string' || typeof payload.source !== 'string' || typeof payload.originalSha256 !== 'string') return Response.json({ error: '편집 버전 정보가 필요합니다.' }, { status: 400 });
    const bytes = Buffer.from(await png.arrayBuffer());
    const result = await withWorkspaceLock(() => saveArtwork(payload.target, payload.source, payload.originalSha256, payload.revision, bytes));
    revalidatePath('/'); revalidatePath('/wardrobe');
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failed(error); }
}
export async function DELETE(request: Request) {
  if (!localRequest(request)) return Response.json({ error: '의상 복원은 localhost의 편집 페이지에서만 가능합니다.' }, { status: 403 });
  try {
    const body = await request.text();
    if (body.length > 10000) return Response.json({ error: '요청이 너무 큽니다.' }, { status: 413 });
    let payload;
    try { payload = JSON.parse(body); } catch { return Response.json({ error: '편집 정보가 올바르지 않습니다.' }, { status: 400 }); }
    if (!payload || typeof payload.revision !== 'string' || typeof payload.source !== 'string' || typeof payload.originalSha256 !== 'string') return Response.json({ error: '편집 버전 정보가 필요합니다.' }, { status: 400 });
    const result = await withWorkspaceLock(() => saveArtwork(payload.target, payload.source, payload.originalSha256, payload.revision, null));
    revalidatePath('/'); revalidatePath('/wardrobe');
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failed(error); }
}
