import { z } from 'zod';
import { parseDateOfBirth } from './date-of-birth.js';
import { parseNickname } from './nickname.js';
import { invalidUserInput } from './user-input.js';

const profileUpdateSchema = z
  .strictObject({
    dateOfBirth: z.string().optional(),
    nickname: z.unknown().optional(),
  })
  .refine(
    (input) => input.dateOfBirth !== undefined || input.nickname !== undefined,
    { message: '변경할 생년월일 또는 닉네임을 입력해 주세요.' },
  );

export function parseProfileUpdate(input: unknown) {
  const result = profileUpdateSchema.safeParse(input);
  if (!result.success)
    invalidUserInput(
      result.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.') || 'body',
        message: issue.message,
      })),
    );
  return {
    dateOfBirth:
      result.data.dateOfBirth === undefined
        ? undefined
        : parseDateOfBirth(result.data.dateOfBirth),
    nickname:
      result.data.nickname === undefined
        ? undefined
        : parseNickname(result.data.nickname),
  };
}
