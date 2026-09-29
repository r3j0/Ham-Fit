import { describe, expect, it } from 'vitest';
import { parseRoutineDecision, routineInput } from './routine-algorithm.js';
import type { serializeRecord } from '../measurements/measurements.service.js';
import type { AxisEvaluation } from '../measurements/evaluation/evaluation-types.js';
import { fixtureAdjustment } from '../../test/fixtures/workouts.js';

const output = () => ({
  algorithmVersion: `recommendation_v2:${'a'.repeat(64)}`,
  dataVersion: 'b'.repeat(64),
  durations: { 'TEST.mp4': 37 },
  result: {
    nextWorkout: {
      estimatedMinutes: 2,
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
    weightAdjustment: fixtureAdjustment(),
  },
});

describe('Python transport contract', () => {
  it('accepts the returned prescription and signed weight changes without calculating them', () => {
    const value = output();
    value.result.weightAdjustment.strength.delta = -0.1;
    expect(parseRoutineDecision(value)).toEqual(value);
  });
  it.each([
    'missing duration',
    'duplicate video',
    'bad order',
    'bad URL',
    'nonfinite estimate',
    'missing factor',
    'bad prescription',
  ])('rejects invalid output: %s', (kind) => {
    const value = output();
    const item = value.result.nextWorkout.routine[0];
    switch (kind) {
      case 'missing duration':
        value.durations['TEST.mp4'] = 0;
        break;
      case 'duplicate video':
        value.result.nextWorkout.routine.push({ ...item, order: 2 });
        break;
      case 'bad order':
        item.order = 2;
        break;
      case 'bad URL':
        item.videoUrl = 'http://127.0.0.1/private';
        break;
      case 'nonfinite estimate':
        value.result.nextWorkout.estimatedMinutes = Infinity;
        break;
      case 'missing factor':
        Reflect.deleteProperty(value.result.weightAdjustment, 'strength');
        break;
      case 'bad prescription':
        item.prescription.sets = 0;
        break;
    }
    expect(() => parseRoutineDecision(value)).toThrow();
  });
  it('passes numeric stored grades only, renames axes, and leaves ungraded axes unset', () => {
    const measurement = {
      axes: [
        { axis: 'strength', status: 'graded', grade: 2 },
        { axis: 'muscular_endurance', status: 'below_standard', grade: null },
        { axis: 'cardiorespiratory_endurance', status: 'graded', grade: 3 },
        { axis: 'flexibility', status: 'unevaluable', grade: null },
      ] as AxisEvaluation[],
    } as ReturnType<typeof serializeRecord>;
    const input = routineInput({
      age: 26,
      measurement,
      exerciseVolume: 'more',
      exerciseGoal: 'fitness_grade_improvement',
      ownedTools: [
        'bosu',
        'agility_ladder',
        'cone',
        'ball',
        'step_box',
        'dumbbell',
        'band',
        'gym_ball',
        'foam_roller',
        'jump_rope',
        'band',
      ],
      currentDate: '2026-09-29',
      logs: [
        { videoId: 'TEST.mp4', date: '2026-09-29T01:00:00Z', completed: true },
      ],
    });
    expect(input).toEqual({
      profile: { age: 26 },
      fitness100: {
        fitness: {
          strength: 2,
          muscularEndurance: null,
          cardiovascularEndurance: 3,
          flexibility: null,
        },
      },
      logs: [
        { videoId: 'TEST.mp4', date: '2026-09-29T01:00:00Z', completed: true },
      ],
      current_date: '2026-09-29',
      goal: 'grade',
      routine_level: 'full',
      owned_tools: [
        '밴드',
        '덤벨',
        '짐볼',
        '폼롤러',
        '줄넘기',
        '스텝박스',
        '공',
        '콘',
        '사다리',
        '보슈',
      ],
    });
  });
});
