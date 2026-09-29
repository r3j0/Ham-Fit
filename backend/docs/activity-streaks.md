# 개인·그룹 공통 활동 집계

2026-09-29 확정 정책. `src/users/member-profile.ts`를 개인 활동과 그룹원 프로필의 공통 집계 경로로 사용한다. 추천 알고리즘·개별 운동의 완료 판정·완료 저장은 변경하지 않는다.

## 응답 계약

아래 응답에 동일한 계산을 적용한다.

- `GET /api/v1/users/me/profile/activity`
- `GET /api/v1/groups/:id/members/:memberId`
- `GET /api/v1/groups/:id`의 `members[]`

기존 `userId`, `nickname`, `profileCharacter`, `streak`를 유지하고 `longestStreak`, `totalWorkoutDays`를 추가한다. `streak`가 현재 스트릭이며 기존 `/users/me/profile` 응답은 바꾸지 않는다. 그룹 응답의 `role`, `joinedAt`도 유지한다.

```json
{
  "userId": "39fcd6bd-f0cf-4c3d-9ce2-4619d37060e2",
  "nickname": "운동친구",
  "profileCharacter": null,
  "streak": 2,
  "longestStreak": 5,
  "totalWorkoutDays": 12
}
```

위 수치는 설명용이며 운영 응답은 저장된 실제 기록에서 계산한다.

## 운동일과 스트릭

1. 신규 `WorkoutRoutine`은 항목이 하나 이상이고 **모든** `WorkoutRoutineItem.status`가 `completed`일 때만 성공 후보가 된다. 일부 완료·중단·미수행은 제외한다.
2. 모든 항목의 `completedAt`이 있어야 하며 조회 시각 이후의 완료는 제외한다. 상태와 시각이 불일치한 기록은 배정일·생성일·이벤트 시각으로 보정하지 않는다. 기존 DB CHECK도 상태/시각의 불일치를 거부한다.
3. 전체 완료 시각은 항목 순서와 무관하게 `max(completedAt)`이다. 이 시각을 `Asia/Seoul` 날짜로 변환한 값이 운동일이다. 여러 날에 걸쳐 수행하거나 자정을 넘겼다면 마지막으로 완료한 날에만 반영한다.
4. 기존 완료 기록과 신규 루틴 기록을 사용자별 날짜 집합으로 합친다. 같은 날 여러 루틴·기존 배정을 완료해도 한 운동일이다.
5. `totalWorkoutDays`는 날짜 집합의 크기, `longestStreak`는 가장 긴 연속 날짜 구간이다.
6. `streak`는 오늘 완료했으면 오늘부터, 오늘 미완료·어제 완료이면 어제부터 과거로 이어지는 연속 일수다. 오늘·어제 모두 없으면 0이다. 빈 기록은 세 값 모두 0이다.
7. KST 변환과 UTC 달력 연산을 명시해 서버 프로세스·DB 세션 시간대에 의존하지 않는다.

## 기존 기록 호환

기존 `UserCurriculumAssignment` 집계 조건인 `assignmentDate != null`, `status = completed`, `completedAt <= 조회 시각`을 유지한다. 운동일은 배정일이 아닌 실제 `completedAt`의 KST 날짜다. 기존 단일 운동/일별 커리큘럼의 성공을 신규 루틴 정책으로 재판정하지 않는다. `assignmentDate`가 null인 구형 내부 커리큘럼은 이전 활동 집계에서도 제외됐으므로 그대로 제외하되 저장 데이터와 기존 완료·이력 기능을 보존한다.

신규 루틴 항목을 `UserCurriculumAssignment`로 복제하거나 기존 단일 운동으로 취급하지 않는다. 과거 기록 삭제·변환·백필은 없다. 저장된 전체 완료 루틴은 이벤트 유무와 무관하게 첫 조회부터 반영된다.

## 조회·인덱스·일관성

집계는 조회 시 원본 완료 상태에서 계산하며 카운터·추가 테이블·마이그레이션을 만들지 않는다. 이벤트 행은 조회하거나 세지 않는다. 동일 요청 키 재전송과 다른 키로 보낸 완료 이벤트도 기존 항목의 최종 완료 시각을 바꾸지 않으므로 집계가 중복 증가하지 않는다.

그룹 구성원 ID 전체를 `in` 조건으로 전달해 사용자, 기존 완료, 전체 완료 루틴을 일괄 조회한다. 루틴 관계는 모든 항목의 자격을 먼저 확인하고, 완료 시각 내림차순 첫 항목의 시각만 선택한다. 사용자/루틴마다 개별 쿼리를 실행하는 루프나 이벤트 전체 조회, 최근 페이지 제한이 없다. 개인과 그룹 모두 기존 RepeatableRead 트랜잭션에서 조회하므로 조회 도중 완료가 저장되어도 같은 스냅샷을 사용한다.

인덱스 검토: 기존 `UserCurriculumAssignment(userId, assignmentDate)` 및 `(userId, assignedAt, id)`, `WorkoutRoutine(userId, assignmentDate)`의 선두 `userId`로 대상 사용자 범위를 제한할 수 있다. 항목 검사에는 기존 `WorkoutRoutineItem(routineId, order)` 및 `(routineId, videoId)`의 선두 `routineId`를 사용할 수 있다. 루틴당 소수 항목의 완료 시각 선택을 위해 중복 인덱스를 추가하지 않았다. 장기 이력이 커지면 완료 기록 수에 비례하는 조회·메모리 비용이 남으며, 실제 실행 계획과 운영 부하를 보고 완료일 SQL 집계를 검토한다.

## 검증과 범위

`src/users/member-profile.spec.ts`는 날짜 경계·윤년·연도 변경·현재/최장 스트릭·총 운동일·빈 기록을 검증한다. `test/activity.e2e-spec.ts`는 실제 PostgreSQL에서 부분 완료 배제, 마지막 항목 완료, 자정 전후 재시도, 여러 날 수행, 과거 저장 루틴, 동일 날짜 중복 제거, 기존 기록 호환, 미래 기록 제외, 사용자 간 격리, 상태/시각 제약 및 개인/그룹 HTTP 응답 일치를 검증한다.

```bash
npm test
npm run test:e2e -- test/activity.e2e-spec.ts test/groups.e2e-spec.ts test/curricula.e2e-spec.ts
TZ=America/Los_Angeles npm run test:e2e -- test/activity.e2e-spec.ts
```

그룹 미션 진행도·씨앗·재화·보상·성장 기능과 화면 연결은 범위 밖이다. 그룹원 프로필의 활동 집계는 개인과 같지만 그룹 미션 성공·보상 기준을 새로 정의하지 않는다.

### 실행 결과 (2026-09-29)

- `npm test`: 20개 파일, 289개 단위 테스트 통과.
- `RECOMMENDATION_PYTHON=.local/recommendation-venv/bin/python npm run test:e2e`: 20개 파일, 394개 통합 테스트 통과. 실제 Python 추천을 사용하는 기존 루틴 테스트 포함.
- `TZ=America/Los_Angeles npm run test:e2e -- test/activity.e2e-spec.ts test/groups.e2e-spec.ts test/curricula.e2e-spec.ts`: 3개 파일, 31개 통과.
- Prisma 스키마 검증·클라이언트 생성, 전체 서식·린트·타입 검사, 빌드, `git diff --check` 통과.
- 전용 테스트 DB의 임시 스키마에서 기존 19개 마이그레이션 적용·재적용을 확인하고 임시 스키마를 정리했다. 개발·운영 DB에는 적용하지 않았다.
- 최초 실행에서 로컬 소켓의 샌드박스 차단과 기본 Python의 추천 실행 실패가 있었고, 실행 권한 및 문서의 준비된 Python 환경을 적용한 재실행은 통과했다. 기존 pg 동시 query deprecation 경고는 남아 있다.
- 최종 diff 및 작업 시작 시점 파일 해시 비교로 기존 진행 중 변경을 보존하고 `frontend/`, `data-analysis/`, 저장소 루트에 변경이 없음을 확인했다.
