import { z } from 'zod';
import { invalidUserInput, parseEntityId } from '../users/user-input.js';

const text = (max: number, min = 0) =>
  z
    .string()
    .transform((value) => value.normalize('NFC').trim())
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine(
          (value) => !/[\p{Cc}\p{Cf}]/u.test(value),
          '제어 문자는 사용할 수 없습니다.',
        ),
    );
export const createGroupSchema = z.strictObject({
  name: text(50, 1),
  description: text(500),
  maxMembers: z.number().int().min(1).max(100),
});
export const updateGroupSchema = createGroupSchema
  .pick({ name: true, description: true })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    '변경할 항목을 입력해 주세요.',
  );
export const joinGroupSchema = z.strictObject({
  inviteCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{43}$/),
});
export const transferGroupSchema = z.strictObject({
  userId: z.uuid().transform((value) => value.toLowerCase()),
});
export const pageSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z
    .uuid()
    .transform((value) => value.toLowerCase())
    .optional(),
});
export const applicationPageSchema = pageSchema.extend({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});
export function parseGroupInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    invalidUserInput(
      result.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.') || 'body',
        message: issue.message,
      })),
    );
  return result.data;
}
export function requestKey(value: unknown) {
  if (value === undefined)
    invalidUserInput([
      { field: 'Idempotency-Key', message: 'UUID 요청 키가 필요합니다.' },
    ]);
  return parseEntityId(value);
}
