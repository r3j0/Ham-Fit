import { describe, expect, it } from 'vitest';
import {
  ageOnDate,
  birthProfile,
  koreaDate,
  parseDateOfBirth,
} from './date-of-birth.js';
import { parseCredentials } from '../auth/auth-input.js';

describe('KST calendar birthday policy', () => {
  it('rolls over at Korean midnight independently of UTC', () => {
    expect(koreaDate(new Date('2026-09-26T14:59:59.999Z'))).toBe('2026-09-26');
    expect(koreaDate(new Date('2026-09-26T15:00:00Z'))).toBe('2026-09-27');
    expect(ageOnDate('2000-09-27', '2026-09-26')).toBe(25);
    expect(ageOnDate('2000-09-27', '2026-09-27')).toBe(26);
    expect(ageOnDate('2000-09-27', '2026-09-28')).toBe(26);
  });
  it('handles leap birthdays and Gregorian calendar validity', () => {
    expect(parseDateOfBirth('2000-02-29')).toBe('2000-02-29');
    expect(ageOnDate('2000-02-29', '2024-02-28')).toBe(23);
    expect(ageOnDate('2000-02-29', '2024-02-29')).toBe(24);
    expect(ageOnDate('2000-02-29', '2025-02-28')).toBe(24);
    expect(ageOnDate('2000-02-29', '2025-03-01')).toBe(25);
  });
  it.each([
    '1900-02-29',
    '2025-02-29',
    '2026-04-31',
    '2026-13-01',
    '0000-01-01',
    '2000-1-1',
    '2000-01-01T00:00:00Z',
    null,
    20000101,
  ])('rejects invalid date %s', (value) => {
    expect(() => parseDateOfBirth(value)).toThrow();
  });
  it('rejects future date using server KST today', () => {
    expect(() =>
      parseDateOfBirth('2026-09-27', new Date('2026-09-26T14:59:59Z')),
    ).toThrow();
    expect(
      parseDateOfBirth('2026-09-27', new Date('2026-09-26T15:00:00Z')),
    ).toBe('2026-09-27');
  });
  it('keeps v1 registration optional and login strict', () => {
    const credentials = {
      email: 'a@example.test',
      password: 'long-enough-test-password',
    };
    expect(parseCredentials(credentials, true).dateOfBirth).toBeUndefined();
    expect(
      parseCredentials({ ...credentials, dateOfBirth: '2000-02-29' }, true)
        .dateOfBirth,
    ).toBe('2000-02-29');
    expect(() =>
      parseCredentials({ ...credentials, dateOfBirth: '2000-02-29' }),
    ).toThrow();
    expect(() =>
      parseCredentials({ ...credentials, dateOfBirth: null }, true),
    ).toThrow();
  });
  it('serializes null without inventing age', () => {
    expect(birthProfile(null)).toEqual({ dateOfBirth: null, currentAge: null });
    expect(
      birthProfile(
        new Date('2000-02-29T00:00:00Z'),
        new Date('2025-02-28T15:00:00Z'),
      ),
    ).toEqual({ dateOfBirth: '2000-02-29', currentAge: 25 });
  });
});
