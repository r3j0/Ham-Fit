import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseCredentials } from '../auth/auth-input.js';
import { parseNickname } from './nickname.js';
import { parseProfileUpdate } from './user-profile-input.js';

describe('nickname input policy', () => {
  it('normalizes surrounding whitespace and decomposed Korean without changing case', () => {
    expect(parseNickname(`  ${'운동친구'.normalize('NFD')}  `)).toBe(
      '운동친구',
    );
    expect(parseNickname('Health_100')).toBe('Health_100');
    expect(parseNickname('ㄱㄱ')).toBe('ㄱㄱ');
    expect(parseNickname('가나')).toBe('가나');
    expect(parseNickname('가'.repeat(20))).toBe('가'.repeat(20));
  });

  it.each([
    undefined,
    null,
    123,
    {},
    [],
    '',
    '  ',
    '가',
    '가'.repeat(21),
    '운동 친구',
    '운동\n친구',
    '운동\u0000친구',
    '운동\u200b친구',
    '운동💪',
    '<script>',
  ])('rejects invalid nickname %j with a field error', (value) => {
    try {
      parseNickname(value);
      expect.fail('Expected nickname validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'INVALID_NICKNAME',
        errors: [{ field: 'nickname' }],
      });
    }
  });

  it('accepts nickname only during registration and preserves old credential requests', () => {
    const credentials = {
      email: 'nickname@example.test',
      password: 'nickname-test-password',
    };
    expect(parseCredentials(credentials, true).nickname).toBeUndefined();
    expect(
      parseCredentials({ ...credentials, nickname: ' 운동친구 ' }, true)
        .nickname,
    ).toBe('운동친구');
    expect(() =>
      parseCredentials({ ...credentials, nickname: '운동친구' }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseCredentials({ ...credentials, nickname: null }, true),
    ).toThrow(BadRequestException);
  });

  it('allows either profile field or both while rejecting empty and foreign updates', () => {
    expect(parseProfileUpdate({ nickname: '운동친구' })).toEqual({
      nickname: '운동친구',
      dateOfBirth: undefined,
    });
    expect(parseProfileUpdate({ dateOfBirth: '2000-02-29' })).toEqual({
      dateOfBirth: '2000-02-29',
      nickname: undefined,
    });
    expect(
      parseProfileUpdate({ nickname: '운동친구', dateOfBirth: '2000-02-29' }),
    ).toEqual({ nickname: '운동친구', dateOfBirth: '2000-02-29' });
    for (const value of [
      {},
      { nickname: undefined },
      { nickname: null },
      { nickname: '운동친구', dateOfBirth: '2001-02-29' },
      { nickname: '운동친구', userId: 'another-user' },
      { nickname: '운동친구', email: 'someone@example.test' },
    ])
      expect(() => parseProfileUpdate(value)).toThrow(BadRequestException);
  });
});
