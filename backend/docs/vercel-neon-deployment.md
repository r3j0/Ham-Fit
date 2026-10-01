# Vercel Hobby + Neon 배포

2026-10-01 결정: Render 대신 Vercel에 백엔드를 시험 배포한다. 기존 Next.js FE 프로젝트와 별도 API 프로젝트를 사용한다. 추천 알고리즘과 CSV는 수정하지 않고 원래 `data-analysis/` 경로로 이미지에 읽기 전용으로 포함한다. Neon production의 초기 27개 마이그레이션은 이미 적용했다. 로컬 사용자 데이터는 이전하지 않았다.

## 배포 묶음과 프로젝트

Vercel Container Images와 Services는 현재 모든 플랜에서 제공하는 베타다. `backend/deploy/vercel.json`은 저장소 루트 빌드 컨텍스트를 사용하는 단일 API 서비스 템플릿이다. `backend/Dockerfile`에서 NestJS와 Python을 함께 실행한다. API의 `/api/v1` 및 `/api/v2` 경로를 유지한다.

백엔드의 저장소 작업 경계를 지키기 위해 루트나 FE에 Vercel 파일을 추가하지 않는다. 대신 커밋 후 다음 명령으로 Git의 원본 바이트를 임시 배포 디렉터리에 추출하고, 그 디렉터리 루트에 템플릿을 설치한다.

```bash
cd backend
node scripts/prepare-vercel.mjs
```

출력의 `deploymentDirectory`를 Vercel CLI의 `--cwd`로 사용한다. 묶음에는 backend와 원본 Python/CSV만 있고 FE, Git, 로컬 DB, `.env*`, node_modules는 포함되지 않는다. Mac의 CRLF 체크아웃이 아니라 Git의 LF CSV를 사용하므로 배포 영상 검증 보고서의 SHA와 일치한다. 출력 폴더가 비어 있지 않으면 덮어쓰지 않는다.

기존 FE `ham-fit`에 연결하지 말고 새 API 프로젝트 `ham-fit-api`에 연결한다. API 프로젝트의 빌드 루트는 배포 묶음의 루트이고 서비스 entrypoint는 `backend/Dockerfile`이다. Singapore `sin1`을 사용한다. Dockerfile의 `PORT`는 플랫폼 환경변수로 재정의 가능하다.

## 환경변수

Git 제외 파일 `backend/.env.render`에 준비된 배포 전용 값들을 동일하게 사용한다. 이름이 Render를 포함해도 값은 플랫폼 공통이다. 시험 배포에는 Preview, 운영 배포에는 Production에 다음 값을 등록한다.

- `NODE_ENV=production`
- `PORT=10000`
- `FRONTEND_ORIGIN=https://ham-fit.vercel.app`
- `DATABASE_URL`: 준비된 Neon production 직접 연결 문자열. SSL 옵션 유지.
- `AUTH_JWT_SECRET`: 준비된 배포 전용 키.
- `AUTH_ACCESS_TTL_SECONDS=900`
- `AUTH_REFRESH_TTL_SECONDS=604800`
- `AUTH_COOKIE_SAME_SITE=none`

연결 문자열과 JWT secret을 CLI 명령 인수, 공개 로그, Git 또는 FE에 넣지 않는다. Vercel 환경변수 입력에서는 표준 입력으로 전달한다. 개발용 `.env`와 로컬 서버는 변경하지 않는다. OCR이 필요할 때만 OPENAI_API_KEY와 기존 계약의 모델 값을 등록한다.

## 검증

Docker 빌드 중 원본 CSV의 272개 재생 증거와 Python 패키지를 검사한다. 추가 중간 단계에서 실제 추천 알고리즘을 테스트 전용 fixture로 실행한다. fixture는 최종 이미지에 남지 않고 어떤 DB에도 저장하지 않는다. 실행 결과 증거는 이미지의 `deploy/recommendation-verification.json`에 포함한다. 서버 시작 때 원본 파일과 Python 환경도 다시 검사한다.

배포 후 `/api/v1/health`와 `/api/v1/health/ready`를 확인한다. Preview의 Vercel Authentication을 유지하고 CLI `vercel curl`로 보호된 미리보기를 검사한다. 운영 입력이 없는 상태에서 임의 회원이나 측정 데이터를 서비스 DB에 넣지 않는다. 실제 사용자 API 검증은 사용자가 가입과 측정을 완료한 후 진행한다.

초기 요청, 이어지는 요청, 유휴 후 요청의 응답 시간을 기록한다. Preview 컨테이너는 유휴 30초, Production은 5분 뒤 축소된다. Vercel의 컨테이너 시작 시간과 Neon DB 재개 시간이 합쳐질 수 있으므로 상시 서버처럼 시작 지연이 없다고 가정하지 않는다.

## main과 CI/CD

시험 배포는 기능 브랜치의 검증용 스냅샷으로 가능하다. 운영 배포는 PR을 main에 병합하고 main의 커밋을 패키징한 뒤 진행한다. root Vercel 설정을 직접 찾는 Git 자동 배포에 이 템플릿을 연결하지 않는다. GitHub Actions에서 검증 → Neon `prisma migrate deploy` → 배포 묶음 생성 → Vercel CLI 배포 순서로 자동화할 수 있다. 루트 workflow 설치와 배포용 인증 정보 등록은 별도 활성화 단계다.

FE 담당자는 검증된 운영 API 주소 뒤에 `/api/v1`을 붙여 Vercel의 `NEXT_PUBLIC_API_BASE_URL`을 갱신하고 FE를 다시 배포한다. FE 코드나 데이터 알고리즘을 변경할 필요가 없다. 서로 다른 Vercel 기본 도메인을 사용할 때 토큰 갱신과 브라우저의 제3자 쿠키 차단도 실제로 확인한다.

## 무료 조건

Hobby는 개인·비상업용이며 월 Active CPU 4시간, Provisioned Memory 360GB-hours 등 계정의 무료 사용량 안에서 동작한다. 한도 초과 시 서비스 이용이 제한될 수 있다. 컨테이너도 요청이 없는 동안 자동 축소된다. OCR 외부 API 비용은 Vercel 무료 할당량과 별도다.

공식 확인 자료:

- [Container Images](https://vercel.com/docs/functions/container-images)
- [Services](https://vercel.com/docs/services)
- [Service configuration](https://vercel.com/docs/services/config-reference)
- [Hobby 조건](https://vercel.com/docs/plans/hobby)
- [Functions 제한](https://vercel.com/docs/functions/limitations)
