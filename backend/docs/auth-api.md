# 이메일 인증 API와 직접 테스트

현재 범위는 이메일·비밀번호 회원가입, 로그인, 로그아웃, 토큰 갱신, 내 계정 조회다. 카카오·구글 로그인, 이메일 소유 확인, 비밀번호 재설정은 별도 후속 기능이다. 회원가입 성공은 이메일 소유 확인을 의미하지 않는다.

## 실행

아래 명령은 모두 `backend/`에서 실행한다. 로컬 `.env`의 기존 JWT 키는 유지하며, 키가 없으면 임의의 32바이트 키를 생성한다. 운영에서는 배포 환경의 secret 관리 기능으로 `AUTH_JWT_SECRET`을 주입한다.

```bash
npm ci
npm run db:local:start
npm run auth:secret
npm run db:migrate:deploy
npm run start:dev
```

## API 계약

기본 주소: `http://localhost:3001/api/v1`. 모든 인증 POST 요청에 `X-CSRF-Protection: 1`을 보낸다. 브라우저의 `Origin`은 `FRONTEND_ORIGIN`과 일치해야 한다. curl처럼 Origin이 없는 클라이언트도 이 헤더를 보내야 한다.

아래 표의 경로는 기본 주소 뒤에 붙인다. 버전 없는 `/api/auth/...` 경로는 404다. 버전 변경 기준은 [API 버전 관리](api-versioning.md)를 따른다.

| 메서드·경로           | 입력                                         | 성공 결과                                                |
| --------------------- | -------------------------------------------- | -------------------------------------------------------- |
| `POST /auth/register` | JSON `{ "email": "...", "password": "..." }` | 201, 계정·access token·refresh 쿠키. 가입 후 로그인 상태 |
| `POST /auth/login`    | 동일                                         | 200, 계정·access token·refresh 쿠키                      |
| `POST /auth/refresh`  | refresh 쿠키                                 | 200, 계정·새 access token·새 refresh 쿠키                |
| `POST /auth/logout`   | refresh 쿠키 또는 Bearer access token        | 204, 해당 세션 폐기·쿠키 삭제                            |
| `GET /auth/me`        | `Authorization: Bearer <access_token>`       | 200, 기존 공개 필드와 확장 프로필                        |

회원가입·로그인·갱신 응답은 `{ "user": { "id", "email", "created_at", "updated_at" }, "access_token", "token_type": "Bearer", "expires_in": 900 }` 형태다. `expires_in`은 초 단위이며 세션 만료가 가까우면 짧아진다. 비밀번호 원문·해시와 refresh token은 JSON 응답에 포함하지 않는다. `GET /auth/me`는 기존 공개 필드를 유지하고 온보딩·재화·현재 배정을 제공한다. 기존 선호 배열·수치 목표·currentFitness 프로필 응답은 폐기했다. 2026-09-26에 추가한 단일 운동량·목적은 별도 [운동 설정 API](user-preferences-api.md)에서 조회·저장하며 로그인 상태를 유지한다. 이메일·비밀번호 변경과 영구 탈퇴는 [사용자 API](users-api.md)를 따른다. 가입·로그인·갱신의 `user` 객체는 기존 형태를 유지한다.

이메일은 앞뒤 공백 제거·소문자화·형식 검증 후 저장한다. 회원가입 비밀번호는 15~128자이며 공백을 제거하거나 문자열을 바꾸지 않는다. 숫자·특수문자 조합을 강제하지 않는다. 알 수 없는 요청 필드도 400으로 거절한다.

오류: 잘못된 입력 400, CSRF/Origin 위반 403, 이메일 중복 409, 잘못된 로그인·만료/위조/폐기 토큰 401, 요청 횟수 초과 429. 429 응답의 `retry_after`는 재시도까지 남은 초다. 없는 이메일·비밀번호 불일치·비밀번호 없는 계정은 동일한 로그인 오류를 반환한다.

로그아웃은 refresh 쿠키가 있으면 그 세션을 대상으로 한다. 쿠키가 없으면 유효한 Bearer token으로도 로그아웃할 수 있다. 쿠키를 이용한 로그아웃은 access token이 만료되어도 가능하고, 반복 호출·빈 쿠키는 204다. 명시적으로 보낸 잘못된 Bearer token은 401이다. 다른 기기의 로그인 세션은 유지한다.

## 직접 데이터 넣고 확인하기

서버를 켜 둔 상태에서 다른 터미널을 열고 `backend/`로 이동한다. 아래 이메일·비밀번호는 로컬 테스트용 예시이며 직접 바꿀 수 있다. Prisma Studio에서 이미 넣은 이메일은 중복이므로 새 이메일을 사용한다. 예시는 실제 API를 호출하며 반환되는 ID·시간·토큰은 서버가 생성한다.

```bash
mkdir -p .local
curl -i http://localhost:3001/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Protection: 1' \
  -c .local/auth-cookies.txt \
  --data '{"email":"signup-test@example.com","password":"local-test-password-2026!"}'
```

201 응답과 `user`의 ID·이메일·생성/수정 시각을 확인한다. `npx prisma studio`로 `users`를 열면 실제 행의 `password`가 `$argon2id$`로 시작하는 해시인 것을 확인할 수 있다. 같은 비밀번호로 다른 계정을 만들어도 salt가 달라 해시가 다르다. Prisma Studio에서 비밀번호를 직접 입력하면 API를 거치지 않으므로 해싱되지 않으며, 이 로그인 API는 그런 평문 값을 받아주지 않는다.

로그인:

```bash
curl -i http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Protection: 1' \
  -c .local/auth-cookies.txt \
  --data '{"email":"signup-test@example.com","password":"local-test-password-2026!"}'
```

내 계정 조회는 응답의 `access_token`을 넣는다:

```bash
curl -i http://localhost:3001/api/v1/auth/me \
  -H 'Authorization: Bearer 여기에_access_token'
```

토큰 갱신은 기존 쿠키를 보내고 새 쿠키로 교체한다:

```bash
curl -i -X POST http://localhost:3001/api/v1/auth/refresh \
  -H 'X-CSRF-Protection: 1' \
  -b .local/auth-cookies.txt -c .local/auth-cookies.txt
```

로그아웃:

```bash
curl -i -X POST http://localhost:3001/api/v1/auth/logout \
  -H 'X-CSRF-Protection: 1' \
  -b .local/auth-cookies.txt -c .local/auth-cookies.txt
```

204를 받은 뒤 마지막 access token으로 `/auth/me`를 다시 호출하면 401이어야 한다. 로그인에서 얻은 access token은 로그인에서 생성한 세션에 속하므로, 로그아웃 테스트에는 가장 최근 로그인/갱신 응답의 토큰을 사용한다. 회원가입에서 얻은 예전 세션의 토큰과 혼동하지 않는다.

## 웹 프론트 연결

인증 POST 호출에서 `credentials: 'include'`, `X-CSRF-Protection: '1'`을 사용한다. 등록·로그인에는 `Content-Type: application/json`도 보낸다. access token은 메모리에 두고 보호된 API 호출의 Authorization 헤더에 넣는다. 새로고침 시 `/auth/refresh`로 access token을 얻는다. refresh 쿠키는 HttpOnly이므로 JavaScript로 읽거나 localStorage에 복사하지 않는다. 쿠키 파일·토큰을 Git에 넣지 않는다.

동시에 여러 요청이 401을 받더라도 refresh 요청은 하나로 합쳐서 보낸다. 여러 탭에서도 갱신을 조정해야 한다. 이미 사용한 refresh token의 재요청은 재사용 탐지에 걸려 세션 전체를 폐기한다. 네트워크 단절로 갱신 응답을 놓쳐 쿠키 교체에 실패한 경우 다시 로그인해야 할 수 있다.

로그아웃 성공 시 프론트의 access token·개인 데이터 캐시도 비운다. 서버 오류로 로그아웃이 실패했다면 서버에서 세션이 폐기됐다고 표시하지 않는다. [측정 기록 API](measurements-api.md)는 `AuthModule`의 `AccessTokenGuard`를 적용하고 인증된 `request.user.id`로 소유권을 확인한다. 이후 추가할 개인 데이터 경로도 같은 원칙을 따른다.

## 저장과 운영

- `users`는 id·email·password·created_at·updated_at을 관리한다. 선호/목적·목표·currentFitness 응답은 2026-09-21 정정으로 폐기했다. 온보딩은 측정 기록 존재 여부로 계산하며 인증 가드에서 상세 관계를 로드하지 않는다. 신규 가입의 계정·재화(0)·운동 설정(standard/null)·세션·토큰은 동일한 nested write 트랜잭션으로 생성한다.
- `auth_sessions`: 계정 연결, 생성 시각, 고정 만료 시각, 폐기 시각. 기본 7일이며 갱신으로 연장되지 않는다.
- `auth_refresh_tokens`: 256비트 난수 토큰의 SHA-256 해시, 세션 연결, 사용 시각. 사용한 해시도 세션 만료까지 유지해 재사용을 탐지한다. 비밀번호에는 SHA-256을 쓰지 않는다.
- `auth_rate_limits`: 서버 간 공유하는 DB 요청 횟수. IP·이메일은 키를 이용한 HMAC으로 처리한다. 인증 POST는 IP당 분당 60회, 회원가입은 이메일당 15분당 5회, 로그인은 이메일당 15분당 10회다. 성공·실패 모두 센다. 시간 구간이 바뀌면 다시 허용하며 경계 부근에는 두 구간의 요청이 인접할 수 있다.
- 운영에서는 `npm run auth:cleanup`을 정기 실행해 만료 세션·토큰·요청 횟수 행을 정리한다. 이 명령은 만료되지 않은 세션이나 계정을 지우지 않는다. 스케줄은 배포 환경에서 설정하며 앱이 임의로 예약하지 않는다.
- 비밀번호: Argon2id, memory 19,456 KiB, iteration 2, parallelism 1, 매번 임의 salt. 로그인 시 실제 해시를 검증한다.
- 계정 이메일·비밀번호 변경은 현재 비밀번호 확인 후 원자적으로 저장하고 모든 기존 세션을 폐기한다. 로그인은 계정 행 잠금 아래 검증한 이메일·비밀번호 해시가 여전히 같은지 확인해 변경 전 자격증명으로 뒤늦게 세션을 만들지 못하게 한다. 변경/탈퇴 후 기존 access/refresh는 401이다.
- access token: HS256으로 서명한 JWT, 기본 15분. 암호화된 데이터가 아니며 사용자 UUID·세션 UUID만 담는다. 알고리즘·서명·issuer·audience·만료를 확인하고 DB의 현재 세션 상태도 조회하므로 로그아웃 직후 차단된다.
- 개발 refresh 쿠키는 `project_health_refresh`, 운영은 `__Host-project_health_refresh`이다. 운영은 Secure·HttpOnly·Path=/·Domain 없음이며 HTTPS가 필수다. `AUTH_COOKIE_SAME_SITE=lax`가 기본이다. 프론트/API가 서로 다른 사이트에 배포되면 운영에서 `none`을 검토하되 브라우저의 제3자 쿠키 제한도 고려한다. 같은 사이트의 서브도메인 구성이 권장된다.
- 프록시 뒤에서는 `TRUST_PROXY_CIDRS`에 실제 프록시 주소/대역만 설정한다. 기본값은 전달된 IP 헤더를 신뢰하지 않는다. 별도 설정이 없으면 프록시에서 온 요청들이 같은 IP 제한을 공유한다. 프록시는 외부에서 전달된 헤더를 올바르게 처리해야 한다.
- JWT 키를 모든 API 인스턴스에서 동일하게 사용하고 코드에 포함하지 않는다. 키 교체는 기존 access token을 무효화한다. refresh 세션을 모두 폐기하는 기능은 별도로 필요하다.

근거: [OWASP 비밀번호 저장](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [node-argon2](https://github.com/ranisalt/node-argon2), [jose](https://github.com/panva/jose), [RFC 9700 refresh token 재사용 탐지](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2). 확인일 2026-09-19.
