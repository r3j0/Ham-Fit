# 통합 기능 수정 로컬 환경

2026-10-02, 최신 `origin/main`의 `d9fac1f`에서 `fix/root/integrated-group-settings` 브랜치를 생성했다. 기존 체크아웃의 미커밋 작업을 보존하고 `/private/tmp/project-health-integrated-group-settings`에서 FE와 BE를 별도 프로세스로 실행한다.

## 재사용한 환경

| 항목       | 설정                                             |
| ---------- | ------------------------------------------------ |
| FE         | `http://localhost:3000`                          |
| BE         | `http://localhost:3001/api/v1`                   |
| PostgreSQL | 기존 개발 클러스터 `127.0.0.1:15432`             |
| 개발 DB    | `project_health`                                 |
| 테스트 DB  | `project_health_test`, 실행별 임시 스키마        |
| Node       | 기존 설치의 26.7.0                               |
| Python     | 기존 `backend/.local/recommendation-venv` 재사용 |

기존 FE·BE 서버를 종료한 뒤 최신 main 기반 코드를 같은 포트에서 다시 실행했다. 기존 의존성과 Git에서 제외된 로컬 환경변수를 재사용하며 FE의 `NEXT_PUBLIC_API_BASE_URL`은 로컬 BE 주소다. BE의 추천 소스·영상 CSV 경로는 통합 작업 디렉터리의 `data-analysis` 원본을 가리킨다. DB 비밀번호와 인증 키는 문서나 Git에 기록하지 않는다.

## 실행

각 서버는 별도 터미널에서 실행한다. 기존 동일 포트 서버가 있다면 해당 실행 터미널에서 먼저 종료한다.

```bash
cd /private/tmp/project-health-integrated-group-settings/backend
nvm use 26
npm run db:migrate:deploy
npm run start:dev
```

```bash
cd /private/tmp/project-health-integrated-group-settings/frontend
nvm use 26
NEXT_BUILD_DIR=.next-local-test-server npm run dev -- --hostname 127.0.0.1 --port 3000
```

로컬 개발 DB에는 최신 main에 포함된 아바타 렌더 카탈로그와 정원 5명 마이그레이션까지 적용했다. 기존 사용자·그룹원·기록은 보존한다. 운영 DB에는 적용하지 않았다. 배포 시에는 정원 마이그레이션과 신규 overview API를 먼저 적용하고 FE를 배포한다.

## 검증 결과

- FE·BE lint, typecheck, build 통과.
- FE 단위 테스트 173개, BE 단위 테스트 363개 통과.
- BE 실제 PostgreSQL 통합 테스트 540개 통과. 51개 그룹의 일괄 조회, 그룹 수와 무관한 DB 조회 횟수, 소속 권한, 8자 비밀번호의 가입·변경, 동시 가입 정원, 기존 6명 그룹의 비파괴 마이그레이션을 포함한다.
- 관련 FE 브라우저 시나리오 25개 통과. 가입·계정 설정의 7자 거절/8자 허용, 정원 6명 거절/5명 허용, 그룹 전환 중 추가 요청 없음, 오류·재조회, 실제 BE와의 그룹·햄스터·닉네임·탈퇴·삭제 연동을 포함한다. 기존 그룹 관리 live 테스트의 프로필 검증 문구를 현재 UI에 맞췄다.
- 기존 로컬 개인 룰렛 활성화 설정에 맞춰 관련 브라우저 테스트에 `E2E_PERSONAL_ROULETTE=true`를 전달했다.
- BE `/health/ready`는 DB 정상인 200, FE 로그인 페이지는 200, 비인증 overview 요청은 401을 확인했다.

BE 로그는 작업 디렉터리의 `backend/.local/`에, FE 검증 로그는 `/private/tmp/project-health-integrated-fe-*.log`에 저장했다. 브라우저 스크린샷은 `frontend/test-results/`에 저장하며 Git에서 제외한다. 개발 모드 StrictMode에서는 최초 효과가 취소·재실행될 수 있지만 그룹 전환은 추가 API 요청을 하지 않는다.

## 그룹 설정·운동 아이콘 후속 검증

2026-10-02 후속 사용자 요청으로 그룹 설정의 정원 수정, 설정 내부 초대 코드 조회·복사, 그룹장용 대기 신청 팝업을 추가했다. 최근 7일 운동 표시는 영상 하나 이상 완료 시 씨앗, 전체 루틴 완료 시 해바라기이며 완료 시각의 한국 날짜를 사용한다. 연속 운동 일수는 기존 서버 기준을 유지한다.

- FE·BE lint, typecheck, 프로덕션 build 통과.
- FE 단위 174개, BE 단위 363개 통과.
- BE 실제 PostgreSQL 통합 541개 통과. 정원 변경 권한·1–5 범위·현재 인원 미만 축소 거절·축소와 동시 승인 경쟁을 검증했다.
- 관련 FE 브라우저 17개 통과. 실제 BE와의 정원 수정·초대·승인/거절·위임·탈퇴·삭제, 일반 그룹원의 초대 조회 권한, 팝업 닫기·초점 복원, 320–1280px 배치, 씨앗→해바라기 전환·새로고침·완료일 구분을 확인했다.

후속 실행 로그는 `/private/tmp/project-health-followup-*.log`, 스크린샷은 작업 디렉터리의 `frontend/test-results/`에 저장했다. 서버는 같은 localhost 3000/3001 포트에서 계속 실행한다.
