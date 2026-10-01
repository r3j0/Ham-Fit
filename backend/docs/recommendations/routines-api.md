# 여러 운동 루틴 API와 실제 Python 연결

2026-09-29 사용자 결정으로 `data-analysis/src/recommendation_v2.py`의 여러 운동 출력에 맞춰 BE를 확장하고 원본 Python 호출을 연결했다. 기존 `/api/v1/workouts`의 단일 영상 계약과 데이터는 유지하며 새 경로 `/api/v2/workout-routines`를 사용한다. 후속 사용자 결정으로 **당일 추천·하루 한 루틴·80% 시청 완료 판정**으로 단일화했다. 같은 날 여러 루틴 생성과 내일 선생성은 제공하지 않는다. 이전 단일 영상 계산기는 계속 미연결 상태다. 프론트엔드 변경과 개발·운영 DB 적용은 이 작업에 포함하지 않는다.

2026-10-02: 이력 GET은 선택적인 `from=YYYY-MM-DD&to=YYYY-MM-DD`를 함께 받는다. 양끝을 포함한 최대 62일이며, 누락·역순·존재하지 않는 날짜·초과 범위는 400이다. 배정일이 범위 안에 있거나 실제 완료 시각의 한국 날짜가 범위 안에 있는 본인 기록만 반환한다. 따라서 과거에 배정하고 나중에 완료한 기록도 완료일 달력에 남는다. 정렬·`limit`·소유권·커서 페이지 넘김은 유지하며, 두 날짜를 모두 생략한 기존 클라이언트의 계약은 보존한다. 빈 목록도 최상위 `serverKoreanDate`를 반환하므로 FE는 기기 시계와 다른 서버 한국 날짜로 조회 기간을 보정할 수 있다.

## 요청과 응답

모든 요청은 Bearer 인증과 DB 세션·소유권 검증, `Cache-Control: no-store`, `Pragma: no-cache`를 적용한다. POST는 `Content-Type: application/json`, `X-CSRF-Protection: 1`, UUID `Idempotency-Key`가 필수다. Origin은 기존 허용 Origin과 일치해야 하며 기존 IP당 변경 요청 60회/분 제한을 공유한다. 사용자 ID·날짜·추천 영상·처방은 클라이언트 입력으로 받지 않는다.

| 경로                                                        | 동작                                                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v2/workout-routines/today`                       | 본문 `{}`. KST 오늘을 `current_date`로 전달해 **오늘** 루틴 생성(201). 같은 날짜에는 완료 여부·새 요청 키와 무관하게 저장값 반환(200). |
| `GET /api/v2/workout-routines/current`                      | **KST 오늘 배정된 루틴** 또는 JSON null. GET은 생성하지 않는다.                                                                        |
| `GET /api/v2/workout-routines/:id`                          | 소유한 루틴 상세. 과거·미래 루틴도 조회 가능.                                                                                          |
| `GET /api/v2/workout-routines/history?limit=20&cursor=UUID` | 배정일 내림차순 목록 `{items,nextCursor}`. 최대 50개. 과거 v1의 미래 배정도 보존하여 포함.                                             |
| `POST /api/v2/workout-routines/:id/items/:itemId/events`    | 특정 운동의 재생·수행 이벤트. 저장 후 전체 루틴 반환(200).                                                                             |

기존 v1 루틴 API의 생성·조회·이벤트 경로는 인증 후 410 `ROUTINE_API_RETIRED`를 반환한다. v2에는 `/next`가 없으며 자동 리다이렉트하지 않는다. 기존 루틴 ID·항목 ID·요청 키는 v2에서 그대로 조회·재시도할 수 있으며 신규 수행 저장은 배정일 당일에만 허용한다. 다른 인증·사용자·측정 API와 기존 단일 영상 `/api/v1/workouts`는 v1을 유지한다.

새 루틴 응답은 `id`, `koreanDate`, `referenceDate`, `serverKoreanDate`, `createdAt`, `status`, `estimatedMinutes`, `cardioRecommendation`, `progress: {completedItems,totalItems}`, `algorithmVersion`, `dataVersion`, `inputSnapshot`, `weightAdjustment`, `routine[]`다. 생성 응답에는 Location과 Idempotency-Replayed 헤더가 있다.

2026-09-30 지난 루틴 보호 정책으로 모든 루틴 응답에 `serverTime`(서버 판정 시각 ISO UTC), `recordingAllowed`(배정일이 서버 KST 오늘과 같은지), `recordingExpiresAt`(배정일 다음 KST 자정, ISO UTC)를 추가한다. 이 값은 조회 시 계산하며 저장된 진행·revision을 변경하지 않는다. 날짜상 기록 가능 여부와 항목 상태별 수행 제약, 미디어 재생 가능 여부는 별개다. 상세 FE 계약과 현재 단일 영상 호출 경로는 [지난 루틴 시청·기록 분리](expired-routine-playback.md)를 따른다.

각 `routine[]` 항목에는 다음을 저장·반환한다.

- 식별·처방: `id`, `order`, `videoId`, `title`, `videoUrl`, `slot`, `prescription: {doseType,value,unit,sets,restSec,text}`.
- 진행: `status`, `resultStatus`, `performedAt`, `completedAt`, `revision`, `progress: {durationSeconds,watchedSeconds,positionSeconds,intervals}`.
- 미디어 검증: `playbackUrl`, `playbackStatus`, `verifiedDurationSeconds`. 기존 검증 보고서 방식이며 새 데이터의 SHA-256을 보고서의 sourceCommit 식별자로 사용한다. 증거가 없으면 unavailable/null로 표시한다. HTTP 원본 URL을 임의로 HTTPS로 바꾸지 않는다.

운동 개수·처방·예상 시간은 Python 반환값을 그대로 저장한다. BE가 운동량별 개수나 세트 수를 다시 계산하지 않는다. 현재 원본은 3/5/7개와 6/10/14분을 반환한다. 영상 진행의 `durationSeconds`는 원본 CSV의 `video_length`이며, 예상 운동 시간이나 반복·유지 처방 시간으로 대체하지 않는다.

### 영상 다음 유산소 안내 (2026-09-30)

루틴 최상위 응답에 `cardioRecommendation: { activity: "걷기" | "뛰기", minutes: number } | null`을 추가한다. data의 `workout.routine`과 `workout.cardioRecommendation`을 각각 보존한다. 신규 Python 결과에는 유산소 객체가 필수이며 activity는 위 두 문자열, minutes는 유한 양의 정수여야 한다. 누락·null·잘못된 종류/시간/추가 필드는 503 `ROUTINE_ALGORITHM_UNAVAILABLE`로 거절하고 루틴·항목·요청 키 전체를 저장하지 않는다. 목적별 시간표와 운동량별 종류 선택은 data만 담당한다.

응답 일부 예시(값은 설명용):

```json
{
  "estimatedMinutes": 10,
  "routine": [{ "order": 1, "videoId": "...", "prescription": { "sets": 3 } }],
  "cardioRecommendation": { "activity": "걷기", "minutes": 20 }
}
```

FE는 영상 `routine`을 반환된 `order` 순서로 모두 표시한 뒤 유산소 안내 카드를 마지막에 표시한다. 유산소는 영상 항목이 아니며 videoId/videoUrl·재생/완료 이벤트·타이머·인증을 갖지 않는다. `estimatedMinutes`는 유산소를 제외한 영상 루틴 예상 시간이다. 기존 완료 판정·활동 연속 기록은 영상 항목만 사용한다.

신규 생성은 영상과 유산소를 같은 트랜잭션에 저장한다. 생성·상세·current·history·이벤트 응답·날짜별 배정 및 요청 키 재사용 모두 저장된 유산소를 반환한다. 설정 변경이나 재요청으로 이를 재계산하지 않는다. 기존 유산소 없는 행은 SQL NULL로 남고 API는 **명시적인 null**을 반환한다. FE는 null이면 카드를 생략하며 임의 권장량을 채우지 않는다.

`prescription`의 sets·value·unit·restSec·text와 배열/order는 data 결과 그대로 저장·응답한다. BE의 체력요인별 재정렬이나 기본 3세트 상수는 없다. 현재 data의 3세트를 수신하되 과거 2세트·순서·입력 스냅샷은 소급 변경하지 않는다.

`weightAdjustment`는 신규 당일 루틴에서 **null**이다. 당일 추천 함수가 반환하지 않는 D→D+1 변화량을 다른 날짜 의미로 계산하거나 0으로 만들어 채우지 않는다. 과거 v1 루틴의 기존 값은 생성 시점 스냅샷으로 그대로 보존한다. null은 가중치를 적용하지 않았다는 뜻이 아니다. 당일 추천 내부에서 과거 운동 노출도와 체력·목적의 우선순위를 계산한다.

완료 이벤트는 수행 기록만 저장하며 가중치를 별도로 갱신하지 않는다. 다음날 첫 생성 요청 때 어제까지의 완료/중단 기록으로 원본이 노출도를 다시 계산한다. 같은 날 저장된 루틴은 운동 완료·설정 변경·새 요청 키로 다시 계산하지 않는다. 자정 자동 생성은 없고, 전날 전체 완료도 다음날 첫 생성의 필수 조건이 아니다.

## 입력 변환과 알고리즘

`RoutineAlgorithm`은 shell 없이 Python 프로세스를 실행하고 `scripts/recommendation-runner.py`가 원본 모듈을 import하여 `extract_fitness_data`로 입력을 변환한 뒤 `recommend_workout_routine(current_date=오늘)`을 직접 호출한다. 다음날용 `run_recommendation`은 호출하지 않는다. 알고리즘·CSV를 BE에 복사하지 않는다. `-B`와 PYTHONDONTWRITEBYTECODE로 원본 디렉터리에 캐시를 생성하지 않는다. 최대 동시 실행은 서버 프로세스당 2개, 실행 제한은 10초, 입력·출력 상한은 각각 2MiB다. 실패·한도 초과는 503이며 임의 결과를 만들지 않는다.

- 나이: 저장 생년월일과 KST 오늘 기준 만 나이. 현재 지원 13–64세.
- 측정: 기존 최신 정렬 `measuredOn DESC, createdAt DESC, id ASC` 한 건과 저장된 평가를 사용한다. 측정 원본에 공유 잠금을 잡아 revision과 평가를 함께 읽는다.
- 체력요인: 기존 `aggregateAxes`가 선택한 숫자 등급을 전달한다. `muscular_endurance` → `muscularEndurance`, `cardiorespiratory_endurance` → `cardiovascularEndurance`; 나머지 네 축은 같은 이름이다.
- 2026-09-30 추천 입력 정책: `graded`는 실제 숫자 grade, `below_standard`는 **계산용 3**, `unevaluable`·`not_measured`는 null을 전달한다. 원본 `get_fitness_need`가 1→0.25, 2→0.50, 3 이상→1.00으로 변환하므로 기준 미달에 필요도 1.00을 적용한다. 필요도 1.00 자체를 등급으로 보내지 않는다. 측정 DB·조회·평가의 `below_standard` 및 `grade:null`은 유지하며 4·5·6등급을 추정하지 않는다. `inputSnapshot.axes`는 원본 평가와 이유, `inputSnapshot.fitness100.fitness`는 Python에 전달한 계산용 값을 각각 보존한다. 기존 스냅샷은 변경하지 않는다.
- 운동량·목적: 저장된 최신 [운동 설정 매핑](../user-preferences-api.md)을 사용한다. 설정 읽기에 공유 잠금을 잡아 하나의 설정 상태를 캡처한다. 목적 null이면 409 EXERCISE_GOAL_REQUIRED이며 알고리즘을 호출하지 않는다. 기존 isOnboarded는 변경하지 않는다.
- 도구: 저장된 `UserPreference.ownedTools`를 운동량·목적과 같은 잠금 아래 읽고 [도구 매핑](../owned-tools.md)에 따라 `owned_tools`로 변환한다. 스냅샷에는 API 식별자 `ownedTools`와 실제 입력 `owned_tools`를 모두 보존한다. 기본값은 빈 배열이며 맨몸·생활용품 허용과 필터는 원본 알고리즘을 그대로 따른다.
- 기록: 기존 단일 영상 배정과 새 루틴 **개별 운동**의 interrupted/completed 대표 결과만 전달한다. 완료는 true, 중단은 false. 이벤트 행을 합산하지 않아 중단 후 완료가 중복 반영되지 않는다. 미시작·미진행은 제외한다. 날짜는 실제 서버 접수 시각을 전달하고 원본이 KST로 해석한다. 현재 데이터에서 사라진 영상 로그는 원본 알고리즘이 제외한다.

BE는 출력 스키마, 연속 순서, 영상 중복, 허용 URL, 실제 영상 길이, 처방 자료형과 유한 숫자를 검증한 후 전체 루틴을 원자적으로 저장한다. 모듈과 CSV의 SHA-256을 실행 전후 대조해 실행 중 데이터 교체를 거부하고 각각 algorithmVersion/dataVersion으로 저장한다. 최신 입력 전체와 측정 ID/revision·설정 수정 시각도 함께 보존한다.

## 진행·완료·재시도

기존 재생 이벤트 형태를 운동 항목별 경로로 보낸다. 각 항목은 자기 영상의 시간축을 가진다.

```json
{
  "type": "progress",
  "deviceId": "fc3d1804-de09-4fbb-8556-eacfa346e451",
  "sequence": 2,
  "intervals": [{ "start": 0, "end": 12.5 }],
  "positionSeconds": 12.5
}
```

`start|progress|pause|end|complete` 이벤트의 구간 합집합·영상 길이 검증은 기존 진행 코드를 재사용하지만 결과 판정은 아래 v2의 **80% 기준**을 사용한다. 배정일 이전 수행은 409 ROUTINE_NOT_DUE다. **배정일이 지난 루틴의 신규 이벤트는 상태와 무관하게 409 ROUTINE_EXPIRED**다. 지난 루틴의 상세·이력·영상 재생 정보는 계속 제공하며 시청만 허용한다. 운동별 순서는 안내용이며 다른 운동의 진행을 자동 완료시키지 않는다. 모든 항목의 상태가 completed일 때만 루틴 전체가 completed다. 신규 수행은 모든 항목의 완료가 배정일 KST 자정 전에 서버에 접수되어야 그날 전체 완료·스트릭으로 인정한다. 전체 상태는 저장된 항목에서 계산한다: 모두 assigned면 assigned, 하나라도 in_progress면 in_progress, 모두 not_performed면 not_performed, 나머지 혼합 상태는 interrupted다.

쓰기는 사용자 행 잠금 획득 후 DB `clock_timestamp()`로 얻은 시각을 접수·판정 시각으로 사용한다. 요청 발송 시각·클라이언트 `occurredAt`·잠금 대기 시작 시각으로 마감을 우회할 수 없다. 자정 이후 처음 접수된 완료는 자정 전 시청 구간이나 occurredAt을 담아도 거절한다. 거절 시 항목·구간·재생 위치·결과·수행/완료 시각·revision·이벤트 행에 쓰기가 없으므로 스트릭과 다음 추천의 수행 로그도 바뀌지 않는다. 자정에 재생을 자동 중단하거나 결과를 추정·확정하지 않는다. 이미 저장된 과거 기록은 소급 수정·재판정하지 않는다.

| 이벤트·실제 시청 비율                    | 결과                                                    |
| ---------------------------------------- | ------------------------------------------------------- |
| start                                    | in_progress. 미완료 항목은 이 이벤트로 이어하기         |
| progress                                 | 진행 구간만 저장, in_progress 유지                      |
| pause / end / complete, 80% 이상         | completed, 완료 시각 저장                               |
| pause / end / complete, 0% 초과 80% 미만 | interrupted(미완료), 다음 추천에 completed=false로 전달 |
| pause / end / complete, 시청 0           | not_performed(미완료), 추천 로그에서 제외               |

시청 비율은 실제 시청 구간 합집합 / 카탈로그 영상 길이다. 탐색 위치·중복 보고·반복 재생을 추가 시청량으로 계산하지 않는다. 완료 버튼도 80%를 우회하지 못한다. pause는 일시 중단 결과를 확정하므로 재개 시 start가 필요하다. 소수 경계는 표시 반올림 없이 실수 연산 오차만 허용하며, 79.999999%를 80%로 올리지 않는다. 일시정지·화면 이탈을 저장할 클라이언트는 pause 이벤트를 보내야 한다. 서버에 이벤트가 전혀 도착하지 않은 강제 종료는 수행 결과를 추정해 완료시키지 않는다.

당일 미완료 항목을 재시작해도 마지막 확정 결과와 시청량이 같으면 `performedAt`을 유지한다. 마지막 pause/end/complete의 `resultingRevision`까지 모든 기기의 저장 이벤트를 합쳐 확정 당시 시청량을 복원하므로, 후속 progress가 새 구간을 먼저 저장한 경우 다음 중단에서 수행 시각을 갱신한다. 같은 서버 시각에 접수된 이벤트도 revision으로 구분하며, 감사 이벤트의 원본 구간은 카탈로그 길이로 잘라 비교한다. 신규 결과·추가 고유 시청·결과 변경일 때만 수행 시각을 저장한다. 기존 이벤트 이력을 사용하며 DB 컬럼·마이그레이션은 추가하지 않는다.

요청 키·기기 sequence의 범위는 **운동 항목별**이다. 같은 키·같은 본문은 날짜 검사 전에 재사용하여 자정 이후에도 200과 `Idempotency-Replayed: true`를 반환하며 새 쓰기를 하지 않는다. 응답은 현재 저장 상태와 현재 서버 날짜를 반영하므로 과거 응답의 날짜 메타데이터까지 동일하다는 의미는 아니다. 같은 키·다른 본문은 기존 409 WORKOUT_CONFLICT다. 배정일 당일의 역순 sequence도 기존 409다. **당일에만** 완료 후 새로운 pause/end/complete는 기존 완료 시각·결과·진행을 유지하며 감사 이벤트를 기록한다. 날짜가 지나면 이 감사 이벤트도 추가하지 않는다. 완료 후 start/progress는 거부한다. 전체 루틴 조회는 Repeatable Read, 생성·수행 쓰기는 사용자 행 잠금으로 직렬화한다.

생성 키는 자정이 지나도 원래 루틴으로 재사용한다. 같은 날짜에 다른 키를 보내도 새로 계산하지 않는다. 설정 변경은 다음 신규 배정부터 반영되며 이미 생성된 현재·미래 루틴, 기존 단일 영상 배정과 진행·측정·등급·세션·재화는 유지한다. GET은 추천을 생성하지 않는다.

## 오류

| 코드                                                                | 의미                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 410 ROUTINE_API_RETIRED                                             | 종료된 v1 루틴 경로. 같은 ID·키로 v2 사용                                       |
| 400                                                                 | 잘못된 JSON·본문·요청 키·UUID·진행 값                                           |
| 401 / 403 / 429                                                     | 기존 인증 / CSRF·Origin / IP 변경 요청 제한                                     |
| 404                                                                 | 본인 소유 루틴·운동·커서 없음                                                   |
| 409 EXERCISE_GOAL_REQUIRED                                          | 목적 미설정                                                                     |
| 409 DATE_OF_BIRTH_REQUIRED / AGE_UNSUPPORTED / MEASUREMENT_REQUIRED | 기존 추천 준비 조건                                                             |
| 409 ROUTINE_NOT_DUE / WORKOUT_CONFLICT                              | 미래 운동 수행 또는 이벤트 재시도/순서 충돌                                     |
| 409 ROUTINE_EXPIRED                                                 | 지난 루틴의 신규 수행 이벤트. 재시도 중단 후 기록 없는 영상 시청 유지           |
| 503 ROUTINE_ALGORITHM_UNAVAILABLE                                   | Python·의존성·원본·CSV 누락, 실행/시간/용량 실패, 구성 불가 또는 출력 검증 실패 |

Python 내부 경로·traceback·개인 입력은 오류 응답에 노출하지 않는다. 실행 실패 시 루틴·운동·요청 키 저장을 롤백한다. 저장된 결과 조회·생성 재시도·진행은 Python이 없어도 동작한다.

## 마이그레이션·배포 준비

2026-09-30 후속 `20260930000100_routine_cardio`는 nullable JSONB `cardio_recommendation`만 추가한다. 기본값·백필 없이 과거 행의 null과 기존 불변 트리거를 유지한다. `20260930000200_supported_tools`는 도구 6종 축소와 기존 설정 정리를 담당한다. enum 재생성으로 구 API와 혼합 운영할 수 없으므로 [도구 배포 순서](../owned-tools.md#배포)를 따른다. 기존 마이그레이션 파일은 수정하지 않는다.

최초 마이그레이션 `20260929000100_workout_routines`는 루틴, 운동 항목, 생성 키, 항목별 이벤트 **4개 테이블만 추가**한다. 기존 테이블의 행·컬럼이나 기존 마이그레이션을 바꾸지 않는다. 사용자 FK CASCADE로 탈퇴 시 전체 삭제한다. 날짜당 루틴 하나, 루틴별 순서·영상 유일성, 연속 순서와 최소 한 항목, 처방·생성 스냅샷·완료 항목 불변을 DB에서 보장한다. 비기본 DB 스키마도 지원한다. readiness는 새 테이블 존재도 검사한다.

추가 마이그레이션 `20260929000500_daily_routine_requests`는 신규 루틴의 배정일=기준일을 검사하고 weight_adjustment의 SQL NULL을 허용한다. 날짜당 한 루틴 유일성과 행 불변 제약은 유지한다. 새 날짜 CHECK는 NOT VALID로 추가하여 과거 다음날 배정 행을 바꾸거나 삭제하지 않고 신규 INSERT에는 당일 조건을 강제한다. 이미 존재하는 미래 배정은 해당 날짜가 되면 같은 날 저장값으로 사용하며 새 루틴으로 덮어쓰지 않는다. 배포 시 새 마이그레이션 후 새 서버를 적용해야 한다. 구 서버의 다음날 INSERT는 새 제약으로 거부되므로 구·신 서버의 생성 트래픽을 동시에 운영하지 않는다.

백엔드 디렉터리를 작업 디렉터리로 사용한다. 원본 모듈과 CSV를 배포 환경에 읽기 전용으로 제공해야 한다. 기본 경로는 각각 `../data-analysis/src/recommendation_v2.py`, `../data-analysis/data/processed/workout_videos_v2_complete.csv`이며 환경변수로 지정할 수 있다.

```bash
python3 -m venv .local/recommendation-venv
.local/recommendation-venv/bin/python -m pip install -r requirements-recommendation.txt
export RECOMMENDATION_PYTHON="$PWD/.local/recommendation-venv/bin/python"
# 다른 배포 위치라면 실제 파일 절대 경로로 지정
# export RECOMMENDATION_SOURCE_PATH=/srv/data-analysis/src/recommendation_v2.py
# export WORKOUT_VIDEOS_PATH=/srv/data-analysis/data/processed/workout_videos_v2_complete.csv
npm run check
```

RECOMMENDATION_PYTHON 생략 시 PATH의 python3를 사용한다. Python 3.9 이상과 고정한 의존성이 필요하다. 모듈·데이터를 일관된 릴리스로 제공하고 위 환경변수를 서비스 프로세스에도 설정한다. 운영 반영 전 기존 절차에 따라 백업·새 마이그레이션 적용·새 서버 교체를 별도로 수행한다. 이번 검증에서는 개발·운영 DB에 적용하지 않는다.

배포물에는 Node 빌드 외에 `scripts/recommendation-runner.py`, Python 실행 환경, 읽기 전용 원본 모듈·CSV가 필요하다. `dist/`만 배포하면 신규 추천을 실행할 수 없다. 실제 서비스 작업 디렉터리는 backend로 설정한다.

프론트엔드는 신규 API·운동별 이벤트 경로와 반환 배열 및 v2의 pause 후 start·80% 결과 판정에 연결해야 한다. 기존 플레이어에 배열의 첫 영상만 주는 방식은 전체 루틴 지원이 아니다. 영상 HTTPS·Range 실제 검증 자료, 운영 부하/프로세스 규모 검증, 프론트의 전체 루틴 흐름은 별도 배포 준비 항목이다.

## 검증 범위

`test/workout-routines.e2e-spec.ts`는 실제 원본 Python·실제 CSV·격리 PostgreSQL을 사용한다. 특정 영상 ID는 무작위 동점 선택 때문에 고정하지 않는다. 원본 반환 순서·처방·예상 시간의 저장 일치, 3/5/7개, 설정 매핑·목적 null, 당일 즉시 수행·KST 자정·다음 날·동시 생성/진행, 완료 후 당일 재요청·80% 경계·항목별 완료/미완료 로그, 소유권·보호·탈퇴, 실행 실패 롤백과 Python 없는 저장값 조회를 검증한다. transport 단위 검사는 잘못된 반환값 거부와 측정 등급 변환을 검증한다. 이는 연결·저장 계약 검증이며 운동 효과·추천 적합성의 임상 검증을 의미하지 않는다.

최초 v1 연결 당시의 실행 기록(아래 수치는 v2 검증 결과가 아님): `RECOMMENDATION_PYTHON=.local/recommendation-venv/bin/python npm run check` 전체 통과. Prisma 스키마 검증·클라이언트 생성·서식·린트·타입 검사·빌드, 단위 18개 파일 279개, 통합 17개 파일 340개가 통과했다. 새 루틴 통합 11개는 원본 Python을 실행하며 기존 사용자 데이터 보존과 DB 불변·유일성·빈 루틴 거부도 검증한다. 전용 project_health_test DB의 임시 스키마에서 15개 마이그레이션 최초 적용과 재배포 시 미적용 항목 없음을 확인하고 임시 스키마를 정리했다. 최초 검사에서 발견한 비기본 스키마 트리거 참조와 테스트 JSON 타입 오류는 수정 후 재검증했다. 기존 pg 동시 query deprecation 경고는 출력됐으며 실패한 검사는 없다.

작업 전후 `data-analysis/`의 19개 파일 경로와 SHA-256이 동일함을 확인했다. 프론트엔드·저장소 루트·기존 마이그레이션은 변경하지 않았다. 운영·개발 DB에는 적용하지 않았고 배포도 수행하지 않았다.

## v2 변경 검증

`test/daily-routine-migration.e2e-spec.ts`는 기존 마이그레이션으로 다음날 루틴·중단 진행·요청 키·이벤트를 만든 뒤 실제 새 마이그레이션을 적용한다. 기존 행이 그대로 보존되고 신규 당일 배정 허용·날짜당 중복 금지·신규 다음날 배정 거부가 유지되는지 검증한다. v1 종료 안내·v2 인증/CSRF·캐시 금지·80% 소수 경계·겹침/탐색 제외·완료 불변·완료 후 당일 재사용·다음날 기록 전달도 검사한다.

2026-09-29 v2 검증 결과: Prisma 스키마 검증·클라이언트 생성·전체 서식 검사·린트·타입 검사·빌드 통과. 단위 20개 파일 288개, 전체 통합 19개 파일 388개 통과. 통합 실행은 전용 테스트 DB의 임시 스키마에서 19개 마이그레이션 적용·재적용 후 정리했으며, 과거 다음날 루틴의 보존 업그레이드 검사도 별도 임시 스키마에서 통과했다. 기존 pg 동시 query deprecation 경고는 남아 있다. 샌드박스의 로컬 포트 제한으로 실패한 실행은 권한 허용 후 재실행하여 통과했다. 프론트엔드·data-analysis 변경과 개발/운영 DB 적용·배포는 수행하지 않았다.

## 2026-09-30 유산소·기준 미달·지원 도구 검증

이번 변경의 검증 결과:

- 단위 테스트 20개 파일 302개 통과. 유산소 누락/null/잘못된 종류/시간/추가 필드 거절, 계산용 등급 매핑과 원본 axes 보존 포함.
- 관련 통합 테스트 5개 파일 127개 통과: `workout-routines`, `user-preferences`, `preferences-migration`, `activity`, `daily-routine-migration`. 실제 Python 모듈·CSV를 읽기 전용으로 호출했다. 3세트·순서·처방·유산소 저장/조회/재사용, 과거 null·2세트 호환, 측정 상태/DB 보존, 제거 도구 원자적 거절, 설정/과거 이력 보존과 기존 완료·활동 기록을 확인했다.
- 전용 `project_health_test` 임시 스키마에서 기존 19개와 신규 2개 마이그레이션을 적용하고 재적용 시 미적용 항목 없음을 확인했다. 실행기가 임시 스키마를 정리했다. 채워진 기존 데이터 업그레이드 검사도 별도 격리 스키마에서 통과했다.
- Prisma validate/generate, TypeScript 타입 검사, 린트, 빌드, 변경 파일 Prettier와 `git diff --check` 통과.

공유 작업 폴더에서는 동시에 진행 중인 아바타 작업의 마이그레이션이 처음에 이번 enum/유산소 DDL을 중복 포함했다. 그 중복은 다른 작업에서 제거됐으나, 이어서 아바타 가입 트리거의 `initialize_avatar(uuid)` 조회 실패로 HTTP 검사가 가입 단계에서 중단됐다. 아바타 파일은 이 작업에서 수정하지 않았다. 위 통합·빌드·최종 린트 검증은 **현재 HEAD의 backend에 이번 변경만 반영한 backend 내부 검증본**을 사용했으며, 동시 작업 전체의 통합 성공을 의미하지 않는다. 검증 로그는 로컬 `backend/.local/recommendation-validation/verified.log`, 검증본은 테스트 자동 검색을 피하도록 `backend/.local/recommendation-validation/node_modules/backend/`에 보관한다. 격리본 린트는 .local 무시 규칙 때문에 파일 목록을 명시하고 `--no-ignore`를 사용했다.

최초 샌드박스 실행의 로컬 DB/HTTP 포트 EPERM은 승인된 실행으로 재검증했다. 기존 pg 동시 client.query deprecation 경고가 출력됐으나 최종 관련 검사는 통과했다. 전체 공유 작업 폴더의 아바타 통합, 전체 E2E 회귀, FE 화면, 운영 규모의 테이블 잠금/재작성 시간은 이번 검증에 포함하지 않는다.

후속 FE 작업은 영상 목록 뒤 유산소 카드 표시(null이면 생략)와 폼롤러·보슈·사다리·콘 선택지 제거다. data 측에는 노트북의 명시적 제외 정책을 실행 모듈에 동기화하는 작업이 남아 있다([상세](../owned-tools.md#data-측-남은-의존사항-2026-09-30-읽기-전용-확인)). 개발·운영 DB 적용, 배포, 커밋·푸시는 수행하지 않았다. frontend·data-analysis·루트 파일과 기존 마이그레이션을 이 작업에서 수정하지 않았다.
