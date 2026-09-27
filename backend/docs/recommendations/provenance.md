# 개인 맞춤 추천 엔진·데이터 출처와 재현

기준은 `feat/data/personalized-recommendation`의 고정 커밋
`92f3493de704c644d5aeff353488f1aff49f1836`이다. 앱 브랜치 전체를 병합하지 않고
추천 소스·전처리 노트북·CSV·JSON의 Git blob만 가져왔다.

- 알고리즘 버전: `nfa100-92f3493-ts-v1`
- 카탈로그 버전: `nfa100-videos-92f3493-v1`
- 데이터 확인일: `2026-09-27` (소스 구조·계산 확인일이며 731개 MP4 전체 재생 확인일이 아니다)
- [알고리즘 문서](https://app.notion.com/p/3e5634ca4bdf80bebc0cfac2f1721251)
- [전처리 문서](https://app.notion.com/p/3e5634ca4bdf80c388fdcfcd9b624204)
- 원본 보존: `data/recommendation/source/data-analysis/`
- 각 원본 SHA-256: `data/recommendation/source-manifest.json`
- 앱 카탈로그: `data/recommendation/catalog.json`

원본 Python과 노트북은 계산 대조 자료이며 런타임 서비스로 실행하지 않는다.
`.prettierignore`는 원본과 실행 증거를 제외한다. 원본에는 실제로 발견된 미래
로그 동점 오류와 가중치 합 검증 누락이 그대로 남아 있다. 과거 검증 디렉터리의
`snapshot/`, `results.json`, `run_checks.py`, `manifest.json`은 수정하지 않았다.
기존 검사기만 `data/recommendation/source/run_checks.py`에 그대로 복사했다.

## 원본 계산과 확정 정책의 경계

TypeScript 순수 함수는 `src/recommendations/engine.ts`에 있다.

| 항목        | 구현                                                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| 6요인       | strength, muscularEndurance, cardiovascularEndurance, flexibility, agility, power       |
| 과거 노출도 | 기준일 이전 1–14일, `0.30 × weight × 0.5^(daysAgo/7) × completionWeight`, 요인별 상한 1 |
| 수행 계수   | 배정별 최종 중단 0.5, 최종 완료 1.0. 미시작·진행 중·미진행은 로그 어댑터에서 제외       |
| 측정 필요도 | 등급 1 → 0.25, 2 → 0.5, 3 이상 → 1; 기준 미달 → 1                                       |
| 우선순위    | 측정/기준 미달: `need + 1 - exposure`; 미측정/평가 불가: `1.5 × (1 - exposure)`         |
| 점수        | 영상 6요인 가중치와 우선순위의 내적                                                     |
| 연령        | 만 13–18세 공통+청소년, 만 19–64세 공통+성인; 청년 분류는 성인 후보에 추가하지 않음     |
| 중복        | 기준일 이전 1–7일 제외. 모든 연령 후보가 제외됐을 때만 중복 제한 완화                   |
| 동점        | 최고점 근접 후보 중 미수행 → 마지막 수행일이 가장 오래된 영상 → 주입 RNG                |

동점은 NumPy 기본 `isclose(a, max)`와 같은
`abs(a-max) <= 1e-8 + 1e-5 × abs(max)`이다. RNG는 `[0,1)`의 유한한 값을
반환해야 한다. Python과 JavaScript의 난수열이 같다는 전제는 없다.

엔진 진입 시 미래 KST 날짜 로그를 제거한 뒤 노출도·중복 제외·동점에 동일하게
사용한다. 최근 14일보다 오래된 수행 이력도 동점 판정을 위해 유지한다.
서비스는 수행 입력의 실제 미래 시각도 서버 시각으로 차단한다.
시간대를 가진 로그는 KST 날짜로 바꾼다. 날짜만 있는 값은 날짜로 유지한다.
API는 기준 시점과 수행 로그의 실제 ISO 시각을 엔진에 전달한다. 기준 시점에
시각이 있으면 같은 KST 날짜라도 이후 시각인 로그는 날짜 변환 전에 제외한다.
날짜만 있는 기준 D는 원본처럼 그 날짜의 수행 이력을 사용할 수 있다.

`calculateWeightAdjustment`는 오늘의 **내부 노출도 변화**를 확정 로그로 매번
재계산한다. 기존 증분을 저장 후 덧셈하지 않는다. 함수 내부 값은 반올림하지 않고
응답용 `roundWeightAdjustment`만 소수점 3자리로 반올림한다. 측정 점수나 실제
체력 향상으로 저장·표시해서는 안 된다.

오늘 최초 배정은 `recommendNextWorkout(referenceDate=D)`이다. D일 수행은 D일
WeightAdjustment에 즉시 반영되고, D+1일 계산에서는 1일 전 노출도와 최근 제외에
반영된다. 원본 통합 함수 `run_recommendation(D)`의 추천 날짜는 D+1이다.
이 통합 함수를 오늘 최초 배정으로 잘못 연결하지 않는다.

현재 제품 범위를 지키기 위해 TypeScript는 만 13–64세 밖을 거부한다. 원본의
12세/65세 후보와 65세 시뮬레이션은 Python 기준 자료에서만 유지한다. 원본의
중첩 `fitness` 해석은 저장된 측정의 명시적인 상태 어댑터로 대체했다.

## 측정 어댑터

`measurement-adapter.ts`는 `serializeRecord`가 반환한 저장 평가/대표 축을 받는다.
서비스에서 DB 정렬 `measuredOn DESC, createdAt DESC, id ASC`로 한 건만 선택한다.
DB 정렬이 생성 시각의 마이크로초를 보존한다. 다른 과거 기록으로 빈 요인을
보충하거나 현재 나이로 과거 평가를 재계산하지 않는다.

어댑터는 `below_standard`의 원본 `grade: null`을 유지하면서 `need: 1`을
전달한다. `not_measured`와 `unevaluable`도 구분한다. 배정 입력에는 측정 ID,
revision, 측정 카탈로그 버전, 선택 항목, 원본 Decimal 문자열, 저장 평가 전체,
평가 기준 버전/URL, 환산식과 입력, YMCA `assessmentKind: reference`를 보존한다.

## 카탈로그 재생성·검증

`backend/`에서 실행한다.

```sh
npm run build
node scripts/recommendation-build-catalog.mjs
```

CSV의 `file_nm`과 JSON의 `videoId`를 일대일로 대응시킨 뒤 제목, URL, 연령,
장비, 6요인 가중치를 대조한다. JSON에 없던 `durationSeconds`는 CSV의
`video_length`에서 가져온다. 결과는 731개이며 길이 32–2928초, 600초 이상
19개를 모두 보존했다.

장비 문자열은 제한된 문자열 목록 문법으로 파싱한다. `eval`은 사용하지 않는다.
`equipment: []`는 장비 정보 없음이며 맨몸 운동이라는 뜻이 아니다. 가중치는
전처리된 운동 블록 구성 비율이며 시간 비율이나 운동 효과 크기가 아니다.

각 가중치는 유한한 숫자, 범위 0–1, 합계 1의 절대 오차 `1e-9`를 검증한다.
잘못된 행은 ID/이유와 함께 수입을 실패시키며 정규화하거나 누락하지 않는다.
중복 ID, CSV/JSON 차이, 잘못된 길이, 허용된 소스와 다른 URL도 거부한다.
고정 버전은 정확히 731개 및 고정 contentHash와 sourceCommit을 요구한다.
재생성 스크립트는 원본 파일들의 고정 SHA-256도 먼저 검사한다.

이 명령은 DB 활성화를 수행하지 않는다. DB 수입은 검증된 전체 카탈로그를
별도 버전으로 저장한 뒤 같은 트랜잭션에서 활성 버전을 변경해야 한다.
과거 배정은 기존 영상 버전과 가중치를 계속 참조해야 하며 엔진은 로그별
`fitnessWeights`로 과거 버전의 가중치를 받을 수 있다.

모든 원본 URL은 `http://openapi.kspo.or.kr/web/video/<videoId>`이다.
원본 URL을 임의의 HTTPS 주소로 바꾸지 않았다. MP4 길이/Range/실제 재생 검증과
전송 정책은 별도 미디어 문서와 실행 증거를 따른다.

## 실행 증거와 재현

NumPy 2.3.5, pandas 2.2.3이 있는 Python 3.12 환경을 사용한다.

```sh
python3 scripts/recommendation-python-reference.py
npx vitest run src/recommendations/engine.spec.ts src/recommendations/catalog.spec.ts src/recommendations/measurement-adapter.spec.ts --reporter=json --outputFile=data/recommendation/validation/typescript-results.json
node scripts/recommendation-simulate.mjs
```

| 파일 (`data/recommendation/validation/`) | 의미                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| prerequisite-regressions.json            | 최초 선행 검사 4/4 통과: 미래 로그·합계 0·합계 1.4 + 실제 731행                        |
| original-reference-results.json          | 원본 검사기를 격리한 임시 경로에서 재실행: 정상 61 통과, 방어 3 실패를 그대로 기록     |
| python-parity.json                       | 원본 계산으로 만든 127개 대조 사례, 전체 후보/동점 집합·점수·노출도·우선순위·오늘 변화 |
| typescript-results.json                  | 수정본 단위/회귀/대조 검사 실행 결과                                                   |
| typescript-simulations.json              | TS 엔진 자체 RNG와 누적 수행 이력으로 실행한 5개 연령 × 21일, 총 105일                 |

Python 대조 생성기는 미래 로그를 진입 시 제거하는 제품 수정만 어댑터로 적용하고
원본 모듈의 계산은 수정하지 않는다. 13·18·19·30·64세 21일 시뮬레이션과 노출도
경계, KST, 과거 이력, 전체 후보 소진을 포함한다. 수치 비교 오차는 `1e-12`,
후보/동점 집합은 정확히 일치해야 하며 최종 무작위 선택은 유효 집합 포함 여부로
검사한다. 별도 TS 시뮬레이션도 연령 범위·최근 7일 중복 없음·노출도 상한을 검사한다.

원본의 실패를 성공으로 바꾸지 않았다. 원본 방어 실패 3개는 고정된 증거이며,
제품에 쓰이는 수정본 엔진/수입 경로가 별도 회귀 검사에서 통과한다.
