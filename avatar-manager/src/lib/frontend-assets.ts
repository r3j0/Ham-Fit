import { mkdir, readFile, realpath, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { readSourceCatalog } from './source-catalog';
import { readWardrobeStore } from './wardrobe-store';
import { readArtworkStore } from './artwork-store';
import { applyPlacements } from '../components/hamster/placements';
import { POSES } from '../components/hamster/poses';
import { applyArtwork } from '../components/hamster/artwork';
import type { PlacementTarget } from '../components/hamster/placements';
import type {
  ItemCatalog,
  LayerAsset,
  HamsterPose,
  HamsterVariant,
  PoseLayers,
} from '../components/hamster/types';

export function catalogLayers(
  catalog: ItemCatalog,
  visit: (layer: LayerAsset, target: PlacementTarget, frame: PoseLayers) => void,
) {
  for (const [itemId, item] of Object.entries(catalog))
    for (const [pose, variants] of Object.entries(item.poses))
      for (const [variant, frame] of Object.entries(variants ?? {})) {
        for (const group of ['layers', 'foreground'] as const)
          frame?.[group]?.forEach((layer, index) =>
            visit(
              layer,
              {
                itemId,
                pose: pose as HamsterPose,
                variant: variant as HamsterVariant | 'shared',
                group,
                index,
              },
              frame,
            ),
          );
      }
}
export function assetHash(src: string) {
  const hash =
    /^\/(?:hamsters\/wardrobe\/assets|api\/v1\/avatar\/assets)\/([a-f0-9]{64})\.png$/.exec(
      src,
    )?.[1];
  if (!hash) throw new Error('프론트엔드 정적 이미지 경로가 올바르지 않습니다.');
  return hash;
}
export async function frontendDirectory() {
  const root = await realpath(
    process.env.AVATAR_FRONTEND_DIR ?? path.resolve(process.cwd(), '../frontend'),
  );
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (!pkg.dependencies?.next)
    throw new Error('AVATAR_FRONTEND_DIR은 서비스 Next.js frontend 폴더여야 합니다.');
  return root;
}
async function boundedDirectory(root: string, relative: string) {
  let directory = root;
  for (const component of relative.split('/')) {
    const next = path.join(directory, component);
    await mkdir(next, { recursive: true });
    directory = await realpath(next);
    if (!directory.startsWith(`${root}${path.sep}`))
      throw new Error('프론트엔드 저장 경로가 프로젝트를 벗어납니다.');
  }
  return directory;
}
async function immutableFile(file: string, bytes: Buffer, write: boolean) {
  if (write) {
    try {
      await writeFile(file, bytes, { flag: 'wx' });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  let existing: Buffer;
  try {
    existing = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('새 이미지가 있습니다. 프론트엔드 이미지 내보내기를 먼저 실행하세요.');
    throw error;
  }
  if (!existing.equals(bytes))
    throw new Error('프론트엔드 정적 파일이 손상되었습니다. 기존 파일을 확인하세요.');
}
export type DraftRevisions = { placementRevision: string; artworkRevision: string };
export async function prepareFrontendAssets(input: DraftRevisions, write = false) {
  const [placements, artwork, sourceCatalog, frontend] = await Promise.all([
    readWardrobeStore(),
    readArtworkStore(),
    readSourceCatalog(),
    frontendDirectory(),
  ]);
  if (input.placementRevision !== placements.revision || input.artworkRevision !== artwork.revision)
    throw new Error('로컬 편집 내용이 다른 창에서 변경되었습니다. 새로고침 후 확인하세요.');
  const originals = structuredClone(sourceCatalog);
  const published = applyArtwork(
    applyPlacements(sourceCatalog, placements.document),
    artwork.document,
    sourceCatalog,
  );
  if (!Object.keys(originals).length) throw new Error('내보낼 의상이 없습니다.');
  for (const [id, item] of Object.entries(originals)) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
      !['hat', 'top', 'bottom'].includes(item.slot) ||
      !item.label?.trim()
    )
      throw new Error('상품 ID·슬롯·이름이 올바르지 않습니다.');
    for (const [pose, variants] of Object.entries(item.poses)) {
      if (!Object.hasOwn(POSES, pose)) throw new Error('지원하지 않는 자세입니다.');
      for (const [variant, frame] of Object.entries(variants ?? {})) {
        if (
          !['cream', 'gray', 'shared'].includes(variant) ||
          !frame?.layers.length ||
          frame.qa?.status !== 'passed' ||
          !frame.qa.reviewer?.trim() ||
          !Number.isFinite(Date.parse(frame.qa.reviewedAt ?? ''))
        )
          throw new Error('모든 프레임은 이미지 검수(passed)가 필요합니다.');
      }
    }
  }
  catalogLayers(published, (layer) => {
    for (const [key, min, max] of [
      ['x', -2000, 2000],
      ['y', -2000, 2000],
      ['width', 1, 4000],
      ['height', 1, 4000],
      ['rotation', -180, 180],
      ['opacity', 0, 1],
      ['zIndex', -1000, 1000],
    ] as const) {
      const value = layer[key];
      if (
        (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) ||
        (key === 'zIndex' && value === undefined)
      )
        throw new Error('의상 배치 값이 올바르지 않습니다.');
    }
  });
  try {
    const previous = await readFrontendCatalog();
    for (const [id, item] of Object.entries(previous))
      for (const [pose, variants] of Object.entries(item.poses))
        for (const [variant, frame] of Object.entries(variants ?? {})) {
          const next =
            published[id]?.poses[pose as HamsterPose]?.[variant as HamsterVariant | 'shared'];
          if (
            !next ||
            published[id].slot !== item.slot ||
            next.layers.length !== frame?.layers.length ||
            (next.foreground?.length ?? 0) !== (frame?.foreground?.length ?? 0)
          )
            throw new Error(
              '기존 프론트엔드 의상·자세·색상은 제거할 수 없습니다. 최신 편집본을 먼저 불러오세요.',
            );
        }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const urls = new Map<string, boolean>();
  catalogLayers(published, (layer) => urls.set(layer.src, false));
  catalogLayers(originals, (layer) => urls.set(layer.src, true));
  const root = await realpath(path.join(process.cwd(), 'public/hamsters'));
  const assets = await boundedDirectory(frontend, 'public/hamsters/wardrobe/assets');
  const bundles = await boundedDirectory(frontend, 'public/hamsters/wardrobe/bundles');
  const mapped = new Map<string, string>();
  const pending = [...urls];
  const addedHashes = new Set<string>();
  for (let index = 0; index < pending.length; index += 6)
    await Promise.all(
      pending.slice(index, index + 6).map(async ([src, original]) => {
        if (!src.startsWith('/hamsters/')) throw new Error('로컬 의상 PNG만 내보낼 수 있습니다.');
        const file = await realpath(path.join(process.cwd(), 'public', src));
        if (!file.startsWith(`${root}${path.sep}`))
          throw new Error('이미지 경로가 저장 폴더를 벗어납니다.');
        const bytes = await readFile(file);
        if (!bytes.length || bytes.length > 8 * 1024 * 1024)
          throw new Error('PNG는 8 MiB 이하여야 합니다.');
        const image = sharp(bytes, { limitInputPixels: 1000000 });
        const metadata = await image.metadata();
        if (
          metadata.format !== 'png' ||
          metadata.width !== 1000 ||
          metadata.height !== 1000 ||
          !metadata.hasAlpha ||
          (metadata.pages ?? 1) !== 1
        )
          throw new Error('1000×1000 투명 PNG가 필요합니다.');
        if (original) {
          const alpha = (await image.stats()).channels.at(-1)!;
          if (alpha.min >= 255 || alpha.max === 0)
            throw new Error('원본 의상에는 투명 배경과 보이는 픽셀이 필요합니다.');
        }
        // Match historical server normalization so existing DB hashes remain usable.
        const png = await image.ensureAlpha().png().toBuffer();
        const hash = createHash('sha256').update(png).digest('hex');
        const output = path.join(assets, `${hash}.png`);
        if (await immutableFile(output, png, write)) addedHashes.add(hash);
        mapped.set(src, `/hamsters/wardrobe/assets/${hash}.png`);
      }),
    );
  for (const catalog of [originals, published])
    catalogLayers(catalog, (layer) => {
      layer.src = mapped.get(layer.src)!;
    });
  const hashes = [...new Set([...mapped.values()].map(assetHash))].sort();
  const catalogBytes = JSON.stringify(published),
    sourceBytes = JSON.stringify(originals);
  const manifest = JSON.stringify({
    schemaVersion: 1,
    assets: hashes,
    catalogSha256: createHash('sha256').update(catalogBytes).digest('hex'),
    sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
  });
  const bundle = createHash('sha256').update(manifest).digest('hex');
  await immutableFile(path.join(bundles, `${bundle}.json`), Buffer.from(manifest), write);
  const revision = Number.parseInt(bundle.slice(0, 12), 16);
  const display = JSON.stringify({ revision, catalog: published });
  const source = JSON.stringify({ revision, catalog: originals });
  const deployment = JSON.stringify({ schemaVersion: 1, bundle });
  const wardrobe = await boundedDirectory(frontend, 'public/hamsters/wardrobe');
  if (write) {
    // Replace only complete display snapshots; never remove historical PNGs.
    for (const [name, bytes] of [
      ['catalog.json', display],
      ['source-catalog.json', source],
      ['deployment.json', deployment],
    ]) {
      const temporary = path.join(wardrobe, `${name}.tmp`);
      await writeFile(temporary, bytes);
      await rename(temporary, path.join(wardrobe, name));
    }
  } else {
    for (const [name, bytes] of [
      ['catalog.json', display],
      ['source-catalog.json', source],
      ['deployment.json', deployment],
    ])
      await immutableFile(path.join(wardrobe, name), Buffer.from(bytes), false);
  }
  return {
    originals,
    published,
    bundle,
    manifest,
    assets: hashes.length,
    added: addedHashes.size,
    frontend,
  };
}
export async function exportFrontendAssets(input: DraftRevisions) {
  const result = await prepareFrontendAssets(input, true);
  return {
    bundle: result.bundle,
    assets: result.assets,
    added: result.added,
    frontend: result.frontend,
  };
}

export function frontendOrigin() {
  const url = new URL(process.env.AVATAR_FRONTEND_URL ?? 'http://127.0.0.1:3000');
  if (
    url.origin !== url.href.replace(/\/$/, '') ||
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol) ||
    (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error(
      'AVATAR_FRONTEND_URL은 서비스 프론트엔드의 HTTPS origin 또는 로컬 개발 주소여야 합니다.',
    );
  return url.origin;
}
export async function verifyFrontendDeployment(bundle: string) {
  const response = await fetch(`${frontendOrigin()}/hamsters/wardrobe/deployment.json`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 1024)
    throw new Error(
      '프론트엔드에 새 이미지·배치가 배포되지 않았습니다. 내보낸 정적 파일을 먼저 배포하세요.',
    );
  const body = await response.text();
  if (body.length > 1024 || body !== JSON.stringify({ schemaVersion: 1, bundle }))
    throw new Error(
      '배포된 프론트엔드 이미지·배치 버전이 다릅니다. 최신 내보내기 파일을 배포하세요.',
    );
}
export async function readFrontendCatalog(source = false): Promise<ItemCatalog> {
  const root = await frontendDirectory();
  const file = await realpath(
    path.join(root, 'public/hamsters/wardrobe', source ? 'source-catalog.json' : 'catalog.json'),
  );
  if (!file.startsWith(`${root}${path.sep}`))
    throw new Error('카탈로그 경로가 프론트엔드 폴더를 벗어납니다.');
  return JSON.parse(await readFile(file, 'utf8')).catalog as ItemCatalog;
}
export async function readFrontendImage(src: string) {
  const hash = assetHash(src),
    root = await frontendDirectory();
  const file = await realpath(path.join(root, 'public/hamsters/wardrobe/assets', `${hash}.png`));
  if (!file.startsWith(`${root}${path.sep}`))
    throw new Error('이미지 경로가 프론트엔드 폴더를 벗어납니다.');
  const bytes = await readFile(file);
  if (createHash('sha256').update(bytes).digest('hex') !== hash)
    throw new Error('프론트엔드 이미지 해시가 일치하지 않습니다.');
  return { hash, bytes };
}
