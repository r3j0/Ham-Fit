# 개인 연속 운동 룰렛

2026-10-01 사용자 확정 정책. 그룹 룰렛과 독립된 개인 보상이다. 기존 추천·운동 완료 판정·KST 루틴 마감·활동 집계·인증·상점 구매·대표 코디 계약을 유지한다. 화면과 에셋은 추가하지 않는다.

## 운동 성공과 권 발급

실제 운동 성공으로 **현재 연속 구간의 5·10·15·20…일**을 달성할 때마다 1장을 자동 적립한다. 15일 구간에서는 총 3장이다. 끊긴 뒤에는 다음 성공을 1일로 시작하고 새 구간에서도 다시 발급한다. 누적 운동일·최장 기록·어제까지 유지되는 표시상 스트릭은 지급 근거가 아니다.

`WorkoutRoutinesService.event`와 `RecommendationsService.event`의 최초 유효 완료 전이가 기존 `recordActivityAchievement`에서 권을 발급한다. 사용자 `FOR NO KEY UPDATE` 잠금 아래 달성 기록·개인 권·모든 그룹 기여·원본 완료·재생 이벤트를 같은 트랜잭션에 저장한다. 어느 한 저장이 실패해도 전부 롤백한다. 조회·로그인·프로필 접근으로 발급하지 않고 과거 달성분 백필도 하지 않는다.

`workoutDays`는 개인/그룹 활동 집계와 발급의 공통 원본 조회다. 날짜가 있는 기존 일별 배정의 유효 완료와 항목이 하나 이상이며 모든 항목의 상태/완료 시각이 유효한 전체 완료 루틴만 포함한다. 운동일은 실제 마지막 서버 완료 시각의 Asia/Seoul 날짜다. 기존 날짜 없는 내부 커리큘럼·부분 완료·중단·미수행·미래 완료 시각은 제외한다. `currentStreak`와 UTC 달력 연산을 재사용하며 서버 프로세스 시간대에 의존하지 않는다.

호출 시점은 원본 완료 저장 **직전**이다. 이미 저장된 날짜 집합에 이번 서버 완료일까지 추가한 뒤 달성을 계산하므로 최초 전체 완료/5일째가 누락되지 않는다. 같은 날 다른 원본 완료나 기존 달성 기록이 있으면 새 달성·권·그룹 기여를 만들지 않는다. 클라이언트 날짜와 `occurredAt`은 지급에 사용하지 않는다. 기존 v2 만료 거절·정확한 재전송 우선 처리도 유지한다.

권은 여러 장 보관하며 만료되지 않는다. 스트릭 종료·그룹 가입 여부·탈퇴·퇴출·그룹 삭제는 개인 권과 이미 지급된 개인 보상에 영향을 주지 않는다. 같은 성공이 그룹 기여 조건도 충족하면 개인/그룹 모두 인정한다. 계정 자체의 영구 삭제는 기존 개인 데이터 삭제 정책에 따라 달성·권·추첨·소유권·재화를 삭제한다.

## 고정 정책과 아이템

권은 불변 `StreakRoulettePolicy` 참조를 가진다. 현재 버전은 `streak-2026-10-01-v1`이며 DB에 확률표를 고정 저장한다. UPDATE/DELETE trigger가 재해석을 막는다. 새 정책은 새 버전/등록 마이그레이션과 명시적 서버 검증을 추가해야 한다. 기존 권의 참조를 바꾸지 않는다. 미지원/손상 정책은 오류로 롤백하며 현재 정책으로 대체하지 않는다.

| 원래 당첨 `originalResult` | 정수 가중치 | 확률 | 실제 지급                                |
| -------------------------- | ----------- | ---- | ---------------------------------------- |
| `seeds_1`                  | 600         | 60%  | 해바라기씨 1개                           |
| `seeds_3`                  | 250         | 25%  | 3개                                      |
| `seeds_5`                  | 100         | 10%  | 5개                                      |
| `seeds_10`                 | 43          | 4.3% | 10개                                     |
| `clothing`                 | 6           | 0.6% | 미보유 판매 의상 1개, 대상 없음이면 50개 |
| `pose`                     | 1           | 0.1% | 미보유 판매 포즈 1개, 대상 없음이면 70개 |

서버 `node:crypto.randomInt(1000)` 구간은 `[0,600)`, `[600,850)`, `[850,950)`, `[950,993)`, `[993,999)`, `[999,1000)`이다. 합계·순서·종류·지급량·버전을 검증한다. 클라이언트가 결과·금액·상품·수령자를 지정할 수 없다.

아이템은 추첨 시 조회한 `saleStatus=on_sale`이면서 미보유인 해당 종류 상품 **전체**에서 `randomInt(상품 수)`로 균등 선택한다. 의상은 기존 `hat/top/bottom`의 개별 상품이고 부위부터 추첨하거나 세트를 만들지 않는다. default/held/retired 상품은 제외한다. 종류에 상품이 없거나 모두 보유했으면 같은 고정 대체 지급을 적용하며 재추첨하지 않는다. DB 조회 오류를 대상 없음으로 처리하지 않는다.

현재 운영 마이그레이션의 의상 상품은 0개이므로 의상 결과는 50개 지급으로 정상 처리한다. 의상 등록·가상 상품·임시 에셋을 추가하지 않았다. 통합 테스트의 상품은 전용 테스트 DB에서만 생성하는 fixture다.

해바라기씨는 `AvatarService.grantCurrencyInTransaction`의 기존 검증·2,147,483,647 상한·원장·이벤트 중복 방지를 재사용한다. 이벤트 키는 `streak-roulette:<drawId>`다. 그룹의 `group-roulette:`와 별개이며 POST 키도 개인 추첨 테이블에서 사용자별로 관리한다. 아이템은 개인 공용 `AvatarOwnership`에 `source=streak_roulette`로 추가하며 구매 행/차감 거래를 만들지 않는다. 자동 착용이나 대표 코디 변경은 하지 않는다.

## API

기본 경로는 `/api/v1/users/me/streak-roulette`다. Bearer 인증으로 본인만 접근한다. POST는 `X-CSRF-Protection: 1`, 허용 Origin, `Content-Type: application/json`을 요구한다. 모든 응답에 기존 `Cache-Control: no-store`, `Pragma: no-cache`를 적용한다. UUID는 소문자로 정규화한다. 입력/쿼리는 strict이며 미지원 필드를 거절한다.

| 메서드·하위 경로 | 입력                                           | 성공                                         |
| ---------------- | ---------------------------------------------- | -------------------------------------------- |
| `GET /tickets`   | `limit`, `cursor`                              | 200 `{items,availableCount,nextCursor}`      |
| `POST /spins`    | JSON `{ticketId}`, UUID `Idempotency-Key` 필수 | 최초 201 / 성공 재전송 200 `{draw,replayed}` |
| `GET /draws`     | `limit`, `cursor`                              | 200 `{items,nextCursor}`                     |

두 GET 모두 상태를 변경하지 않는다. 페이지는 UUID 오름차순이며 시간순을 뜻하지 않는다. limit은 기본 20, 최대 50, 최소 1이다. `nextCursor`는 마지막 반환 ID 또는 null이다. cursor는 배타적 UUID 하한이므로 다른 사용자의 UUID를 넣어도 본인의 데이터만 범위 조회하며 존재 여부를 노출하지 않는다. `availableCount`는 페이지/커서와 관계없이 본인의 전체 미사용 권 수이고 목록과 같은 RepeatableRead 스냅샷에서 계산한다.

권 객체:

```json
{
  "id": "70ea95af-90ac-48f2-a138-c560e24d22de",
  "achievementId": "5799ac65-03b7-4a58-a26d-af70ab36c0bb",
  "koreanDate": "2026-10-05",
  "segmentStartDate": "2026-10-01",
  "streakDays": 5,
  "createdAt": "2026-10-05T01:00:00.000Z",
  "policyVersion": "streak-2026-10-01-v1",
  "status": "available",
  "usable": true,
  "usedAt": null
}
```

사용한 권은 `status=used`, `usable=false`, `usedAt=추첨 시각`이다. invalidated/expired 상태는 없다. 날짜는 KST 날짜 문자열, 시각은 UTC ISO 문자열이다. 식별자와 시각은 설명용이다.

```http
POST /api/v1/users/me/streak-roulette/spins
Authorization: Bearer <access-token>
X-CSRF-Protection: 1
Content-Type: application/json
Idempotency-Key: c9e9ef2c-ecfa-4d7e-bf68-b93ef3df679b

{"ticketId":"70ea95af-90ac-48f2-a138-c560e24d22de"}
```

추첨 응답의 의상 대체 지급 예시:

```json
{
  "replayed": false,
  "draw": {
    "id": "2fd159dd-fc45-4496-9640-878c7f13dfee",
    "ticketId": "70ea95af-90ac-48f2-a138-c560e24d22de",
    "achievement": {
      "id": "5799ac65-03b7-4a58-a26d-af70ab36c0bb",
      "koreanDate": "2026-10-05",
      "segmentStartDate": "2026-10-01",
      "streakDays": 5,
      "achievedAt": "2026-10-05T01:00:00.000Z",
      "sourceKind": "routine",
      "sourceId": "15937269-66dc-46b4-baa1-203a01ba3b2c"
    },
    "drawnAt": "2026-10-05T02:00:00.000Z",
    "policyVersion": "streak-2026-10-01-v1",
    "originalResult": "clothing",
    "actualReward": {
      "kind": "seeds",
      "amount": 50,
      "productId": null,
      "transactionId": "1f6b67ac-76c7-4efc-9e36-38974cfc66ea"
    },
    "fallback": { "applied": true, "reason": "no_eligible_product" }
  }
}
```

`sourceKind`는 `routine`/`daily_assignment`다. 실제 아이템은 `actualReward.kind=clothing/pose`, `amount=1`, `productId=상품 ID`, `transactionId=null`이다. 기본 재화 당첨은 `kind=seeds`와 해당 금액이다. 대체 없는 결과는 `fallback={applied:false,reason:null}`이다. 대상 없음의 세부 상황(상품 미등록/전부 보유)은 같은 `no_eligible_product` 근거로 저장한다. 결과에는 다른 사용자의 정보·잔액·전체 inventory가 없다. 본인 현재 잔액/소유 목록은 기존 `/users/me/avatar/inventory`로 조회한다.

## 멱등성·오류·복구

같은 사용자·키·권의 성공 재시도는 저장 결과를 그대로 반환하고 `replayed=true`, HTTP 200, `Idempotency-Replayed: true`다. 최초 성공은 false/201/헤더 false다. 재시도는 난수·후보 상품·현재 판매 상태·소유 목록을 다시 계산하지 않는다. 같은 키로 다른 권은 409 `IDEMPOTENCY_CONFLICT`, 다른 키로 사용한 권은 409 `TICKET_USED`다. 실패한 트랜잭션의 키는 저장하지 않는다.

응답 유실/5xx/네트워크 오류는 같은 키와 같은 body로 재시도한다. GET `/draws`로도 본인의 저장 결과를 복구할 수 있다. GET `/tickets`의 usedAt만 보고 보상 종류를 추측하지 않는다.

| HTTP | 계약                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| 400  | 기존 사용자 입력 형식 `{statusCode:400,message,errors:[{field,message}]}`. 키/UUID/JSON/미지원 필드/페이지 오류 |
| 401  | 기존 인증 오류, 삭제한 계정                                                                                     |
| 403  | 기존 CSRF/Origin 오류                                                                                           |
| 404  | 본인의 권 없음. 타인 권도 동일하게 404                                                                          |
| 409  | `{statusCode:409,code,message}`의 `IDEMPOTENCY_CONFLICT`, `TICKET_USED`, 기존 `BALANCE_LIMIT`/`GRANT_CONFLICT`  |
| 429  | 기존 요청 제한, Retry-After 준수                                                                                |
| 503  | 기존 `CURRENCY_MISSING`                                                                                         |
| 5xx  | 정책 손상·DB/지급 저장 오류. 전부 롤백하며 대체 보상으로 숨기지 않음                                            |

수동 달성·임의 권 발급·사용자 지정 보상 API는 없다.

## DB·원자성·경쟁

- `StreakRouletteTicket`: user+KST 날짜 unique, achievement unique, user+segmentStartDate+streakDays unique. 사용자+달성 일수만의 unique가 아니므로 새 구간에서 다시 지급한다. composite FK로 달성의 소유자/날짜를 연결하고 CHECK로 양의 5배수·구간 날짜·KST 발급 날짜를 검사한다. UPDATE는 금지한다.
- `StreakRoulettePolicy`: 버전 PK와 확률 snapshot. UPDATE/DELETE 금지.
- `StreakRouletteDraw`: ticket unique가 1회 사용 상태이며 사용자+UUID 키 unique, 거래 ID unique다. 원래 결과·실제 종류/수량·상품·거래·대체 이유를 CHECK하고, INSERT trigger가 권의 소유자/정책/시간과 실제 재화 거래 또는 룰렛 소유권을 검사한다. UPDATE 금지.
- 기존 소유권 source CHECK에 `streak_roulette`만 추가한다. 원래 default/purchase 경로와 직렬화는 유지한다. 아이템 소유권/거래 FK는 NO ACTION·지연 검사로 개별 지급 근거 삭제를 막으면서 계정의 전체 CASCADE 삭제를 허용한다.

개인 추첨은 사용자 `FOR NO KEY UPDATE` → 후보 상품 ID 순서 `FOR SHARE` → 재화 행 조건부 UPDATE 순서다. 구매/동시 개인 추첨은 같은 사용자 잠금에서 직렬화한다. 상품 공유 잠금은 판매 조건 UPDATE/DELETE를 막고, 먼저 진행 중인 판매 변경을 기다린 SELECT는 변경된 자격을 재확인한다. 상품 조회·보유 검사·획득·결과 저장이 같은 트랜잭션이며 사용자 소유권 PK도 중복을 차단한다. 전역 잠금·신규 인프라는 없다. 교착/직렬화 오류는 기존 `retryTransaction`으로 전체 트랜잭션을 재시도한다. 실패한 난수 결과는 외부에 확정하지 않는다.

## 마이그레이션·적용 경계

새 forward-only 마이그레이션은 다음 순서다. 기존 파일은 수정하지 않는다.

1. 기존 `20260930000400_group_missions`까지 적용.
2. `20261001000100_streak_roulette_tickets`: 정책 참조·개인 권·달성 composite unique/FK.
3. `20261001000200_streak_roulette_draws`: 추첨/지급 명세·원자성 제약·소유 경로 CHECK 확장.
4. 해당 변경을 사용하는 서버 시작.

이번 작업은 개발·운영 DB에 적용하거나 배포하지 않는다. 향후 승인된 적용은 기존 백업/DB 운영 절차에 따라 새 서버보다 먼저 `npm run db:migrate:deploy`로 수행한다. 기존 데이터/과거 달성 백필은 없다. 사용자 데이터가 많은 환경에서 기존 달성 unique 인덱스와 CHECK 검증의 잠금/시간은 스테이징에서 확인해야 한다. SQL의 CREATE TABLE을 직접 반복하지 않고 Prisma migration ledger로 재적용한다.

활동 원본 날짜 조회는 이력 크기에 비례한다. 별도 카운터·캐시·인프라 없이 기존 정확한 집계 규칙을 공유했으며 긴 이력의 비용은 실제 실행 계획/부하에 따라 후속 검토한다. [단계별 검증 결과](streak-roulette-verification.md)를 참고한다.
