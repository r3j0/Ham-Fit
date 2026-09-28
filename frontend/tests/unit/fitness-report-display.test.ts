import test from "node:test";
import assert from "node:assert/strict";
import {
  belowGradeIntervals,
  reportGradeSteps,
} from "../../lib/fitness-report-display.ts";
import {
  storedRecordFixture,
  unscoredRecordFixture,
} from "../fixtures/measurement-evaluation.ts";

test("등급별 앞뒤 기준은 API의 실제 등급만 사용하고 평가 불가는 비워둔다", () => {
  const e = storedRecordFixture().items[0].evaluation;
  assert.deepEqual(
    reportGradeSteps(e).map((s) => s.title),
    ["3등급", "2등급", "1등급"],
  );
  e.grade = 3;
  e.nextTarget.grade = 2;
  e.nextTarget.intervals = e.thresholds[1].intervals;
  assert.deepEqual(
    reportGradeSteps(e).map((s) => s.title),
    ["기준 미달", "3등급", "2등급"],
  );
  e.grade = null;
  e.status = "below_standard";
  e.nextTarget.grade = 3;
  e.nextTarget.intervals = e.thresholds[2].intervals;
  assert.deepEqual(
    reportGradeSteps(e).map((s) => s.title),
    ["기준 미달", "3등급"],
  );
  assert.deepEqual(
    reportGradeSteps(unscoredRecordFixture().items[0].evaluation),
    [],
  );
});
test("3등급이 없는 종목에 3등급을 만들지 않고 서버가 정한 최고 등급을 표시한다", () => {
  const e = storedRecordFixture().items[0].evaluation;
  e.thresholds = e.thresholds.slice(0, 2);
  assert.deepEqual(
    reportGradeSteps(e).map((s) => s.title),
    ["기준 미달", "2등급", "1등급"],
  );
  e.grade = 1;
  e.nextTarget = {
    status: "highest_grade",
    grade: null,
    intervals: [],
    adjustments: [],
    reasonCode: "highest_grade_reached",
  };
  assert.deepEqual(
    reportGradeSteps(e).map((s) => s.title),
    ["2등급", "1등급", "최고 등급!"],
  );
});
test("기준 미달은 높을수록/낮을수록 좋은 기준의 열린 경계를 보존한다", () => {
  assert.deepEqual(
    belowGradeIntervals([
      { lower: { value: "5.3", inclusive: true }, upper: null },
      { lower: { value: "10.1", inclusive: true }, upper: null },
    ]),
    [{ lower: null, upper: { value: "5.3", inclusive: false } }],
  );
  assert.deepEqual(
    belowGradeIntervals([
      { lower: null, upper: { value: "0.335", inclusive: false } },
    ]),
    [{ lower: { value: "0.335", inclusive: true }, upper: null }],
  );
});
test("대안 구간과 구간 사이 단일 경계점도 숫자 정밀도를 잃지 않고 표시한다", () => {
  assert.deepEqual(
    belowGradeIntervals([
      {
        lower: { value: "10.1", inclusive: false },
        upper: { value: "20", inclusive: true },
      },
      { lower: null, upper: { value: "-2", inclusive: false } },
    ]),
    [
      {
        lower: { value: "-2", inclusive: true },
        upper: { value: "10.1", inclusive: true },
      },
      { lower: { value: "20", inclusive: false }, upper: null },
    ],
  );
  const value = "9007199254740993.00000001";
  assert.deepEqual(
    belowGradeIntervals([
      { lower: null, upper: { value, inclusive: false } },
      { lower: { value, inclusive: false }, upper: null },
    ]),
    [{ lower: { value, inclusive: true }, upper: { value, inclusive: true } }],
  );
  assert.deepEqual(
    belowGradeIntervals([
      { lower: null, upper: { value, inclusive: true } },
      { lower: { value, inclusive: false }, upper: null },
    ]),
    [],
  );
});
