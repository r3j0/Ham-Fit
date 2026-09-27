# 생년월일과 추천 준비 상태

2026-09-27 사용자 확정 정책. 이전 계정 범위 문서보다 이 추가 정책을 우선한다.

`users.date_of_birth`는 nullable PostgreSQL DATE다. 기존 행은 null로 보존하며 측정 나이에서 추정하지 않는다. 현재 만 나이는 저장하지 않고 서버 `Asia/Seoul` 오늘 날짜에서 매번 계산한다. 윤년 2월 29일 생일은 평년 2월 28일까지 이전 나이, 3월 1일부터 새 나이가 된다. 생년월일은 날짜 전용 `YYYY-MM-DD`로 입출력하며 미래·불가능한 날짜·타임스탬프는 거절한다.

`POST /api/v1/auth/register`에는 선택 필드 `dateOfBirth`를 추가했다. 기존 v1 클라이언트의 생략 요청을 유지한다. 이번 작업은 BE만 포함하며, 가입 UI의 필수 입력과 기존 사용자 보완 화면은 후속 FE 연동 계약이다. 로그인·갱신 응답의 기존 user 형태는 유지한다. `GET /api/v1/auth/me`에는 `dateOfBirth`, `currentAge`를 추가하며 추천을 생성하지 않는다.

`GET /api/v1/users/me/profile`은 `{ dateOfBirth: string | null, currentAge: number | null, nickname: string | null }`을 반환한다. `PATCH`는 JSON `{ dateOfBirth: "2000-02-29" }` 또는 `{ nickname: "운동친구" }`, 또는 두 필드를 함께 받으며 생략한 필드는 보존한다. 2026-09-27 추가 요청으로 중복 허용 닉네임을 확장했다. [닉네임 계약](../nickname-profile.md)을 따른다. 기존 인증·CSRF·Origin 규칙과 본인 소유권을 적용하며 계정 행을 잠가 배정 생성과 직렬화한다. 세션을 폐기하거나 측정·평가·운동 설정을 변경하지 않는다. 이메일·비밀번호 변경은 기존 `/users/me`로 분리한다.

온보딩은 기존대로 유효한 측정 1건 존재 여부다. 추천 준비는 별도로 생년월일·현재 만 13–64세·최신 측정 존재를 확인한다. 간이측정의 기존 만 19–64세 제한은 유지한다. 기존 측정 `ageAtMeasurement` 및 저장된 평가는 현재 생일이나 프로필 수정으로 재평가하지 않는다. 이미 저장한 일별 배정도 변경하지 않는다.

검사: `npm test -- src/users/date-of-birth.spec.ts`, 격리된 PostgreSQL에서 `npm run test:e2e -- test/birth-profile.e2e-spec.ts test/workouts.e2e-spec.ts`. 기존 계정의 nullable 마이그레이션 보존은 upgrade E2E에서 함께 검증한다.
