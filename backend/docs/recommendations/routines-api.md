# 여러 운동 루틴 API와 실제 Python 연결

2026-09-29 사용자 결정으로 `data-analysis/src/recommendation_v2.py`의 여러 운동 출력에 맞춰 BE를 확장하고 원본 Python 호출을 연결했다. 기존 `/api/v1/workouts`의 단일 영상 계약과 데이터는 유지하며 새 경로 `/api/v1/workout-routines`를 사용한다. 이전 단일 영상 계산기는 계속 미연결 상태다. 프론트엔드 변경과 개발·운영 DB 적용은 이 작업에 포함하지 않는다.

## 요청과 응답

모든 요청은 Bearer 인증과 DB 세션·소유권 검증, `Cache-Control: no-store`, `Pragma: no-cache`를 적용한다. POST는 `Content-Type: application/json`, `X-CSRF-Protection: 1`, UUID `Idempotency-Key`가 필수다. Origin은 기존 허용 Origin과 일치해야 하며 기존 IP당 변경 요청 60회/분 제한을 공유한다. 사용자 ID·날짜·추천 영상·처방은 클라이언트 입력으로 받지 않는다.

| 경로                                                        | 동작                                                                                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/workout-routines/next`                        | 본문 `{}`. KST 오늘을 `current_date`로 전달해 **내일** 루틴 생성(201). 같은 날짜 배정이나 요청 키 재사용은 저장값 반환(200). |
| `GET /api/v1/workout-routines/current`                      | **KST 오늘 배정된 루틴** 또는 JSON null. 내일 생성 결과를 오늘 루틴으로 표시하지 않는다.                                     |
| `GET /api/v1/workout-routines/:id`                          | 소유한 루틴 상세. 과거·미래 루틴도 조회 가능.                                                                                |
| `GET /api/v1/workout-routines/history?limit=20&cursor=UUID` | 배정일 내림차순 목록 `{items,nextCursor}`. 최대 50개. 미래 배정도 포함.                                                      |
| `POST /api/v1/workout-routines/:id/items/:itemId/events`    | 특정 운동의 재생·수행 이벤트. 저장 후 전체 루틴 반환(200).                                                                   |

새 루틴 응답은 `id`, `koreanDate`, `referenceDate`, `serverKoreanDate`, `createdAt`, `status`, `estimatedMinutes`, `progress: {completedItems,totalItems}`, `algorithmVersion`, `dataVersion`, `inputSnapshot`, `weightAdjustment`, `routine[]`다. 생성 응답에는 Location과 Idempotency-Replayed 헤더가 있다.

각 `routine[]` 항목에는 다음을 저장·반환한다.

- 식별·처방: `id`, `order`, `videoId`, `title`, `videoUrl`, `slot`, `prescription: {doseType,value,unit,sets,restSec,text}`.
- 진행: `status`, `resultStatus`, `performedAt`, `completedAt`, `revision`, `progress: {durationSeconds,watchedSeconds,positionSeconds,intervals}`.
- 미디어 검증: `playbackUrl`, `playbackStatus`, `verifiedDurationSeconds`. 기존 검증 보고서 방식이며 새 데이터의 SHA-256을 보고서의 sourceCommit 식별자로 사용한다. 증거가 없으면 unavailable/null로 표시한다. HTTP 원본 URL을 임의로 HTTPS로 바꾸지 않는다.

운동 개수·처방·예상 시간은 Python 반환값을 그대로 저장한다. BE가 운동량별 개수나 세트 수를 다시 계산하지 않는다. 현재 원본은 3/5/7개와 6/10/14분을 반환한다. 영상 진행의 `durationSeconds`는 원본 CSV의 `video_length`이며, 예상 운동 시간이나 반복·유지 처방 시간으로 대체하지 않는다.

`weightAdjustment`는 **해당 추천 생성 시점의 계산 스냅샷**이다. GET·재시도·진행 이벤트에서 Python을 재실행하지 않는다. 운동 수행 후의 값은 이후 신규 추천 생성에서 계산한다. 이 필드는 실시간 화면 갱신값이 아니다.

## 입력 변환과 알고리즘

`RoutineAlgorithm`은 shell 없이 Python 프로세스를 실행하고 `scripts/recommendation-runner.py`가 원본 모듈을 import하여 `run_recommendation`을 호출한다. 알고리즘·CSV를 BE에 복사하지 않는다. `-B`와 PYTHONDONTWRITEBYTECODE로 원본 디렉터리에 캐시를 생성하지 않는다. 최대 동시 실행은 서버 프로세스당 2개, 실행 제한은 10초, 입력·출력 상한은 각각 2MiB다. 실패·한도 초과는 503이며 임의 결과를 만들지 않는다.

- 나이: 저장 생년월일과 KST 오늘 기준 만 나이. 현재 지원 13–64세.
- 측정: 기존 최신 정렬 `measuredOn DESC, createdAt DESC, id ASC` 한 건과 저장된 평가를 사용한다. 측정 원본에 공유 잠금을 잡아 revision과 평가를 함께 읽는다.
- 체력요인: 기존 `aggregateAxes`가 선택한 숫자 등급을 전달한다. `muscular_endurance` → `muscularEndurance`, `cardiorespiratory_endurance` → `cardiovascularEndurance`; 나머지 네 축은 같은 이름이다.
- 숫자 등급이 없는 `below_standard`, `unevaluable`, `not_measured`는 null이다. 최하 등급 미달을 임의의 ‘4등급’으로 만들거나 표시용 등급 문자열·과거 기록·원본 수치로 추정하지 않는다. 현재 알고리즘에서 null은 등급 미제공 의미이므로, 최하 기준 미달을 별도 need로 처리하려면 데이터 팀과 입력 계약을 확장해야 한다. 원본 axes와 이유는 스냅샷에 남긴다.
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

`start|progress|pause|end|complete`, 구간 합집합·영상 길이 검증·50% 중단 판정은 [기존 진행 계약](workouts-api.md)을 재사용한다. 배정일 이전 수행은 409 ROUTINE_NOT_DUE다. 과거 루틴은 날짜가 지나도 이어 할 수 있다. 운동별 순서는 안내용이며 다른 운동의 진행을 자동 완료시키지 않는다. 모든 항목이 명시적으로 완료되어야 루틴 전체가 completed다. 전체 상태는 저장된 항목에서 계산한다: 모두 assigned면 assigned, 하나라도 in_progress면 in_progress, 모두 not_performed면 not_performed, 나머지 혼합 상태는 interrupted다.

요청 키·기기 sequence의 범위는 **운동 항목별**이다. 같은 키·같은 본문은 재사용, 같은 키·다른 본문이나 역순 sequence는 409다. 완료 후 새로운 complete는 기존 완료 시각·결과를 유지하며 감사 이벤트만 기록한다. 완료 후 start/progress/end는 거부한다. 전체 루틴 조회는 Repeatable Read, 생성·수행 쓰기는 사용자 행 잠금으로 직렬화한다.

생성 키는 자정이 지나도 원래 루틴으로 재사용한다. 같은 날짜에 다른 키를 보내도 새로 계산하지 않는다. 설정 변경은 다음 신규 배정부터 반영되며 이미 생성된 현재·미래 루틴, 기존 단일 영상 배정과 진행·측정·등급·세션·재화는 유지한다. GET은 추천을 생성하지 않는다.

## 오류

| 코드                                                                | 의미                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 400                                                                 | 잘못된 JSON·본문·요청 키·UUID·진행 값                                           |
| 401 / 403 / 429                                                     | 기존 인증 / CSRF·Origin / IP 변경 요청 제한                                     |
| 404                                                                 | 본인 소유 루틴·운동·커서 없음                                                   |
| 409 EXERCISE_GOAL_REQUIRED                                          | 목적 미설정                                                                     |
| 409 DATE_OF_BIRTH_REQUIRED / AGE_UNSUPPORTED / MEASUREMENT_REQUIRED | 기존 추천 준비 조건                                                             |
| 409 ROUTINE_NOT_DUE / WORKOUT_CONFLICT                              | 미래 운동 수행 또는 이벤트 재시도/순서 충돌                                     |
| 503 ROUTINE_ALGORITHM_UNAVAILABLE                                   | Python·의존성·원본·CSV 누락, 실행/시간/용량 실패, 구성 불가 또는 출력 검증 실패 |

Python 내부 경로·traceback·개인 입력은 오류 응답에 노출하지 않는다. 실행 실패 시 루틴·운동·요청 키 저장을 롤백한다. 저장된 결과 조회·생성 재시도·진행은 Python이 없어도 동작한다.

## 마이그레이션·배포 준비

후속 마이그레이션 `20260929000100_workout_routines`는 루틴, 운동 항목, 생성 키, 항목별 이벤트 **4개 테이블만 추가**한다. 기존 테이블의 행·컬럼이나 기존 마이그레이션을 바꾸지 않는다. 사용자 FK CASCADE로 탈퇴 시 전체 삭제한다. 날짜당 루틴 하나, 루틴별 순서·영상 유일성, 연속 순서와 최소 한 항목, 처방·생성 스냅샷·완료 항목 불변을 DB에서 보장한다. 비기본 DB 스키마도 지원한다. readiness는 새 테이블 존재도 검사한다.

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

프론트엔드는 신규 API·운동별 이벤트 경로와 반환 배열에 연결해야 한다. 기존 플레이어에 배열의 첫 영상만 주는 방식은 전체 루틴 지원이 아니다. 영상 HTTPS·Range 실제 검증 자료, 운영 부하/프로세스 규모 검증, 프론트의 전체 루틴 흐름은 별도 배포 준비 항목이다.

## 검증 범위

`test/workout-routines.e2e-spec.ts`는 실제 원본 Python·실제 CSV·격리 PostgreSQL을 사용한다. 특정 영상 ID는 무작위 동점 선택 때문에 고정하지 않는다. 원본 반환 순서·처방·예상 시간의 저장 일치, 3/5/7개, 설정 매핑·목적 null, KST 자정·다음 날·동시 생성/진행, 항목별 완료·로그, 소유권·보호·탈퇴, 실행 실패 롤백과 Python 없는 저장값 조회를 검증한다. transport 단위 검사는 잘못된 반환값 거부와 측정 등급 변환을 검증한다. 이는 연결·저장 계약 검증이며 운동 효과·추천 적합성의 임상 검증을 의미하지 않는다.

2026-09-29 실제 실행 결과: `RECOMMENDATION_PYTHON=.local/recommendation-venv/bin/python npm run check` 전체 통과. Prisma 스키마 검증·클라이언트 생성·서식·린트·타입 검사·빌드, 단위 18개 파일 279개, 통합 17개 파일 340개가 통과했다. 새 루틴 통합 11개는 원본 Python을 실행하며 기존 사용자 데이터 보존과 DB 불변·유일성·빈 루틴 거부도 검증한다. 전용 project_health_test DB의 임시 스키마에서 15개 마이그레이션 최초 적용과 재배포 시 미적용 항목 없음을 확인하고 임시 스키마를 정리했다. 최초 검사에서 발견한 비기본 스키마 트리거 참조와 테스트 JSON 타입 오류는 수정 후 재검증했다. 기존 pg 동시 query deprecation 경고는 출력됐으며 실패한 검사는 없다.

작업 전후 `data-analysis/`의 19개 파일 경로와 SHA-256이 동일함을 확인했다. 프론트엔드·저장소 루트·기존 마이그레이션은 변경하지 않았다. 운영·개발 DB에는 적용하지 않았고 배포도 수행하지 않았다.
