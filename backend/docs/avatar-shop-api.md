# 사용자 캐릭터·대표 코디·해바라기씨 상점 API

기준: 2026-09-30. 구현 범위는 `backend/`이며 FE 화면·에셋은 변경하지 않았다. [검증 기록](avatar-shop-verification.md)을 함께 참고한다.

## 확정 정책과 현재 등록 범위

- 사용자 답변으로 **구매한 자세·의상은 크림·그레이 공용 소유**로 확정했다. 공용 소유와 실제 렌더링 지원은 별개다.
- 신규·기존 사용자에게 `character.cream`, `character.gray`, `pose.basic`만 기본 지급한다. 최초 대표 코디는 크림/basic/의상 없음이다. 재화 기본값은 기존 `UserCurrency`의 0이다. 가입·운동 완료 자체의 직접 재화 보상은 없으며, 2026-09-30 [그룹 룰렛](group-missions.md)이 기존 개인 재화에 당첨 보상을 지급한다.
- FE의 `components/mascot/mascot-poses.d.ts`, `mascot-poses.js`, `wardrobe.js`, `MascotPose.tsx`, `public/mascots/poses`를 읽기 전용으로 확인했다. 두 캐릭터, 13개 자세, 기존 스포츠웨어 4종의 130개 조합에서 참조 이미지 파일 존재를 확인했다. 이미지 품질·부위별 합성은 검증하지 않았다.
- 후속 사용자 결정: 기존 합본 이미지 `blue-sportswear`, `black-sportswear`, `white-sportswear`, `green-sportswear`는 **카탈로그에서 제외**한다. 세트 상품 가격·전환·분리 소유권을 만들지 않는다. FE 파일은 보존한다.
- 따라서 초기 카탈로그는 캐릭터 2 + 자세 13 = 15개, 의상 미착용 지원 조합은 26개다. 의상 상품은 아직 0개이며 모자·상의·하의의 가상 이미지나 상품을 판매하지 않는다.
- 분리 의상 등록 시 초기 가격 기준은 **모자 30, 상의 25, 하의 20 해바라기씨**다. 이미지·렌더링 지원 확인 후 실제 상품 행에 가격을 등록한다.
- 아래 유료 자세 가격은 **임시값**이다. 최종 기준은 DB 상품 행이며 코드·FE 표시값이 아니다.

| 상품 ID         | FE renderKey | 초기 가격 | 상태    |
| --------------- | ------------ | --------: | ------- |
| character.cream | cream        |      null | default |
| character.gray  | gray         |      null | default |
| pose.basic      | basic        |      null | default |
| pose.curious    | curious      |        50 | on_sale |
| pose.a-plus     | a-plus       |        60 | on_sale |
| pose.drink      | drink        |        50 | on_sale |
| pose.lying      | lying        |        50 | on_sale |
| pose.stretch    | stretch      |        60 | on_sale |
| pose.run        | run          |        70 | on_sale |
| pose.passion    | passion      |        60 | on_sale |
| pose.victory    | victory      |        60 | on_sale |
| pose.pushup     | pushup       |        70 | on_sale |
| pose.situp      | situp        |        70 | on_sale |
| pose.droopy     | droopy       |        50 | on_sale |
| pose.cant-hear  | cant-hear    |        50 | on_sale |

## 공통 계약

모든 경로는 `/api/v1` 기준이고 기존 Bearer access token을 사용한다. 변경 요청은 `Content-Type: application/json`, `X-CSRF-Protection: 1`이 필요하다. 브라우저 Origin 검증과 기존 IP 제한도 유지한다. 모든 본인 데이터는 인증된 사용자 ID로 조회한다. body의 `userId`, `price`, `balance` 같은 정의되지 않은 필드는 400으로 거절한다. 응답은 `Cache-Control: no-store`이며 CORS에 ETag/Idempotency-Replayed가 노출된다.

| 메서드·경로                    | 용도                            | 성공                                |
| ------------------------------ | ------------------------------- | ----------------------------------- |
| GET /shop/products             | 저장된 상품·가격·호환 조합 조회 | 200                                 |
| GET /users/me/avatar/inventory | 본인 소유 목록과 현재 잔액      | 200                                 |
| POST /shop/purchases           | 영구 소유 상품 구매             | 최초 201, 동일 성공 요청 재시도 200 |
| GET /users/me/avatar/outfit    | 저장된 대표 코디                | 200 + ETag                          |
| PUT /users/me/avatar/outfit    | 대표 코디 전체 교체             | 200 + 새 ETag                       |

대표 코디 프리셋·구매 내역 목록·환불·선물·재판매·관리자 가격 화면·사용자 가격 수정·사용자 재화 지급 API는 제공하지 않는다. 기존 `/auth/me`의 `currency.balance`도 같은 UserCurrency다. 그룹 룰렛 보상도 같은 개인 해바라기씨에 지급한다. 성장 기여 단위인 물은 재화가 아니다.

## 상품 조회

`GET /api/v1/shop/products` 예시(전체 목록에서 일부만 발췌):

```json
{
  "products": [
    {
      "id": "pose.run",
      "kind": "pose",
      "slot": null,
      "occupiesSlots": [],
      "renderKey": "run",
      "ownershipScope": "shared",
      "scopeCharacterId": null,
      "saleStatus": "on_sale",
      "price": 70,
      "priceProvisional": true,
      "catalogRevision": 1
    }
  ],
  "combinations": [
    {
      "characterId": "character.cream",
      "poseId": "pose.run",
      "clothingIds": []
    },
    { "characterId": "character.gray", "poseId": "pose.run", "clothingIds": [] }
  ]
}
```

- `id`는 영구 소유·구매의 안정적인 SKU 키다. 허용 형식 `[a-z][a-z0-9.-]{0,99}`. 렌더링 이름과 분리하며 기존 ID를 다른 상품에 재사용하지 않는다.
- `kind`: `character`, `pose`, `clothing`. 분리 의상의 `slot`은 `hat`, `top`, `bottom`, `occupiesSlots`는 해당 슬롯 하나다. 캐릭터·자세는 slot=null, occupiesSlots=[]다. 현재 set 슬롯은 허용하지 않는다.
- `renderKey`: FE 어댑터에 전달하는 식별자다. 임의 이미지 URL을 받거나 만들어내지 않는다.
- `ownershipScope=shared`, `scopeCharacterId=null`이 현재 정책이다. 스키마는 향후 별도 정책 검토를 위한 pending/character 상태를 표현하지만 현행 상품으로 사용하지 않는다. 획득된 SKU의 소유권 정책은 변경할 수 없다.
- `saleStatus`: `default` 기본 지급/비판매, `on_sale` 판매, `held` 등록 후 검증·판매 보류, `retired` 판매 종료. 판매 종료해도 기존 소유·착용은 유지한다. 상품·호환 정보를 판매 여부로 필터링해 버리면 기존 구매자의 렌더링이 깨지므로 전체를 반환한다.
- `price=null`은 구매 가격이 없다는 뜻이다. 무료 구매가 아니다. `basic`과 기본 캐릭터는 구매할 수 없다. 유료 가격은 양의 정수다.
- `combinations`에 **전체 조합이 정확히 있어야** 저장 가능하다. 개별 모자와 상의가 각각 지원된다고 동시 착용까지 추정하면 안 된다. 미보유 상품 미리보기는 FE 내부 상태로만 처리하며 구매/코디 저장 API를 호출하지 않는다.

## 본인 보유·잔액 조회

`GET /api/v1/users/me/avatar/inventory`:

```json
{
  "currency": { "balance": 0 },
  "inventory": [
    {
      "productId": "character.cream",
      "source": "default",
      "acquiredAt": "2026-09-30T00:00:00.000Z"
    },
    {
      "productId": "character.gray",
      "source": "default",
      "acquiredAt": "2026-09-30T00:00:00.000Z"
    },
    {
      "productId": "pose.basic",
      "source": "default",
      "acquiredAt": "2026-09-30T00:00:00.000Z"
    }
  ]
}
```

`source`는 `default` 또는 `purchase`다. 기본 지급·구매 시각을 영구 보관한다. 소유권은 사용자+상품 PK로 중복될 수 없다. 구매한 의상은 지원 조합이 있는 두 캐릭터에서 공용으로 사용한다.

## 구매와 통신 재시도

```http
POST /api/v1/shop/purchases
Authorization: Bearer <access-token>
X-CSRF-Protection: 1
Content-Type: application/json
Idempotency-Key: 93ce4e82-c34a-4f97-a59a-dc0e6e031117

{"productId":"pose.run","catalogRevision":1}
```

잔액이 100인 사용자의 성공 응답 예시(구매 잔액은 테스트·예시일 뿐 가입 지급량이 아니다):

```json
{
  "replayed": false,
  "purchase": {
    "id": "d8fdfec5-f8df-4fd9-a86c-502764d8022f",
    "productId": "pose.run",
    "price": 70,
    "catalogRevision": 1,
    "createdAt": "2026-09-30T00:01:00.000Z"
  },
  "currency": { "balance": 30 },
  "inventory": [
    {
      "productId": "character.cream",
      "source": "default",
      "acquiredAt": "2026-09-30T00:00:00.000Z"
    },
    {
      "productId": "character.gray",
      "source": "default",
      "acquiredAt": "2026-09-30T00:00:00.000Z"
    },
    {
      "productId": "pose.basic",
      "source": "default",
      "acquiredAt": "2026-09-30T00:00:00.000Z"
    },
    {
      "productId": "pose.run",
      "source": "purchase",
      "acquiredAt": "2026-09-30T00:01:00.000Z"
    }
  ]
}
```

1. 한 번의 구매 의도마다 UUID 요청 키를 생성한다. 네트워크 오류·응답 유실·5xx 재시도는 **같은 키와 같은 body**를 유지한다. 연속 클릭에서도 진행 중인 키를 재사용한다.
2. 성공한 동일 키는 저장된 구매 가격·ID를 재반환하고 다시 차감하지 않는다. 이때 `replayed=true`, HTTP 200, `Idempotency-Replayed: true`다. 잔액·보유 목록은 재시도 처리 시점의 현재 데이터이므로 과거 응답과 달라질 수 있다.
3. 같은 키의 다른 상품/카탈로그 revision은 409 `IDEMPOTENCY_CONFLICT`다. 다른 키로 이미 소유한 영구 상품을 구매해도 409 `ALREADY_OWNED`이며 차감하지 않는다.
4. 실패한 트랜잭션의 키는 저장하지 않는다. 잔액 확보 후 같은 body 재시도는 가능하다. 상품 조건 변경에 동의해 body를 바꾸는 경우 새 키로 새 구매 의도를 만든다.
5. 성공 응답의 inventory/currency로 화면을 갱신하고 상품·본인 inventory 캐시를 무효화한다. 여러 요청/기기에서 응답 순서가 뒤바뀔 수 있으므로 동시에 처리한 구매가 모두 끝나면 inventory를 다시 조회한다. 숫자 차감이나 소유 추가를 FE 추정값으로 확정하지 않는다.
6. 구매는 저장 코디를 바꾸지 않는다. 착용은 별도의 PUT 요청으로 사용자가 확정한다.

### 가격 변경 중의 처리

`catalogRevision`은 FE가 본 상품 조건의 버전이며 가격 자체를 요청하지 않는다. DB trigger가 가격·판매 상태·임시 가격 여부·허용된 정책 확정 변경 시 revision을 올린다. 수동으로 revision만 낮추거나 덮어쓸 수 없다.

구매는 사용자 행을 잠근 후 상품 행에 `FOR SHARE`를 획득하고, **그 잠금 아래 읽은 DB 가격**으로 차감한다. 관리자가 가격/상태를 바꾸는 UPDATE는 이 잠금과 직렬화된다.

- 가격 변경이 먼저 잠금을 획득해 커밋하면 구매는 새 조건을 확인한다. 요청 revision이 다르면 409 `CATALOG_CHANGED`로 차감 없이 끝난다. FE는 카탈로그를 재조회해 새 가격을 보여주고 사용자 확인 후 새 키·새 revision으로 요청한다.
- 구매가 먼저 잠금을 획득하면 확인한 가격으로 구매가 완료되고, 그 다음 가격 변경이 적용된다. 같은 상품의 다른 구매자들은 공유 잠금을 사용할 수 있다.
- 이미 성공한 구매의 동일 키 재시도는 가격 변경·판매 종료 이후에도 원래 구매 가격으로 성공 재반환한다. 구매 기록의 가격·revision은 재계산하지 않는다.

## 대표 코디 조회·전체 저장

```http
GET /api/v1/users/me/avatar/outfit
Authorization: Bearer <access-token>
```

```http
ETag: "1"
```

```json
{
  "characterId": "character.cream",
  "poseId": "pose.basic",
  "clothingIds": [],
  "revision": 1,
  "updatedAt": "2026-09-30T00:00:00.000Z",
  "rendering": { "variant": "cream", "pose": "basic", "clothing": [] }
}
```

저장은 전체 필드를 보내며 빈 clothingIds는 의상 전부 해제다. 부분 PATCH는 제공하지 않는다.

```http
PUT /api/v1/users/me/avatar/outfit
Authorization: Bearer <access-token>
X-CSRF-Protection: 1
Content-Type: application/json
If-Match: "1"

{"characterId":"character.gray","poseId":"pose.run","clothingIds":[]}
```

run을 보유하고 있으면 200, 새 `ETag: "2"`, 같은 형태의 저장 응답을 반환한다. 저장마다 revision이 증가한다. 타임스탬프로 충돌을 판정하지 않는다. 여러 기기가 같은 revision으로 저장하면 하나만 성공하며 나머지는 412 `OUTFIT_CONFLICT`다. 최신 GET 후 사용자의 선택을 다시 확인하고 저장한다. 저장 응답 유실도 GET으로 확인한다. 오래된 요청에 최신 revision을 자동으로 붙여 재시도하면 안 된다.

BE는 아이템 종류, 전부 소유 여부, 부위 중복, 캐릭터 귀속 제약(향후 정책), 전체 렌더링 조합을 검사한다. 같은 슬롯의 상품 2개나 동일 상품 중복은 400, 미보유는 403, 지원되지 않는 전체 조합은 422다. 조합 하나를 가리키는 참조와 revision을 같은 트랜잭션으로 갱신하므로 캐릭터만 바뀌고 의상은 옛 상태로 읽히는 일이 없다.

FE 렌더링:

- 현재 미착용 상태는 `MascotPose`의 `variant=rendering.variant`, `pose=rendering.pose`, `outfit={}`로 대응된다. 기존 스포츠웨어를 추측해 붙이지 않는다.
- 향후 분리 의상은 `rendering.clothing[]`의 `{productId, slot, renderKey, occupiesSlots}`를 새 FE 레이어 렌더러에 전달한다. 현재 `outfit.wear`의 단일 이미지 교체 방식과 자동 호환되지 않는다.
- 현재 FE에는 마이룸이 없으므로 본인 보유 조회 → 로컬 미리보기/편집 → 명시적 저장 UI는 FE 후속 작업이다. 미리보기만으로 PUT하지 않는다.

## 그룹 프로필

기존 `GET /groups/:groupId`, `GET /groups/:groupId/members/:userId`의 `profileCharacter`를 위 대표 코디 응답 객체로 채운다. 기존 userId/nickname/streak/longestStreak/totalWorkoutDays/role/joinedAt 필드는 유지한다. 본인 `/users/me/activity`도 같은 serializer와 저장 데이터를 사용한다. 신규 별도 그룹 캐릭터 테이블은 없다.

기존 같은 그룹 멤버십 검사를 그대로 사용하며 외부인은 403이다. profileCharacter에는 현재 대표 코디와 렌더링 식별자·revision·수정 시각만 포함하고 잔액·전체 inventory·구매 기록·획득 경로는 포함하지 않는다. 저장 행 누락은 임의 기본 코디로 대체하지 않고 503으로 알린다.

## 오류 처리

상점/코디 도메인 오류 형식:

```json
{
  "statusCode": 409,
  "code": "INSUFFICIENT_FUNDS",
  "message": "해바라기씨가 부족합니다."
}
```

| HTTP              | code                                                                 | FE 처리                                                     |
| ----------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| 400               | INVALID_INPUT, INVALID_REVISION, INVALID_PRODUCT_KIND, SLOT_CONFLICT | 요청·슬롯 구성 수정                                         |
| 401/403/429       | 기존 인증·CSRF·Origin·rate-limit 응답                                | 기존 인증 처리·Retry-After 준수                             |
| 403               | ITEM_NOT_OWNED                                                       | 보유 목록 재조회                                            |
| 404               | PRODUCT_NOT_FOUND                                                    | 카탈로그 갱신; 제외된 기존 세트도 해당                      |
| 409               | NOT_FOR_SALE                                                         | 구매 버튼 비활성화·조건 재조회                              |
| 409               | ALREADY_OWNED                                                        | 보유/잔액 갱신, 재차감 없음                                 |
| 409               | INSUFFICIENT_FUNDS                                                   | 현재 잔액 표시                                              |
| 409               | CATALOG_CHANGED                                                      | 변경 가격 확인 후 새 구매 요청                              |
| 409               | IDEMPOTENCY_CONFLICT                                                 | 키 재사용 버그 확인                                         |
| 412               | OUTFIT_CONFLICT                                                      | 최신 코디 조회·사용자 재확인                                |
| 422               | UNSUPPORTED_COMBINATION                                              | 카탈로그의 전체 조합에 맞춰 편집                            |
| 428               | REVISION_REQUIRED                                                    | GET으로 ETag 확보                                           |
| 503               | CURRENCY_MISSING, OUTFIT_MISSING 또는 기존 Service Unavailable 응답  | 서버 데이터 점검; 클라이언트에서 기본값으로 초기화하지 않음 |
| 5xx/네트워크 오류 | 일반 서버 오류                                                       | 구매는 같은 키/body로 재시도; 코디는 GET으로 확인           |

## 상품 추가·가격 변경 요청 절차

FE 담당자는 다음을 BE에 전달한다. 이는 요청 규격이며 등록된 가상 상품 예시가 아니다.

| 필드                    | 규격                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| productId               | `clothing.<고유 영문 slug>`; 등록 후 재사용/변경 금지                                                      |
| kind/slot/occupiesSlots | clothing / hat·top·bottom 중 하나 / 같은 슬롯 하나의 배열                                                  |
| renderKey               | 실제 FE 레이어/에셋 식별자, 에셋 버전 또는 커밋·출처                                                       |
| ownershipScope          | shared; 크림·그레이 공용 소유                                                                              |
| price/priceProvisional  | 정수 가격; 초기 기준 hat=30/top=25/bottom=20; 기준과 다른 값은 정책 승인 근거                              |
| saleStatus              | 처음 held; 검증 완료 후 on_sale                                                                            |
| compatibility           | characterId + poseId + **전체 clothingIds** 조합 목록. 각 조합의 이미지·레이어 순서·클리핑 등 FE 검증 근거 |

BE 담당자는 새 forward-only 마이그레이션을 작성해 상품과 호환 조합을 같은 트랜잭션으로 등록한다. 조합 ID는 `JSON.stringify([characterId, poseId, [...clothingIds].sort()])`와 정확히 일치해야 한다. 예시는 테스트 fixture에만 있으며 실상품 등록 전에 FE 렌더러와 자산 존재를 확인한다. 조합의 character/pose는 해당 종류여야 하고 clothingIds는 중복 없는 의상 상품 ID여야 한다. 완전한 조합을 검증해 등록하고, 의상 하나씩의 호환성을 조합 전체의 지원으로 확대 해석하지 않는다.

상품의 id/kind/slot/occupiesSlots/renderKey와 기존 렌더링 조합은 DB trigger로 변경·재해석을 차단한다. 조합 항목은 부모 조합을 등록하는 트랜잭션에서만 추가할 수 있다. 지원 조합을 추가할 때 새 조합 행을 만들며 기존 조합을 덮어쓰지 않는다. 에셋 제거·기존 식별자의 의미 변경은 저장 코디를 깨뜨리므로 금지한다. 상품 판매 종료는 saleStatus만 retired로 바꾼다.

가격 변경 요청은 상품 ID, 현재 catalogRevision/가격, 새 가격, 임시값 여부, 변경 사유·적용 시점을 포함한다. BE가 전용 테스트 DB에서 구매 경합·과거 구매 가격 보존을 검증한 새 마이그레이션/운영 변경안을 검토한다. 예: `UPDATE avatar_products SET price=..., price_provisional=... WHERE id=... AND catalog_revision=... RETURNING ...`의 영향 행 수가 1인지 확인한다. revision은 DB가 증가시키므로 직접 지정하지 않는다. 다중 상품 갱신은 상품 ID 순서로 잠그고, 구매의 사용자→상품→재화 잠금 순서와 역순으로 섞지 않는다. 관리자 화면/일반 사용자 수정 엔드포인트를 추가하지 않는다.

## DB·내부 재화 지급·배포 경계

새 모델: AvatarProduct, AvatarCombination, AvatarCombinationItem, AvatarOwnership, AvatarOutfit, AvatarPurchase, CurrencyTransaction. 잔액은 기존 UserCurrency만 사용한다. 구매는 사용자 잠금→상품 공유 잠금→잔액 조건부 감소→구매/소유권/거래 기록 생성까지 하나의 트랜잭션이다. 중간 실패는 전부 롤백한다. DB의 비음수 CHECK와 사용자+상품/요청 키 UNIQUE도 중복 구매·음수 잔액을 막는다.

`AvatarService.grantCurrency(userId, eventKey, amount)`는 **신뢰할 수 있는 서버 내부 호출 전용**이며 Controller가 없다. 호출자는 인증된 내부 이벤트를 검증하고 서버 정책으로 지급량을 결정해야 한다. 이벤트 키는 `<source>:<event-id>` 형식, 동일 사용자+키는 1회만 지급한다. 같은 키의 다른 금액은 GRANT_CONFLICT다. `purchase:` namespace를 사용할 수 없다. 잔액 상한은 2,147,483,647이고 초과는 전체 거절한다. 2026-09-30 그룹 룰렛은 `grantCurrencyInTransaction(tx,userId,eventKey,amount)`으로 같은 지급 핵심을 호출하며 모든 수령자 지급·권 소비·추첨 저장을 한 트랜잭션에 묶는다. 기존 3인자 `grantCurrency`는 독립 트랜잭션 호출 계약을 유지한다. 수령자 계정/재화는 UUID 순서로 잠그고 상점의 조건부 차감·음수 방지·상한을 유지한다. 기존 잔액에 대한 가상 거래 이력도 소급 생성하지 않는다.

마이그레이션 `20260930000300_avatar_shop`은 기존 계정·잔액·운동·인증을 수정하지 않고 누락된 기본 소유/대표 코디만 INSERT ON CONFLICT DO NOTHING으로 추가한다. 계정 INSERT trigger가 같은 트랜잭션에서 기본 지급해 신규 가입 및 구버전 서버의 동시 가입도 보호한다. 백필 전 users 잠금으로 가입과의 누락 경합을 방지한다. 함수는 설치된 스키마의 search_path를 고정하므로 Prisma의 격리 스키마에서도 동작한다.

초기화 복구가 필요한 경우 대상 스키마에서 `SELECT initialize_avatar(id) FROM users`를 재실행할 수 있다. 잔액·구매·소유 경로·획득 시각·기존 대표 코디/revision/수정 시각은 덮어쓰지 않는다. 전체 SQL 파일의 CREATE TABLE을 반복 실행하지 않는다. 정상 적용 재처리는 Prisma migration ledger를 사용한다. GET/로그인은 누락 행을 조용히 보정하지 않는다.

이 작업에서는 **개발·운영 DB에 적용하거나 배포하지 않았다**. 향후 적용은 기존 DB 운영 절차에 따라 백업·잠금 시간·마이그레이션 검토 후 새 서버보다 먼저 진행해야 한다. 대규모 백필의 운영 잠금 시간은 별도 스테이징 검증 대상이다. 계정 삭제는 개인 소유·코디·구매·거래를 CASCADE로 삭제하고 공용 카탈로그를 보존한다.
