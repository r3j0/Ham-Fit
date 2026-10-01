import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCatalog } from '../../scripts/catalog-import.mjs';
import type { ItemCatalog } from '../components/hamster/types';
import { readSourceCatalog } from './source-catalog';

export const MAX_IMPORT_BYTES = 128 * 1024 * 1024;
export type ImportFile = { relativePath: string; bytes: Buffer };

/** Add reviewed sets to the local draft. This never contacts or publishes to the service. */
export async function importCatalog(files: ImportFile[], root = process.cwd()) {
  if (!files.length || files.length > 2000 || files.reduce((sum, file) => sum + file.bytes.length, 0) > MAX_IMPORT_BYTES) throw new Error('의상 폴더는 2,000개 파일, 총 128 MiB 이하여야 합니다.');
  const paths = new Set<string>();
  for (const file of files) {
    const segments = file.relativePath.split('/');
    if (segments.length < 2 || segments.some(segment => !segment || segment === '.' || segment === '..') || /[\\\u0000]/.test(file.relativePath) || paths.has(file.relativePath)) throw new Error('의상 파일 경로가 올바르지 않거나 중복되었습니다.');
    paths.add(file.relativePath);
    const manifest = segments.at(-1) === 'manifest.json';
    if ((!manifest && !file.relativePath.endsWith('.png')) || file.bytes.length > (manifest ? 256 * 1024 : 8 * 1024 * 1024)) throw new Error('manifest.json과 8 MiB 이하 PNG만 가져올 수 있습니다.');
  }
  const prefixes = files.filter(file => file.relativePath.endsWith('/manifest.json')).map(file => file.relativePath.slice(0, -'/manifest.json'.length));
  if (!prefixes.length) throw new Error('manifest.json이 들어 있는 의상 세트 폴더를 선택하세요.');
  const setIds = prefixes.map(prefix => prefix.split('/').at(-1)!);
  if (new Set(setIds).size !== setIds.length || setIds.some(id => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) throw new Error('세트 폴더 이름은 중복 없는 영문 소문자·숫자·하이픈이어야 합니다.');
  if (prefixes.some(prefix => prefixes.some(other => prefix !== other && prefix.startsWith(`${other}/`)))) throw new Error('의상 세트 안에 다른 세트를 중첩할 수 없습니다.');
  const staging = await mkdtemp(path.join(tmpdir(), 'avatar-import-'));
  try {
    for (const file of files) {
      const prefix = prefixes.find(value => file.relativePath.startsWith(`${value}/`));
      if (!prefix) throw new Error('모든 PNG는 manifest.json이 있는 세트 폴더에 속해야 합니다.');
      const relative = file.relativePath.slice(prefix.length + 1);
      const target = path.join(staging, prefix.split('/').at(-1)!, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.bytes);
    }
    const result = await buildCatalog(staging);
    const incoming = result.catalog as ItemCatalog;
    const added = Object.keys(incoming);
    if (!added.length) throw new Error('검수가 완료된 의상 이미지가 없습니다. QA의 passed·검수자·검수 시각을 확인하세요.');
    const current = await readSourceCatalog(root);
    if (added.some(key => Object.hasOwn(current, key))) throw new Error('이미 있는 상품 ID는 추가할 수 없습니다. 기존 상품은 편집 화면에서 수정하고, 새 상품은 다른 ID를 사용하세요.');
    if (Object.keys(current).length + added.length > 100) throw new Error('의상 상품은 최대 100개까지 등록할 수 있습니다.');
    if (Object.values(incoming).some(item => !['hat', 'top', 'bottom'].includes(item.slot))) throw new Error('상점에 추가할 의상 종류는 모자·상의·하의입니다.');
    for (const [id, item] of Object.entries(incoming)) {
      if (id.length > 80 || item.label.length > 100) throw new Error('상품 ID는 80자, 상품명은 100자 이하여야 합니다.');
      for (const variants of Object.values(item.poses)) for (const frame of Object.values(variants ?? {})) {
        const qa = frame?.qa;
        const layers = frame ? [...frame.layers, ...(frame.foreground ?? [])] : [];
        if (!qa || qa.reviewer.length > 200 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(qa.reviewedAt) || layers.length > 16 || layers.some(layer => layer.zIndex < -1000 || layer.zIndex > 1000)) throw new Error('검수 시각은 ISO 형식이어야 하며 이미지 레이어는 최대 16개입니다.');
      }
    }
    const sources = new Map<string, string>();
    for (const [url, bytes] of result.files as Map<string, Buffer>) {
      const hash = createHash('sha256').update(bytes).digest('hex');
      const src = `/hamsters/wardrobe/imported/${hash}.png`;
      const destination = path.join(root, 'public', src);
      await mkdir(path.dirname(destination), { recursive: true });
      try { await writeFile(destination, bytes, { flag: 'wx' }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await readFile(destination)).equals(bytes)) throw error;
      }
      sources.set(url, src);
    }
    for (const item of Object.values(incoming)) for (const variants of Object.values(item.poses)) for (const frame of Object.values(variants ?? {})) {
      if (frame) for (const layer of [...frame.layers, ...(frame.foreground ?? [])]) layer.src = sources.get(layer.src)!;
    }
    const local = path.join(root, '.local');
    const backup = path.join(local, 'backups', `import-${randomUUID()}`);
    await mkdir(backup, { recursive: true });
    await writeFile(path.join(backup, 'catalog.json'), JSON.stringify(current));
    const temporary = path.join(local, `catalog-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ ...current, ...incoming }));
      await rename(temporary, path.join(local, 'catalog.json'));
    } finally { await rm(temporary, { force: true }); }
    return { added, frames: result.report.counts.frames, skippedFrames: result.report.counts.skippedFrames };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
