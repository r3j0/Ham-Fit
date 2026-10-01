# Render Free + Neon Free 배포

2026-10-01 기준. GitHub 저장소는 `https://github.com/r3j0/Ham-Fit`, FE origin은 `https://ham-fit.vercel.app`이다. 기존 로컬 DB의 회원·측정·운동 이력은 이전하지 않는다. 원본 Python과 CSV는 저장소의 `data-analysis/` 경계를 유지한 채 컨테이너에 읽기 전용으로 포함한다.

## 먼저 사용자가 할 일

1. [Neon Console](https://console.neon.tech)에 GitHub 계정으로 로그인하고 **Free** 프로젝트 `ham-fit`을 만든다. PostgreSQL **17**, AWS **Singapore**를 선택한다. Render 지역과 가깝게 맞춘다.
2. 데이터베이스는 기본 `neondb`를 사용해도 된다. **Connect**에서 연결 문자열을 복사한다. 초기 단일 서버 배포는 **Connection pooling을 끈 직접 연결**로 설정하고 `sslmode=require` 옵션을 유지한다.
3. 비밀번호가 포함된 연결 문자열을 채팅이나 GitHub 코드에 붙이지 않는다. 백엔드의 Git 제외 파일 `.env.render`에서 **DATABASE_URL** 빈 값에 넣는다. 로컬 개발 `.env`는 변경하지 않는다.
4. [Render Dashboard](https://dashboard.render.com)에 로그인하고 GitHub 저장소 `r3j0/Ham-Fit` 접근을 허용한다. 워크스페이스는 무료 **Hobby**, 서버 인스턴스는 별도로 **Free**를 선택한다.

## DB 최초 적용

배포 파일이 있는 백엔드 체크아웃에서 실행한다. 이 명령은 `.env.render`의 Neon URL을 해당 프로세스에만 적용하며 로컬 개발 설정을 바꾸지 않는다. Node 24.15 이상 또는 26.x가 필요하다.

```bash
cd backend
npm ci
node --env-file=.env.render node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.render node_modules/prisma/build/index.js migrate status
```

`migrate deploy`가 모두 성공한 후 Render 서버를 시작한다. 운영에는 `migrate dev`, `migrate reset`, `db push`를 사용하지 않는다. 최초 DB는 저장소의 전체 마이그레이션과 실제 기준 카탈로그만 적용하며 예시 사용자 데이터를 넣지 않는다.

## Render Web Service 설정

**New → Web Service → 연결한 GitHub 저장소**로 생성한다.

| 항목                         | 값                                                       |
| ---------------------------- | -------------------------------------------------------- |
| Name                         | `ham-fit-api` (중복이면 다른 이름 가능)                  |
| Branch                       | 배포 파일을 올린 BE 브랜치. main 병합 후 `main`으로 변경 |
| Region                       | Singapore                                                |
| Language / Runtime           | Docker                                                   |
| Root Directory               | **빈 값**                                                |
| Dockerfile Path              | `backend/Dockerfile`                                     |
| Docker Build Context         | `.` (저장소 루트)                                        |
| Docker Command               | 빈 값; Dockerfile의 CMD 사용                             |
| Instance Type / Compute Plan | **Free**                                                 |
| Auto-Deploy                  | 초기에는 **Off**                                         |
| Health Check Path            | `/api/v1/health`                                         |

**Root Directory를 backend로 지정하면 안 된다.** 형제 폴더 `data-analysis/`의 원본 파일을 Docker 빌드에서 읽어야 한다. Dockerfile과 모든 새 배포 설정은 backend 안에 둔다. `backend/Dockerfile.dockerignore`가 Git, FE, 개발 DB, `.env*`, 로컬 node_modules를 빌드 컨텍스트에서 제외한다.

Environment에 아래 값을 등록한다. `.env.render`에서 준비된 값들을 복사할 수 있다.

| 변수                     | 값                                               |
| ------------------------ | ------------------------------------------------ |
| NODE_ENV                 | `production`                                     |
| PORT                     | `10000`                                          |
| FRONTEND_ORIGIN          | `https://ham-fit.vercel.app` (**마지막 / 없음**) |
| DATABASE_URL             | Neon의 직접 연결 문자열                          |
| AUTH_JWT_SECRET          | `.env.render`의 새 배포 전용 64자리 키           |
| AUTH_ACCESS_TTL_SECONDS  | `900`                                            |
| AUTH_REFRESH_TTL_SECONDS | `604800`                                         |
| AUTH_COOKIE_SAME_SITE    | `none`                                           |

Python 실행 파일·원본 소스·CSV·영상 검증 보고서 경로는 Dockerfile에 이미 설정했다. 개발 Mac의 `/Users/...` 경로를 등록하지 않는다. `TEST_DATABASE_URL`은 서버에 등록하지 않는다. OCR을 사용할 때만 기존 계약에 맞는 OPENAI_API_KEY와 OPENAI_OCR_MODEL을 별도로 등록한다.

신뢰 프록시는 기본값이 빈 목록이다. 실제 프록시 CIDR을 확인하기 전 임의 주소나 모든 주소 신뢰를 설정하지 않는다. 기본값에서는 프록시 IP 기준으로 요청 제한이 공유될 수 있으므로 다중 사용자 테스트 때 확인한다.

## 배포 후 확인과 FE 연결

Render가 발급한 `https://서비스명.onrender.com` 주소로 확인한다.

```bash
curl https://서비스명.onrender.com/api/v1/health
curl https://서비스명.onrender.com/api/v1/health/ready
```

두 요청이 200이어야 한다. 이어서 가입·로그인·측정 저장·`POST /api/v2/workout-routines/today`·영상 재생·진행 저장·전체 완료 씨앗과 영수증 API를 실제 입력으로 확인한다. 프로세스 health는 DB와 Python 동작 전체를 보장하지 않는다.

FE 담당자가 Vercel의 `NEXT_PUBLIC_API_BASE_URL`을 `https://서비스명.onrender.com/api/v1`로 설정하고 FE를 다시 배포한다. 루틴은 기존 FE의 v2 경로 구성에 따라 호출한다. 브라우저에 DB URL이나 JWT secret을 등록하지 않는다. Vercel과 Render 기본 도메인은 서로 다른 사이트이므로 `SameSite=None; Secure`를 사용하지만, 브라우저의 제3자 쿠키 차단 설정에서는 갱신이 제한될 수 있다. 새로고침·토큰 갱신·로그아웃도 확인한다.

## GitHub CI/CD 활성화

`backend/deploy/github-actions.yml`을 `.github/workflows/backend-render.yml`로 등록한다. 저장소의 BE 작업 경계 때문에 루트 파일은 자동 변경하지 않고 설치할 템플릿을 제공한다. 템플릿은 PR와 main에서 Node/Python 검사, PostgreSQL 17 통합 테스트, 원본 추천, Docker 빌드와 512MB/1CPU 추천 검증을 수행한다. 합산 웹 서버 메모리와 실제 동시 요청 성능은 배포 환경에서 추가 확인한다.

GitHub **Settings → Environments → production**을 만들고 main만 배포하도록 제한한 뒤 다음 **Environment secrets**를 등록한다.

- `NEON_DATABASE_URL`: 최초 적용에 사용한 직접 연결 문자열.
- `RENDER_DEPLOY_HOOK_URL`: Render 서비스 **Settings → Deploy Hook**에서 복사한 비밀 URL.

main 검증 성공 후 마이그레이션과 해당 커밋 SHA의 Render 배포 요청을 실행한다. Render Auto-Deploy는 **Off**를 유지한다. Hook 성공은 배포 접수이며 완료가 아니다. Render **Deploys**에서 **Live**와 커밋을 확인한 뒤 위 상태/API 검증을 수행한다. DB 변경은 기존 서버에서도 동작할 수 있는 순서로 설계하며 DB 상태는 코드 롤백만으로 되돌아가지 않는다.

CI는 별도 임시 PostgreSQL을 사용하므로 테스트 사용자나 삭제 작업이 서비스 Neon DB에 들어가지 않는다. 불필요한 빌드를 줄이도록 BE·원본 추천 파일 변경에만 동작한다. 저장소는 공개이므로 표준 GitHub runner의 실행 시간이 무료이고, Render 빌드는 별도 무료 할당량을 사용한다.

## 영상 검증 결과와 실행 확인

Linux Git 체크아웃의 CSV는 LF이고 로컬 Mac 체크아웃은 CRLF여서 파일 SHA가 다르다. 배포 보고서는 **Git에 커밋된 CSV 바이트**를 별도 임시 파일로 읽어 실제 영상 HTTPS·Range·MP4·길이를 다시 검증해 생성한다. 원본 CSV나 알고리즘은 수정하지 않는다.

컨테이너 빌드와 시작 때 `scripts/verify-deployment.mjs`가 정확한 CSV SHA, 전체 재생 증거, Python import와 고정 라이브러리 버전을 확인한다. 실패하면 시작을 중단한다. 테스트용 입력은 `test/fixtures/deployment-routine.json`에 있으며 운영 이미지에 포함되지 않는다. Docker 검증에서는 읽기 전용으로 마운트한다. 사용자 결과나 DB에는 저장하지 않는다.

로컬 Docker 검증 명령은 배포 파일 커밋 후 저장소 루트에서 실행한다. Git archive로 커밋된 LF 바이트를 사용하여 Mac의 줄바꿈 변환에 영향을 받지 않는다.

```bash
git archive HEAD backend data-analysis/src/recommendation_v2.py data-analysis/data/processed/workout_videos_v2_complete.csv | docker build -f backend/Dockerfile -t ham-fit-api -
docker run --rm --memory=512m --cpus=1 --env-file backend/.env.render -p 10000:10000 ham-fit-api
```

## 무료 조건과 비용

Render Free는 15분 유휴 후 중지되고 다음 시작에 약 1분이 걸릴 수 있다. 파일 시스템은 임시이므로 런타임에서 생성한 파일을 영구 저장소로 사용하지 않는다. 영상 검증 결과는 이미지에 포함한다. 카드 미등록 시 무료 대역폭 초과는 서비스 제한으로 이어지고, 등록된 결제 수단이 있으면 추가 요금이 발생할 수 있으므로 무료 사용량을 확인한다. AI OCR의 외부 API 요금은 호스팅 무료 할당량에 포함되지 않는다.

공식 확인 자료:

- [Render Docker](https://render.com/docs/docker)
- [Render monorepo](https://render.com/docs/monorepo-support)
- [Render 무료 제한](https://render.com/docs/free)
- [Render Deploy Hook와 GitHub Actions](https://render.com/docs/deploy-hooks)
- [Neon 프로젝트 시작](https://neon.com/docs/get-started-with-neon/signing-up)
- [Neon 연결](https://neon.com/docs/connect/connect-from-any-app)
- [Prisma 7 운영 마이그레이션](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production)
