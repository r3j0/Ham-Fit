# FE 연동 구현과 BE 요청 규격

기준: BE PR #9 `f5774815fa7a42386672683fbf227a6e937ed0eb` (2026-10-01 확인). 이번 변경은 **FE와 요청 규격만** 포함하며 BE 소스, DB, 배포를 변경하지 않는다. 기존 계획보다 아래 확정 사항을 우선한다.

## 확정한 동작

- 기존 영상 80% 시청 완료 판정 유지. `reps` / `hold` / `timed` 처방 수행은 선택이다. FE 타이머·횟수·세트 완료는 서버 완료, 스트릭, 지급 이벤트가 아니다.
- 하루 루틴 전체 완료 시 개인 해바라기씨 1개, KST 하루 한 번. 실제 지급은 BE 트랜잭션에서 처리한다.
- 전체 루틴 완료 → 완료 화면 → 서버 현재 스트릭 → 실제 지급된 씨앗 → 실제 기여한 그룹별 물 → 메인. 미지급/이미 다른 루틴에서 지급된 경우 해당 보상 화면을 건너뛴다.
- 구매 가격과 잔액은 서버 값만 사용. `priceProvisional=true`인 상품은 가격 확정 후 구매할 수 있도록 막는다. 60개를 확정 가격으로 취급하지 않는다.
- 가입 직후 `/welcome`에서 닉네임과 크림/그레이 선택 후 `/onboarding`으로 이동. 기존 사용자는 신규 설정 화면으로 강제 이동하지 않으며, BE 기본 지급/백필 크림 코디를 사용한다. 기존에 저장한 코디를 FE가 덮어쓰지 않는다.

## 현재 API로 연결한 기능

| 기능                 | FE 경로                                                      | 사용 API                                                     |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 순차 운동, 선택 세트 | `/workout`, `/workout-routines/:id/items/:itemId[/practice]` | 기존 v2 루틴/이벤트                                          |
| 완료 및 스트릭       | `/workout-routines/:id/complete[/streak]`                    | v2 루틴, GET `/users/me/profile/activity`                    |
| 캐릭터 선택          | `/welcome`                                                   | PATCH `/users/me/profile`, GET/PUT `/users/me/avatar/outfit` |
| 상점·옷장            | `/shop`, `/shop/wardrobe`                                    | catalog, inventory, purchases, outfit                        |
| 그룹 성장·시작       | `/groups/:id`                                                | missions/current, missions/start                             |
| 그룹 룰렛            | `/groups/:id/roulette`                                       | roulette/tickets, roulette/spins, roulette/draws             |

모든 v1 API 경로는 `/api/v1` 기준이다. 구매·미션 시작·추첨은 CSRF 헤더 및 UUID 요청 키를 사용한다. 네트워크 유실/5xx/응답 파싱 실패 시 원래 본문·키를 사용자별 sessionStorage 저널에 보관하여 새로고침 후 재확인한다. 성공/확정된 거절 후에만 새 요청을 만든다. 재조회는 지급을 발생시키지 않는다. 옷장 PUT은 전체 코디와 원래 revision의 `If-Match`를 보낸다. 412 이후 최신 코디를 명시적으로 다시 선택해야 한다.

## BE가 추가해야 하는 API (제안, 현재 미구현)

아래 계약이 합의되고 배포되기 전에는 `.env.example`의 두 출시 설정을 `false`로 유지한다. 활성화한 테스트는 제안 계약에 대한 FE 테스트이며 실제 BE 구현 검증을 대신하지 않는다. 플래그를 켜려면 재빌드가 필요하다.

### 1. 완료 보상 영수증

`NEXT_PUBLIC_DAILY_REWARDS_ENABLED=true`에서 사용하는 읽기 API:

`GET /users/me/activity-rewards?routineId=<UUID>`

```json
{
  "routineId": "20000000-0000-4000-8000-000000000001",
  "koreanDate": "2026-10-01",
  "seed": {
    "status": "granted",
    "amount": 1,
    "transactionId": "20000000-0000-4000-8000-000000000011"
  },
  "waters": [
    {
      "groupId": "20000000-0000-4000-8000-000000000012",
      "groupName": "함께 운동",
      "roundId": "20000000-0000-4000-8000-000000000013",
      "amount": 1
    }
  ],
  "personalTicketIds": []
}
```

- 최초 유효 전체 루틴 완료와 같은 트랜잭션에서 사용자/KST 날짜 unique 지급과 거래를 기록. 기존 그룹 활동 달성 원장을 활용하되 개인 지급과 그룹 자격을 구분한다.
- `seed.status`: 이 루틴이 지급 원본이면 `granted`, 같은 날 다른 원본에서 받았으면 `already_granted`, 지급 대상이 아니면 `not_eligible`. 뒤 두 상태는 `amount:0, transactionId:null`.
- 재조회/재전송에서 동일 영수증 반환. `granted`는 이번 조회에서 새로 지급했다는 의미가 아니다. FE는 조회로 지급을 요청하지 않는다.
- `waters`에는 **이 원본 완료에 실제 연결된 기여 원장**만 포함. 소속 그룹, 현재 자격, 현재 누적 물의 차이만으로 지급을 추정하지 않는다. 여러 그룹에 각 1회 반영되면 모두 포함. 시작 후 가입, 탈퇴/재가입, 완료 이전 시작 조건, 같은 날 중복 규칙은 기존 문서 그대로 유지.
- 본인 루틴만 접근, 완료 전/원장 없는 상태는 명시적으로 반환하거나 409. 과거 기록의 지급 백필 여부는 BE에서 별도 결정하며 FE가 자동 소급하지 않는다.
- 개인 지급 실패와 물 반영 실패 시 전체 원자성을 보장하고, 잔액 상한·동시 요청·KST 자정·동일 날짜 여러 루틴/기기·응답 유실·과거 재전송을 테스트해야 한다.
- API가 없으면 FE는 완료/스트릭만 표시. 물 주기 자체는 기존 BE에서 수행되지만, 현재 API만으로 해당 운동의 기여 여부를 안전하게 단정할 수 없어 축하 페이지는 영수증 준비 전까지 표시하지 않는다.

### 2. 개인 룰렛

`NEXT_PUBLIC_PERSONAL_ROULETTE_ENABLED=true`에서 아래 API를 사용한다. 모든 페이지 목록은 기존 `{items,nextCursor}` UUID 커서 규격이다.

`GET /users/me/roulette/tickets?limit=50&cursor=...`

```json
{
  "items": [
    {
      "id": "20000000-0000-4000-8000-000000000021",
      "earnedAt": "2026-10-01T02:00:00.000Z",
      "koreanDate": "2026-10-01",
      "streak": 5,
      "policyVersion": "<BE 확정 버전>",
      "status": "available",
      "usable": true,
      "usedAt": null
    }
  ],
  "nextCursor": null
}
```

- 서버에서 유효 하루 전체 완료에 따른 연속 운동이 5의 배수일 때 발급. 화면의 streak 숫자, 페이지 방문, 타이머가 발급 트리거가 되면 안 된다. 스트릭 단절 후 재달성·동일 날짜 중복·과거 완료 정책을 원장 unique 키로 보장한다.
- status는 `available|used|invalidated`; 사용된 권은 usedAt ISO 시각. 사용 가능 여부는 서버 계산.
- 오래된 권도 해당 권의 정책 버전을 사용한다.

`GET /users/me/roulette/policy?version=<ticket.policyVersion>`

```json
{
  "version": "<BE 확정 버전>",
  "rewards": [
    {
      "id": "<안정적인 보상 ID>",
      "kind": "currency",
      "amount": 1,
      "probability": 100
    }
  ]
}
```

**위 한 행은 응답 구조를 설명하기 위한 예시이며 정책 제안이 아니다.** 실제 보상표는 해바라기씨 1/3/5/10개·랜덤 의상·랜덤 자세별 확률 합계 100으로 BE가 확정한다. `kind=clothing|pose`는 `amount:null`. FE는 서버의 확률표를 그대로 표시한다.

`POST /users/me/roulette/spins` + `Idempotency-Key`, 본문 `{ticketId}`:

```json
{
  "replayed": false,
  "draw": {
    "id": "20000000-0000-4000-8000-000000000022",
    "ticketId": "20000000-0000-4000-8000-000000000021",
    "drawnAt": "2026-10-01T02:10:00.000Z",
    "policyVersion": "<BE 확정 버전>",
    "result": { "kind": "currency", "amount": 3, "productId": null },
    "currency": { "balance": 8 },
    "inventory": [
      {
        "productId": "character.cream",
        "source": "default",
        "acquiredAt": "2026-10-01T00:00:00.000Z"
      }
    ]
  }
}
```

- 의상/자세 결과는 `{kind:"clothing"|"pose",amount:null,productId:<실제 소유권을 지급한 상품 ID>}`. inventory에는 지급한 상품 포함. 기존 avatar ownership의 DB source 제약에 `reward` 등을 추가해야 한다(현재 default/purchase만 허용).
- 권 소비, 서버 추첨, 소유권/개인 잔액/거래, 결과 저장은 한 트랜잭션. 같은 키/권은 저장된 같은 결과, 다른 본문은 409. 티켓당 한 추첨을 DB unique로 보장. 재전송의 currency/inventory는 현재 상태를 반환.
- 응답 유실 뒤 같은 키 재전송과 새로고침 복구, 다른 기기에서 이미 사용된 권, 만료 인증, 전 상품 소유, 상품 0개, 지급 실패를 검증해야 한다.
- **최신 BE Markdown에는 개인 확률 및 미보유 소진/상품 없음 시 대체 보상 정책이 없다.** `backend/docs/group-missions.md`의 확률은 그룹용(50/25/13/7/4/1%)이며 랜덤 아이템 규칙이 없다. 개인 정책에 복사하지 않는다. 미보유만 추첨할지, 모두 소유/등록 상품 0개면 어떤 결과를 지급할지 BE 정책 확정이 필요하다. FE는 fallback을 계산하지 않고 최종 서버 결과만 표시한다.
- 위 기능 활성화 전, 서버 구현 경로/필드가 달라지면 `lib/personal-rewards.ts`, `lib/personal-reward-contract.ts`를 함께 맞춘다.

## 의상 등록 요청

사용자가 제공한 `hamster-wardrobe-studio-data-v2-2026-09-29.zip`의 분리 PNG 및 `little-wardrobe-stage/v1` 좌표를 가져왔다. 기존 PNG와 SHA-256이 같은 베이스 11종은 파일을 중복 저장하지 않고 공유하되, studio의 정확한 viewBox/clip을 유지한다. 의상 레이어 순서는 하의 → 상의 → 모자다. 원본 합쳐진 스포츠웨어 4종을 임의로 모자/상의/하의 상품으로 팔지 않는다.

| 제안 productId                    | 표시 이름        | slot/occupiesSlots | renderKey       | 가격 |
| --------------------------------- | ---------------- | ------------------ | --------------- | ---- |
| `clothing.helmet`                 | 헬멧             | hat / [hat]        | `item-mumcdhbz` | 30   |
| `clothing.yellow-baseball-jacket` | 노란 야구점퍼    | top / [top]        | `item-mumd1fjp` | 25   |
| `clothing.white-tennis-skirt`     | 하얀 테니스 치마 | bottom / [bottom]  | `item-mumdmxtg` | 20   |

공통 `kind=clothing, ownershipScope=shared, scopeCharacterId=null`. productId는 BE 등록을 위한 제안이며 렌더링은 renderKey로 매핑하므로 FE가 이 제안 ID로 보유권을 가정하지 않는다. 이름 필드가 없는 현행 API에서는 FE registry의 이름을 표시한다.

정확한 캐릭터/자세별 지원 범위 및 transform은 `lib/wardrobe-assets.json`에 있다. 크림·그레이 모두 모자 11자세, 상의·하의 각각 9자세. 스튜디오에만 있는 phone/toilet/weight는 현재 BE·FE 자세 집합에 없어 이번 등록 대상에서 제외했다. 기존 a-plus/situp의 레이어는 제공되지 않아 의상과 함께 착용할 수 없다. 베이스 이미지만 있는 자세에도 별도로 누락된 의상 배치를 만들어 추정하지 않는다.

BE는 지원하는 **전체** `{characterId,poseId,clothingIds}` 조합을 명시적으로 등록해야 한다. 개별 에셋 유무만으로 FE가 가능한 전체 조합을 만들어 저장하지 않는다. 모자·상의·하의 혼합 조합도 필요한 부분집합별로 등록하고 겹침/가림을 확인한다. 등록 전 상점 카테고리는 정직한 빈 목록이다. 알 수 없는 renderKey는 기본 코디로 대체하지 않고 이미지 준비 중 상태를 표시한다.

자세 가격은 BE에서 50/70 카테고리별 매핑을 확정하고 상품 revision을 갱신해야 한다. FE는 미확정 가격 구매를 차단한다. 현재 provisional 값이 유지되면 해당 상품은 출시할 수 없다.

## 남은 서버 연동 조건

신규 프로필 설정 완료 상태는 현재 별도 BE 필드가 없다. 가입 성공은 `/welcome`으로 바로 이동하고 페이지 새로고침은 가능하지만, 다른 기기 재로그인 후 미완료 설정을 반드시 이어가게 하려면 서버에 `profileSetupCompleted` 같은 상태와 원자적인 닉네임/초기 캐릭터 저장 API가 필요하다. 현재 FE는 닉네임 저장 후 outfit 저장을 순서대로 처리하고 부분 성공을 재시도한다. 기존 사용자의 nickname null만으로 신규 가입자로 판정하지 않는다.

검증 결과와 실행 범위는 별도 테스트 로그 및 최종 변경 보고를 기준으로 한다. 제안 API의 mock 성공을 실제 지급/실제 서버 구현 완료로 보고하지 않는다.

## FE 검증 (2026-10-01)

- 최종 `npm run check`: ESLint, Next route typegen/TypeScript, 단위 테스트 **155개**, 프로덕션 빌드 통과. Prettier 검사 통과.
- 관련 Playwright 시나리오 **53개** 통과(중복 실행 제외). 구매 유실/새로고침/같은 키 복구, 별도 코디 저장, 412 충돌, 대표 코디의 메인/프로필 반영, 그룹 미션·룰렛, 순차 영상 80% 완료, 만료·다시보기, 세 유형의 선택 수행, 가입 및 기존 화면 회귀를 포함한다.
- 이 브라우저 검증은 **API 계약 응답을 사용하는 FE 검사**다. 실제 BE 지급이나 의상 등록이 완료되었다는 뜻이 아니다. 기존 BE 엄격 검증은 별도 PR 검증 기록을 참조한다.
- 제안 API 관련 2개 시나리오는 `NEXT_PUBLIC_DAILY_REWARDS_ENABLED=true NEXT_PUBLIC_PERSONAL_ROULETTE_ENABLED=true`로 시작한 별도 서버에서 `E2E_PROPOSED_REWARDS=true`로 실행했다. 테스트용 확률 100%는 당첨 결과 표시 검사용이며 제품 정책이 아니다.
- 기본 false 설정의 프로덕션 빌드에서도 개인 보상 API를 호출하지 않고 씨앗/물 획득을 표시하지 않는 것을 확인했다. 기본 실행 시 제안 계약 2개 시나리오는 의도적으로 건너뛰며, 위 별도 실행에서는 모두 통과했다.
- 크림·그레이 3부위 코디를 320/390/1280px에서 확인했다. 로그와 화면은 `.local/avatar-shop-qa/`에 보관했다. 최초 회귀 실행의 옛 버튼/가입 기대값 실패는 새 흐름에 맞게 갱신한 후 재검증했으며, 개발 도구 버튼이 하단 메뉴를 가린 검사는 프로덕션에서 확인했다.
- 실제 BE가 필요한 전체 live E2E는 이번 FE 작업에서 실행하지 않았다. 운영 반영 전 실제 PR #9 API 및 추가 구현된 위 계약으로 최종 통합 검증해야 한다.
