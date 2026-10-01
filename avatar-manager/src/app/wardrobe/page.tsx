import type { Metadata } from 'next';
import { readSourceCatalog } from '@/lib/source-catalog';
import { readWardrobeStore } from '@/lib/wardrobe-store';
import { readArtworkStore } from '@/lib/artwork-store';
import { WardrobeEditor } from './wardrobe-editor';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '의상 조정 · Hamster', description: '가져온 의상의 크기, 회전, 위치를 조정하고 프로젝트에 저장합니다.' };
export default async function WardrobePage() {
  const [initialStore, initialArtwork] = await Promise.all([readWardrobeStore(), readArtworkStore()]);
  return <WardrobeEditor catalog={await readSourceCatalog()} initialStore={initialStore} initialArtwork={initialArtwork} />;
}
