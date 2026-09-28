import test from "node:test";
import assert from "node:assert/strict";
import {
  fitnessFactors,
  gradeRadius,
  radarGeometry,
  safeSourceUrl,
  type FitnessAxis,
} from "../../lib/fitness-evaluation.ts";
test("0, 1, 2개 평가 모두 여섯 점을 원점을 포함하여 닫힌 경로로 연결한다", () => {
  const axes: FitnessAxis[] = fitnessFactors.map((f) => ({
    factor: f.code,
    status: "not_measured",
    grade: null,
    reason: null,
    sourceMeasurementCodes: [],
  }));
  for (let count = 0; count <= 2; count++) {
    if (count)
      axes[count - 1] = { ...axes[count - 1], status: "evaluated", grade: 1 };
    const result = radarGeometry(axes);
    assert.equal(result.points.length, 6);
    assert.equal(
      result.points.filter((p) => p.x === 180 && p.y === 158).length,
      6 - count,
    );
    assert.equal((result.path.match(/L /g) ?? []).length, 5);
    assert.ok(result.path.endsWith(" Z"));
  }
  assert.deepEqual(radarGeometry(axes).points[0], {
    factor: "cardiorespiratory_endurance",
    x: 180,
    y: 50,
  });
  assert.ok(radarGeometry(axes).points[1].x > 180);
});
test("기준 미달은 원점보다 바깥, 등급이 좋을수록 바깥에 표시한다", () => {
  const levels = [
    gradeRadius({ status: "not_measured", grade: null, reason: null }),
    gradeRadius({ status: "below_standard", grade: null, reason: null }),
    ...([3, 2, 1] as const).map((grade) =>
      gradeRadius({ status: "evaluated", grade, reason: null }),
    ),
  ];
  assert.deepEqual(levels, [0, 0.25, 0.5, 0.75, 1]);
});
test("판정 근거의 실행 URL과 자격증명을 포함한 URL을 거부한다", () => {
  assert.equal(safeSourceUrl("javascript:alert(1)"), false);
  assert.equal(safeSourceUrl("https://user:pass@example.com"), false);
  assert.equal(safeSourceUrl("https://nfa.kspo.or.kr/"), true);
});
