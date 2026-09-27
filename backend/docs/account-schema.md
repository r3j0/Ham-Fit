# 계정과 사용자 데이터 구조

2026-09-21 정정: User UPDATE는 이메일·비밀번호 변경이다. 선호 운동·운동 목적·개인별 목표/기준값을 폐기하고, 사용자 프로필의 `currentFitness` 응답을 제거한다. **기존 측정 CRUD와 온보딩 조건은 유지**한다. User의 실제 컬럼은 아래 5개다.

| User 컬럼    | 형태                 | 의미                                |
| ------------ | -------------------- | ----------------------------------- |
| `id`         | UUID PK              | 내부 사용자 식별자                  |
| `email`      | TEXT NOT NULL UNIQUE | trim·소문자화한 로그인 이메일       |
| `password`   | TEXT nullable        | Argon2id 단방향 해시, 응답에서 제외 |
| `created_at` | TIMESTAMPTZ(6)       | 계정 생성 시각                      |
| `updated_at` | TIMESTAMPTZ(6)       | 계정 변경 시각                      |

Prisma는 `createdAt`, `updatedAt`을 DB의 snake_case 컬럼에 매핑한다. 이메일·비밀번호 변경은 현재 비밀번호 확인과 세션 폐기를 동반한다. [사용자 API](users-api.md)에 요청·응답과 동시 요청 정책을 정의한다.

비밀번호 원문은 저장하지 않는다. 미래 소셜 전용 계정을 위해 nullable을 유지하되 현재 로그인·수정·탈퇴에서는 null·평문·손상된 해시를 거절한다. 임의 기본 비밀번호·가짜 이메일을 만들지 않는다. 수동 DB 입력은 해싱을 거치지 않으므로 가입은 인증 API를 사용한다.

2026-09-26 추가 결정: User 컬럼은 그대로 두고 단일 선택 운동량·운동 목적을 별도 UserPreference 관계로 관리한다. [운동 설정 API](user-preferences-api.md)를 따른다.

## 관계

- User 1:N Measurement, Measurement 1:N MeasurementItem. 실제 측정값은 기존 측정 API에서 관리하며 User에 복제하지 않는다.
- User 1:1 UserPreference. userId PK/FK, exerciseVolume enum NOT NULL DEFAULT standard, exerciseGoal nullable enum 초기 null, createdAt·updatedAt. 가입 트랜잭션과 기존 회원 마이그레이션으로 생성하며 탈퇴 시 CASCADE 삭제한다.
- User 1:1 UserCurrency. userId PK/FK, 비음수 INTEGER 잔액과 생성·수정 시각. 신규 가입은 계정·세션과 같은 nested transaction으로 생성하고 기존 사용자는 마이그레이션으로 초기화한다. 관계 누락은 503이다.
- User 1:N UserCurriculumAssignment, WorkoutCurriculum 1:N UserCurriculumAssignment. 현재 배정은 `currentForUserId` UNIQUE 관계 하나로 표현하고 소유자 일치 CHECK·트랜잭션으로 최대 하나만 유지한다. 완료 이력은 새 배정으로 덮어쓰지 않는다.
- User 1:N AuthSession, AuthSession 1:N AuthRefreshToken. User 1:N MeasurementCreateRequest.

`isOnboarded`는 유효한 측정 기록 존재 여부에서 계산한다. 마지막 측정 삭제 후 미완료로 되돌아간다. 온보딩 조건은 추후 회의에서 재검토하는 MVP 정책이며 추천 가능 여부와 구분한다. 운동 설정은 온보딩 조건에 영향을 주지 않는다.

모든 사용자 소유 관계는 계정 삭제 시 CASCADE다. 공용 측정 카탈로그·검사 정의·커리큘럼 정의는 함께 삭제하지 않는다. 기존 측정 계약을 유지한다.

## 변경 이력과 후속 범위

초기 `20260921000100_user_features`는 선호/목적 컬럼과 UserFitnessGoal을 추가했으나 이후 사용자 정정으로 폐기했다. 이미 공유한 이 SQL은 변경하지 않고 새 `20260921000200_account_update_scope`가 해당 컬럼·테이블과 데이터를 제거한다. 기존 계정·측정·재화·배정·인증 데이터는 보존한다.

카카오·구글 로그인·이메일 소유 확인·비밀번호 분실 재설정, 재화 거래, 운동 콘텐츠·추천, 성장 비교는 후속 범위다. 같은 이메일만으로 로그인 수단을 자동 연결하지 않는다. 2026-09-26에 단일 운동량·목적 설정을 별도로 추가했다. 이전 선호 배열·개인별 수치 목표는 복원하지 않는다.

기존 기획 출처: [회원가입 / 로그인 / 온보딩 명세](https://app.notion.com/p/d54634ca4bdf83a8bb7c0147f51e63db), 2026-09-19 확인. 현재 범위는 2026-09-26 별도 운동 설정 추가 및 2026-09-21 계정 범위 정정과 ‘측정 CRUD 유지, currentFitness 응답만 제거’ 확인을 따른다. 공유 Notion 원문은 이번 작업에서 수정하지 않았다.
