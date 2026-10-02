# 🛠️ 햄피트 백엔드

햄피트의 인증·체력 기록·맞춤 운동·그룹·보상을 제공하는 NestJS API 서버입니다. 사용자 데이터는 PostgreSQL에 저장하며, 신규 운동 루틴은 데이터 분석 영역의 Python 원본을 직접 호출해 생성합니다.

[프로젝트 소개](../README.md) · [프론트엔드](../frontend/README.md) · [데이터 분석](../data-analysis/README.md) · [개발 원칙](AGENTS.md)

## 지원 기능

| 영역             | 제공 기능                                                                               | 계약 문서                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 인증·계정        | 이메일 가입·로그인·로그아웃·토큰 갱신, Argon2id 비밀번호 해싱, 계정 정보 변경·회원 탈퇴 | [인증](docs/auth-api.md), [사용자](docs/users-api.md)                                                           |
| 프로필·운동 설정 | 닉네임·생년월일, 온보딩 상태, 운동량·운동 목적·보유 도구                                | [프로필](docs/nickname-profile.md), [운동 설정](docs/user-preferences-api.md), [보유 도구](docs/owned-tools.md) |
| 체력 기록        | 국민체력100·성인 간이측정 CRUD, 부분 저장, 종목별 평가와 최신 6축 조회                  | [측정](docs/measurements-api.md), [평가](docs/measurement-evaluation-api.md)                                    |
| 사진 추출        | 결과표 사진에서 저장 전 초안을 추출하고 사용자 확인 후 기존 측정 API로 저장             | [사진 추출](docs/measurement-extraction-api.md)                                                                 |
| 맞춤 루틴        | KST 당일 루틴 생성·조회, 여러 운동과 처방·유산소 권장량, 영상별 진행·이력               | [루틴 API](docs/recommendations/routines-api.md)                                                                |
| 그룹             | 생성·가입 신청·초대 코드·그룹원 관리·알림, 최대 5명 그룹                                | [그룹 API](docs/groups-api.md)                                                                                  |
| 그룹 미션        | 미션 시작·성장·기여도·물 주기·그룹 룰렛                                                 | [그룹 미션](docs/group-missions.md), [물 주기](docs/group-mission-water.md)                                     |
| 활동·보상        | 전체 루틴 완료 보상, 연속 운동 집계와 개인 룰렛                                         | [완료 보상](docs/activity-rewards.md), [스트릭](docs/activity-streaks.md), [개인 룰렛](docs/streak-roulette.md) |
| 캐릭터·상점      | 캐릭터 선택·상품·구매·보유 목록·대표 코디, 아바타 매니저 메타데이터 게시                | [상점](docs/avatar-shop-api.md), [아바타 매니저](docs/avatar-manager.md)                                        |
| 운영 상태        | 프로세스 상태와 DB·스키마·카탈로그 readiness                                            | [DB 안내](docs/database.md)                                                                                     |

대부분의 API는 `/api/v1`이며 당일 루틴은 `/api/v2/workout-routines`를 사용합니다. 기존 `/api/v1/workouts`의 단일 영상 추천 계산기는 미연결 상태를 유지합니다. 새 연동은 v2 루틴 계약을 사용하세요.

## 기술과 요구 환경

- Node.js `^24.15.0 || >=26.0.0`, npm (`.nvmrc`: 24)
- NestJS 12, TypeScript 6, ESM
- PostgreSQL 17, Prisma 7.10와 `pg` 어댑터
- Python 3.9 이상, NumPy·pandas: 신규 추천 실행에 필요
- Vitest·Supertest, Oxlint·Prettier

패키지 버전은 `package-lock.json`, 추천 런타임 버전은 `requirements-recommendation.txt`를 기준으로 설치합니다. 아래 명령은 모두 `backend/`에서 실행합니다.

## 실행 방법

### 1. Node.js 의존성 설치

```bash
cd backend
nvm use
npm ci
```

### 2. 데이터베이스 준비

**로컬 DB 도우미 사용** — `initdb`, `pg_ctl`이 PATH에 있는 환경:

```bash
npm run db:local:start
npm run auth:secret
npm run db:migrate:deploy
```

도우미는 `.local/`에 전용 클러스터를 만들고 `127.0.0.1:15432`에서 실행합니다. 개발용 `project_health`와 테스트용 `project_health_test` DB를 만들고, `.env`가 없으면 임의 비밀번호를 포함한 접속 설정을 생성합니다. 기존 `.env`는 덮어쓰지 않습니다. 첫 초기화 시 `LOCAL_POSTGRES_PORT`로 포트를 바꿀 수 있으며 종료는 `npm run db:local:stop`입니다.

**이미 준비된 PostgreSQL 사용** — 새 체크아웃에서:

```bash
cp .env.example .env
# .env의 DATABASE_URL과 TEST_DATABASE_URL을 실제 접속 정보로 수정
npm run auth:secret
npm run db:migrate:deploy
```

`TEST_DATABASE_URL`은 개발·운영 DB와 분리합니다. `DIRECT_URL`을 비워 두면 Prisma CLI도 `DATABASE_URL`을 사용합니다. 별도 마이그레이션 접속 주소가 필요한 환경에서는 `DIRECT_URL`을 지정합니다.

### 3. 추천 런타임 준비

```bash
python3 -m venv .local/recommendation-venv
.local/recommendation-venv/bin/python -m pip install -r requirements-recommendation.txt
export RECOMMENDATION_PYTHON="$PWD/.local/recommendation-venv/bin/python"
```

원본 `../data-analysis/src/recommendation_v2.py`와 `../data-analysis/data/processed/workout_videos_v2_complete.csv`가 필요합니다. 백엔드는 원본을 복사·재구현하지 않고 읽기 전용으로 실행합니다. 터미널을 새로 열면 `RECOMMENDATION_PYTHON`을 다시 지정하거나 `.env`에 가상환경 Python의 절대 경로를 저장하세요.

### 4. 개발 서버 실행

```bash
npm run start:dev
```

```bash
curl http://localhost:3001/api/v1/health
curl http://localhost:3001/api/v1/health/ready
```

`health`는 프로세스 응답을, `health/ready`는 실제 DB 연결·필수 스키마·조회 권한·검사 카탈로그를 확인합니다. 준비되지 않았으면 readiness는 503을 반환합니다. 시작 시 DB 연결에 실패하면 서버가 시작되지 않습니다.

## 환경변수

시스템 환경변수가 `.env`보다 우선합니다. 전체 예시는 [.env.example](.env.example)을 참고하세요.

| 변수                                  | 기본값·필요 조건                                                 | 용도                                                  |
| ------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `NODE_ENV`                            | `development`                                                    | 실행 환경 (`development`, `production`, `test`)       |
| `PORT`                                | `3001`                                                           | API 포트                                              |
| `FRONTEND_ORIGIN`                     | `http://localhost:3000`                                          | CORS 허용 origin. 경로·끝 슬래시 없이 지정            |
| `DATABASE_URL`                        | 필수                                                             | PostgreSQL 실행 접속 주소                             |
| `DIRECT_URL`                          | 선택                                                             | Prisma CLI의 별도 마이그레이션 접속 주소              |
| `TEST_DATABASE_URL`                   | 통합 테스트 시 필수                                              | 분리된 테스트 DB                                      |
| `AUTH_JWT_SECRET`                     | 필수                                                             | 임의 32바이트의 64자리 hex 키. `auth:secret`으로 생성 |
| `AUTH_ACCESS_TTL_SECONDS`             | `900`                                                            | access token 수명                                     |
| `AUTH_REFRESH_TTL_SECONDS`            | `604800`                                                         | refresh 세션 수명                                     |
| `AUTH_COOKIE_SAME_SITE`               | `lax`                                                            | 운영 HTTPS 환경에서 `none` 사용 가능                  |
| `TRUST_PROXY_CIDRS`                   | 없음                                                             | 실제 신뢰할 프록시 IP/CIDR                            |
| `RECOMMENDATION_PYTHON`               | PATH의 `python3`                                                 | 추천 실행용 Python 경로                               |
| `RECOMMENDATION_SOURCE_PATH`          | `../data-analysis/src/recommendation_v2.py`                      | 추천 원본 경로                                        |
| `WORKOUT_VIDEOS_PATH`                 | `../data-analysis/data/processed/workout_videos_v2_complete.csv` | 추천 카탈로그 경로                                    |
| `WORKOUT_MEDIA_REPORT_PATH`           | `.local/recommendation/media-verification.json`                  | 검증된 재생 URL·길이 보고서                           |
| `OPENAI_API_KEY` / `OPENAI_OCR_MODEL` | 사진 추출 시 필요                                                | 서버 전용 키와 이미지 추출 모델                       |
| `AVATAR_MANAGER_TOKEN`                | 매니저 게시 시 필요                                              | 64자리 소문자 hex 게시 토큰                           |

사진 추출 설정이 없으면 추출 기능만 503을 반환합니다. 추천 실행 환경이나 원본이 없으면 신규 루틴 생성이 실패하며 임의 추천으로 대체하지 않습니다. 미디어 검증 자료가 없으면 재생 URL이 제공되지 않을 수 있습니다. 실제 영상 검증 절차는 [미디어 안내](docs/recommendations/media-verification.md)를 참고하세요.

## 주요 명령과 테스트

| 명령                                      | 용도                                             |
| ----------------------------------------- | ------------------------------------------------ |
| `npm run start:dev` / `start:debug`       | 개발·디버깅 서버, Prisma Client 자동 생성        |
| `npm run build` / `start:prod`            | Prisma Client 생성·빌드 / 빌드된 서버 실행       |
| `npm run db:generate` / `db:validate`     | Prisma Client 생성 / 스키마 검사                 |
| `npm run db:migrate:dev -- --name 이름`   | 개발 DB에서 새 마이그레이션 작성                 |
| `npm run db:migrate:deploy` / `db:status` | 커밋한 마이그레이션 적용 / 상태 확인             |
| `npm run auth:secret` / `auth:cleanup`    | 로컬 키 생성 / 만료 세션·토큰·요청 제한 정리     |
| `npm test` / `test:watch` / `test:cov`    | 단위 테스트 / 감시 실행 / 커버리지               |
| `npm run test:e2e`                        | 실제 PostgreSQL 통합 테스트                      |
| `npm run format` / `format:check`         | 서식 정리 / 검사                                 |
| `npm run check`                           | 스키마·생성·서식·린트·타입·단위·통합 테스트·빌드 |

전체 검증에는 테스트 DB와 추천 Python 환경이 필요합니다.

```bash
export RECOMMENDATION_PYTHON="$PWD/.local/recommendation-venv/bin/python"
npm run check
```

통합 테스트는 `TEST_DATABASE_URL` 안에 임시 스키마를 만들고 마이그레이션을 적용한 뒤 자신이 만든 스키마만 정리합니다. 테스트 DB가 없거나 개발 DB와 같으면 실패합니다. 운동 루틴 통합 테스트는 실제 Python 원본과 CSV를 사용합니다. OCR 테스트의 외부 호출 대역은 실제 유료 모델 호출 검증과 구분합니다.

## 디렉토리 구조

```text
backend/
├── docs/                  # API 계약·정책·배포·검증 기록
├── prisma/
│   ├── schema.prisma      # 데이터 모델
│   └── migrations/        # 테이블·제약·기준 데이터 변경
├── scripts/               # DB·인증·추천 Python 연결·배포 도우미
├── src/
│   ├── auth/              # 인증·세션·가드
│   ├── users/             # 계정·프로필·설정·재화
│   ├── measurements/      # 기록·평가·사진 추출
│   ├── recommendations/   # 루틴·진행·추천 원본 호출
│   ├── groups/            # 그룹·미션·물 주기
│   ├── avatar/            # 상점·코디·게시 메타데이터
│   ├── curricula/         # 기존 운동 배정 내부 서비스
│   ├── database/          # DB 연결·readiness
│   ├── config/            # 환경·버전·요청 설정
│   └── health/            # 상태 확인 API
├── test/                  # 실제 DB와 HTTP 통합 테스트
└── requirements-recommendation.txt
```

## 기여하기

1. [공통 기여 규칙](../CONTRIBUTING.md)과 [백엔드 개발 원칙](AGENTS.md), 변경할 기능의 `docs/` 계약을 먼저 확인합니다.
2. 기능별 Nest 모듈·컨트롤러·서비스로 변경하고 필요한 모듈에서 `DatabaseModule`을 import합니다. ESM 로컬 import에는 `.js` 확장자를 사용합니다.
3. DB 변경은 Prisma 스키마와 새 마이그레이션을 함께 작성합니다. 생성된 Prisma 코드는 직접 수정하지 않습니다.
4. 인증된 본인 소유권, 생성 요청의 멱등성, 측정 수정·삭제의 revision, Decimal 문자열 정밀도를 보존합니다.
5. 알고리즘 변경은 `data-analysis/` 원본에서 진행합니다. 기준 자료에는 출처·버전·확인일을 기록하고 사용자 결과를 하드코딩하지 않습니다.
6. 영향받는 단위·통합 테스트와 API 문서를 갱신하고 `npm run check` 결과를 PR에 적습니다. 기존 계약을 깨는 변경은 새 API 버전으로 추가합니다.

백엔드 코드·설정·테스트·문서는 `backend/`에서 관리합니다. 프론트 연동이 필요한 변경은 요청·응답·오류·배포 순서를 함께 설명하세요.

## 배포와 상세 문서

의존성 설치·빌드, 해당 환경의 마이그레이션 적용, 서버 실행 순으로 준비합니다. 일반 서버 시작은 마이그레이션이나 샘플 사용자 생성을 자동으로 수행하지 않습니다. 운영에는 HTTPS origin과 서버 비밀 설정이 필요합니다.

추천을 실행하는 배포물에는 `dist/` 외에도 Python 환경, `scripts/recommendation-runner.py`, 읽기 전용 원본 모듈과 CSV가 필요합니다. 의상 PNG는 프론트 정적 파일로 제공하며 백엔드는 상품·가격·보유·코디 메타데이터를 관리합니다.

- [DB 설계·마이그레이션](docs/database.md), [API 버전 관리](docs/api-versioning.md)
- [추천 연결 경계](docs/recommendations/provenance.md), [추천 런타임·진행 계약](docs/recommendations/routines-api.md)
- [절대악력 환산](docs/absolute-grip.md), [스텝검사 참고 평가](docs/step-assessment.md), [평가 기준 조사](docs/research-fitness-criteria.md)
- [Vercel 배포](docs/vercel-neon-deployment.md), [Render 배포](docs/render-neon-deployment.md)
- [아바타 게시·배포](docs/avatar-production-publishing.md), [출력기 v2](docs/avatar-outputter-v2.md)
