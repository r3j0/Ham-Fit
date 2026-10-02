# 🎨 햄피트 프론트엔드

햄돌이·햄콩이와 함께 체력을 기록하고 운동 습관을 만드는 Next.js 웹 애플리케이션입니다. 모바일 중심의 반응형 UI로 체력 리포트·운동 플레이어·그룹 미션·상점·프로필을 제공합니다.

[프로젝트 소개](../README.md) · [백엔드](../backend/README.md) · [API 연동 문서](BACKEND-INTEGRATION.md)

## 지원 기능

| 영역        | 제공 기능                                                                             |
| ----------- | ------------------------------------------------------------------------------------- |
| 가입·온보딩 | 이메일 가입·로그인, 닉네임·생년월일·캐릭터 설정, 첫 체력 기록 등록                    |
| 체력 기록   | 국민체력100 직접 입력, 사진 추출 결과 확인·저장, 성인 간이측정, 기록 조회·수정·삭제   |
| 체력 리포트 | 서버 평가 기반 6축 그래프, 종목별 등급·미평가 이유·기준 출처, 악력 환산·스텝검사 근거 |
| 오늘의 운동 | 맞춤 루틴·처방·유산소 안내, 영상 재생·진행 저장·이어하기, 완료 흐름과 보상 표시       |
| 운동 이력   | 주간·월간 달력, 날짜별 기록 상세, 완료한 운동 다시보기                                |
| 그룹        | 생성·가입·초대 코드·가입 신청 관리, 그룹원 캐릭터, 미션 성장·물 주기·룰렛             |
| 상점·옷장   | 실제 잔액·상품·보유 목록, 코디 미리보기·구매·대표 코디 저장                           |
| 프로필·알림 | 체력·활동 리포트, 운동량·목적·보유 도구 설정, 계정 변경·탈퇴, 개인·그룹 룰렛 진입     |

하단 메뉴는 `운동 / 상점 / 메인 / 내 그룹 / 내 프로필`로 구성합니다. 데이터가 없거나 조회에 실패하면 그 상태와 재시도를 표시합니다. 체력 등급은 서버 판정을 사용하며 프론트엔드가 임의로 계산하지 않습니다.

## 기술과 요구 환경

- Node.js: 백엔드와 함께 개발할 때 `^24.15.0 || >=26.0.0` 사용
- Next.js 16.3.5 App Router, React 19, TypeScript
- Tailwind CSS 4, Noto Sans KR, Lucide 아이콘
- Node.js 내장 테스트 러너, Playwright, ESLint, Prettier

의존성은 `package-lock.json`을 기준으로 설치합니다. 아래 명령은 모두 `frontend/`에서 실행합니다.

## 실행 방법

### 1. 백엔드 준비

같은 저장소의 [백엔드 실행 안내](../backend/README.md)에 따라 API·DB를 먼저 실행합니다. 신규 루틴 추천에는 Python 런타임과 데이터 분석 원본도 필요합니다.

### 2. 프론트엔드 실행

새 체크아웃에서 환경 파일을 한 번 복사한 뒤 실행합니다. 기존 `.env.local`이 있으면 현재 설정을 확인해 수정하세요.

```bash
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. 로컬 API 주소는 `http://localhost:3001/api/v1`이며 백엔드의 `FRONTEND_ORIGIN`은 `http://localhost:3000`과 일치해야 합니다. 브라우저 origin에 `localhost`와 `127.0.0.1`을 섞지 마세요.

### 3. 프로덕션 빌드 확인

```bash
npm run build
npm run start
```

`NEXT_PUBLIC_*` 값은 빌드 시 브라우저 코드에 포함됩니다. 변경 후에는 다시 빌드해야 합니다.

## 환경변수와 API 연결

| 변수                                    | 예시·기본 설정                 | 용도                                               |
| --------------------------------------- | ------------------------------ | -------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`              | `http://localhost:3001/api/v1` | 브라우저가 호출할 API 기본 주소                    |
| `NEXT_PUBLIC_DAILY_REWARDS_ENABLED`     | 예시 파일: `false`             | 완료 보상 영수증 UI. 해당 서버 계약 배포 후 활성화 |
| `NEXT_PUBLIC_PERSONAL_ROULETTE_ENABLED` | 예시 파일: `true`              | 개인 룰렛 연동                                     |
| `NEXT_BUILD_DIR`                        | `.next`                        | 개발 서버와 별도 검증 빌드의 출력 폴더 분리        |
| `E2E_BASE_URL`                          | `http://localhost:3000`        | Playwright 대상 프론트 주소                        |
| `E2E_API_BASE_URL`                      | 테스트 API 주소                | 실제 API를 사용하는 E2E 대상                       |

환경 파일 예시는 [.env.example](.env.example)을 참고하세요. 브라우저 공개 변수에는 DB 접속 정보·서버 키를 넣지 않습니다.

일반 API는 v1, 당일 운동 루틴은 v2 계약으로 연결합니다. 운영의 같은 origin 연결에서는 `NEXT_PUBLIC_API_BASE_URL=/api/v1`을 사용하고 새 빌드를 배포합니다. 현재 [next.config.ts](next.config.ts)의 `/api/:path*` rewrite는 `https://ham-fit-api.vercel.app/api/:path*`로 전달하므로 다른 API를 배포한다면 목적지 설정도 함께 확인하세요.

## 주요 화면

| 경로                                                      | 역할                                       |
| --------------------------------------------------------- | ------------------------------------------ |
| `/login`, `/register`, `/welcome`                         | 로그인·가입·첫 프로필과 캐릭터 설정        |
| `/onboarding`, `/onboarding/manual`, `/onboarding/photo`  | 첫 체력 기록 안내·직접 입력·사진 확인      |
| `/`                                                       | 캐릭터·그룹 현황·오늘의 운동·최근 7일 활동 |
| `/workout`                                                | 오늘 루틴 전체 목록과 운동 달력            |
| `/workout-routines/:routineId/items/:itemId`              | 루틴 운동 수행·진행 저장                   |
| `/workouts/history/:date`                                 | 날짜별 운동 기록                           |
| `/measurements`, `/measurements/new`, `/measurements/:id` | 측정 목록·추가·리포트                      |
| `/groups`, `/groups/:id`                                  | 그룹 생성·가입·상세·미션·설정              |
| `/shop`, `/shop/wardrobe`                                 | 상점과 보유 의상·코디                      |
| `/account`, `/account/settings`, `/account/preferences`   | 프로필·계정·운동 설정                      |
| `/account/notifications`, `/roulette/personal`            | 알림·룰렛 진입과 개인 추첨                 |

운동 다시보기는 저장된 완료 기록을 변경하지 않습니다. 과거 운동의 신규 수행 이벤트는 서버 정책에 따라 제한됩니다. 자세한 흐름은 [운동 연동 문서](WORKOUTS.md)를 참고하세요.

## 데이터·인증·조회 정책

- 측정값은 Decimal 문자열로 보내고 공란을 제외합니다. 원본 `reportedGrade`와 서버 종목별 `evaluation`, 6축 `axes`를 구분합니다.
- 생성 요청은 작업별 `Idempotency-Key`, 측정 수정·삭제는 조회한 ETag의 `If-Match`를 사용합니다. 저장 응답 유실·충돌 시 입력과 요청 키를 보존합니다.
- 계정·기록별 입력 초안은 탭의 `sessionStorage`에 보관합니다. 일반 초안은 24시간, 미확정 요청은 결과 확인까지 유지하며 로그아웃·계정 전환 때 정리합니다. 비밀번호·토큰·사진 바이트는 초안에 저장하지 않습니다.
- 인증 만료·로그아웃·계정 전환 후 늦게 도착한 응답은 무시합니다. 측정 변경과 다른 탭 변경 후 관련 데이터를 갱신합니다.
- 홈 운동 이력은 최근 7일, 달력은 표시 기간, 날짜 상세는 해당 날짜만 조회합니다. 보이는 탭에서 현재 이력·오늘 루틴은 5분, 알림은 1분, 그룹 현황은 2분 간격으로 갱신합니다. 과거 이력과 나머지 리소스는 진입·재시도·변경 후 갱신을 사용합니다.
- 의상 PNG·배치 카탈로그는 `public/hamsters/wardrobe/`의 정적 파일을 읽습니다. 해시 이미지·버전 번들은 immutable 캐시를 사용하고 상품·가격·보유·코디 메타데이터는 API로 조회합니다.

## 검증 방법

```bash
npm run check
npm run format:check
```

`check`는 ESLint·타입 검사·단위 테스트·프로덕션 빌드를 실행합니다. `format:check`는 앱·컴포넌트·라이브러리·테스트·주요 설정의 서식을 검사합니다.

E2E는 프론트 서버를 별도로 실행한 상태에서 진행합니다. 현재 Playwright 설정은 Chromium의 iPhone 13 환경을 기본으로 사용합니다.

```bash
npx playwright install chromium
npm run test:e2e
# 특정 기능만 확인
npm run test:e2e -- tests/e2e/bottom-navigation.spec.ts
```

실제 API 시나리오에는 분리된 로컬 테스트용 DB·백엔드와 올바른 `E2E_API_BASE_URL` 설정이 필요합니다. 일부 시나리오는 계정·측정·그룹을 생성·삭제하므로 운영 API를 대상으로 실행하지 않습니다. HTTP 계약 대역 시나리오는 화면·오류 처리를 검증하며 실제 OCR·서버 판정 검증과 구분합니다.

| 명령                              | 용도                                    |
| --------------------------------- | --------------------------------------- |
| `npm run dev` / `build` / `start` | 개발 서버 / 프로덕션 빌드 / 빌드 실행   |
| `npm run lint` / `typecheck`      | ESLint / Next 타입 생성·TypeScript 검사 |
| `npm test`                        | Node.js 내장 러너로 단위 테스트         |
| `npm run test:e2e`                | Playwright 시나리오                     |
| `npm run format` / `format:check` | 서식 정리 / 검사                        |

## 디렉토리 구조

```text
frontend/
├── app/              # App Router 페이지·레이아웃·아이콘
├── components/       # 리포트·운동·그룹·상점·캐릭터 UI
├── lib/              # HTTP·세션·API 계약·입력·표시 로직
├── public/           # 햄스터·의상·아이콘 정적 자산
├── tests/
│   ├── unit/         # 계약·변환·상태·자산 검증
│   ├── e2e/          # Playwright 화면·실제 API 시나리오
│   └── fixtures/     # 운영 데이터와 분리한 테스트 자료
└── next.config.ts    # API rewrite·응답 헤더·자산 캐시
```

## 기여하기

1. [공통 규칙](../CONTRIBUTING.md)과 [AGENTS.md](AGENTS.md)를 읽습니다. Next.js 코드를 수정할 때는 설치된 `node_modules/next/dist/docs/`의 관련 안내를 확인합니다.
2. 기존 디자인 토큰·레이아웃·재사용 컴포넌트를 따르고 모바일·데스크톱, 하단 메뉴·안전 영역·키보드 접근을 확인합니다.
3. API 변경은 요청·응답·오류 계약과 로딩·빈 상태·실패·재시도·세션 만료 처리를 함께 검토합니다. 사용자 결과나 성공 응답을 하드코딩하지 않습니다.
4. 영향받는 단위·E2E 검사를 실행하고 새 동작과 검증 범위를 PR에 기록합니다. 실제 API 검사와 계약 대역 검사를 구분합니다.
5. 의상 이미지·배치는 [아바타 매니저](../avatar-manager/README.md)의 가져오기·내보내기 흐름으로 변경하고 생성된 정적 자산을 함께 검토합니다.

## 상세 문서

- [백엔드 연동 계약](BACKEND-INTEGRATION.md), [운동 API 연동](WORKOUTS.md), [배포 순서](BACKEND-ROLLOUT.md)
- [수동 테스트 안내](MANUAL-TEST.md), [검증 기록과 한계](VERIFICATION.md), [추가 API 요청 규격](BACKEND-REQUESTS.md)
- [햄스터 출력 도구](HAMSTER-OUTPUTTER.md), [기존 마스코트 출력 API](components/mascot/README.md)
