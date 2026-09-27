// Compile first: npm run build. No database access; activation is a separate command.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import {
  SOURCE_COMMIT,
  transformCatalog,
} from '../dist/recommendations/catalog.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = resolve(root, 'data/recommendation');
const sourceFiles = [
  'src/recommendation.py',
  '02_data_preprocessing.ipynb',
  '03_recommendation.ipynb',
  'data/processed/workout_videos.csv',
  'data/processed/workout_videos.json',
];
const pinnedHashes = {
  'src/recommendation.py':
    '22f5efd3a36b125d95aaf4a5fd7563fc928ecfd865b3c06f18090ac986558f42',
  '02_data_preprocessing.ipynb':
    '71a3f07eb9413da9c908db19db6d2c2cf54c411635423d70f679356937aebcc7',
  '03_recommendation.ipynb':
    'c92ab9424da25db110295155fb8a9ab1982cb1960507dac9aac0c5c1157c8d0c',
  'data/processed/workout_videos.csv':
    '7f5169a8eb1ce296466b8f1cdbc98e97a296e689cc3d70d771bc4071a5db5225',
  'data/processed/workout_videos.json':
    '35cabf0c9303c6cd130ece6212bcadc87e89d977f6c11da673787d9d7177aea0',
};
const files = [];
for (const name of sourceFiles) {
  const bytes = await readFile(resolve(data, 'source/data-analysis', name));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== pinnedHashes[name])
    throw new Error(`Pinned source hash mismatch: ${name}`);
  files.push({
    source: `data-analysis/${name}`,
    sha256,
  });
}
const csv = await readFile(
  resolve(data, 'source/data-analysis/data/processed/workout_videos.csv'),
  'utf8',
);
const json = JSON.parse(
  await readFile(
    resolve(data, 'source/data-analysis/data/processed/workout_videos.json'),
    'utf8',
  ),
);
const catalog = transformCatalog(csv, json);
await writeFile(
  resolve(data, 'catalog.json'),
  `${JSON.stringify(catalog, null, 2)}\n`,
);
await writeFile(
  resolve(data, 'source-manifest.json'),
  `${JSON.stringify({ sourceCommit: SOURCE_COMMIT, files, catalogHash: catalog.contentHash, checkedOn: catalog.checkedOn, provenance: 'Git blob export, source files preserved byte for byte' }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    version: catalog.version,
    rows: catalog.videos.length,
    contentHash: catalog.contentHash,
  }),
);
