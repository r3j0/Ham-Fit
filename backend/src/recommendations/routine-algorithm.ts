import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { z } from 'zod';
import type {
  ExerciseGoal,
  ExerciseVolume,
  OwnedTool,
} from '../generated/prisma/enums.js';
import {
  normalizeOwnedTools,
  PYTHON_TOOL_NAMES,
} from '../users/owned-tools.js';
import type { serializeRecord } from '../measurements/measurements.service.js';
import { FITNESS_FACTORS } from './workout-contracts.js';
import type { WorkoutLog } from './workout-contracts.js';

const volumes = { less: 'light', standard: 'normal', more: 'full' } as const;
const goals = {
  fitness_grade_improvement: 'grade',
  body_composition_management: 'body',
  general_fitness_improvement: 'general',
} as const;
const axes = {
  strength: 'strength',
  muscular_endurance: 'muscularEndurance',
  cardiorespiratory_endurance: 'cardiovascularEndurance',
  flexibility: 'flexibility',
  agility: 'agility',
  power: 'power',
} as const;

export function routineInput(input: {
  age: number;
  measurement: ReturnType<typeof serializeRecord>;
  exerciseVolume: ExerciseVolume;
  exerciseGoal: ExerciseGoal;
  ownedTools: OwnedTool[];
  currentDate: string;
  logs: WorkoutLog[];
}) {
  return {
    profile: { age: input.age },
    fitness100: {
      fitness: Object.fromEntries(
        input.measurement.axes.map((axis) => [
          axes[axis.axis],
          // No inferred grades from display text, raw values, or old records.
          axis.status === 'graded' ? axis.grade : null,
        ]),
      ),
    },
    logs: input.logs.map(({ date, videoId, completed }) => ({
      date,
      videoId,
      completed,
    })),
    current_date: input.currentDate,
    goal: goals[input.exerciseGoal],
    routine_level: volumes[input.exerciseVolume],
    owned_tools: normalizeOwnedTools(input.ownedTools).map(
      (tool) => PYTHON_TOOL_NAMES[tool],
    ),
  };
}
export type RoutineInput = ReturnType<typeof routineInput>;
export const prescriptionSchema = z.strictObject({
  doseType: z.enum(['reps', 'hold', 'timed']),
  value: z.string().min(1),
  unit: z.string().min(1),
  sets: z.number().int().positive(),
  restSec: z.number().nonnegative(),
  text: z.string().min(1),
});
const outputSchema = z.strictObject({
  algorithmVersion: z.string().regex(/^recommendation_v2:[a-f0-9]{64}$/),
  dataVersion: z.string().regex(/^[a-f0-9]{64}$/),
  durations: z.record(z.string(), z.number().positive()),
  result: z.strictObject({
    nextWorkout: z.strictObject({
      estimatedMinutes: z.number().positive(),
      routine: z
        .array(
          z.strictObject({
            order: z.number().int().positive(),
            videoId: z.string().regex(/^[A-Za-z0-9_-]+\.mp4$/),
            title: z.string().min(1),
            videoUrl: z.string(),
            slot: z.enum([
              'flexibility_group',
              'agility_power_group',
              'strength_group',
              'cooldown',
            ]),
            prescription: prescriptionSchema,
          }),
        )
        .min(1),
    }),
    weightAdjustment: z.record(
      z.enum(FITNESS_FACTORS),
      z.strictObject({
        previous: z.number(),
        delta: z.number(),
        next: z.number(),
      }),
    ),
  }),
});
export type RoutineDecision = z.infer<typeof outputSchema>;

export function parseRoutineDecision(value: unknown): RoutineDecision {
  const parsed = outputSchema.safeParse(value);
  if (!parsed.success) throw algorithmUnavailable();
  const result = parsed.data;
  const ids = new Set<string>();
  for (const [index, item] of result.result.nextWorkout.routine.entries()) {
    if (
      item.order !== index + 1 ||
      ids.has(item.videoId) ||
      !result.durations[item.videoId] ||
      item.videoUrl !== `http://openapi.kspo.or.kr/web/video/${item.videoId}`
    )
      throw algorithmUnavailable();
    ids.add(item.videoId);
  }
  return result;
}
function algorithmUnavailable() {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: 'ROUTINE_ALGORITHM_UNAVAILABLE',
    message:
      '추천 루틴을 생성할 수 없습니다. 알고리즘 실행 환경과 데이터를 확인해 주세요.',
  });
}

@Injectable()
export class RoutineAlgorithm {
  private running = 0;
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async recommend(input: RoutineInput): Promise<RoutineDecision> {
    // Bound subprocess work independently of HTTP requests and DB pool size.
    if (this.running >= 2) throw algorithmUnavailable();
    const payload = JSON.stringify(input);
    if (Buffer.byteLength(payload) > 2 * 1024 * 1024)
      throw algorithmUnavailable();
    this.running++;
    try {
      const output = await new Promise<string>((resolveOutput, reject) => {
        const child = execFile(
          this.config.get<string>('RECOMMENDATION_PYTHON') || 'python3',
          [
            '-B',
            resolve('scripts/recommendation-runner.py'),
            resolve(
              this.config.get<string>('RECOMMENDATION_SOURCE_PATH') ||
                '../data-analysis/src/recommendation_v2.py',
            ),
            resolve(
              this.config.get<string>('WORKOUT_VIDEOS_PATH') ||
                '../data-analysis/data/processed/workout_videos_v2_complete.csv',
            ),
          ],
          {
            timeout: 10_000,
            killSignal: 'SIGKILL',
            maxBuffer: 2 * 1024 * 1024,
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
          },
          (error, stdout) =>
            error ? reject(algorithmUnavailable()) : resolveOutput(stdout),
        );
        child.stdin?.on('error', () => {
          /* Process failure is handled by execFile. */
        });
        child.stdin?.end(payload);
      });
      return parseRoutineDecision(JSON.parse(output));
    } catch {
      throw algorithmUnavailable();
    } finally {
      this.running--;
    }
  }
}
