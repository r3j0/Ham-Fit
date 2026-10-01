import 'reflect-metadata';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { catalogFromCsv } from './probe-workout-media.mjs';
import { createMediaResolver } from '../dist/recommendations/media.js';
import { RoutineAlgorithm } from '../dist/recommendations/routine-algorithm.js';

config({ quiet: true });
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--routine-input')) {
  throw new Error(
    'Usage: node scripts/verify-deployment.mjs [--routine-input TEST_FIXTURE.json]',
  );
}
const source = resolve(
  process.env.RECOMMENDATION_SOURCE_PATH ||
    '../data-analysis/src/recommendation_v2.py',
);
const csv = resolve(
  process.env.WORKOUT_VIDEOS_PATH ||
    '../data-analysis/data/processed/workout_videos_v2_complete.csv',
);
const reportPath = resolve(
  process.env.WORKOUT_MEDIA_REPORT_PATH || 'deploy/media-verification.json',
);
const python = process.env.RECOMMENDATION_PYTHON || 'python3';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceHash = hash(readFileSync(source));
const csvBytes = readFileSync(csv);
const dataVersion = hash(csvBytes);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const videos = catalogFromCsv(csvBytes);
if (
  report.sourceCommit !== dataVersion ||
  report.videos?.length !== videos.length
) {
  throw new Error(
    'Deployment video report does not match the exact CSV bytes. Regenerate it for the committed source.',
  );
}
const media = createMediaResolver(report, dataVersion);
for (const video of videos) {
  if (!media(video.videoId, video.videoUrl, video.duration).playbackUrl) {
    throw new Error(
      `Deployment playback verification is missing: ${video.videoId}`,
    );
  }
}
// Import the original module in its own process, just as the live adapter does.
// This checks Linux wheels and catalog loading without generating user data.
const runtime = JSON.parse(
  execFileSync(
    python,
    [
      '-B',
      '-c',
      `
import importlib.util, json, sys
import numpy, pandas
spec = importlib.util.spec_from_file_location("deployment_recommendation", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert callable(module.recommend_workout_routine)
assert callable(module.extract_fitness_data)
print(json.dumps({"numpy": numpy.__version__, "pandas": pandas.__version__}))
`,
      source,
    ],
    {
      env: {
        ...process.env,
        WORKOUT_VIDEOS_PATH: csv,
        PYTHONDONTWRITEBYTECODE: '1',
      },
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    },
  ),
);
if (runtime.numpy !== '2.0.2' || runtime.pandas !== '2.2.3') {
  throw new Error(
    'Recommendation libraries do not match requirements-recommendation.txt.',
  );
}
if (
  hash(readFileSync(source)) !== sourceHash ||
  hash(readFileSync(csv)) !== dataVersion
) {
  throw new Error('Recommendation artifacts changed during verification.');
}
let routineItems;
if (args.length) {
  // Explicit CI-only fixture. This result is never persisted or returned by an API.
  const input = JSON.parse(readFileSync(resolve(args[1]), 'utf8'));
  const algorithm = new RoutineAlgorithm(
    new ConfigService({
      RECOMMENDATION_PYTHON: python,
      RECOMMENDATION_SOURCE_PATH: source,
      WORKOUT_VIDEOS_PATH: csv,
    }),
  );
  const decision = await algorithm.recommend(input);
  if (
    decision.algorithmVersion !== `recommendation_v2:${sourceHash}` ||
    decision.dataVersion !== dataVersion
  ) {
    throw new Error(
      'Recommendation output versions do not match deployment artifacts.',
    );
  }
  for (const item of decision.result.workout.routine) {
    if (
      !media(item.videoId, item.videoUrl, decision.durations[item.videoId])
        .playbackUrl
    ) {
      throw new Error('Recommended item has no verified playback URL.');
    }
  }
  routineItems = decision.result.workout.routine.length;
}
console.log(
  JSON.stringify({
    status: 'verified',
    catalogVideos: videos.length,
    dataVersion,
    ...runtime,
    ...(routineItems ? { routineItems } : {}),
  }),
);
