# 보유 운동 도구 저장과 추천 연결

2026-09-29 사용자 결정. 기존 `UserPreference`와 `/api/v1/users/me/preferences` GET/PATCH를 확장한다. 프론트 화면은 `/account/preferences`다. 데이터 팀 원본 `data-analysis/src/recommendation_v2.py`와 `workout_videos_v2_complete.csv`는 읽기 전용으로 사용한다.

## 도구 계약

후속 사용자 결정으로 홈트 소도구 10종을 모두 제공한다. 아래 표 순서로 중복 제거·정렬한다. 없음은 식별자가 아닌 빈 배열이다. 시설 장비·생활용품을 선택지로 추가하지 않는다.

| 화면            | API·DB 식별자    | Python `owned_tools` 이름 |
| --------------- | ---------------- | ------------------------- |
| 밴드            | `band`           | 밴드                      |
| 덤벨·아령       | `dumbbell`       | 덤벨                      |
| 짐볼            | `gym_ball`       | 짐볼                      |
| 폼롤러          | `foam_roller`    | 폼롤러                    |
| 줄넘기          | `jump_rope`      | 줄넘기                    |
| 스텝박스·스텝퍼 | `step_box`       | 스텝박스                  |
| 공              | `ball`           | 공                        |
| 콘              | `cone`           | 콘                        |
| 사다리          | `agility_ladder` | 사다리                    |
| 보슈            | `bosu`           | 보슈                      |
| 없음            | `[]`             | `[]`                      |

확인한 원본 별칭은 아령→덤벨, 스탭퍼·스텝퍼·박스→스텝박스, 큰공·메디신볼·테니스공→공, 줄사다리→사다리다. 짐볼은 공과 구분한다. 현재 CSV에는 콘·폼롤러 영상이 없어 선택해도 해당 후보가 추가되지 않으며 임의 영상을 생성하지 않는다. 생활용품 `BASIC_TOOLS`, 여러 도구가 필요한 영상의 허용 여부는 원본 함수 `filter_by_equipment`에 맡긴다. BE에는 이름 변환만 둔다.

## API 예시

기존 Bearer 인증·JSON·`X-CSRF-Protection: 1`·Origin·요청 제한을 유지한다.

```http
PATCH /api/v1/users/me/preferences
Content-Type: application/json
Authorization: Bearer <access_token>
X-CSRF-Protection: 1

{"ownedTools":["dumbbell","band","band"]}
```

200 응답 예시(GET도 같은 구조, 시각은 예시):

```json
{
  "exerciseVolume": "standard",
  "exerciseGoal": "general_fitness_improvement",
  "ownedTools": ["band", "dumbbell"],
  "updatedAt": "2026-09-29T07:00:00.000Z"
}
```

- `ownedTools` 생략: 기존 값 유지. 구 클라이언트 요청도 허용한다.
- `{"ownedTools":[]}`: 전체 해제. 목록 전달: 해당 필드 전체 교체.
- `null`, 비배열, null/숫자/객체 원소, 미지원 식별자, 한글 이름, `none`: 400 및 `errors[].field`에 `ownedTools` 또는 `ownedTools.<index>`를 반환한다.
- 운동량·목적·도구 중 잘못된 필드가 하나라도 있으면 저장 전에 전체 거절한다.
- 같은 도구 집합(순서·중복 차이 포함)과 같은 설정을 재전송하면 `updatedAt`을 보존한다.
- 기존 행의 `FOR UPDATE` 잠금 후 전달된 필드만 비교·수정한다. 동시에 다른 필드를 변경해도 보존하고 같은 필드 충돌은 DB에서 나중에 처리된 요청이 반영된다.
- 설정 행이 누락되면 기존 503을 반환한다. 조회나 PATCH에서 행을 자동 생성하지 않는다.

## 추천과 보존

`WorkoutRoutinesService.next`의 기존 날짜별 배정·요청 키 재사용을 먼저 처리한다. 신규 생성 시 기존 공유 잠금 아래 설정 한 행에서 운동량·목적·도구·수정 시각을 함께 읽는다. `routineInput`이 영문 식별자를 Python 도구명으로 변환한다.

신규 입력 스냅샷 예시(다른 기존 필드는 생략):

```json
{
  "ownedTools": ["band", "dumbbell"],
  "owned_tools": ["밴드", "덤벨"],
  "exerciseVolume": "standard",
  "exerciseGoal": "general_fitness_improvement",
  "preferenceUpdatedAt": "2026-09-29T07:00:00.000Z"
}
```

설정 GET/PATCH는 추천을 실행하지 않는다. 수정 전 만들어진 현재·미래 루틴, 입력 스냅샷, 진행·이벤트는 유지한다. 새 요청 키라도 같은 배정 날짜에 루틴이 있으면 기존 결과를 재사용한다. 다음 신규 배정일의 생성부터 변경을 반영한다.

측정 최소 1건, 미측정 축 허용, 3·5·7개 구성, dose_type별 처방, 세트·배정 날짜, 점수·목적 가중치·노출도·weightAdjustment는 변경하지 않는다.

## 배포

후속 마이그레이션 `20260929000200_owned_tools`는 enum과 `user_preferences.owned_tools` 배열을 추가한다. 기존·신규 행의 기본값은 빈 배열이고 NOT NULL 및 null 원소 금지 제약을 둔다. 기존 운동량·목적·생성/수정 시각은 바꾸지 않는다. 기존 사용자 FK의 ON DELETE CASCADE로 탈퇴 시 함께 삭제된다.

추가 후속 마이그레이션 `20260929000300_home_training_tools`는 `OwnedTool` enum에 공·콘·사다리·보슈 식별자만 추가한다. 기존 6종 마이그레이션은 수정하지 않으며 기존 선택·시각·기본값·루틴을 유지한다. 새 10종 API·프론트 반영 전에 이 마이그레이션까지 적용해야 한다.

1. 대상 환경·백업을 확인하고 기존 미적용 루틴 마이그레이션을 포함해 `npm run db:migrate:deploy`를 실행한다.
2. `npm run db:generate`와 `npm run build`로 새 API를 준비하고 교체한다. Python 실행 환경은 기존 루틴 배포 계약을 따른다.
3. 새 GET 응답의 `ownedTools`를 확인한 뒤 프론트를 반영한다. 새 프론트는 도구 필드 누락을 오류로 처리하므로 API가 먼저다.

초기 UserPreference 도입이 이미 완료된 환경은 도구를 위한 별도 백필·가입 중지가 필요 없다. 기본값 덕분에 기존 서버의 가입·부분 수정도 호환된다. 초기 설정 기능까지 처음 배포하는 환경은 [기존 가입 중지·누락 점검 절차](user-preferences-api.md#마이그레이션과-배포)를 따른다. 개발·운영 DB 적용, 배포, 커밋·푸시는 이번 작업에서 수행하지 않는다.

## 검증

- `test/user-preferences.e2e-spec.ts`: 실제 가입 기본값, 저장·조회·교체·해제, 구 요청 호환, 원자성, 정규화·수정 시각, 동시 수정, 격리, 인증·요청 보호, 누락 오류, 탈퇴.
- `test/preferences-migration.e2e-spec.ts`: 기존 사용자·설정·시각 보존, 빈 배열 추가, DB 제약.
- `test/workout-routines.e2e-spec.ts`: 실제 Python 실행 및 원본 필터 후보 집합 검증, 저장값 전달·스냅샷, 기존 루틴·진행 보존, 다음 신규 날짜 반영, 생성 중 설정 변경의 일관성. 특정 무작위 영상 ID를 요구하지 않는다.
- 프론트 `tests/unit/user-preferences.test.ts`, `tests/e2e/workout-preferences.spec.ts`, `tests/e2e/workout-preferences-live.spec.ts`: 집합 비교·응답 검증, 복수 선택·해제·실패 재시도, 실제 API 저장 후 새로고침·재로그인·별도 브라우저 세션 복원.

백엔드 통합 검사는 `RECOMMENDATION_PYTHON=.local/recommendation-venv/bin/python npm run test:e2e`로 전용 `TEST_DATABASE_URL`의 임시 스키마에서 실행한다. 프론트 브라우저 검사는 테스트 전용 API·프론트 실행 후 `E2E_BASE_URL=... E2E_API_BASE_URL=... npm run test:e2e -- workout-preferences.spec.ts workout-preferences-live.spec.ts`로 실행한다. 프론트 빌드의 `NEXT_PUBLIC_API_BASE_URL`도 해당 API 주소여야 한다.

### 10종 확장 확인 결과 (2026-09-29)

공·콘·사다리·보슈를 API·DB·프론트 선택지·Python 이름 매핑에 추가했다. 백엔드 통합 17개 파일 364개와 추천 입력 단위 9개, 프론트 단위 125개 및 관련 브라우저 11개가 통과했다. 실제 Python 검증은 추가 4종 각각과 10종 전체 입력을 포함한다. 브라우저는 10종 전체 선택을 저장한 뒤 새로고침·재로그인·별도 컨텍스트 복원과 전체 해제를 확인했다. 양쪽 타입·린트·빌드 및 Prisma 스키마 검증을 통과했다.

전용 테스트 DB 임시 스키마에서 17개 마이그레이션 적용·재배포와 기존 6종 선택·수정 시각 보존을 확인했다. 임시 스키마·테스트 서버는 정리했으며 개발·운영 DB 적용, 배포, 커밋·푸시는 하지 않았다. Chromium 외 브라우저·실물 기기·프론트 전체 브라우저 회귀는 재검증하지 않았다.

### 초기 6종 구현 확인 결과 (2026-09-29)

- 백엔드 Prisma 검증·클라이언트 생성, 타입·린트·서식 검사, 빌드 통과. 단위 18개 파일 279개 통과.
- 전체 통합 최초 실행은 17개 파일 359개 중 357개 통과. 실패한 2개는 테스트의 `pg` custom enum-array 해석 문제로 조회를 JSON 변환하도록 수정했고, 해당 마이그레이션 파일 3개 테스트를 재실행해 모두 통과했다. 실제 Python 도구 필터·신규 추천·스냅샷 보존 테스트도 전체 실행에서 통과했다.
- 전용 `project_health_test`의 임시 스키마에서 16개 마이그레이션 적용 및 두 번째 deploy의 미적용 항목 없음 확인. 생성한 테스트 스키마는 실행 후 정리했다.
- 프론트 타입·린트·서식 검사, 단위 125개, Next.js 프로덕션 빌드 통과.
- Chromium 모바일 뷰포트에서 관련 브라우저 테스트 11개 모두 통과(실제 API 2개, 격리한 응답으로 UI 흐름 검증 9개). 새로고침·재로그인·별도 브라우저 컨텍스트, 전체 해제, 실패·결과 불명·재시도·세션 만료를 포함한다. 320·390·430px 너비의 가로 넘침 검사와 화면 캡처를 확인했다.
- 최초 브라우저 실행에 필요한 Chromium이 없어 임시 디렉터리에 설치했다. 오류 안내 선택자가 Next.js 내부 알림과 겹친 테스트 1개를 수정하고 11개 전체를 재실행했다. 테스트용 API·프론트 서버와 임시 스키마를 종료·정리했다.
- 샌드박스의 로컬 연결·포트·Turbopack 제한은 승인된 외부 실행으로 재검증했다. 오래된 `.next` 생성 캐시는 임시 디렉터리에 보존한 뒤 새로 빌드했다. 기존 `pg` deprecation, Node module type, Next.js 외부 lockfile 경고는 남아 있으나 검사는 통과했다.

운영 DB·실제 배포 환경·Safari/Firefox·실물 기기에서는 검증하지 않았다. 프론트의 전체 브라우저 회귀 모음은 실행하지 않았으며 이번 작업에 관련된 두 파일만 실행했다. 커밋·푸시와 개발·운영 DB 마이그레이션은 수행하지 않았다.
