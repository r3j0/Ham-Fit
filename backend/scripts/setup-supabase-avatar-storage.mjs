import 'reflect-metadata';
import { config } from 'dotenv';
import { randomBytes, createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'Usage: npm run avatar:storage:setup -- [--create] [--smoke-test]\nBuild first. Set SUPABASE_URL, SUPABASE_SECRET_KEY and optional SUPABASE_AVATAR_BUCKET in backend/.env or the process environment.\n--create creates only a missing private PNG bucket; --smoke-test uploads, reads and removes one isolated fixture without changing the catalog.',
  );
  process.exit(0);
}
if (args.some((arg) => !['--create', '--smoke-test'].includes(arg)))
  throw new Error('Unsupported option. Use --help.');
config({ quiet: true });
const { supabaseStorageSettings } =
  await import('../dist/config/supabase-storage.js');
const settings = supabaseStorageSettings(process.env);
const client = createClient(settings.url, settings.key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        cache: 'no-store',
        signal: AbortSignal.timeout(30000),
      }),
  },
});
const fail = (message) => {
  throw new Error(message);
};
let { data, error } = await client.storage.getBucket(settings.bucket);
if (
  error &&
  args.includes('--create') &&
  (error.code === 'NoSuchBucket' || error.message === 'Bucket not found')
) {
  const result = await client.storage.createBucket(settings.bucket, {
    public: false,
    allowedMimeTypes: ['image/png'],
    fileSizeLimit: 8 * 1024 * 1024,
  });
  if (result.error)
    fail(
      'Cannot create the avatar bucket. Check the server key and Storage permissions.',
    );
  ({ data, error } = await client.storage.getBucket(settings.bucket));
}
if (error || !data)
  fail(
    'Cannot read the avatar bucket. Check the bucket ID, server key and Storage connection.',
  );
if (data.public !== false)
  fail(
    'The avatar bucket must be private. This script does not change existing bucket permissions.',
  );
console.log(
  JSON.stringify({ bucket: settings.bucket, private: true, connection: 'ok' }),
);

if (args.includes('--smoke-test')) {
  const { AvatarAssetStorage } =
    await import('../dist/avatar/assets-storage.js');
  const pixels = randomBytes(16);
  pixels[3] = 0;
  pixels[15] = 255;
  const png = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } })
    .resize(1000, 1000, { kernel: 'nearest' })
    .png()
    .toBuffer();
  const filename = `${createHash('sha256').update(png).digest('hex')}.png`;
  const bucket = client.storage.from(settings.bucket);
  const absent = await bucket.download(filename);
  if (
    absent.data ||
    !absent.error ||
    !(
      absent.error.code === 'NoSuchKey' ||
      (absent.error.statusCode === '404' &&
        ['Object not found', 'The resource was not found'].includes(
          absent.error.message,
        ))
    )
  ) {
    fail(
      'Cannot verify the smoke-test fixture is absent; no existing file will be replaced.',
    );
  }
  const serviceConfig = new ConfigService({
    AVATAR_ASSET_STORAGE: 'supabase',
    SUPABASE_URL: settings.url,
    SUPABASE_SECRET_KEY: settings.key,
    SUPABASE_AVATAR_BUCKET: settings.bucket,
  });
  try {
    await new AvatarAssetStorage(serviceConfig).write(filename, png);
    const downloaded = await new AvatarAssetStorage(serviceConfig).read(
      filename,
    );
    if (!downloaded.equals(png))
      fail('Storage smoke-test PNG does not match the uploaded file.');
    console.log(
      JSON.stringify({
        upload: 'ok',
        freshInstanceDownload: 'ok',
        sha256: filename.slice(0, -4),
        catalogChanged: false,
      }),
    );
  } finally {
    const removed = await bucket.remove([filename]);
    if (removed.error)
      fail(
        'Cannot remove the smoke-test fixture. Remove only the reported fixture from the avatar bucket.',
      );
  }
}
