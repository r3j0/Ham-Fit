// Read-only pinned KSPO verification. TLS, ranges and MP4 metadata, not decoding/playback.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const SOURCE_COMMIT = '92f3493de704c644d5aeff353488f1aff49f1836';
const TYPES = new Set(['video/mp4', 'video/mg4']);
const BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'iso8',
  'iso9',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'MSNV',
  'dash',
]);
export function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(cell.replace(/\r$/, ''));
      cell = '';
      if (c === '\n') {
        rows.push(row);
        row = [];
      }
    } else cell += c;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field');
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export async function range(url, start, end, evidence, fetcher = fetch) {
  const response = await fetcher(url, {
    headers: { Range: `bytes=${start}-${end}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  const contentType =
    response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ??
    '';
  evidence.contentTypes.add(contentType);
  const match = response.headers
    .get('content-range')
    ?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  const total = match ? Number(match[3]) : 0;
  const actualEnd = match ? Number(match[2]) : -1;
  if (
    response.status !== 206 ||
    !match ||
    Number(match[1]) !== start ||
    actualEnd !== Math.min(end, total - 1) ||
    !Number.isSafeInteger(total) ||
    total <= start ||
    !TYPES.has(contentType)
  ) {
    await response.body?.cancel();
    throw new Error(
      `Invalid MP4 range response: ${response.status} type=${contentType} range=${response.headers.get('content-range')} requested=${start}-${end}${response.headers.has('location') ? ` redirect=${response.headers.get('location')}` : ''}`,
    );
  }
  if (evidence.total !== undefined && evidence.total !== total) {
    await response.body?.cancel();
    throw new Error('Source size changed between range requests');
  }
  evidence.total = total;
  const expected = actualEnd - start + 1;
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) !== expected) {
    await response.body?.cancel();
    throw new Error('Content-Length differs from Content-Range');
  }
  if (!response.body) throw new Error('Missing range response body');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > expected) {
        await reader.cancel();
        throw new Error('Range body exceeds requested length');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length !== expected) throw new Error('Range body is truncated');
  evidence.bytesFetched += length;
  evidence.rangeRequests.push({ start, end: actualEnd, contentType });
  return { bytes: Buffer.concat(chunks, length), total };
}
export function box(bytes, offset, availableLength = bytes.length - offset) {
  if (offset + 8 > bytes.length) throw new Error('Truncated MP4 box header');
  const size32 = bytes.readUInt32BE(offset);
  const header = size32 === 1 ? 16 : 8;
  if (offset + header > bytes.length)
    throw new Error('Truncated extended MP4 box header');
  const size =
    size32 === 1
      ? Number(bytes.readBigUInt64BE(offset + 8))
      : size32 === 0
        ? availableLength
        : size32;
  const type = bytes.toString('ascii', offset + 4, offset + 8);
  if (
    !Number.isSafeInteger(size) ||
    size < header ||
    size > availableLength ||
    !/^[\x20-\x7e]{4}$/.test(type)
  )
    throw new Error('Invalid MP4 box size or type');
  return { size, header, type };
}
export function fileType(bytes) {
  const ftyp = box(bytes, 0);
  if (
    ftyp.type !== 'ftyp' ||
    ftyp.size < ftyp.header + 8 ||
    (ftyp.size - ftyp.header) % 4 !== 0
  )
    throw new Error('Missing or invalid MP4 ftyp');
  const majorBrand = bytes.toString('ascii', ftyp.header, ftyp.header + 4);
  const compatibleBrands = [];
  for (let at = ftyp.header + 8; at < ftyp.size; at += 4)
    compatibleBrands.push(bytes.toString('ascii', at, at + 4));
  if (![majorBrand, ...compatibleBrands].some((brand) => BRANDS.has(brand)))
    throw new Error('Unrecognized MP4 file brand');
  return { majorBrand, compatibleBrands };
}
function children(bytes, start, end) {
  const list = [];
  for (let at = start; at < end;) {
    const child = box(bytes, at, end - at);
    list.push({ ...child, offset: at });
    at += child.size;
  }
  return list;
}
export function movieMetadata(bytes) {
  const moov = box(bytes, 0);
  if (moov.type !== 'moov' || moov.size !== bytes.length)
    throw new Error('Invalid movie metadata container');
  const items = children(bytes, moov.header, moov.size);
  const mvhd = items.find((item) => item.type === 'mvhd');
  if (!mvhd) throw new Error('Missing movie duration metadata');
  const p = mvhd.offset + mvhd.header;
  const version = bytes[p];
  if (
    ![0, 1].includes(version) ||
    mvhd.size - mvhd.header < (version === 1 ? 32 : 20)
  )
    throw new Error('Invalid mvhd version or length');
  const timescale = bytes.readUInt32BE(p + (version === 1 ? 20 : 12));
  const ticks =
    version === 1
      ? Number(bytes.readBigUInt64BE(p + 24))
      : bytes.readUInt32BE(p + 16);
  const durationSeconds = ticks / timescale;
  if (
    timescale <= 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isSafeInteger(ticks)
  )
    throw new Error('Invalid MP4 movie duration');
  let videoTrackCount = 0;
  for (const trak of items.filter((item) => item.type === 'trak')) {
    const mdia = children(
      bytes,
      trak.offset + trak.header,
      trak.offset + trak.size,
    ).find((item) => item.type === 'mdia');
    if (!mdia) continue;
    const hdlr = children(
      bytes,
      mdia.offset + mdia.header,
      mdia.offset + mdia.size,
    ).find((item) => item.type === 'hdlr');
    if (
      hdlr &&
      hdlr.size - hdlr.header >= 12 &&
      bytes.toString(
        'ascii',
        hdlr.offset + hdlr.header + 8,
        hdlr.offset + hdlr.header + 12,
      ) === 'vide'
    )
      videoTrackCount++;
  }
  if (videoTrackCount < 1) throw new Error('MP4 has no video handler track');
  return { durationSeconds, timescale, videoTrackCount };
}
export async function probe(video, catalogDurationSeconds, fetcher = fetch) {
  const result = {
    videoId: video.videoId,
    originalUrl: video.videoUrl,
    checkedAt: new Date().toISOString(),
    catalogDurationSeconds,
  };
  const evidence = {
    contentTypes: new Set(),
    bytesFetched: 0,
    rangeRequests: [],
  };
  const observed = () => ({
    sourceContentTypes: [...evidence.contentTypes].sort(),
    bytesFetched: evidence.bytesFetched,
    rangeRequests: evidence.rangeRequests,
  });
  try {
    if (
      !/^[A-Za-z0-9_-]+\.mp4$/.test(video.videoId) ||
      video.videoUrl !== `http://openapi.kspo.or.kr/web/video/${video.videoId}`
    )
      throw new Error('Unexpected source URL');
    if (!Number.isFinite(catalogDurationSeconds) || catalogDurationSeconds <= 0)
      throw new Error('Missing catalog duration');
    const url = `https://openapi.kspo.or.kr/web/video/${video.videoId}`;
    const first = await range(url, 0, 31, evidence, fetcher);
    const ftyp = box(first.bytes, 0, first.total);
    if (ftyp.type !== 'ftyp' || ftyp.size > 4096)
      throw new Error('Expected initial MP4 ftyp box');
    const signature = fileType(
      ftyp.size <= first.bytes.length
        ? first.bytes.subarray(0, ftyp.size)
        : (await range(url, 0, ftyp.size - 1, evidence, fetcher)).bytes,
    );
    let offset = ftyp.size;
    let metadata;
    const topLevelBoxes = [{ type: ftyp.type, size: ftyp.size, offset: 0 }];
    for (let i = 0; i < 64 && offset < first.total; i++) {
      const head = await range(
        url,
        offset,
        Math.min(offset + 31, first.total - 1),
        evidence,
        fetcher,
      );
      const parent = box(head.bytes, 0, first.total - offset);
      topLevelBoxes.push({ type: parent.type, size: parent.size, offset });
      if (parent.type === 'moov') {
        if (parent.size > 32 * 1024 * 1024)
          throw new Error('Metadata exceeds 32 MiB limit');
        metadata = movieMetadata(
          (
            await range(
              url,
              offset,
              offset + parent.size - 1,
              evidence,
              fetcher,
            )
          ).bytes,
        );
        break;
      }
      offset += parent.size;
    }
    if (!metadata) throw new Error('No valid MP4 movie metadata');
    const matched =
      Math.abs(metadata.durationSeconds - catalogDurationSeconds) <= 1;
    return {
      ...result,
      status: matched ? 'verified' : 'duration_mismatch',
      verifiedUrl: url,
      actualDurationSeconds: metadata.durationSeconds,
      sizeBytes: first.total,
      rangeSupported: true,
      httpsVerified: true,
      mp4Validated: true,
      ...signature,
      movieTimescale: metadata.timescale,
      videoTrackCount: metadata.videoTrackCount,
      topLevelBoxes,
      ...observed(),
    };
  } catch (error) {
    return {
      ...result,
      status: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.cause
        ? { cause: String(error.cause) }
        : {}),
      ...observed(),
    };
  }
}
export async function main(args = process.argv.slice(2)) {
  const [source, csvPath, output, mode] = args;
  if (!source || !csvPath || !output)
    throw new Error(
      'Usage: node scripts/probe-workout-media.mjs source.json source.csv report.json [--retry-unavailable]',
    );
  const sourceBytes = await readFile(source);
  const csvBytes = await readFile(csvPath);
  const sourceHashes = {
    json: createHash('sha256').update(sourceBytes).digest('hex'),
    csv: createHash('sha256').update(csvBytes).digest('hex'),
  };
  if (
    sourceHashes.json !==
      '35cabf0c9303c6cd130ece6212bcadc87e89d977f6c11da673787d9d7177aea0' ||
    sourceHashes.csv !==
      '7f5169a8eb1ce296466b8f1cdbc98e97a296e689cc3d70d771bc4071a5db5225'
  )
    throw new Error('Probe source differs from pinned CSV/JSON');
  const videos = JSON.parse(sourceBytes.toString('utf8'));
  const [headers, ...rows] = csvRows(
    csvBytes.toString('utf8').replace(/^\uFEFF/, ''),
  );
  const lengths = new Map(
    rows.map((row) => [
      row[headers.indexOf('file_nm')],
      Number(row[headers.indexOf('video_length')]),
    ]),
  );
  const prior =
    mode === '--retry-unavailable'
      ? JSON.parse(await readFile(output, 'utf8'))
      : null;
  if (mode && mode !== '--retry-unavailable')
    throw new Error('Unknown probe option');
  if (
    prior &&
    (prior.schemaVersion !== 2 ||
      prior.sourceCommit !== SOURCE_COMMIT ||
      prior.videos.length !== videos.length ||
      prior.videos.some(
        (entry, index) =>
          entry.videoId !== videos[index].videoId ||
          entry.originalUrl !== videos[index].videoUrl ||
          entry.catalogDurationSeconds !== lengths.get(entry.videoId),
      ))
  )
    throw new Error('Previous report does not match this source');
  const results = prior ? [...prior.videos] : new Array(videos.length);
  const targets = videos
    .map((_, index) => index)
    .filter((index) => !prior || prior.videos[index].status === 'unavailable');
  let next = 0;
  let completed = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < targets.length) {
        const index = targets[next++];
        const result = await probe(
          videos[index],
          lengths.get(videos[index].videoId),
        );
        const previous = prior?.videos[index];
        results[index] = previous
          ? {
              ...result,
              priorAttempts: [
                ...(previous.priorAttempts ?? []),
                {
                  checkedAt: previous.checkedAt,
                  status: previous.status,
                  error: previous.error,
                  cause: previous.cause,
                },
              ],
            }
          : result;
        completed++;
        if (completed % 50 === 0)
          console.log(`Checked ${completed}/${targets.length}`);
      }
    }),
  );
  const statuses = results.reduce((all, r) => {
    all[r.status] = (all[r.status] ?? 0) + 1;
    return all;
  }, {});
  const report = {
    schemaVersion: 2,
    sourceCommit: SOURCE_COMMIT,
    sourceHashes,
    checkedAt: new Date().toISOString(),
    scope:
      'HTTPS byte ranges, MP4 ftyp and moov/mvhd/video handler metadata; not full decoding or playback',
    durationToleranceSeconds: 1,
    acceptedSourceContentTypes: [...TYPES],
    sourceMimeAnomaly:
      'KSPO returns video/mg4 for valid MP4 ranges. Accepted only after independent ftyp/box/video-track validation.',
    summary: { count: results.length, statuses },
    run: {
      mode: prior ? 'retry_unavailable' : 'all',
      attemptedCount: targets.length,
      previousCheckedAt: prior?.checkedAt ?? null,
    },
    videos: results,
  };
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporary, output);
  console.log(JSON.stringify(report.summary));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();
