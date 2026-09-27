# Backend

Project Health의 NestJS API 서버입니다. 백엔드 코드·설정·문서·테스트는 이 디렉토리에서 관리합니다.

- [개발 원칙](AGENTS.md)
- [API 버전 관리](docs/api-versioning.md): 현재 `/api/v1`, DB·측정 기준·기록 수정 버전과 구분
- [계정 스키마](docs/account-schema.md): 이메일·비밀번호 등 계정 필드와 사용자 관계
- [계정 정보 변경·온보딩·재화·커리큘럼·영구 탈퇴 API](docs/users-api.md)
- [개인 운동 설정 API·가입/탈퇴·배포 순서](docs/user-preferences-api.md)
- [회원가입·로그인·로그아웃·토큰 갱신 API와 직접 테스트](docs/auth-api.md)
- [측정 데이터 명세](docs/measurement-data-spec.md)
- [측정 기록 CRUD API와 직접 테스트](docs/measurements-api.md)
- [간이측정·공식 종목 평가·6축 조회 API](docs/measurement-evaluation-api.md)
- [절대악력 원본 입력·상대악력 환산 및 평가 계약](docs/absolute-grip.md)
- [공식 평가 기준 조사·적용 범위](docs/research-fitness-criteria.md)
- [국민체력100 사진 추출 API·환경설정·프론트 연동](docs/measurement-extraction-api.md)
- [DB 설계와 마이그레이션](docs/database.md)

## 개발 환경

Node.js 24.15 이상(`.nvmrc`), npm, NestJS 12, TypeScript ESM, PostgreSQL 17, Prisma 7.10을 사용합니다. 패키지 버전은 `package-lock.json`으로 고정합니다. 아래 명령은 모두 `backend/`에서 실행합니다.

## 시작하기

로컬 PostgreSQL 실행 파일(`initdb`, `pg_ctl`)이 PATH에 있다면:

```bash
nvm use
npm ci
npm run db:local:start
npm run auth:secret
npm run db:migrate:deploy
npm run start:dev
```

`db:local:start`는 `backend/.local/`에 전용 DB 클러스터를 만들고 `127.0.0.1:15432`에서 실행합니다. 개발·테스트 DB를 분리하고 임의로 생성한 비밀번호를 사용합니다. `.env`가 없으면 접속 설정을 생성하며, 기존 `.env`는 덮어쓰지 않습니다. 기본 포트를 바꾸려면 최초 초기화 시 `LOCAL_POSTGRES_PORT`를 지정합니다. 종료는 `npm run db:local:stop`입니다.

이미 준비한 PostgreSQL을 사용한다면 `.env.example`을 `.env`로 복사하고 실제 접속 정보로 바꾼 뒤 `npm run auth:secret`, `npm run db:migrate:deploy`를 실행합니다. 개발 도우미가 만든 DB는 배포용 인프라가 아닙니다.

기본 API 주소는 `http://localhost:3001/api/v1`입니다.

인증·측정·상태 확인 API 모두 명시적인 v1 경로를 사용합니다. 이전 `/api/...` 경로와 미지원 버전은 404를 반환합니다. 프론트와 호출 도구도 기본 경로를 `/api/v1`로 설정합니다.

```bash
curl http://localhost:3001/api/v1/health
curl http://localhost:3001/api/v1/health/ready
```

`/health`는 프로세스 응답 여부, `/health/ready`는 실제 DB 연결·계정 스키마·검사 카탈로그 준비 여부를 검사합니다. 준비되지 않으면 503을 반환하고 DB 접속 정보는 노출하지 않습니다. 서버 시작 시 DB 연결에 실패하면 시작을 중단합니다.

2026-09-21 정정으로 선호 운동·운동 목적·개인별 목표/기준값과 `currentFitness` 프로필 응답을 제거했습니다. 기존 측정 CRUD·저장 데이터와 유효한 기록 1건 이상의 온보딩 조건은 유지합니다.

2026-09-26부터 별도 UserPreference에 운동량 선호·단일 운동 목적을 저장합니다. 기존 프로필·계정 변경 계약과 온보딩을 유지하며 운동 알고리즘에는 아직 반영하지 않습니다. 가입 중지 → 마이그레이션 → 모든 신규 서버 교체 → 누락 점검 → 가입 재개 순서가 필요합니다. [운동 설정 API](docs/user-preferences-api.md)에 요청·응답·복구 절차를 정리했습니다.

2026-09-24부터 공식 수치 기준을 확보하지 못한 성인 `self_curl_up`은 신규 입력에서 제외합니다. 최신 카탈로그는 `nfa100-2026-09-24`이며, 기존 기록·과거 카탈로그와 청소년 `curl_up`은 유지합니다. [평가 API](docs/measurement-evaluation-api.md)에 신규 입력과 기존 기록 수정 계약을 정리했습니다.

현재 이메일 인증·국민체력100 측정 CRUD와 이메일·비밀번호 변경·온보딩·재화 조회·영구 탈퇴를 구현했습니다. 운동 1회분 배정·완료·이력은 내부 서비스까지 제공하며 콘텐츠·추천 HTTP 호출은 후속 범위입니다. 비밀번호는 Argon2id 해시로 저장하고, 측정 기록은 인증된 본인만 조회·수정·삭제합니다. [인증 테스트](docs/auth-api.md)와 [측정 기록 테스트](docs/measurements-api.md)에 curl 예제가 있습니다. 간이측정 저장·공식 종목 평가·최신 회차의 6축 조회도 제공합니다. 소셜 로그인·이메일 확인·비밀번호 재설정은 후속 범위입니다.

## 환경변수

시스템 환경변수가 `.env`보다 우선합니다. 실제 접속 정보와 `.local/`은 Git에서 제외됩니다.

| 변수                       | 기본값                    | 용도                                                            |
| -------------------------- | ------------------------- | --------------------------------------------------------------- |
| `NODE_ENV`                 | `development`             | `development`, `production`, `test`                             |
| `PORT`                     | `3001`                    | API 포트                                                        |
| `FRONTEND_ORIGIN`          | `http://localhost:3000`   | CORS 허용 origin. 인증을 대신하지 않음                          |
| `DATABASE_URL`             | 없음, 필수                | PostgreSQL 접속 주소. `schema` 옵션 지원                        |
| `TEST_DATABASE_URL`        | 없음, 통합 테스트 시 필수 | 개발·운영 DB와 다른 테스트 전용 DB                              |
| `AUTH_JWT_SECRET`          | 없음, 필수                | 임의 32바이트 키의 64자리 hex 표현                              |
| `AUTH_ACCESS_TTL_SECONDS`  | `900`                     | access token 수명(60~3600초)                                    |
| `AUTH_REFRESH_TTL_SECONDS` | `604800`                  | 세션 고정 수명(3600~2592000초, access보다 길어야 함)            |
| `AUTH_COOKIE_SAME_SITE`    | `lax`                     | 운영 HTTPS에서 `none` 허용                                      |
| `TRUST_PROXY_CIDRS`        | 없음                      | 실제 신뢰할 프록시 IP/CIDR을 쉼표로 구분                        |
| `OPENAI_API_KEY`           | 없음, 추출 사용 시 필수   | 서버 비밀 설정. 미설정 시 추출만 503                            |
| `OPENAI_OCR_MODEL`         | 없음, 추출 사용 시 필수   | 이미지·Responses·Structured Outputs 지원 및 계정 접근 확인 필요 |

## DB와 배포 명령

| 명령어                                     | 용도                                        |
| ------------------------------------------ | ------------------------------------------- |
| `npm run db:local:start` / `db:local:stop` | 전용 로컬 PostgreSQL 시작·종료              |
| `npm run db:generate`                      | 스키마에서 Prisma Client 생성               |
| `npm run db:validate`                      | Prisma 스키마 검증                          |
| `npm run db:migrate:dev -- --name 이름`    | 개발 DB에서 새 마이그레이션 작성            |
| `npm run db:migrate:deploy`                | 검토·커밋한 마이그레이션 적용               |
| `npm run db:status`                        | 마이그레이션 상태 확인                      |
| `npm run start:dev`                        | 클라이언트 생성 후 변경 감지 서버 실행      |
| `npm run start:debug`                      | 디버깅 서버 실행                            |
| `npm run build`                            | 클라이언트 생성 후 `dist/` 빌드             |
| `npm run start:prod`                       | 빌드된 서버 실행                            |
| `npm run auth:secret`                      | 로컬 JWT 키 생성, 기존 값 보존              |
| `npm run auth:cleanup`                     | 만료된 세션·refresh token·요청 제한 행 정리 |

배포 파이프라인에서는 의존성 설치·빌드 후 해당 환경의 `DATABASE_URL`로 `db:migrate:deploy`를 한 번 실행하고 서버를 시작합니다. `NODE_ENV=production`, HTTPS `FRONTEND_ORIGIN`, 비밀 관리 기능으로 주입한 `AUTH_JWT_SECRET`을 설정하고 API도 HTTPS로 제공합니다. 서버가 시작할 때 임의로 마이그레이션·샘플 사용자 생성을 실행하지 않습니다. 만료 세션 정리는 배포 환경에서 정기 실행합니다.

## 검사와 테스트

```bash
npm run check
```

스키마·서식·린트·타입 검사, 단위·통합 테스트와 빌드를 실행합니다. 단위 테스트만 실행할 때는 `npm test`를 사용합니다. `npm run format`은 서식 정리, `npm run format:check`는 서식 검사입니다.

`npm run test:e2e`는 `TEST_DATABASE_URL`의 DB 안에 매번 새로운 임시 스키마를 만들고 마이그레이션을 두 번 적용합니다. 실제 PostgreSQL로 테스트한 뒤 자신이 만든 스키마만 정리합니다. 테스트 DB가 설정되지 않거나 개발 DB와 같으면 실패하며, 인메모리 DB로 대체하거나 테스트를 건너뛰지 않습니다. 실행 환경은 로컬 DB 접속과 테스트용 포트 열기를 허용해야 합니다.

HTTP 테스트 앱은 `await app.listen(0, '127.0.0.1')`로 시작하고 종료 시 `app.close()`합니다. macOS에서 Supertest의 자동 wildcard 바인딩이 다른 로컬 서버와 겹치는 문제를 방지합니다. [404 실패 분석과 재현](docs/auth-test-failure-analysis.md)을 참고합니다.

| 테스트                           | 검증                                                                     |
| -------------------------------- | ------------------------------------------------------------------------ |
| `src/config/environment.spec.ts` | 환경변수·접속 주소 검증                                                  |
| `test/accounts.e2e-spec.ts`      | 확장 계정 컬럼, 이메일 유일성·정규화, 수정 시각                          |
| `test/auth.e2e-spec.ts`          | 실제 API·해싱·토큰 회전·재사용·동시 요청·로그아웃·CSRF·요청 제한         |
| `test/database.e2e-spec.ts`      | 실제 저장·조회, 부분 기록, 단위·연령·값 제약, 동시 삭제, 카탈로그 불변성 |
| `test/measurements.e2e-spec.ts`  | 측정 CRUD·소유권·재시도 중복 방지·수정 충돌·삭제·페이지 조회             |
| `test/app.e2e-spec.ts`           | 서버 초기화, CORS, 상태 확인·503 응답                                    |

추가 평가 검증: `src/measurements/evaluation/measurement-evaluator.spec.ts`의 공식 경계·방향·연령·출처·미평가·6축·목표값 검사, `test/measurement-evaluation.e2e-spec.ts`의 간이측정 저장·최신 회차·기존 데이터·온보딩 회귀 검사. [검증 결과](docs/measurement-evaluation-verification.md)를 참고합니다.

추가 PostgreSQL 통합 테스트:

- `test/users.e2e-spec.ts`: 폐기 API/응답 제거·온보딩 스냅샷·재화 제약·영구 삭제/쿠키·모든 토큰 차단
- `test/account-update.e2e-spec.ts`: 이메일·비밀번호 변경·본인 확인·중복/동시 요청·세션 폐기·이전 자격증명 차단
- `test/curricula.e2e-spec.ts`: 현재 배정/소유권·중복 키·동시 배정/완료·완료 이력 보존
- `test/user-migration.e2e-spec.ts`: 폐기 데이터 제거와 계정/측정/잔액/배정/세션 보존·재화 백필·기존 사용자 온보딩
- `test/measurement-extraction.e2e-spec.ts`: 이미지 업로드·인증·실제 카탈로그·호출 제한·추출 시 저장/온보딩 불변·확인 후 기존 저장. OpenAI transport만 대역 사용
- `src/measurements/extraction/*.spec.ts`: 실제 이미지 디코딩, 추출 내용 검증, strict 스키마·프롬프트 전달, 외부 오류·시간/횟수 제한

새 사용자 기능 마이그레이션의 적용 절차는 [DB 문서](docs/database.md), 프론트 연동 예시는 [사용자 API](docs/users-api.md)를 참고합니다. 테스트는 운영·개발 DB에 적용하지 않습니다.

## 디렉토리 구조

```text
backend/
├── AGENTS.md
├── docs/                       # 계정·측정·DB 명세
├── prisma/
│   ├── schema.prisma
│   └── migrations/             # 테이블·제약·공식 기준 데이터
├── scripts/                    # 로컬 DB 및 격리 테스트 도우미
├── src/
│   ├── auth/                   # 이메일 인증 API·해싱·토큰·가드
│   ├── config/                 # 환경변수 검증
│   ├── curricula/              # 운동 1회분 배정·완료·이력 내부 서비스
│   ├── users/                  # 계정 정보 변경·온보딩 조회·영구 탈퇴
│   ├── database/               # Prisma 연결·종료·준비 상태
│   ├── generated/prisma/       # 생성 코드, Git 제외
│   ├── measurements/           # 공식 카탈로그·본인 측정 기록 CRUD
│   └── health/
├── test/
└── prisma.config.ts
```

새 기능은 기능별 Nest 모듈·컨트롤러·서비스로 추가하며, 필요한 모듈에서 `DatabaseModule`을 import해 `DatabaseService`를 주입합니다. ESM 로컬 import는 `.js` 확장자를 사용합니다. 생성 코드는 직접 수정하지 않습니다.

Prisma 구성은 [공식 NestJS 안내](https://docs.prisma.io/docs/guides/frameworks/nestjs)를 참고하되 이 저장소의 ESM 설정을 유지합니다.

## 성인 스텝검사 참고 평가 (2026-09-24)

회복 심박수 원본을 보존하고 측정 당시 성별·나이·신장·체중으로 최대산소섭취량을 추정합니다. 부분 저장, 계산 근거 및 참고 등급 계약은 [스텝검사 안내](docs/step-assessment.md)를 따릅니다. 과거의 YMCA 기준 미확보 설명은 새로 저장·수정하는 성인 기록에 한해 이 계약으로 대체되며, 기존 스냅샷은 유지됩니다.
