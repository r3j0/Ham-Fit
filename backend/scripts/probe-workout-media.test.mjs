import test from 'node:test';
import assert from 'node:assert/strict';
import {
  box,
  fileType,
  movieMetadata,
  probe,
  catalogFromCsv,
} from './probe-workout-media.mjs';
function atom(type, payload) {
  const bytes = Buffer.alloc(8 + payload.length);
  bytes.writeUInt32BE(bytes.length);
  bytes.write(type, 4, 'ascii');
  payload.copy(bytes, 8);
  return bytes;
}
const ftyp = atom(
  'ftyp',
  Buffer.from('6d7034320000000069736f6d6d703432', 'hex'),
);
function movie(version = 0) {
  const mvhd = Buffer.alloc(version === 1 ? 32 : 20);
  mvhd[0] = version;
  mvhd.writeUInt32BE(1000, version === 1 ? 20 : 12);
  if (version === 1) mvhd.writeBigUInt64BE(100000n, 24);
  else mvhd.writeUInt32BE(100000, 16);
  const handler = Buffer.alloc(12);
  handler.write('vide', 8, 'ascii');
  return atom(
    'moov',
    Buffer.concat([
      atom('mvhd', mvhd),
      atom('trak', atom('mdia', atom('hdlr', handler))),
    ]),
  );
}
const mp4 = Buffer.concat([ftyp, atom('mdat', Buffer.alloc(128)), movie()]);
const video = {
  videoId: 'TEST_A.mp4',
  videoUrl: 'http://openapi.kspo.or.kr/web/video/TEST_A.mp4',
};
test('reads a BOM CSV with quoted commas without a copied recommendation catalog', () => {
  const csv =
    '\uFEFFfile_nm,title,file_url,video_length\r\nTEST_A.mp4,"a,b",http://openapi.kspo.or.kr/web/video/TEST_A.mp4,100\r\n';
  assert.deepEqual(catalogFromCsv(Buffer.from(csv)), [
    { ...video, duration: 100 },
  ]);
});
test('rejects duplicate, malformed or unsafe catalog inputs before probing', () => {
  const head = 'file_nm,file_url,video_length\n';
  const row = 'TEST_A.mp4,http://openapi.kspo.or.kr/web/video/TEST_A.mp4,100\n';
  for (const csv of [
    head,
    head + row + row,
    head + row.replace(',100', ',0'),
    head + row.replace('http://openapi.kspo.or.kr', 'http://localhost'),
    head + row.replace(',100', ',100,extra'),
    'file_nm\nTEST_A.mp4\n',
  ])
    assert.throws(() => catalogFromCsv(Buffer.from(csv)));
});
function responder(bytes = mp4, edit = () => ({})) {
  let count = 0;
  return async (url, options) => {
    assert.equal(url, 'https://openapi.kspo.or.kr/web/video/TEST_A.mp4');
    assert.equal(options.redirect, 'manual');
    const match = options.headers.Range.match(/^bytes=(\d+)-(\d+)$/);
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.length - 1);
    const override = edit(++count, start, end);
    return new Response(override.body ?? bytes.subarray(start, end + 1), {
      status: override.status ?? 206,
      headers: {
        'content-range': `bytes ${start}-${end}/${bytes.length}`,
        'content-type': count === 1 ? 'video/mp4' : 'video/mg4',
        ...override.headers,
      },
    });
  };
}
test('accepts observed MIME typo only with independent MP4/video-track evidence', async () => {
  const result = await probe(video, 100, responder());
  assert.equal(result.status, 'verified');
  assert.equal(result.actualDurationSeconds, 100);
  assert.equal(result.mp4Validated, true);
  assert.equal(result.videoTrackCount, 1);
  assert.deepEqual(result.sourceContentTypes, ['video/mg4', 'video/mp4']);
  assert(result.rangeRequests.some((r) => r.start > 128));
});
test('accepts structurally validated initial range with the same source MIME typo', async () =>
  assert.equal(
    (
      await probe(
        video,
        100,
        responder(mp4, () => ({ headers: { 'content-type': 'video/mg4' } })),
      )
    ).status,
    'verified',
  ));
test('preserves actual duration mismatch explicitly', async () => {
  const result = await probe(video, 105, responder());
  assert.equal(result.status, 'duration_mismatch');
  assert.equal(result.actualDurationSeconds, 100);
});
test('does not accept HTML or arbitrary bytes falsely labelled video/mg4', async () => {
  const result = await probe(
    video,
    100,
    responder(Buffer.alloc(500, 60), () => ({
      headers: { 'content-type': 'video/mg4' },
    })),
  );
  assert.equal(result.status, 'unavailable');
  assert.match(result.error, /MP4/);
});
test('rejects unexpected HTTP MIME and status, shifted ranges and truncated bodies', async () => {
  for (const override of [
    { headers: { 'content-type': 'text/html' } },
    { status: 200 },
    { headers: { 'content-range': `bytes 1-32/${mp4.length}` } },
    { body: Buffer.alloc(4) },
  ])
    assert.equal(
      (
        await probe(
          video,
          100,
          responder(mp4, () => override),
        )
      ).status,
      'unavailable',
    );
});
test('rejects content that changes total length between requests', async () => {
  const result = await probe(
    video,
    100,
    responder(mp4, (count, start, end) =>
      count === 2
        ? {
            headers: {
              'content-range': `bytes ${start}-${end}/${mp4.length + 1}`,
            },
          }
        : {},
    ),
  );
  assert.equal(result.status, 'unavailable');
  assert.match(result.error, /size changed/);
});
test('rejects arbitrary URLs before network calls', async () => {
  const result = await probe(
    { ...video, videoUrl: 'http://internal.invalid/x' },
    100,
    () => {
      throw new Error('Network must not run');
    },
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error, 'Unexpected source URL');
});
test('validates truncated extended boxes and MP4 brands', () => {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32BE(1);
  bytes.write('moov', 4);
  assert.throws(() => box(bytes, 0), /extended/);
  assert.throws(
    () => fileType(atom('ftyp', Buffer.from('xxxx0000yyyy'))),
    /brand/,
  );
});
test('reads mvhd versions 0 and 1, refuses missing tracks and zero timescale', () => {
  assert.equal(movieMetadata(movie()).durationSeconds, 100);
  assert.equal(movieMetadata(movie(1)).durationSeconds, 100);
  const noTrack = atom('moov', atom('mvhd', Buffer.alloc(20)));
  assert.throws(() => movieMetadata(noTrack), /duration/);
  const invalidTrack = movie();
  invalidTrack.write('soun', invalidTrack.length - 4);
  assert.throws(() => movieMetadata(invalidTrack), /no video/);
});
