import test from 'node:test';
import assert from 'node:assert/strict';
import { localRequest } from '../src/lib/backend';

test('loopback origin uses the browser Host rather than Next internal hostname', () => {
  for (const host of ['localhost:3002', '127.0.0.1:3002', '[::1]:3002']) {
    assert.equal(localRequest(new Request('http://localhost:3002/api/publish', { headers: { host, origin: `http://${host}` } })), true);
  }
});
test('external hosts, foreign origins and missing write origins are rejected', () => {
  const cases: Record<string, string>[] = [
    { host: 'example.com:3002', origin: 'http://example.com:3002' },
    { host: '127.0.0.1:3002', origin: 'http://example.com' },
    { host: '127.0.0.1:3002' },
    { host: '127.0.0.1:3002', origin: 'http://127.0.0.1:3003' },
  ];
  for (const headers of cases) assert.equal(localRequest(new Request('http://localhost:3002/api/publish', { headers })), false);
});
