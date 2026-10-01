import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { parseDateOfBirth } from '../users/date-of-birth.js';
import { parseNickname } from '../users/nickname.js';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const loginSchema = z.strictObject({
  email,
  password: z.string().min(1).max(128),
});
const newPassword = z.string().min(15).max(128);
const registerSchema = loginSchema.extend({
  password: newPassword,
  dateOfBirth: z.string().optional(),
  nickname: z.unknown().optional(),
});
const accountUpdateSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(128),
    email: email.optional(),
    newPassword: newPassword.optional(),
  })
  .refine(
    (input) => input.email !== undefined || input.newPassword !== undefined,
  );

export type AccountUpdateInput = z.output<typeof accountUpdateSchema>;

export function parseAccountUpdate(input: unknown): AccountUpdateInput {
  const result = accountUpdateSchema.safeParse(input);
  if (!result.success)
    throw new BadRequestException({
      statusCode: 400,
      message:
        '현재 비밀번호와 변경할 이메일 또는 15~128자 새 비밀번호를 입력해 주세요.',
    });
  return result.data;
}

export function parseCredentials(input: unknown, registration = false) {
  const result = (registration ? registerSchema : loginSchema).safeParse(input);
  if (!result.success) {
    // Never include submitted values, passwords, or the original request body.
    throw new BadRequestException({
      statusCode: 400,
      message: registration
        ? '유효한 이메일과 15~128자 비밀번호를 입력해 주세요.'
        : '유효한 이메일과 비밀번호를 입력해 주세요.',
    });
  }
  const data = result.data;
  return {
    ...data,
    dateOfBirth:
      registration && 'dateOfBirth' in data && data.dateOfBirth !== undefined
        ? parseDateOfBirth(data.dateOfBirth)
        : undefined,
    nickname:
      registration && 'nickname' in data && data.nickname !== undefined
        ? parseNickname(data.nickname)
        : undefined,
  };
}
