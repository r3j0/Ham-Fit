import { localRequest } from '@/lib/backend';
import { importCatalog, MAX_IMPORT_BYTES } from '@/lib/import-catalog';
import { withWorkspaceLock } from '@/lib/workspace-lock';
import { WardrobeStoreError } from '@/lib/wardrobe-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!localRequest(request)) return Response.json({ error: '로컬 편집 앱에서만 의상을 추가할 수 있습니다.' }, { status: 403 });
  try {
    // Bound even chunked requests before parsing multipart data into memory.
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = request.body?.getReader();
    if (!reader) throw new Error('의상 폴더를 선택하세요.');
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_IMPORT_BYTES + 2 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: '가져오기 요청은 128 MiB 이하여야 합니다.' }, { status: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData();
    const paths: unknown = JSON.parse(String(form.get('paths')));
    const files = form.getAll('files');
    if (!Array.isArray(paths) || paths.length !== files.length || paths.some(value => typeof value !== 'string') || files.some(file => !(file instanceof File))) throw new Error('의상 파일 목록이 올바르지 않습니다.');
    const input = await Promise.all((files as File[]).map(async (file, index) => ({ relativePath: paths[index] as string, bytes: Buffer.from(await file.arrayBuffer()) })));
    const result = await withWorkspaceLock(() => importCatalog(input));
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '의상을 가져오지 못했습니다.' }, { status: error instanceof WardrobeStoreError ? error.status : 400 });
  }
}
