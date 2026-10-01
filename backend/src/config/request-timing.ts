import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const API_BOOT_ID = randomUUID();

export type RequestTiming = {
  event: 'api_request_timing';
  boot_id: string;
  request_id: string;
  method: string;
  route: string;
  status: number;
  duration_ms: number;
};

/** Record route templates and timings only; never URLs, bodies or credentials. */
export function requestTiming(
  write: (entry: RequestTiming) => void = (entry) =>
    console.log(JSON.stringify(entry)),
): RequestHandler {
  return (request, response, next) => {
    const started = performance.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);
    response.once('finish', () => {
      const route = request.route?.path;
      write({
        event: 'api_request_timing',
        boot_id: API_BOOT_ID,
        request_id: requestId,
        method: request.method,
        route: typeof route === 'string' ? route : 'unmatched',
        status: response.statusCode,
        duration_ms: Math.round(performance.now() - started),
      });
    });
    next();
  };
}
