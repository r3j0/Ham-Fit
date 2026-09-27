# 개인 맞춤 추천 BE 구현·검증 결과 — 2026-09-27

## 최종 범위

사용자의 작업 중 정정에 따라 **BE만 포함**한다. `feat/backend/personalized-recommendation`에서 `backend/` 코드·데이터·마이그레이션·테스트·문서를 변경했다. 시작점은 `31a0c2fd7bdc95b438377f6f5998c097d326be28`이며 작업 시작 당시 미커밋 변경은 없었다. `frontend/` 변경은 모두 작업 전 상태로 복원했다. FE 화면 연결·가입 필수 UI·실제 앱 브라우저 흐름은 이번 결과에 포함하지 않는다.

## 구현된 흐름

v1 가입의 선택 생년월일 또는 별도 `/users/me/profile` 보완 → 기존 측정 저장과 평가 재사용 → 명시적 `POST /workouts/today`로 사용자/KST 날짜당 한 영상 → 배정별 start/progress/pause/end/complete 이벤트 → 실제 재생 구간 합집합·대표 수행 결과 저장 → 상세/이력 복원과 확정 로그 기반 노출도 재계산. 미진행은 기록을 보존하고 엔진에서 제외한다. 중단 후 완료는 같은 대표 결과를 갱신한다.

신규 API 전체·오류·일자 전이는 [운동 API](workouts-api.md), 생년월일과 기존 인증 호환성은 [프로필 API](birth-profile.md)에 있다. 기존 운동량·운동 목적 설정, 측정 revision/If-Match/Decimal, 온보딩, 저장된 과거 평가를 유지했다.

## 실제 실행 결과

| 검사                                               | 결과                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run check`                                    | exit 0: Prisma validate/generate, format, lint, typecheck, 단위, PostgreSQL E2E, Nest build 전부 통과 |
| 단위 검사                                          | 17개 파일, 429개 통과                                                                                 |
| 격리 PostgreSQL E2E                                | 15개 파일, 310개 통과                                                                                 |
| `node --test scripts/probe-workout-media.test.mjs` | 9개 통과                                                                                              |
| 원본 Python 재실행                                 | 기존 61개 통과·3개 방어 검사 실패 재현, 새 결과 경로로 저장                                           |
| 수정 TS 3개 회귀                                   | 미래 이력, 합계 0, 합계 1.4 모두 통과                                                                 |
| Python/TS 대조                                     | 127개 수치·후보 집합 사례 통과, 최종 무작위는 후보 허용 범위로 검사                                   |
| 실제 카탈로그 TS 시뮬레이션                        | 연령 13/18/19/30/64 각각 21일, 총 105일 통과                                                          |
| `git diff --check`                                 | 통과                                                                                                  |

전체 검사 로그는 `backend/data/recommendation/validation/backend-check.log`에 있다. 새 `backend-integration-results.json`은 범위와 실행 결과를 기록한다. 기존 검증 폴더의 snapshot/results.json은 수정하지 않았다. source 파일은 고정 커밋·해시로 보존했다. 상세 재현 방법은 [출처·대조 문서](provenance.md)를 따른다.

DB 검사는 운영/개발 DB와 분리된 로컬 `project_health_test`의 매번 새 `test_*` 스키마에서 실행했다. 13개 마이그레이션의 최초 적용과 재적용, 과거 계정·측정·배정 보존, 소유권, 요청 키, 5개 동시 최초 요청의 RNG 1회 실행, 일별 유일성, 자정 이후 결과, 49.9%/50%, 명시적 완료, 반복·동시 기기·역순/미래 요청 등을 검사했다. 검사 후 임시 스키마를 제거한다. pg 드라이버가 순차화한 트랜잭션 내부 쿼리에 대한 deprecation 경고는 로그에 남아 있으나 검사 실패는 없다.

## 마이그레이션·카탈로그

신규 `20260927000100_daily_workouts`는 기존 데이터를 보존하며 nullable DATE 생년월일과 일별 배정·이벤트·불변 카탈로그를 추가한다. 검토한 대상 환경에서 `npm run db:migrate:deploy`, `npm run build`, `node scripts/recommendation-import-catalog.mjs` 순서다. 수입은 731개 전체 검증 후 트랜잭션으로 활성화하고 같은 버전 재실행은 재사용한다. 실제 테스트 DB에서 첫 수입과 재수입도 검증했다. 이 작업에서는 **운영 DB 적용·배포를 실행하지 않았다**.

## 미검증·외부 제한

731개 중 729개는 실제 HTTPS, byte Range, MP4 구조/영상 트랙/메타데이터 길이를 확인했다. `0CBNLH06S_00037.mp4`, `0CBPCCU5Q_00063.mp4`는 반복해서 302 `/error.html`을 반환한다. 카탈로그에서 제거하거나 다른 영상으로 대체하지 않고 `playbackUrl:null`, `playbackStatus:unavailable`을 제공한다. 두 소스는 제공기관의 복구 또는 이후 명시적인 콘텐츠 정책 결정이 필요하다.

컨테이너 메타데이터 검사는 전체 디코딩·음영상 재생 검증을 의미하지 않는다. 실제 브라우저 재생, 전체 FE 흐름, 전체 영상 파일 디코딩, 운영 배포 환경은 미검증이다. 직접 HTTPS를 사용하므로 별도 임의 URL 프록시는 없다. 상세 범위·MIME 오타·실측 차이는 [미디어 검증](media-verification.md)에 기록했다.

Notion 두 출처 페이지는 연결된 계정에서 404로 반환됐다. 고정 원본·검증 자료·사용자 확정 정책을 사용했으며 문서에 원본 URL은 보존했다. 제품 정책을 새로 임의 결정하지 않았다. 후속 FE 연동은 이 API 계약으로 별도 진행한다.
