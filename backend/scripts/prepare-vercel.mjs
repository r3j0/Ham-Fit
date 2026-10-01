import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Package committed files, including their canonical line endings. Never upload
// the working checkout, local DB, credentials, frontend, or algorithm copies.
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(backend, '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) {
  throw new Error(
    'Usage: node scripts/prepare-vercel.mjs [--output EMPTY_DIRECTORY]',
  );
}
const directory = args.length
  ? resolve(args[1])
  : mkdtempSync(join(tmpdir(), 'ham-fit-vercel-'));
if (existsSync(directory) && readdirSync(directory).length) {
  throw new Error('Deployment output directory must be empty.');
}
mkdirSync(directory, { recursive: true });
const originalFiles = [
  'data-analysis/src/recommendation_v2.py',
  'data-analysis/data/processed/workout_videos_v2_complete.csv',
];
const git = (...params) =>
  execFileSync('git', params, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const commit = git('rev-parse', 'HEAD').toString().trim();
const archive = git(
  'archive',
  '--format=tar',
  commit,
  'backend',
  ...originalFiles,
);
execFileSync('tar', ['-xf', '-', '-C', directory], { input: archive });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const file of originalFiles) {
  if (
    hash(readFileSync(join(directory, file))) !==
    hash(git('show', `${commit}:${file}`))
  ) {
    throw new Error(
      `Original artifact differs from the committed source: ${file}`,
    );
  }
}
const csvHash = hash(readFileSync(join(directory, originalFiles[1])));
const media = JSON.parse(
  readFileSync(
    join(directory, 'backend/deploy/media-verification.json'),
    'utf8',
  ),
);
if (media.sourceCommit !== csvHash) {
  throw new Error('Deployment media report does not match the committed CSV.');
}
const stripLocalFiles = (folder) => {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const file = join(folder, entry.name);
    if (
      entry.name === '.env' ||
      entry.name.startsWith('.env.') ||
      [
        '.git',
        '.local',
        '.vercel',
        'node_modules',
        'dist',
        'coverage',
      ].includes(entry.name)
    ) {
      rmSync(file, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      stripLocalFiles(file);
    } else if (entry.isSymbolicLink()) {
      throw new Error('Deployment archive must not contain symbolic links.');
    }
  }
};
stripLocalFiles(directory);
const config = join(directory, 'backend/deploy/vercel.json');
if (!existsSync(config)) {
  throw new Error('Commit the Vercel deployment template before packaging.');
}
copyFileSync(config, join(directory, 'vercel.json'));
writeFileSync(
  join(directory, '.vercelignore'),
  [
    '.git/**',
    '**/.env',
    '**/.env.*',
    '**/.local/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    'frontend/**',
    '',
  ].join('\n'),
);
const manifest = {
  sourceCommit: commit,
  csvHash,
  catalogVideos: media.videos.length,
};
writeFileSync(
  join(directory, '.ham-fit-deployment.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(JSON.stringify({ deploymentDirectory: directory, ...manifest }));
