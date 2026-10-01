// Verify the packaged Python/data/media artifacts before accepting requests.
// Schema changes are applied once by the deployment job, never on cold starts.
await import('./verify-deployment.mjs');
await import('../dist/main.js');
