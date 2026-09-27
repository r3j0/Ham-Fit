import { describe, expect, it } from 'vitest';
import {
  nextPlaybackStatus,
  parsePlaybackEvent,
  unionIntervals,
  watchedSeconds,
} from './playback.js';
import { randomUUID } from 'node:crypto';
describe('played interval union and explicit outcome semantics', () => {
  it('does not count seeks, repeats or overlapping reports twice', () => {
    const intervals = unionIntervals(
      [
        { start: 0, end: 20 },
        { start: 70, end: 80 },
        { start: 10, end: 30 },
        { start: 0, end: 20 },
      ],
      100,
    );
    expect(intervals).toEqual([
      { start: 0, end: 30 },
      { start: 70, end: 80 },
    ]);
    expect(watchedSeconds(intervals)).toBe(40);
  });
  it('distinguishes 49.9%, exactly 50%, provisional playback and explicit completion', () => {
    expect(nextPlaybackStatus('in_progress', 'end', 49.9, 100)).toBe(
      'not_performed',
    );
    expect(nextPlaybackStatus('in_progress', 'end', 50, 100)).toBe(
      'interrupted',
    );
    expect(nextPlaybackStatus('in_progress', 'pause', 100, 100)).toBe(
      'in_progress',
    );
    expect(nextPlaybackStatus('in_progress', 'complete', 0, 100)).toBe(
      'completed',
    );
    expect(nextPlaybackStatus('interrupted', 'start', 50, 100)).toBe(
      'in_progress',
    );
    expect(() => nextPlaybackStatus('assigned', 'progress', 50, 100)).toThrow();
    expect(() => nextPlaybackStatus('completed', 'start', 100, 100)).toThrow();
  });
  it('rejects nonfinite, negative, out-of-duration and malformed reports', () => {
    for (const interval of [
      { start: -1, end: 2 },
      { start: 0, end: 101 },
      { start: 1, end: 1 },
      { start: 0, end: Infinity },
      { start: NaN, end: 1 },
    ])
      expect(() => unionIntervals([interval], 100)).toThrow();
    const event = {
      type: 'progress',
      deviceId: randomUUID(),
      sequence: 1,
      positionSeconds: 0,
      intervals: [],
    };
    expect(() =>
      parsePlaybackEvent({ ...event, positionSeconds: Infinity }),
    ).toThrow();
    expect(() =>
      parsePlaybackEvent({ ...event, completionCoefficient: 1 }),
    ).toThrow();
    expect(() =>
      parsePlaybackEvent({ ...event, videoId: 'spoofed' }),
    ).toThrow();
  });
});
