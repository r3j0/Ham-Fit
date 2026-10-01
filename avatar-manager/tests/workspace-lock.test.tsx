import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withWorkspaceLock } from '../src/lib/workspace-lock';

test('local saves cannot overlap publication or server pull and failures release the lock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'avatar-lock-test-'));
  try {
    await withWorkspaceLock(async () => {
      await assert.rejects(withWorkspaceLock(async () => 'overlap', root), { status: 409 });
    }, root);
    await assert.rejects(withWorkspaceLock(async () => { throw new Error('failed'); }, root), /failed/);
    assert.equal(await withWorkspaceLock(async () => 'next', root), 'next');
  } finally { await rm(root, { recursive: true, force: true }); }
});
