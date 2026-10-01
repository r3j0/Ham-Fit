# 하루 전체 루틴 완료 보상

2026-10-02 [하루 한 그룹 물 기여](group-mission-water.md)를 추가했다. 이 문서의 waters는 **완료 시점에 이미 반영된** 단일 자동 기여의 불변 기록이다. 나중에 선택한 그룹의 물은 신규 물 API 영수증으로 조회하고 기존 v1 영수증을 변경하지 않는다.

2026-10-01 사용자 요청과 FE `6e600bf:frontend/BACKEND-REQUESTS.md`를 구현한다. 기존 영상 80% 판정, 선택 수행, 스트릭, 그룹 참여자 스냅샷·물 기여, 개인/그룹 룰렛 정책은 유지한다. 가입 설정 복구는 포함하지 않는다.

## 지급과 원자성

`WorkoutRoutinesService.event`의 최초 전체 완료 전이에서 해바라기씨 1개를 지급한다. 서버가 사용자 잠금을 얻은 뒤 받은 완료 시각의 KST 날짜를 사용한다. 항목 일부 완료·선택 세트 수행·진행 보고·GET·완료 이벤트 재전송은 지급 트리거가 아니다.

기존 그룹 달성 기록과 물·개인 룰렛권 처리, 마지막 항목/이벤트 저장, 기존 `AvatarService.grantCurrencyInTransaction`의 잔액 증가·거래 저장, 영수증 INSERT를 같은 트랜잭션으로 처리한다. 개인 지급 또는 어느 그룹 반영이 실패하면 전체를 롤백한다. 기존 잔액 상한과 거래 검증을 재사용한다.

거래 키는 사용자별 `daily-activity:YYYY-MM-DD`다. 영수증의 사용자+KST 날짜에 `seed_status='granted'`인 행은 SQL partial unique index로 한 개만 허용한다. 기존 사용자 잠금이 기기와 요청 키가 다른 동시 완료도 직렬화한다. 기존 일별 단일 영상 배정은 그룹/스트릭 자격을 소비하지만 **전체 루틴 씨앗** 자격을 소비하지 않는다.

## 영수증 API

`GET /api/v1/users/me/activity-rewards?routineId=<UUID>`

기존 Bearer 인증과 `Cache-Control: no-store`를 사용한다. UUID를 소문자로 정규화하며 빠진/중복/알 수 없는 query 필드는 400이다. 타인 루틴과 없는 루틴은 동일하게 404다.

```json
{
  "routineId": "20000000-0000-4000-8000-000000000001",
  "koreanDate": "2026-10-01",
  "seed": {
    "status": "granted",
    "amount": 1,
    "transactionId": "20000000-0000-4000-8000-000000000011"
  },
  "waters": [],
  "personalTicketIds": []
}
```

- `granted`: 이 루틴이 실제 지급 원본이다. 다시 조회해도 1개와 같은 거래 ID를 반환하며 추가 지급하지 않는다.
- `already_granted`: 같은 완료 날짜의 다른 원본에서 이미 받았다. `amount:0, transactionId:null`이다.
- `not_eligible`: 도입 전 다른 전체 루틴이 그날 이미 완료됐다. 소급 지급하지 않으며 `amount:0, transactionId:null`이다.
- 완료 전이나 도입 전 완료처럼 영수증 자체가 없는 본인 루틴은 409 `ACTIVITY_REWARD_NOT_RECORDED`다. GET이나 과거 이벤트 재전송으로 영수증·보상을 백필하지 않는다.

`waters`는 이 루틴을 원본으로 하는 실제 그룹 기여 행에서만 `{groupId,groupName,roundId,amount:1}`을 저장한다. UUID 순서로 모든 실제 기여 그룹을 포함하고 현재 소속/누적 물로 추정하지 않는다. `personalTicketIds`도 이 원본 달성에서 실제 발급한 권만 저장한다. 다른 완료에서 소비된 그룹 자격이나 발급된 권을 이 루틴에 붙이지 않는다.

이 값들은 완료 트랜잭션에서 고정한 JSON/UUID 배열이다. 그룹 이름 변경·탈퇴·그룹 삭제·권 사용 후에도 같은 영수증을 반환한다. 당시 기여를 보여주는 이력이며 현재 그룹 접근권이나 룰렛 사용권을 복구하지 않는다. 계정 영구 삭제 때는 영수증과 개인 거래를 함께 삭제한다.

## DB·적용

신규 `20261001000300_routine_activity_rewards`만 추가한다. 기존 마이그레이션을 수정하거나 기존 완료·잔액을 백필하지 않는다. 원본 루틴과 실제 씨앗 거래는 복합 FK로 소유자를 확인한다. DB trigger는 실제 전체 완료 시각, 1개 지급 거래, 원본 기여·권과 영수증의 일치를 검사한다. 영수증·연결된 거래 변경과 영수증만의 삭제를 차단하며 계정 전체 CASCADE 삭제는 허용한다.

기능별 검증은 `test/activity-rewards.e2e-spec.ts`와 `test/activity-rewards-migration.e2e-spec.ts`에서 실제 PostgreSQL/HTTP로 수행한다. 기존 그룹·개인 룰렛의 회귀 검사는 일일 씨앗과 원래 추첨 지급액을 함께 반영한 실제 잔액을 검증한다. 추첨 정책의 지급액은 변경하지 않는다.

이번 구현은 테스트 DB의 임시 스키마에만 마이그레이션을 적용한다. 개발·운영 DB 적용과 실행 서버 교체는 별도 작업이다. 새 서버를 사용할 때는 먼저 새 마이그레이션을 적용해야 readiness가 통과한다.
