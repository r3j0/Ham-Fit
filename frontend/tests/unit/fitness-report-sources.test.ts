import test from "node:test";
import assert from "node:assert/strict";
import type { ReportItem } from "../../lib/fitness-contract.ts";
import { collectReportSources } from "../../lib/fitness-report-sources.ts";
import { storedRecordFixture } from "../fixtures/measurement-evaluation.ts";
import { gripRecordFixture } from "../fixtures/grip-evaluation.ts";

function item(code: string): ReportItem {
  return {
    ...storedRecordFixture().items[0],
    measurementCode: code,
    factor: "flexibility",
  };
}
test("동일 출처 URL·판정 버전·평가 시각을 한 번만 모으고 적용 종목을 보존한다", () => {
  const items = [item("first"), item("second")];
  const sources = collectReportSources(items);
  assert.equal(sources.links.length, 4);
  assert.deepEqual(sources.links[0].codes, ["first", "second"]);
  assert.equal(sources.rules.length, 1);
  assert.equal(sources.times.length, 1);
  assert.deepEqual(sources.rules[0].codes, ["first", "second"]);
});
test("같은 URL이라도 다른 버전·적용 기간·출처 확인일은 합치지 않는다", () => {
  for (const change of ["version", "period", "checked"] as const) {
    const items = [item("first"), item("second")];
    const c = items[1].evaluation.criterion!;
    if (change === "version") c.internalVersion = "new-version";
    if (change === "period") c.effectiveFrom = "2026-01-01";
    if (change === "checked") c.source.checkedOn = "2026-09-24";
    const sources = collectReportSources(items);
    assert.equal(sources.links.length, 4);
    assert.equal(sources.rules.length, 2);
  }
});
test("환산과 일반 판정이 공유하는 URL은 한 번만 표시하되 출처 용도·환산 버전을 유지한다", () => {
  const grip: ReportItem = {
    ...gripRecordFixture().items[0],
    factor: "strength",
  };
  grip.evaluation.conversion!.sourceUrl = grip.evaluation.criterion!.source.url;
  const sources = collectReportSources([grip]);
  assert.equal(sources.links.length, 4);
  assert.ok(sources.links[0].titles.includes("상대악력 환산 안내"));
  assert.equal(
    sources.conversions[0].conversion.formulaVersion,
    "nfa100-relative-grip-v1",
  );
});
