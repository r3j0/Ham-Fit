# 회원가입 닉네임과 프로필

2026-09-27 사용자 요청으로 생년월일과 같은 가입·프로필 경로에 닉네임을 추가했다. 사용자가 **닉네임 중복 허용**을 선택했다. 닉네임은 화면 표시용 이름이며 계정 식별자는 기존 UUID, 로그인 수단은 이메일이다.

## 입력과 저장

- `nickname`은 한글(완성형·호환 자모), 영문, 숫자, 밑줄(`_`)을 조합한 2~20자다. 영문 대소문자를 유지한다.
- 앞뒤 공백 제거 후 Unicode NFC로 정규화하며 그 결과로 길이·문자를 검사한다. 내부 공백·제어 문자·이모지·그 밖의 특수문자는 허용하지 않는다.
- 빈 문자열, `null`, 숫자·배열·객체, 형식 위반은 400 `INVALID_NICKNAME`과 `errors: [{ field: "nickname", ... }]`를 반환한다. 오류에 제출 값을 포함하지 않는다.
- DB는 nullable `users.nickname VARCHAR(20)`과 길이·문자 CHECK를 사용한다. UNIQUE 제약은 없으며 같은 닉네임으로 가입하거나 변경할 수 있다.
- 기존 사용자와 닉네임을 생략한 v1 가입은 `null`로 보존한다. 이메일이나 임의 값으로 닉네임을 채우지 않는다.

2~20자와 허용 문자 범위는 이번 구현의 기본 규칙이다. 중복 허용은 사용자가 확인한 정책이다.

## 가입과 조회

```http
POST /api/v1/auth/register
Content-Type: application/json
X-CSRF-Protection: 1

{"email":"member@example.test","password":"example-password-2026","dateOfBirth":"2000-02-29","nickname":"운동친구"}
```

`nickname`은 생년월일처럼 v1 API에서 선택 필드다. 이메일·비밀번호만 보내는 기존 요청을 유지한다. 입력한 경우 검증한 닉네임을 User·재화·운동 설정·세션과 같은 가입 트랜잭션에서 저장한다. 로그인 요청에는 닉네임을 보내지 않는다.

가입·로그인·갱신 응답의 `user`는 기존 `id`, `email`, `created_at`, `updated_at` 4개 필드를 유지한다. `GET /api/v1/auth/me`의 기존 응답에 `nickname: string | null`을 추가한다. 가입 후 이 응답 또는 아래 프로필 API에서 닉네임을 읽는다.

`GET /api/v1/users/me/profile`은 다음 세 필드를 반환한다. 현재 나이는 서버 KST 오늘 기준으로 계산하며 [생년월일 정책](recommendations/birth-profile.md)을 따른다.

```json
{
  "dateOfBirth": null,
  "currentAge": null,
  "nickname": null
}
```

## 프로필 부분 수정

```http
PATCH /api/v1/users/me/profile
Authorization: Bearer <access_token>
X-CSRF-Protection: 1
Content-Type: application/json

{"nickname":"운동친구2"}
```

`dateOfBirth`, `nickname` 중 하나 이상을 보낸다. 두 필드를 함께 보낼 수 있으며 생략한 필드는 보존한다. 기존 생년월일 단독 PATCH도 유지한다. 빈 본문·알 수 없는 필드·`userId`·이메일·비밀번호는 400이다. 어느 한 필드가 잘못되어도 전체 변경을 거절한다. 닉네임 삭제를 위한 `null`은 허용하지 않는다.

성공은 200이며 GET과 같은 전체 프로필을 반환한다. 본인 계정만 수정하고 기존 인증·CSRF·Origin 검증·개인 응답 캐시 금지를 유지한다. 계정 행 잠금 아래 저장하며 세션·refresh 쿠키·측정/평가·운동 설정·재화·기존 운동 배정을 변경하지 않는다. 닉네임은 온보딩이나 추천 가능 여부의 조건이 아니다. 이메일·비밀번호 변경은 기존 `/users/me`로 분리한다.

## 적용과 프론트 연동

새 마이그레이션은 `20260927000200_user_nickname`이다. 기존 마이그레이션을 수정하지 않고 nullable 컬럼을 추가하여 계정·생년월일·관계 데이터를 보존한다. 대상 환경에서 [DB 적용 절차](database.md)에 따라 `npm run db:migrate:deploy` 후 새 서버를 시작한다. 이번 구현은 전용 테스트 DB에서 검증하며 개발·운영 DB 적용과 배포를 포함하지 않는다.

현재 프론트는 초기 화면만 있어 회원가입 화면은 후속 구현이다. 가입 UI에서는 생년월일과 함께 닉네임을 입력받아 전송하고, 기존 회원의 `nickname: null`은 프로필에서 보완한다. 중복 확인 API나 닉네임 선점 기능은 필요하지 않다. 프론트의 필수 입력 처리와 v1 API의 생략 호환성은 구분한다.

검증: `npm test -- src/users/nickname.spec.ts`, `npm run test:e2e -- test/nickname-profile.e2e-spec.ts test/birth-profile.e2e-spec.ts test/accounts.e2e-spec.ts test/user-migration.e2e-spec.ts test/preferences-migration.e2e-spec.ts test/users.e2e-spec.ts test/auth.e2e-spec.ts`.
