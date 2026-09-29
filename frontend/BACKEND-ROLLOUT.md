# 최신 백엔드 프론트 연동

기준: `origin/feat/backend/personalized-recommendation`, `a29fa291297ba9c841199cbfa362b1265d4bd614` (2026-09-29).
현재 main의 프론트 화면·인증·계정별 저장 복구 구조를 유지한다. 백엔드와 data-analysis는 변경하지 않는다.

## 보유 운동 도구

`/account/preferences`에 10종 복수 선택과 없음(빈 배열)을 제공한다. 기존 운동량·목적과 함께 `GET/PATCH /users/me/preferences`에 연결하고, 변경한 필드만 전송한다. 저장 결과가 불명확하면 원래 PATCH를 유지하고 재시도하며, 계정·화면 변경 후 늦은 응답은 폐기한다. 설정 변경은 다음 신규 루틴 생성부터 적용된다.

백엔드 브랜치의 도구 UI·어댑터·검사를 기존 프론트에 적용했다. API에 ownedTools가 없으면 조회 오류를 표시하므로 DB 마이그레이션과 최신 API 배포가 먼저다.

검증: 린트·타입·단위 126개·프로덕션 빌드 통과. Chromium 관련 11개 통과(실제 최신 API 2개, 오류·복구·반응형 계약 9개). 실제 PostgreSQL은 이번 검증의 별도 임시 디렉터리/포트에만 생성했다. 새로고침·재로그인·별도 브라우저 복원, 전체 선택/해제, 사용자 격리와 기존 계정 정보 보존을 확인했다.

## 검증 환경

기존 개발 서버와 캐시 충돌을 피하기 위해 `NEXT_BUILD_DIR=.next-integration`을 지원한다. 기본 실행 경로는 기존 `.next`다. 검증 서버는 `NEXT_PUBLIC_API_BASE_URL=http://localhost:3101/api/v1`로 빌드하고 3100 포트에서 실행했다. 테스트의 `E2E_BASE_URL`과 `E2E_API_BASE_URL`은 각각 이 프론트와 API 주소를 사용한다. 실제 배포 환경과 DB는 변경하지 않았다.
