# 모두채력 프론트엔드

모바일 중심의 국민체력100 측정·운동 기록 웹앱입니다. 이메일 가입·로그인·로그아웃, 생년월일 프로필, 본인 측정 기록 CRUD, 하루 한 영상 추천, 운동 재생·이어하기·명시적 완료와 이력을 실제 백엔드에 연결합니다. 메인(`/`)은 오늘 운동, 내 프로필(`/account`)은 생년월일과 측정·운동 이력의 진입점입니다. 하단 `메인 / 내 프로필` 구조를 유지합니다. 인증 만료 후 같은 계정으로 로그인하면 측정 또는 운동 화면으로 돌아갑니다.

승인된 시안의 색상·서체·2단계 측정 입력 흐름을 적용했습니다. 캐릭터는 `components/ui.tsx`의 `ArtworkSlot`으로 위치만 잡고, 로고는 임시 서비스명을 텍스트로 표시합니다. 실제 이미지 확정 시 이 자리를 교체하면 됩니다. 그룹·코인·캐릭터 성장·OCR 화면·등급 자동 계산 표시는 후속 범위입니다. 운동 기능의 계약과 검증 범위는 [운동 연동 문서](WORKOUTS.md)에 있습니다.

## 로컬 실행

프론트와 백엔드 모두 Node.js 24.15 이상인 24 LTS 사용을 권장합니다. PostgreSQL과 인증·측정 API가 포함된 백엔드가 먼저 실행되어야 합니다.

운동 기능은 백엔드 PR #9의 `8d09df968fdcdac9ba6a10639bce19b1fad27bbc` 계약을 사용합니다. 해당 PR이 아직 합쳐지지 않았다면 저장소 루트에서 별도 체크아웃으로 실행합니다. 해당 경로가 이미 있다면 새로 만들지 말고 기존 체크아웃의 커밋과 로컬 변경을 먼저 확인합니다.

```bash
git fetch origin pull/9/head
git worktree add --detach ../project-health-backend FETCH_HEAD
cd ../project-health-backend/backend
npm ci
cp .env.example .env
npm run db:local:start
npm run auth:secret
npm run db:migrate:deploy
npm run build
node scripts/recommendation-import-catalog.mjs
node scripts/probe-workout-media.mjs data/recommendation/source/data-analysis/data/processed/workout_videos.json data/recommendation/source/data-analysis/data/processed/workout_videos.csv .local/recommendation/media-verification.json
npm run start:dev
```

로컬 PostgreSQL 실행 전 해당 백엔드의 README에 안내된 PostgreSQL 설치 조건을 확인하세요. 백엔드의 `FRONTEND_ORIGIN`은 `http://localhost:3000`으로 설정합니다. 기존 `.env`가 있으면 복사로 덮어쓰지 않습니다. 운영 데이터베이스를 로컬 검증에 사용하지 않습니다.

영상 검증 파일은 Git에 포함되지 않습니다. 파일이 없으면 추천은 가능해도 영상은 재생 불가로 표시됩니다. 검증 파일 갱신 후에는 백엔드를 재시작합니다. 원본 소스가 줄바꿈 변환 등으로 변경되면 검사기는 고정 해시 불일치로 거절하므로 원본 바이트를 유지해야 합니다.

다른 터미널에서 이 저장소의 `frontend/`로 이동합니다.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

[http://localhost:3000](http://localhost:3000)에서 직접 계정을 만들고 기록을 등록할 수 있습니다. 예시 계정이나 측정값을 자동 생성하지 않습니다.

- `NEXT_PUBLIC_API_BASE_URL`: **브라우저에서 직접 접근할** 백엔드 주소. 기본값 `http://localhost:3001/api/v1`이며 `/api/v1`까지 포함합니다. 이전 `BACKEND_API_URL` 설정은 사용하지 않습니다.
- Next.js API rewrite를 사용하지 않습니다. 브라우저가 백엔드의 CORS·CSRF·쿠키 계약으로 직접 통신하므로 모든 사용자가 프론트 서버 IP의 인증 제한을 공유하지 않습니다. 프론트 주소에서 `/api/v1/...`을 호출하면 404이며, API 주소를 사용해야 합니다.
- 로컬에서는 프론트와 API 모두 `localhost`를 사용합니다. `127.0.0.1`과 섞으면 쿠키의 사이트 조건이 달라집니다. 프론트 주소를 바꾸면 백엔드 `FRONTEND_ORIGIN`도 정확하게 맞춰야 합니다.
- 공개 API 주소는 브라우저 번들에 빌드 시 포함됩니다. API 주소 변경 시 다시 빌드하며, 배포 빌드에서는 실제 공개 주소를 지정합니다. 토큰이나 비밀값을 `NEXT_PUBLIC_` 환경 변수에 넣지 않습니다.
- 배포는 `https://app.example.com`과 `https://api.example.com/api/v1`처럼 같은 사이트의 HTTPS 구성을 사용합니다. 백엔드는 `NODE_ENV=production`, `FRONTEND_ORIGIN=https://app.example.com`, `AUTH_COOKIE_SAME_SITE=lax`로 설정합니다. CORS는 credentials·CSRF 헤더·ETag 노출을 허용해야 하며 현재 백엔드가 이를 제공합니다. 서로 무관한 도메인의 쿠키는 브라우저의 서드파티 쿠키 정책에 막힐 수 있으므로 위 구성을 기준으로 합니다.
- 백엔드를 직접 노출하는 로컬 구성에서는 `TRUST_PROXY_CIDRS`를 비워 둡니다. 운영 API 앞에 별도 프록시가 있다면 실제 프록시 주소만 신뢰하도록 백엔드를 설정하고 프록시에서 외부 전달 IP 헤더를 정규화합니다. 임의의 클라이언트 전달 헤더를 그대로 신뢰하지 않습니다.
- 자동 로그인 유지는 Web Locks 지원 브라우저의 HTTPS 또는 localhost 환경을 전제로 합니다. 지원하지 않는 환경에서는 새로고침 후 다시 로그인합니다.

```bash
npm run build
npm run start
```

## API 연동 규칙

- Access token은 메모리에서만 보관하고 Refresh token은 서버의 HttpOnly 쿠키로만 사용합니다. 인증 POST에 CSRF 헤더를 보냅니다.
- 초기 접속·새로고침과 API의 인증 만료 응답에서 세션을 갱신합니다. Web Locks로 탭 간 인증 요청을 직렬화하고 BroadcastChannel로 로그인·로그아웃을 공유합니다.
- 명시적 로그아웃에서 인증 무효(401)를 받으면 정상 응답과 마찬가지로 로컬 인증·임시 입력을 정리하고 다른 탭에도 로그아웃을 알립니다. 만료된 Access Token과 Refresh 쿠키 부재가 겹쳐도 계정 화면에 남지 않습니다. 403·429·서버 오류·통신 실패에서는 입력과 인증 상태를 유지하고 오류를 표시하여 재시도할 수 있게 합니다.
- 검사명·단위·연령·수치 제한은 서버 카탈로그를 사용합니다. 수정 시 해당 기록에 저장된 카탈로그 버전을 사용합니다.
- 측정값은 숫자로 변환하지 않고 Decimal 문자열로 전송합니다. 공란은 제외하며 실제 `0`과 음수·소수 정밀도를 보존합니다. 등급은 사용자가 입력한 결과표 원문입니다.
- 생성은 요청 본문에 대응하는 `Idempotency-Key`를 유지합니다. 저장 결과를 알 수 없는 통신 오류가 나면 입력을 잠그고 같은 키·내용으로 재확인합니다. 이후 인증 갱신·요청 제한 오류가 발생해도 미확정 요청을 새 키로 바꾸지 않습니다. 키와 본문을 요청 전부터 임시 보관하여 새로고침·재인증 후에도 같은 요청을 이어갑니다.
- 화면을 떠났거나 세션·작업이 바뀌면 이전 저장·삭제 응답은 현재 입력과 화면 이동에 반영하지 않습니다. 임시 입력의 쓰기·삭제에는 현재 폼의 버전이 필요하며, 새 폼이 열린 뒤 이전 폼의 작업은 거절합니다. 서버 저장 여부가 불확실한 요청의 키·본문과 원래 ETag는 계속 보존합니다.
- 계정 상세 조회가 실패하거나 응답을 기다리는 중에도 로그아웃과 내 측정 기록 이동을 제공합니다. 계정 조회 오류와 로그아웃 오류는 각각 재시도할 수 있습니다.
- 수정·삭제는 상세 조회에서 받은 `ETag`를 `If-Match`로 전달합니다. PATCH의 `items`는 전체 목록입니다. 충돌 시 작성 중인 값을 보존하고 최신 기록을 확인하며, 명시적으로 선택하기 전에는 덮어쓰지 않습니다.
- 오류는 실패 상태와 재시도를 표시합니다. API 실패를 예시 데이터나 임의의 성공으로 대체하지 않습니다.
- 미저장 변경은 앱 링크 이동과 문서 종료에서 이탈 확인을 제공합니다. 날짜·나이·측정값·등급·진행 단계·원래 ETag를 계정과 기록별로 해당 탭의 `sessionStorage`에 보관하여 뒤로가기·앞으로가기·새로고침 및 같은 계정의 재인증 후 복원합니다. 수정 입력 복원 시 서버에서 새로 읽은 ETag로 조용히 바꾸지 않으므로 동시 수정 충돌을 계속 검사합니다.
- 임시 입력에는 비밀번호·인증 토큰을 넣지 않습니다. 일반 입력은 마지막 변경 후 24시간까지 복원하고, 미확정 요청은 결과 확인까지 유지합니다. 저장 성공·임시 입력 지우기·명시적 로그아웃·다른 계정 로그인 시 지웁니다. 저장소 사용이 차단된 브라우저에서는 메모리로 대체하여 같은 문서 내 화면 이동·재인증만 복원합니다. 탭 종료나 브라우저 데이터 삭제 후에는 복원을 보장하지 않으므로 저장 여부를 목록에서 먼저 확인합니다.

## 검증

```bash
npm run check
npm run format:check
```

`check`는 린트·타입 검사·입력 검증 단위 테스트·프로덕션 빌드를 실행합니다. E2E는 별도 실행입니다.

실제 PostgreSQL을 사용하는 **개발/테스트용 백엔드**와 프론트를 실행한 상태에서:

```bash
npx playwright install chromium
npm run test:e2e
```

기본 프론트 주소는 `http://localhost:3000`이고 `E2E_BASE_URL`로 바꿀 수 있습니다. API 주소를 바꿨다면 `E2E_API_BASE_URL`도 프론트 빌드의 `NEXT_PUBLIC_API_BASE_URL`과 맞춥니다. 테스트는 실행마다 `frontend-e2e-<uuid>@example.test` 계정과 측정 데이터를 만듭니다. 테스트 계정 삭제 API가 없어 데이터가 남으므로 전용 로컬 DB에서만 실행하세요. 오류 응답·응답 유실 시나리오 외에는 실제 API를 사용합니다. 인증 요청의 횟수 제한은 해제하지 않으며 회원가입의 429는 UI의 대기 시간을 지켜 재시도합니다.

가입·재로그인·갱신·로그아웃, 본인 접근 제한, 부분 저장·긴 소수·0·음수, 선택 정보 보존, 생성 응답 유실 재시도, 탭 간 수정/삭제 충돌과 동시 갱신, 연령 검증, 기간 필터, 카탈로그 장애 복구 및 모바일 너비를 검증합니다. Chromium의 모바일 뷰포트에서 확인하며 실제 iOS/Android 키보드 검증을 대체하지는 않습니다. 스크린샷과 실패 추적은 Git에서 제외된 `test-results/`, HTML 결과는 `playwright-report/`에 생성됩니다.

리뷰 회귀 테스트는 응답 유실→인증 갱신 429→새로고침에서 같은 생성 키 유지, 히스토리 이동·새로고침·재로그인 후 입력 복원, 로그아웃·계정 전환 시 임시 입력 폐기, 수정 입력 복원 후 기존 ETag로 충돌 검사, 브라우저의 공개 API 직접 호출을 검증합니다.

로그아웃 오류 응답을 주입하여 401에서는 모든 탭의 계정 화면·임시 입력이 정리되고, 403·429·503·통신 실패에서는 입력을 보존한 채 다시 로그아웃할 수 있는지도 검증합니다.

지연 응답 회귀 테스트는 첫 생성·수정 요청을 실제 서버에서 처리한 뒤 브라우저 응답만 보류합니다. 화면 이탈·재진입·동일 요청 재확인·새 입력 이후 첫 성공/실패 응답을 전달하여 초안과 경로가 유지되는지 확인합니다. 삭제 후 뒤로가기로 새 입력을 시작하는 경우와 계정 조회 실패·대기 중 로그아웃도 검증합니다.

## 파일 구성

- `app/`: 화면 경로·공통 스타일·레이아웃.
- `components/`: 인증 폼, 계정, 기록 목록·입력·상세, 항목 선택창과 공통 UI.
- `lib/session.ts`, `lib/http.ts`: 인증 상태·쿠키 갱신·요청·오류 처리.
- `lib/measurement-form.ts`: 입력 검증과 정밀도를 유지하는 요청 구성.
- `lib/measurement-drafts.ts`: 계정별·탭별 임시 입력 및 미확정 요청 복원·폐기.
- `lib/measurements.ts`, `lib/types.ts`: 측정 API·날짜 표시·응답 타입.
- `tests/unit/`, `tests/e2e/`: 입력 검증 단위 테스트와 실제 백엔드 연동 흐름 검증.

2026-09-20 재검증 기준: 백엔드 `main`의 `ce148fe193302725ce8dea136e1668cbb8a85f2c`와 Node.js 24.15.0. 백엔드의 `docs/auth-api.md`, `docs/measurements-api.md`, `docs/api-versioning.md`를 계약으로 사용합니다. 해당 커밋은 기존 DB 시작 시 준비 상태 검사와 동시 조회 일관성 수정을 포함합니다.
