import { readEditedPng } from '@/lib/artwork-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** New PNGs must also load before a production server's static public inventory is restarted. */
export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await params;
    const bytes = await readEditedPng(filename);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response('Image unavailable', { status: 404 }); }
}
