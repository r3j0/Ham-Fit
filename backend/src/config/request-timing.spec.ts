import express from 'express';
import request from 'supertest';
import {
  API_BOOT_ID,
  requestTiming,
  type RequestTiming,
} from './request-timing.js';

function fixture() {
  const entries: RequestTiming[] = [];
  const app = express();
  app.use(requestTiming((entry) => entries.push(entry)));
  app.get('/records/:id', (_req, res) => res.json({ ok: true }));
  app.get('/failure', (_req, res) => res.status(503).end());
  return { app, entries };
}

describe('request timing privacy and correlation', () => {
  it('logs the route template without user identifiers, query values or credentials', async () => {
    const { app, entries } = fixture();
    const response = await request(app)
      .get('/records/private-user-id?token=private-query-value')
      .set('Authorization', 'Bearer private-access-token')
      .set('Cookie', 'session=private-cookie-value')
      .set('X-Request-Id', 'untrusted-request-id');
    expect(response.status).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0].route).toBe('/records/:id');
    expect(entries[0].boot_id).toBe(API_BOOT_ID);
    expect(entries[0].request_id).toBe(response.headers['x-request-id']);
    expect(entries[0].request_id).not.toBe('untrusted-request-id');
    expect(JSON.stringify(entries)).not.toMatch(
      /private-|untrusted-request-id/,
    );
    expect(entries[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('records the real failure status and keeps unmatched paths private', async () => {
    const { app, entries } = fixture();
    await request(app).get('/failure').expect(503);
    await request(app).get('/private-unknown-path').expect(404);
    expect(entries.map(({ status }) => status)).toEqual([503, 404]);
    expect(entries[1].route).toBe('unmatched');
    expect(JSON.stringify(entries)).not.toContain('private-unknown-path');
  });

  it('assigns distinct request IDs while preserving a shared instance identifier', async () => {
    const { app, entries } = fixture();
    await Promise.all([
      request(app).get('/records/a'),
      request(app).get('/records/b'),
    ]);
    expect(new Set(entries.map(({ request_id }) => request_id)).size).toBe(2);
    expect(new Set(entries.map(({ boot_id }) => boot_id)).size).toBe(1);
  });
});
