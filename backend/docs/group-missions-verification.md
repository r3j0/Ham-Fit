# 그룹 미션·룰렛 검증

2026-09-30 요청에 따라 backend 안에서 구현했다. 작업 전 `git status --short`는 깨끗했다. 개발·운영 DB 적용과 배포는 하지 않았다.

## 신규 검증

`src/groups/mission-policy.spec.ts`는 성장 N/3N/7N/14N 직전·도달, 6/7/14/20/21회 권 계산, 모든 확률 구간의 양끝, 확률 합계, 잘못된 정책 버전·금액·확률·난수를 검사한다. 운영은 crypto 난수를 사용하며 테스트만 생성자를 통해 결정적 난수를 주입한다.

`test/group-missions.e2e-spec.ts`는 실제 PostgreSQL에서 다음을 검사한다.

- 최소 인원·현재 그룹장 권한·동시 시작·동일/상이 키·고정 스냅샷·활성 회차 DB unique.
- 부분 루틴 제외, 전체 완료 1회, 여러 기기/키/기존 배정 경로 경쟁, 모든 유효 그룹 반영과 신규 참여 불가 그룹 제외.
- 실제 원본 이벤트로 불연속 28회 누적 및 모든 성장 경계·마지막 기여·완료 후 추가 기여 제외.
- 어제 스트릭 표시 유지·조회 부작용 없음·시작 전/무회차 완료 재전송·도입 전 완료와 내부 배정 제외.
- 서버 KST 자정, 클라이언트 occurredAt 소급 방지, 만료 새 이벤트 거절과 정확한 기존 키 재전송.
- 도중 가입·탈퇴·퇴출·재가입, 탈퇴/승인 경쟁, N/기여 보존, 1명 회차 유지, 위임 유지, 계정 삭제 익명화.
- 동시 마지막 기여와 권 발급 1회, 같은 날 새 회차 중복 사용 금지, 21/14/7회 발급과 완료 전 탈퇴 제외.
- 완료 후 기존 권 영구 무효화, 다음 회차 이후 이전 권 보관, 원래 회차의 1–6회 기여자 포함과 0/신규/재가입자 제외.
- 모든 개인/단체 결과의 실제 UserCurrency 지급, 같은 권/키/다른 키 경쟁, 저장된 결과·수령자 재전송, 본인 권 소유권, 지급 이벤트 unique.
- 두 번째 수령자 지급 실패 주입의 전체 롤백, 잔액 상한, 상점 구매 경합과 개인 거래 합계.
- 룰렛/탈퇴·퇴출·삭제 경쟁, 그룹 삭제 시 미션/권 삭제 및 개인 완료/달성·기지급 재화/거래 보존.
- 한 그룹 기여 INSERT 실패 주입 시 원본 완료/이벤트/개인 달성/모든 그룹 기여의 전체 롤백과 재시도.
- 계정 삭제 후 과거 지급 명세 익명화와 후속 단체 대상 제외, 페이지네이션, HTTP v1 인증/CSRF/캐시/strict 입력/불필요 API 부재.

경쟁/룰렛 테스트의 완료 직전 상태는 실제 DB에 달성·기여 원장 fixture를 저장해 준비하며 마지막 완료는 운영 운동 트랜잭션으로 실행한다. 별도 28회 누적 검사는 모든 기여를 실제 원본 운동 이벤트로 실행한다. DB 제약·경쟁·롤백을 mock만으로 검증하지 않는다. 기존 단일 운동의 응답 계산은 해당 기존 테스트 방식과 동일한 명시적 테스트 대역이며 데이터 팀 알고리즘 복사/재구현이 아니다. 전체 회귀의 신규 루틴 추천은 준비된 실제 Python을 실행한다.

`test/group-missions-migration.e2e-spec.ts`는 이전 마이그레이션만 적용한 격리 스키마에 기존 사용자·그룹·멤버십·개인 완료·재화·거래·코디를 저장한 후 신규 SQL을 적용한다. 기존 행이 동일하고 과거 달성/성장/권이 생성되지 않는지, 기존 그룹의 새 시작/탈퇴/삭제와 개인 완료/재화 보존을 검사한다.

## 실행 명령·결과

전용 `TEST_DATABASE_URL`의 `project_health_test` DB에서 runner가 임시 `test_*` 스키마를 만들고 23개 마이그레이션 적용·재적용 후 제거한다. `DATABASE_URL`을 개발 DB 대체값으로 쓰지 않는다. Python에는 `PYTHONDONTWRITEBYTECODE=1`과 준비된 `.local/recommendation-venv/bin/python`을 사용한다.

```bash
PYTHONDONTWRITEBYTECODE=1 RECOMMENDATION_PYTHON=.local/recommendation-venv/bin/python npm run check
```

미디어 동시 변경 이전의 `npm run check`: exit 0, 전체 통과. 이후 동시 변경을 보존한 현재 코드도 아래처럼 개별 검사를 재실행했다.

| 검사                                          | 결과                                              |
| --------------------------------------------- | ------------------------------------------------- |
| `npm run db:validate` / `npm run db:generate` | Prisma 스키마 검증·클라이언트 생성 통과           |
| `npm run format:check`                        | 전체 backend 서식 통과                            |
| `npm run lint`                                | 타입 인식 린트, 경고 거절 설정 통과               |
| `npm run typecheck`                           | 타입 검사 통과                                    |
| `npm test`                                    | 21개 파일, 328개 단위 테스트 통과                 |
| `npm run test:e2e`                            | 24개 파일, 475개 실제 PostgreSQL 통합 테스트 통과 |
| `npm run build`                               | Prisma 생성·Nest 빌드 통과                        |
| `git diff --check`                            | 공백/패치 검사 통과                               |

신규 통합은 2개 파일 41개 테스트다. 개인 기여 6/7/14/20/21회의 권 발급을 각각 실제 DB에서 확인하고, 계정 행 잠금과 그룹 룰렛 잠금의 교착을 의도적으로 만들어 전체 트랜잭션 재시도·권 소비/지급 1회·원장 보존을 검증했다. 미래 완료 시각이 들어 있는 기존 항목은 활동 집계와 동일하게 제외한다. 기존 단일 운동의 P2002 재시도는 유지하되, 교착/직렬화 재시도는 공통 helper에서 처리하여 중첩 재시도를 피했다.

로그는 로컬 `backend/.local/group-missions-check.log`, `group-missions-current-unit.log`, `group-missions-current-e2e.log`에 보관했다. 모든 검증 대상이 통과했으며 요청된 검사 중 환경 문제로 미실행한 항목은 없다.

선행 검사: Prisma 검증/생성·타입·린트 통과, 신규 통합 2개 파일 34개 테스트 통과, 기존 그룹 회귀 18개 통과. 최초 로컬 DB 연결은 샌드박스 EPERM으로 차단되어 허용된 전용 DB 연결로 재실행했다. 회귀에서 발견된 adapter 내부 교착 SQLSTATE 누락을 수정하고, 초기 테스트 fixture의 기존 영상/계산기 설정을 정정했다. 기존 pg 동시 query deprecation 경고는 기능 실패와 별도로 남는다.

## 동시 변경 보존과 재검증

마지막 검사 뒤 미디어 기능의 동시 변경이 나타났다. 이 작업에서 작성하지 않은 `.env.example`, `nest-cli.json`, `src/recommendations/media.ts`, `src/recommendations/media.spec.ts`, `src/recommendations/media-reports/`의 두 JSON 및 `docs/recommendations/media-verification.md`는 수정/되돌림 없이 보존했다. 잠시 `media.spec.ts`의 전체 서식 검사가 실패했으나 이후 해당 변경이 정리된 현재 상태의 전체 서식 검사도 통과했다.

동시 변경을 포함한 현재 코드에서 린트·타입을 다시 확인하고, 허용된 로컬 환경에서 단위 332개, 전용 PostgreSQL 통합 475개와 빌드를 다시 통과했다. 추가 단위 실행의 최초 로컬 listen EPERM은 샌드박스 제한이었으며 재실행은 통과했다. 이 동시 변경 파일들은 아래 그룹 미션 구현 파일 목록과 구분한다. 저장소 밖/보호 디렉터리 변경은 없으며 이 작업의 개발·운영 DB 미적용/미배포 원칙도 유지했다.

## 변경 파일

- 신규 운영 코드: `src/database/transaction-retry.ts`, `src/groups/mission-policy.ts`, `src/groups/mission-contributions.ts`, `src/groups/group-missions.service.ts`, `src/groups/group-missions.controller.ts`.
- 기존 연동: `src/groups/groups.module.ts`, `src/groups/groups.service.ts`, `src/recommendations/workout-routines.service.ts`, `src/recommendations/recommendations.service.ts`, `src/avatar/avatar.service.ts`, `src/auth/auth.service.ts`, `src/database/database.service.ts`.
- DB: `prisma/schema.prisma`, `prisma/migrations/20260930000400_group_missions/migration.sql`.
- 테스트: `src/groups/mission-policy.spec.ts`, `test/group-missions.e2e-spec.ts`, `test/group-missions-migration.e2e-spec.ts`.
- 문서: `README.md`, `docs/group-missions.md`, `docs/group-missions-verification.md`, `docs/groups-api.md`, `docs/groups-verification.md`, `docs/activity-streaks.md`, `docs/avatar-shop-api.md`, `docs/api-versioning.md`, `docs/database.md`, `docs/recommendations/expired-routine-playback.md`.

## 미실행 범위와 보존 확인

개발·운영 DB 마이그레이션, 실제 배포, 프론트 화면 연결은 요청대로 실행하지 않는다. 테스트는 전용 로컬 PostgreSQL이며 운영 부하 테스트/운영 외부 기기 실측은 포함하지 않는다. 최종 `git diff`/`git status` 및 작업 전 캡처한 backend 밖 tracked/non-ignored 파일 330개의 SHA-256 목록을 비교했다. 변경·신규·삭제가 모두 0이며 frontend/, data-analysis/, data-anaylsis/ 및 저장소 루트에 이 작업으로 생긴 변경이 없다. 알고리즘과 원본 데이터는 읽기만 하고 Python 캐시를 만들지 않는다.
