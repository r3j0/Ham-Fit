import type {
  Criterion,
  MeasurementConversion,
  ReportItem,
} from "./fitness-contract.ts";

export function collectReportSources(items: readonly ReportItem[]) {
  const links = new Map<
    string,
    { url: string; titles: string[]; codes: string[] }
  >();
  const rules = new Map<string, { criterion: Criterion; codes: string[] }>();
  const conversions = new Map<
    string,
    { conversion: MeasurementConversion; codes: string[] }
  >();
  const times = new Map<string, { value: string; codes: string[] }>();
  const append = (list: string[], value: string) => {
    if (!list.includes(value)) list.push(value);
  };
  function link(url: string, title: string, code: string) {
    const entry = links.get(url) ?? { url, titles: [], codes: [] };
    append(entry.titles, title);
    append(entry.codes, code);
    links.set(url, entry);
  }
  for (const item of items) {
    const { criterion, conversion, evaluatedAt } = item.evaluation;
    const code = item.measurementCode;
    if (criterion) {
      const { source } = criterion;
      link(source.url, source.documentTitle, code);
      link(source.protocolUrl, "공식 측정 방법", code);
      source.supportingUrls
        .filter((url) => url !== source.url && url !== source.protocolUrl)
        .forEach((url, i) => link(url, `관련 공식 자료 ${i + 1}`, code));
      // Group repeated provenance only; per-item criteria and grades stay independent.
      const key = JSON.stringify([
        source.url,
        source.revision,
        source.checkedOn,
        criterion.officialVersion,
        criterion.internalVersion,
        criterion.effectiveFrom,
        criterion.effectiveUntil,
      ]);
      const group = rules.get(key) ?? { criterion, codes: [] };
      append(group.codes, code);
      rules.set(key, group);
    }
    if (conversion) {
      const step = conversion.formulaVersion === "nfa100-adult-step-vo2max-v1";
      link(
        conversion.sourceUrl,
        step ? "최대산소섭취량 계산 공식" : "상대악력 환산 안내",
        code,
      );
      if (step) link(conversion.protocolUrl, "자가측정 방법", code);
      const key = JSON.stringify([
        conversion.formulaVersion,
        conversion.sourceUrl,
        step ? conversion.protocol : null,
        step ? conversion.protocolUrl : null,
      ]);
      const group = conversions.get(key) ?? { conversion, codes: [] };
      append(group.codes, code);
      conversions.set(key, group);
    }
    if (evaluatedAt) {
      const group = times.get(evaluatedAt) ?? { value: evaluatedAt, codes: [] };
      append(group.codes, code);
      times.set(evaluatedAt, group);
    }
  }
  return {
    links: [...links.values()],
    rules: [...rules.values()],
    conversions: [...conversions.values()],
    times: [...times.values()],
  };
}
