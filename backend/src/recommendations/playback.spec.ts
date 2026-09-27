import { describe, expect, it } from 'vitest';
import {
  nextPlaybackStatus,
  normalizePlaybackProgress,
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
  it('recognizes 50% from decimal intervals without rounding a real shortfall up', () => {
    const intervals = unionIntervals(
      [
        { start: 0.1, end: 25.1 },
        { start: 50.1, end: 75.1 },
      ],
      100,
    );
    expect(watchedSeconds(intervals)).toBeCloseTo(50, 12);
    expect(
      nextPlaybackStatus('in_progress', 'end', watchedSeconds(intervals), 100),
    ).toBe('interrupted');
    expect(nextPlaybackStatus('in_progress', 'end', 49.9999999, 100)).toBe(
      'not_performed',
    );
  });
  it('clips only the verified overrun and ignores its zero-length remainder', () => {
    expect(
      normalizePlaybackProgress(
        {
          positionSeconds: 100.4,
          intervals: [{ start: 99.9, end: 100.4 }],
        },
        100,
        100.4,
      ),
    ).toEqual({
      positionSeconds: 100,
      intervals: [{ start: 99.9, end: 100 }],
    });
    expect(
      normalizePlaybackProgress(
        {
          positionSeconds: 100,
          intervals: [
            { start: 100, end: 100.4 },
            { start: 100.1, end: 100.3 },
          ],
        },
        100,
        100.4,
      ),
    ).toEqual({ positionSeconds: 100, intervals: [] });
    expect(
      normalizePlaybackProgress(
        {
          positionSeconds: 99.6,
          intervals: [{ start: 0, end: 99.6 }],
        },
        100,
        100,
      ),
    ).toEqual({ positionSeconds: 99.6, intervals: [{ start: 0, end: 99.6 }] });
  });
  it('rejects invalid raw intervals before normalizing them', () => {
    for (const interval of [
      { start: 100.1, end: 100.1 },
      { start: 100.4, end: 100.1 },
      { start: 100.1, end: 100.5 },
      { start: -0.1, end: 100.4 },
    ])
      expect(() =>
        normalizePlaybackProgress(
          {
            positionSeconds: 100,
            intervals: [interval],
          },
          100,
          100.4,
        ),
      ).toThrow();
    expect(() =>
      normalizePlaybackProgress(
        { positionSeconds: 100.5, intervals: [] },
        100,
        100.4,
      ),
    ).toThrow();
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
