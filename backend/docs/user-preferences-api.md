# 개인 운동 설정 API

2026-09-26 사용자 결정으로 `UserPreference`를 추가한다. 프론트의 ‘내 프로필 → 운동 설정’ 화면은 아래 계약을 사용한다. 기존 `PATCH /users/me`의 이메일·비밀번호 변경 계약은 유지한다. 2026-09-21에 폐기한 선호 운동 배열·개인별 수치 목표·`currentFitness`를 복원하지 않는다.

## 인증과 요청 보호

- 기본 주소: `/api/v1`. GET·PATCH 모두 `Authorization: Bearer <access_token>`이 필요하다. 기존 DB 세션 검증을 사용한다.
- PATCH는 `Content-Type: application/json`, `X-CSRF-Protection: 1`을 전송한다. 브라우저 `Origin`은 서버의 `FRONTEND_ORIGIN`과 일치해야 한다. Origin이 없는 API 클라이언트도 CSRF 헤더가 필요하다.
- 기존 IP당 60회/분 변경 요청 제한을 공유한다. 현재 비밀번호는 요구하지 않는다.
- 사용자 ID는 인증 정보에서만 가져온다. 본문의 `userId`·`id`는 알 수 없는 필드로 거절한다. 사용자 ID 경로는 제공하지 않으며, 쿼리 파라미터로 대상을 바꿀 수 없다.
- 응답은 `Cache-Control: no-store`, `Pragma: no-cache`다. 설정 저장은 로그인 세션·토큰·refresh 쿠키를 변경하지 않는다.

## 조회

```http
GET /api/v1/users/me/preferences
Authorization: Bearer <access_token>
```

200 OK:

```json
{
  "exerciseVolume": "standard",
  "exerciseGoal": null,
  "updatedAt": "2026-09-26T00:00:00.000Z"
}
```

응답 키는 위 세 개다. 시각은 예시이며 실제 응답은 저장된 수정 시각의 UTC ISO 8601 문자열이다. `exerciseGoal: null`은 최초 미설정 상태다. 조회로 설정을 생성하거나 과거 기록에서 목적을 추정하지 않는다.

## 부분 저장

```http
PATCH /api/v1/users/me/preferences
Authorization: Bearer <access_token>
X-CSRF-Protection: 1
Content-Type: application/json

{
  "exerciseVolume": "more",
  "exerciseGoal": "fitness_grade_improvement"
}
```

| 필드             | 허용 문자열                   | 의미                  |
| ---------------- | ----------------------------- | --------------------- |
| `exerciseVolume` | `less`                        | 더 적게 운동하기      |
| `exerciseVolume` | `standard`                    | 기본                  |
| `exerciseVolume` | `more`                        | 더 많이 운동하기      |
| `exerciseGoal`   | `fitness_grade_improvement`   | 국민체력100 등급 개선 |
| `exerciseGoal`   | `body_composition_management` | 체형 관리             |
| `exerciseGoal`   | `general_fitness_improvement` | 기본 체력 증진        |

각 필드는 단일 선택이고 둘 중 하나 이상을 전달한다. 문자열을 trim하거나 대소문자를 변환하지 않는다. 생략한 필드는 그대로 유지한다. 예를 들어 `{"exerciseVolume":"less"}`는 목적이 null이든 설정돼 있든 운동량만 변경한다. `{"exerciseGoal":"body_composition_management"}`는 운동량을 유지한다.

명시적인 null, 빈 문자열, 미허용 enum, 숫자·boolean·배열·객체, 알 수 없는 필드, 빈 본문·빈 객체·JSON 객체가 아닌 본문을 모두 400으로 거절한다. 목적을 한 번 선택한 뒤 PATCH로 null로 되돌릴 수 없다. `updatedAt`, 현재 비밀번호, 온보딩 상태 등도 요청 필드가 아니다.

요청 전체 검증이 끝난 뒤 하나의 트랜잭션으로 저장한다. 하나라도 잘못되면 두 설정과 `updatedAt` 모두 유지한다. 두 필드를 함께 전송해도 하나의 원자적 변경이다.

200 OK — 저장된 전체 설정:

```json
{
  "exerciseVolume": "more",
  "exerciseGoal": "fitness_grade_improvement",
  "updatedAt": "2026-09-26T03:00:00.000Z"
}
```

동일 값 재요청도 200이며 기존 `updatedAt`을 유지한다. 실제 설정값이 달라질 때만 수정 시각을 갱신한다. 사용자 설정 행 잠금 아래 최신 값과 비교하고 전달된 필드 중 바뀐 필드만 갱신한다. 서로 다른 필드의 동시 수정은 둘 다 남으며, 같은 필드의 상충하는 수정은 DB에서 나중에 처리된 요청의 값이 남는다. HTTP 응답은 각 요청이 저장한 시점의 전체 설정이다.

## 오류

기존 NestJS 오류 형식과 사용자 입력 오류 형식을 따른다.

| 코드 | 조건                                                                   |
| ---- | ---------------------------------------------------------------------- |
| 400  | 잘못된 필드·값·자료형, 빈 요청, JSON 객체가 아닌 본문, 잘못된 JSON     |
| 401  | 인증 누락, 만료·잘못된 access token, 폐기 세션, 탈퇴 계정              |
| 403  | PATCH의 CSRF 헤더 누락·불일치 또는 허용되지 않은 Origin                |
| 429  | 기존 IP 요청 제한 초과 (`retry_after` 초 포함)                         |
| 503  | 계정은 존재하지만 설정 행 누락: 배포 또는 데이터 무결성 확인·복구 필요 |

설정 조회 또는 행 잠금 결과가 없으면 계정 존재 여부를 확인한다. 인증을 통과한 뒤 탈퇴가 완료되어 계정도 없으면 기존 인증 오류 메시지와 함께 401을 반환한다. 계정이 남아 있고 설정만 없으면 503을 반환하며 설정을 자동 생성하지 않는다. PATCH의 계정 확인은 설정 처리와 같은 트랜잭션에서 수행한다. 탈퇴보다 먼저 설정을 조회하거나 잠근 요청은 처리 순서에 따라 200으로 완료될 수 있다.

빈 객체 검증 오류 예시:

```json
{
  "statusCode": 400,
  "message": "사용자 입력을 확인해 주세요.",
  "errors": [
    {
      "field": "body",
      "message": "변경할 운동 설정을 하나 이상 전달해 주세요."
    }
  ]
}
```

enum·자료형 검증 오류도 `errors`에 필드명과 검증 메시지를 담는다. 본문 전체·알 수 없는 키 오류는 `field: "body"`다. JSON 파서에서 먼저 거절하는 문법·비객체 오류는 기존 `{ "statusCode": 400, "message": "...", "error": "Bad Request" }` 형태일 수 있으므로 클라이언트는 항상 `errors`가 있다고 가정하지 않는다.

인증 오류 예시:

```json
{
  "statusCode": 401,
  "message": "로그인이 필요하거나 세션이 만료되었습니다.",
  "error": "Unauthorized"
}
```

요청 보호 오류 예시:

```json
{
  "statusCode": 403,
  "message": "허용되지 않은 인증 요청입니다.",
  "error": "Forbidden"
}
```

요청 제한 오류 예시(`retry_after`는 실제 남은 초):

```json
{
  "statusCode": 429,
  "message": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  "retry_after": 12
}
```

설정 누락 오류:

```json
{
  "statusCode": 503,
  "message": "사용자 운동 설정이 누락되었습니다. 관리자 확인이 필요합니다.",
  "error": "Service Unavailable"
}
```

## 저장·가입·탈퇴

Prisma 모델은 `UserPreference`, DB 테이블은 기존 snake_case 관례의 `user_preferences`다.

| Prisma 필드 / DB 컬럼                | 저장 규칙                                                    |
| ------------------------------------ | ------------------------------------------------------------ |
| `userId` / `user_id`                 | UUID PK·NOT NULL·users FK, 사용자당 한 행, ON DELETE CASCADE |
| `exerciseVolume` / `exercise_volume` | ExerciseVolume enum·NOT NULL·기본 standard                   |
| `exerciseGoal` / `exercise_goal`     | ExerciseGoal enum·nullable·초기 null                         |
| `createdAt` / `created_at`           | TIMESTAMPTZ(6)·NOT NULL·실제 설정 생성 시각                  |
| `updatedAt` / `updated_at`           | TIMESTAMPTZ(6)·NOT NULL·생성/실제 변경 시각                  |

실제 신규 사용자 생성 경로는 `AuthService.register`의 이메일 가입 하나다. User·재화·설정·세션·refresh 해시를 기존 Prisma nested write의 같은 트랜잭션에서 만든다. 소셜 가입은 아직 구현돼 있지 않다. 미래 가입 경로나 수동 계정 생성 도구도 같은 트랜잭션에서 기본 설정을 생성해야 한다.

탈퇴는 `AuthService.deleteAccount`의 물리 DELETE이며 새 FK의 CASCADE가 설정을 함께 삭제한다. 논리 삭제 플래그는 없다. 설정 API는 계정 수정 API의 비밀번호 확인이나 세션 무효화 로직을 호출하지 않는다.

## 마이그레이션과 배포

새 마이그레이션 `20260926000100_user_preferences`는 enum·테이블·제약을 만들고 기존 사용자를 `standard`·null로 백필한다. 계정 생성 시각을 복사하지 않고 설정이 생성되는 시각을 사용한다. 초기화 INSERT는 `ON CONFLICT (user_id) DO NOTHING`으로 이미 저장된 값과 두 시각을 보존한다. 기존 측정·등급·커리큘럼에서 목적을 추론하지 않는다.

기존 서버는 가입할 때 설정을 만들지 않는다. 따라서 **가입 요청을 잠시 차단하고 진행 중 가입을 완료시킨 뒤, 마이그레이션 → 모든 서버의 신규 코드 교체 → 누락 점검 → 가입 재개** 순서로 배포한다. 사용자 생성 배치·관리 도구가 있다면 함께 중지한다. 신규 서버는 새 테이블이 필요한 상태 확인과 API를 사용하므로 먼저 시작하지 않는다.

```bash
# backend/에서 대상 환경 DATABASE_URL을 확인한다.
npm ci
npm run db:validate
npm run db:generate
npm run build

# 가입 중지·진행 중 요청 완료 후, 배포 작업 한 곳에서 실행한다.
npm run db:status
npm run db:migrate:deploy

# 모든 구버전 인스턴스를 종료/교체하고 신규 서버를 시작한다.
npm run start:prod
```

대상 DB의 실제 앱 스키마를 search_path로 선택한 관리 연결에서 아래 누락 점검 결과가 0인지 확인하고 가입을 재개한다. 비기본 스키마는 `DATABASE_URL`의 `schema` 값과 같아야 한다.

```sql
SELECT count(*) AS missing_preferences
FROM users u
LEFT JOIN user_preferences p ON p.user_id = u.id
WHERE p.user_id IS NULL;
```

중단된 배포·구버전 동시 운영으로 누락이 생겼다면 먼저 모든 구버전 생성 경로를 중지/교체한 뒤 아래 마이그레이션과 동일한 초기화 INSERT를 실행하고 다시 점검한다. 설정이 이미 있는 사용자는 값·생성/수정 시각을 유지한다. 기본 스키마가 아니라면 실제 앱 스키마를 지정한다.

```sql
BEGIN;
-- 필요 시 SET LOCAL search_path TO "실제_앱_스키마";
INSERT INTO user_preferences (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;
COMMIT;
```

전체 마이그레이션 SQL을 수동 재실행하지 않는다. `prisma migrate deploy`는 이미 적용된 마이그레이션을 건너뛰므로 누락 행 복구는 위 INSERT를 별도로 실행해야 한다. 운영에서 `db push`·`migrate reset`을 사용하지 않는다. 테이블 규모에 따른 백필 시간은 스테이징에서 확인한다. 조회·수정 API는 계정이 존재하지만 설정 행이 누락된 경우 자동 생성하지 않고 503을 반환해 문제를 드러낸다.

## 검증과 범위

`npm run check`는 기존 단위·통합 검사와 함께 `test/user-preferences.e2e-spec.ts`, `test/preferences-migration.e2e-spec.ts`를 실행한다. `TEST_DATABASE_URL`은 개발·운영과 다른 DB여야 한다. 통합 실행기는 테스트 DB에 임시 스키마를 생성해 전체 마이그레이션 및 재배포, 기존 데이터 업그레이드, enum/부분 수정/원자성/동시성/요청 보호/세션·데이터 보존/탈퇴를 검증하고 임시 스키마를 제거한다.

2026-09-27 탈퇴 경합의 오류 분류를 보완한다. GET·PATCH 각각 실제 인증 후 설정 서비스 진입에서 요청을 대기시키고, 별도 HTTP 탈퇴 요청이 완료된 뒤 재개하여 401과 계정·설정의 삭제 상태 유지를 검증한다. 계정이 존재하고 설정만 누락된 경우의 503 검증도 유지한다.

2026-09-26 실제 검증 결과: `db:validate`, `db:generate`, `format:check`, `lint`, `typecheck`, `build` 통과. `npm test`는 9개 파일·169개 테스트, `npm run test:e2e`는 13개 파일·286개 테스트가 모두 통과했다. 테스트 DB에서 10개 마이그레이션 최초 적용과 두 번째 deploy의 미적용 항목 없음도 확인했다. 개발·운영 DB에는 적용하지 않았다. UTC 회귀 검증에서 발견한 어댑터의 시간대 가정을 해결하기 위해 모든 Prisma 연결을 UTC로 시작하도록 수정했으며, 기존 기능까지 전체 회귀 검증했다.

이번 설정은 운동량 선호와 목적을 저장·조회하는 기능이다. 운동 시간·횟수·세트 증감, 운동 추천, 커리큘럼 생성·교체·진행 초기화에 연결하지 않는다. 측정·평가·등급·재화·isOnboarded·기존 로그인 상태를 유지한다. 프론트엔드 구현은 포함하지 않는다.
