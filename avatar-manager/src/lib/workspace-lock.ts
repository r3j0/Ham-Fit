import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { WardrobeStoreError } from './wardrobe-errors';

/** Serialize local edits, server publication and pulls across tabs and Node processes. */
export async function withWorkspaceLock<T>(operation: () => Promise<T>, root = process.cwd()): Promise<T> {
  await mkdir(path.join(root, '.local'), { recursive: true });
  const file = path.join(root, '.local/workspace.lock');
  let handle;
  try { handle = await open(file, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WardrobeStoreError('다른 편집·등록·불러오기 작업이 진행 중입니다. 완료 후 다시 시도하세요.', 409);
    throw error;
  }
  try { return await operation(); }
  finally { await handle.close(); await unlink(file); }
}
