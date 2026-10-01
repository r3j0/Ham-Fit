# 그룹 기능 검증·변경 파일

검증일: 2026-09-29. 작업 대상 `/Users/idonghyeon/project-health/backend`.

## 최종 실행 결과

| 검사                                                                           | 결과                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| `npm run db:validate`                                                          | 통과                                      |
| `npm run db:generate`                                                          | 통과, backend의 Git 제외 생성 코드만 갱신 |
| `npm run typecheck`                                                            | 통과                                      |
| `npm run lint`                                                                 | 경고 없이 통과                            |
| `npm run format:check`                                                         | 통과                                      |
| `npm test`                                                                     | 20개 파일, 283개 테스트 통과              |
| `RECOMMENDATION_PYTHON=.local/recommendation-venv/bin/python npm run test:e2e` | 18개 파일, 382개 테스트 통과              |
| `npm run build`                                                                | 통과                                      |
| `git diff --check`                                                             | 통과                                      |

신규 검증은 그룹 입력·스트릭 단위 테스트 4개, 실제 PostgreSQL 그룹 통합 테스트 18개다. 기존 인증·프로필·계정 삭제·개인 커리큘럼·측정·단일 영상·여러 운동 루틴 테스트도 함께 통과했다.

`project_health_test`의 실행별 임시 스키마에서 총 18개 마이그레이션을 적용했다. 두 번째 deploy에서 미적용 항목이 없음을 확인하고 테스트 종료 후 스키마를 정리했다. 새 그룹 마이그레이션은 1개다. 개발/운영 DB에는 적용하지 않았다.

초기 실행 문제와 해결:

- 샌드박스에서 PostgreSQL 접속과 기존 HTTP 단위 테스트의 loopback listen이 EPERM으로 차단되어 승인된 실행 환경에서 재검증했다.
- 기본 PATH의 Python으로 전체 통합 테스트를 실행했을 때 기존 추천 루틴 테스트 19개가 503으로 실패했다. 기존 문서의 준비된 backend 전용 `.local/recommendation-venv/bin/python`을 지정한 재실행에서는 **378개 전부 통과**했고, 재검토에서 4개를 추가한 최종 검사는 382개가 통과했다. Python 설치·알고리즘·데이터 파일 변경은 하지 않았다.
- 기존 pg 드라이버의 동일 client 동시 query 관련 deprecation 경고가 일부 기존 통합 테스트에서 출력된다. 검사 실패는 없다.

## 신규 PostgreSQL 통합 검증 범위

`test/groups.e2e-spec.ts`는 실제 Nest HTTP 서버와 실제 DB를 사용한다. 경쟁 조건은 같은 DB의 여러 동시 트랜잭션으로 실행하며, 인증·권한·입력/응답 검증은 HTTP 경로를 사용한다.

| 검증                  | 확인 내용                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| 생성                  | 생성자 즉시 그룹장, 단독 그룹 정원, 동일 키 동시 생성 한 번, 변경 payload 충돌, 코드 비노출                |
| 신청                  | 올바른 코드·잘못된 형식·없는 코드, 승인 전 접근 불가, pending 중복·기존 구성원 차단                        |
| 복수 그룹             | 동일 사용자의 복수 그룹 가입, 한 그룹 탈퇴가 다른 그룹 권한에 영향 없음                                    |
| 재신청                | 거절·퇴출 후 새 키 재신청, 퇴출 후 과거 승인 재시도가 재가입시키지 않음                                    |
| 권한                  | 일반 구성원/외부인의 모든 관리 경로 차단, 타 그룹 신청 ID 차단, 인증·CSRF, 개인정보 비노출                 |
| 정원·중복             | 마지막 자리 두 명 동시 승인 중 하나만 성공, 동일 신청 승인 8개 동시 재시도에서 멤버십·결과 알림 하나       |
| 신청 경쟁             | 동일 키 4개 동시 요청 결과 동일, 다른 키 같은 사용자 동시 신청 중 하나만 생성                              |
| 위임·탈퇴 경쟁        | 위임·대상 탈퇴·승인 동시 요청 후 그룹장 존재·정원·역할 일관성, 단독 그룹장 탈퇴와 승인 경쟁                |
| DB 불변식             | 비구성원 그룹장 설정·그룹장 멤버십 직접 삭제·중복 멤버십 금지, 계정 삭제 우회 차단                         |
| 즉시 차단·삭제        | 탈퇴/퇴출 후 상세·프로필·코드 차단, 마지막 구성원 탈퇴 시 그룹 삭제                                        |
| 알림                  | 그룹장 접수/신청자 결과 대상, 승인·거절 경쟁 한 결과, 재시도 중복 방지, 타인 읽음 처리 차단                |
| 트랜잭션 실패         | DB CHECK 제약으로 알림 저장 실패를 주입하여 멤버십·승인 상태·신청 생성 전체 롤백, 제약 해제 후 재시도 성공 |
| 삭제 범위             | 그룹/신청/멤버십/알림/생성 키 정리, 실제 완료한 개인 커리큘럼·재화·계정·세션·다른 그룹 보존                |
| 내부 쓰기             | 직접 동시 INSERT에도 capacity trigger로 정원 유지, 정원 축소 및 멤버십 이동 차단                           |
| 일반 구성원 계정 삭제 | 해당 사용자 멤버십·신청 삭제, 그룹 및 그룹장 보존                                                          |
| 프로필                | 실제 개인 완료 데이터로 KST 스트릭 2일 계산, 동일 날짜 중복 제거·배정일과 분리, 개인/그룹 프로필 일치      |
| 페이지                | 제한된 본인 그룹 페이지와 커서, 비공개 코드 응답 no-store                                                  |

## 미실행·미구현 범위

- 운영/개발 DB 배포·실제 클라이언트 UI 연결은 수행하지 않았다. 테스트 DB에서 서버/API 계약을 검증했다.
- 이 문서의 최초 그룹 관리 검증 당시에는 미션 원장이 없었다. 2026-09-30 후속 작업에서 구현과 실제 PostgreSQL 검증을 추가했다. 최신 결과는 [그룹 미션 검증](group-missions-verification.md)에 기록한다.
- 2026-09-30 후속으로 저장 대표 코디를 `profileCharacter`에 연결했다. [코디·상점 검증 기록](avatar-shop-verification.md)을 참고한다. 닉네임·스트릭·기존 그룹 접근 검사는 유지한다.

## 변경 파일 목록

아래 경로는 모두 `backend/` 기준이다. 기존 사용자 변경은 시작 시 없었으며 다른 디렉터리의 파일은 수정하지 않았다. 루트 설정·의존성·잠금 파일은 변경하지 않았고 신규 의존성/인프라도 추가하지 않았다.

| 구분              | 파일                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 모델              | `prisma/schema.prisma`                                                                                                              |
| 마이그레이션      | `prisma/migrations/20260929000400_groups/migration.sql`                                                                             |
| 그룹 구현         | `src/groups/group-input.ts`, `src/groups/groups.controller.ts`, `src/groups/groups.module.ts`, `src/groups/groups.service.ts`       |
| 알림 구현         | `src/notifications/notifications.controller.ts`, `src/notifications/notifications.service.ts`                                       |
| 공통 프로필       | `src/users/member-profile.ts`, `src/users/user-profile.controller.ts`, `src/users/user-profile.service.ts`                          |
| 모듈·DB·인증·캐시 | `src/app.module.ts`, `src/database/database.service.ts`, `src/auth/auth.service.ts`, `src/setup-app.ts`                             |
| 테스트            | `src/groups/group-input.spec.ts`, `src/users/member-profile.spec.ts`, `test/groups.e2e-spec.ts`                                     |
| 문서              | `docs/groups-api.md`, `docs/group-missions.md`, `docs/groups-verification.md`, `docs/database.md`, `docs/users-api.md`, `README.md` |

최종 `git status --porcelain=v1 --untracked-files=all`의 변경/신규 파일 경로와 `git diff --check`를 확인한다. `frontend/`, `data-analysis/`, 프로젝트 루트 변경은 0개다. 기존 FE 코드와 분석 런타임은 읽기만 했고, 원본 Python import는 기존 `-B`/`PYTHONDONTWRITEBYTECODE=1` 방식으로 외부 캐시 생성을 방지했다.

## 재검토에서 발견·수정한 문제

계정 영구 삭제와 그룹 승인·그룹장 위임이 겹치면, 그룹 잠금만으로 대상 사용자 삭제를 보호하지 못해 FK 오류가 HTTP 500으로 반환되는 두 경로를 실제 PostgreSQL에서 재현했다. 승인·거절·위임에 대상 사용자 `FOR KEY SHARE` 잠금을 추가했다. 삭제가 먼저 끝나면 404로 처리하고, 그룹 처리가 먼저 잠그면 계정 삭제는 트랜잭션 완료까지 기다린다. 일반 구성원 탈퇴도 계정 삭제 CASCADE가 먼저 멤버십을 제거한 경우 오류 없이 완료하도록 보완했다.

추가한 4개 통합 테스트는 승인·거절·위임 각각에서 계정 삭제와의 경쟁을 `pg_blocking_pids`로 실제 대기 상태를 관측하여 재현하고, 두 그룹장의 상호 가입 신청에서 알림이 유실되지 않는지 검사한다. 기존 위임·탈퇴 경쟁 테스트도 단순 최종 상태뿐 아니라 모든 실패가 예상한 403/404/409인지 검사하여 예상하지 못한 DB 오류를 숨기지 않게 했다.
