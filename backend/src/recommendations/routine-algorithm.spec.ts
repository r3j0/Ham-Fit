import { describe, expect, it } from 'vitest';
import { parseRoutineDecision, routineInput } from './routine-algorithm.js';
import type { serializeRecord } from '../measurements/measurements.service.js';
import type { AxisEvaluation } from '../measurements/evaluation/evaluation-types.js';

const output = () => ({
  algorithmVersion: `recommendation_v2:${'a'.repeat(64)}`,
  dataVersion: 'b'.repeat(64),
  durations: { 'TEST.mp4': 37 },
  result: {
    workout: {
      estimatedMinutes: 2,
      cardioRecommendation: { activity: '걷기', minutes: 20 },
      routine: [
        {
          order: 1,
          videoId: 'TEST.mp4',
          title: '[TEST ONLY]',
          videoUrl: 'http://openapi.kspo.or.kr/web/video/TEST.mp4',
          slot: 'strength_group',
          prescription: {
            doseType: 'reps',
            value: '10~15',
            unit: '회',
            sets: 2,
            restSec: 20,
            text: '10~15회 × 2세트',
          },
        },
      ],
    },
  },
});

describe('Python transport contract', () => {
  it('accepts the original same-day prescription without next-day weight adjustments', () => {
    const value = output();
    expect(parseRoutineDecision(value)).toEqual(value);
  });
  it.each([
    undefined,
    null,
    {},
    { activity: '자전거', minutes: 20 },
    { activity: '걷기', minutes: 0 },
    { activity: '뛰기', minutes: -1 },
    { activity: '걷기', minutes: 1.5 },
    { activity: '걷기', minutes: '20' },
    { activity: '걷기', minutes: Infinity },
    { activity: '걷기', minutes: NaN },
    { activity: '걷기' },
    { minutes: 20 },
    { activity: '걷기', minutes: 20, videoId: 'fake.mp4' },
  ])('rejects malformed or absent cardio on new decisions: %j', (cardio) => {
    const value = output();
    Reflect.set(value.result.workout, 'cardioRecommendation', cardio);
    expect(() => parseRoutineDecision(value)).toThrow();
  });
  it.each([
    'missing duration',
    'duplicate video',
    'bad order',
    'bad URL',
    'nonfinite estimate',
    'missing workout',
    'bad prescription',
  ])('rejects invalid output: %s', (kind) => {
    const value = output();
    const item = value.result.workout.routine[0];
    switch (kind) {
      case 'missing duration':
        value.durations['TEST.mp4'] = 0;
        break;
      case 'duplicate video':
        value.result.workout.routine.push({ ...item, order: 2 });
        break;
      case 'bad order':
        item.order = 2;
        break;
      case 'bad URL':
        item.videoUrl = 'http://127.0.0.1/private';
        break;
      case 'nonfinite estimate':
        value.result.workout.estimatedMinutes = Infinity;
        break;
      case 'missing workout':
        Reflect.deleteProperty(value.result, 'workout');
        break;
      case 'bad prescription':
        item.prescription.sets = 0;
        break;
    }
    expect(() => parseRoutineDecision(value)).toThrow();
  });
  it('maps below-standard only for calculation and preserves original axes', () => {
    const measurement = {
      axes: [
        { axis: 'strength', status: 'graded', grade: 2 },
        { axis: 'muscular_endurance', status: 'below_standard', grade: null },
        { axis: 'cardiorespiratory_endurance', status: 'graded', grade: 3 },
        { axis: 'flexibility', status: 'unevaluable', grade: null },
        { axis: 'agility', status: 'not_measured', grade: null },
        { axis: 'power', status: 'graded', grade: 1 },
      ] as AxisEvaluation[],
    } as ReturnType<typeof serializeRecord>;
    const original = structuredClone(measurement);
    const input = routineInput({
      age: 26,
      measurement,
      exerciseVolume: 'more',
      exerciseGoal: 'fitness_grade_improvement',
      ownedTools: [
        'ball',
        'step_box',
        'dumbbell',
        'band',
        'gym_ball',
        'jump_rope',
        'band',
      ],
      currentDate: '2026-09-29',
      logs: [
        { videoId: 'TEST.mp4', date: '2026-09-29T01:00:00Z', completed: true },
      ],
    });
    expect(measurement).toEqual(original);
    expect(input).toEqual({
      profile: { age: 26 },
      fitness100: {
        fitness: {
          strength: 2,
          muscularEndurance: 3,
          cardiovascularEndurance: 3,
          flexibility: null,
          agility: null,
          power: 1,
        },
      },
      logs: [
        { videoId: 'TEST.mp4', date: '2026-09-29T01:00:00Z', completed: true },
      ],
      current_date: '2026-09-29',
      goal: 'grade',
      routine_level: 'full',
      owned_tools: ['밴드', '덤벨', '짐볼', '줄넘기', '스텝박스', '공'],
    });
  });
});
