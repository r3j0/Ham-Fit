import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const manager = path.join(root, '.env.local'), backend = path.join(root, '../backend/.env.avatar-manager');
async function existing(file) { try { return await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; return ''; } }
const localText = await existing(manager), backendText = await existing(backend), primaryText = await existing(path.join(root, '../backend/.env'));
function readToken(text) {
  const value = /^AVATAR_MANAGER_TOKEN=(.*)$/m.exec(text)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (!value) return undefined;
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Existing AVATAR_MANAGER_TOKEN is invalid. No credentials were overwritten.');
  return value;
}
const tokens = [readToken(localText), readToken(backendText), readToken(primaryText), readToken(`AVATAR_MANAGER_TOKEN=${process.env.AVATAR_MANAGER_TOKEN ?? ''}`)].filter(Boolean);
if (new Set(tokens).size > 1) throw new Error('Existing manager and backend tokens differ. Resolve them explicitly; no credentials were overwritten.');
const token = tokens[0] ?? randomBytes(32).toString('hex');
function set(text, key, value) { const line = `${key}=${value}`; const regex = new RegExp(`^${key}=.*$`, 'm'); return regex.test(text) ? text.replace(regex, line) : `${text.trimEnd()}\n${line}\n`; }
let managerText = set(localText, 'AVATAR_MANAGER_TOKEN', token);
if (!/^AVATAR_BACKEND_URL=/m.test(managerText)) managerText = set(managerText, 'AVATAR_BACKEND_URL', 'http://127.0.0.1:3001/api/v1');
if (!/^AVATAR_FRONTEND_URL=/m.test(managerText)) managerText = set(managerText, 'AVATAR_FRONTEND_URL', 'http://127.0.0.1:3000');
await writeFile(manager, managerText.trimStart(), { mode: 0o600 });
await writeFile(backend, set(backendText, 'AVATAR_MANAGER_TOKEN', token).trimStart(), { mode: 0o600 });
console.log('Configured server-only manager credential. Restart NestJS and avatar-manager; no token was printed.');
