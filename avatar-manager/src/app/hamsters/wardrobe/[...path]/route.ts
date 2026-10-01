import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const segments = (await params).path;
  if (!segments.every(part => /^[a-zA-Z0-9_-]+(?:\.png)?$/.test(part)) || !segments.at(-1)?.endsWith('.png')) return new Response(null, { status: 404 });
  try {
    const root = await realpath(path.join(process.cwd(), 'public/hamsters/wardrobe'));
    const file = await realpath(path.join(root, ...segments));
    if (!file.startsWith(`${root}${path.sep}`)) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(await readFile(file)), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  } catch { return new Response(null, { status: 404 }); }
}
