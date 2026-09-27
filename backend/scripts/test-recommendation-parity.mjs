import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'project-health-parity-'));
function run(command, args, env = process.env) {
  const child = spawnSync(command, args, {
    cwd: root,
    env: { ...env, PYTHONDONTWRITEBYTECODE: '1' },
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  return child.status ?? 1;
}
try {
  const python = process.env.RECOMMENDATION_PYTHON || 'python3';
  const generated = run(python, [
    'scripts/recommendation-python-reference.py',
    directory,
  ]);
  if (generated !== 0) {
    console.error(
      'Python reference generation failed. Use Python 3.12 with numpy 2.3.5 and pandas 2.2.3; set RECOMMENDATION_PYTHON if needed.',
    );
    process.exitCode = generated;
  } else {
    process.exitCode = run(
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        '--config',
        'vitest.config.parity.ts',
      ],
      {
        ...process.env,
        RECOMMENDATION_REFERENCE_PATH: join(directory, 'python-parity.json'),
      },
    );
  }
} finally {
  // Only remove the temporary directory allocated by this invocation.
  await rm(directory, { recursive: true, force: true });
}
