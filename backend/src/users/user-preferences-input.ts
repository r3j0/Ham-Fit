import { z } from 'zod';
import { ExerciseGoal, ExerciseVolume } from '../generated/prisma/enums.js';
import { invalidUserInput } from './user-input.js';

const updateSchema = z
  .strictObject({
    exerciseVolume: z.enum(ExerciseVolume).optional(),
    exerciseGoal: z.enum(ExerciseGoal).optional(),
  })
  .refine(
    (input) =>
      input.exerciseVolume !== undefined || input.exerciseGoal !== undefined,
    { message: '변경할 운동 설정을 하나 이상 전달해 주세요.' },
  );

export type UserPreferencesInput = z.infer<typeof updateSchema>;

export function parseUserPreferences(input: unknown): UserPreferencesInput {
  const result = updateSchema.safeParse(input);
  if (!result.success)
    invalidUserInput(
      result.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.') || 'body',
        message: issue.message,
      })),
    );
  return result.data;
}
