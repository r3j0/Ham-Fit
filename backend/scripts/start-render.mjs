// Verify the packaged Python/data/media artifacts before accepting requests.
// Schema changes are applied once by the deployment job, never on cold starts.
import { API_BOOT_ID } from '../dist/config/request-timing.js';

const started = performance.now();
const timingEnabled = process.env.API_REQUEST_TIMING === '1';
const phase = (name, duration) => {
  if (timingEnabled)
    console.log(
      JSON.stringify({
        event: 'api_startup_timing',
        boot_id: API_BOOT_ID,
        phase: name,
        duration_ms: Math.round(duration),
      }),
    );
};
phase('launcher_started', 0);
await import('./verify-deployment.mjs');
const verified = performance.now();
phase('artifact_verification', verified - started);
await import('../dist/main.js');
phase('application_bootstrap', performance.now() - verified);
phase('application_ready', performance.now() - started);
