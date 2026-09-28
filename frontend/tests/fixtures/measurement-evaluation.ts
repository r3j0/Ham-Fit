import type { Catalog, Measurement } from "../../lib/types.ts";
import type {
  PolygonAxis,
  StoredItemEvaluation,
} from "../../lib/fitness-contract.ts";
export const recordIdentity = {
  id: "00000000-0000-4000-8000-000000000004",
  revision: 1,
  measuredOn: "2026-09-01",
};
/** Sanitized real PR #6 response; fixture values never serve as grading rules. */
export function storedRecordFixture(): Measurement & {
  axes: PolygonAxis[];
  items: (Measurement["items"][number] & {
    evaluation: StoredItemEvaluation;
  })[];
} {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    measuredOn: "2026-09-01",
    ageAtMeasurement: 25,
    sexAtMeasurement: "male",
    reportKind: "unknown",
    centerName: null,
    reportedOverallGrade: null,
    sourceProgram: "nfa100",
    entryMethod: "manual",
    catalogVersion: "nfa100-2026-09-23",
    revision: 1,
    createdAt: "2026-09-01T01:00:00Z",
    updatedAt: "2026-09-01T01:00:00Z",
    items: [
      {
        measurementCode: "sit_and_reach",
        value: "10.1",
        unit: "cm",
        reportedGrade: null,
        evaluation: {
          sex: "male",
          grade: 2,
          status: "graded",
          ageBand: {
            maxAge: 29,
            minAge: 25,
          },
          message:
            "공식 종목별 기준 2등급에 해당합니다. 종합 인증등급과는 별개입니다.",
          criterion: {
            id: "nfa100-adult-sit_and_reach-male-25-29",
            sex: "male",
            unit: "cm",
            maxAge: 29,
            minAge: 25,
            source: {
              url: "https://nfa.kspo.or.kr/reserve/0/selectMeasureGradeItemListByAgeSe.kspo",
              revision: "문화체육관광부 고시 제2025-0027호 (시행 2025-06-02)",
              checkedOn: "2026-09-23",
              protocolUrl:
                "https://nfa.kspo.or.kr/measure/self/selectSelfMeasureItem.kspo",
              documentTitle:
                "국민체력100 성인기 인증기준 및 체력인증의 등급별 기준과 절차에 관한 규정 별표 3",
              supportingUrls: [
                "https://www.mcst.go.kr/site/s_data/ordinance/instruction/instructionView.jsp?pSeq=3588",
                "https://www.law.go.kr/LSW/flDownload.do?bylClsCd=200201&flSeq=153209715",
              ],
            },
            protocol: "nfa100_sit_and_reach",
            rounding: "none",
            direction: "higher",
            entryMethods: ["manual", "self_assessment"],
            effectiveFrom: "2025-06-02",
            effectiveUntil: null,
            catalogVersions: ["nfa100-2026-09-19", "nfa100-2026-09-23"],
            internalVersion: "nfa100-adult-2025-0027-v1",
            measurementCode: "sit_and_reach",
            officialVersion: "문화체육관광부 고시 제2025-0027호",
          },
          nextTarget: {
            grade: 1,
            status: "available",
            intervals: [
              {
                lower: {
                  value: "14.9",
                  inclusive: true,
                },
                upper: null,
              },
            ],
            reasonCode: null,
            adjustments: [
              {
                lower: {
                  unit: "cm",
                  change: "increase",
                  inclusive: true,
                  threshold: "14.9",
                  difference: "4.8",
                  requiresBeyondBoundary: false,
                },
                upper: null,
              },
            ],
          },
          reasonCode: "official_criterion_applied",
          thresholds: [
            {
              grade: 1,
              intervals: [
                {
                  lower: {
                    value: "14.9",
                    inclusive: true,
                  },
                  upper: null,
                },
              ],
            },
            {
              grade: 2,
              intervals: [
                {
                  lower: {
                    value: "10.1",
                    inclusive: true,
                  },
                  upper: null,
                },
              ],
            },
            {
              grade: 3,
              intervals: [
                {
                  lower: {
                    value: "5.3",
                    inclusive: true,
                  },
                  upper: null,
                },
              ],
            },
          ],
          evaluatedAt: "2026-09-01T01:00:00Z",
          measurementId: "00000000-0000-4000-8000-000000000004",
          recordRevision: 1,
          measurementCode: "sit_and_reach",
          ageAtMeasurement: 25,
        },
      },
    ],
    axes: [
      {
        axis: "cardiorespiratory_endurance",
        label: "심폐지구력",
        grade: null,
        status: "not_measured",
        representativeMeasurementCode: null,
        measuredMeasurementCodes: [],
        reasonCode: "no_measurements",
        recordRevision: 1,
      },
      {
        axis: "strength",
        label: "근력",
        grade: null,
        status: "not_measured",
        representativeMeasurementCode: null,
        measuredMeasurementCodes: [],
        reasonCode: "no_measurements",
        recordRevision: 1,
      },
      {
        axis: "muscular_endurance",
        label: "근지구력",
        grade: null,
        status: "not_measured",
        representativeMeasurementCode: null,
        measuredMeasurementCodes: [],
        reasonCode: "no_measurements",
        recordRevision: 1,
      },
      {
        axis: "flexibility",
        label: "유연성",
        grade: 2,
        status: "graded",
        representativeMeasurementCode: "sit_and_reach",
        measuredMeasurementCodes: ["sit_and_reach"],
        reasonCode: "best_available_grade",
        recordRevision: 1,
      },
      {
        axis: "agility",
        label: "민첩성",
        grade: null,
        status: "not_measured",
        representativeMeasurementCode: null,
        measuredMeasurementCodes: [],
        reasonCode: "no_measurements",
        recordRevision: 1,
      },
      {
        axis: "power",
        label: "순발력",
        grade: null,
        status: "not_measured",
        representativeMeasurementCode: null,
        measuredMeasurementCodes: [],
        reasonCode: "no_measurements",
        recordRevision: 1,
      },
    ],
    missingMeasurementCodes: [],
    evaluation: {
      status: "not_evaluated",
      reason: "overall_certification_not_computed",
    },
  };
}
export const storedCatalogFixture: Catalog = {
  version: "nfa100-2026-09-23",
  checkedOn: "2026-09-23",
  age: null,
  definitions: [
    {
      code: "sit_and_reach",
      label: "앉아 윗몸 앞으로 굽히기",
      category: "health_fitness",
      factor: "flexibility",
      unit: "cm",
      valueType: "decimal",
      minAge: 13,
      maxAge: 64,
      minValue: null,
      maxValue: null,
      minInclusive: true,
      sourceUrls: [],
    },
  ],
};
export function unscoredRecordFixture(
  status:
    | "not_evaluated"
    | "criteria_unavailable"
    | "insufficient_information" = "criteria_unavailable",
) {
  const record = storedRecordFixture();
  const e = record.items[0].evaluation;
  Object.assign(e, {
    status,
    grade: null,
    message:
      status === "not_evaluated"
        ? "이 기존 기록에는 저장된 평가가 없습니다."
        : status === "insufficient_information"
          ? "측정 당시 성별 정보가 필요합니다."
          : "공식 기준을 확인하지 못했습니다.",
    reasonCode: "fixture_unavailable",
    criterion: null,
    ageBand: null,
    thresholds: [],
    nextTarget: {
      status: "unavailable",
      grade: null,
      intervals: [],
      adjustments: [],
      reasonCode: "fixture_unavailable",
    },
    evaluatedAt: status === "not_evaluated" ? null : e.evaluatedAt,
  });
  Object.assign(record.axes[3], {
    status: "unevaluable",
    grade: null,
    reasonCode: "all_measurements_unevaluable",
  });
  return record;
}
