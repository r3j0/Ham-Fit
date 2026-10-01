# FE 연동 구현과 BE 요청 규격

기준: 최신 main `95b3a69`에 BE PR #9의 `44d1355`까지 병합됨. 2026-10-01 사용자 확정 답변을 반영한 BE 작업 전달 규격이다. 이 문서 변경은 요청 규격만 포함하며 BE 소스·DB·실행 서버는 변경하지 않는다. 기존 계획보다 아래 최신 확정 사항을 우선한다.

## 다른 세션의 BE 담당자에게 전달할 작업

최신 main에서 CONTRIBUTING 규약에 맞는 별도 BE 브랜치를 만들고 `backend/AGENTS.md`를 따른다. 작업은 하루 전체 루틴 완료 씨앗 지급·완료 보상 영수증 API, 새 출력기 상품/조합 등록, 확정 가격 반영, a-plus 판매·추첨 제외다. 자세한 HTTP 규격과 검증 조건은 아래를 따른다. FE 코드와 데이터 팀 알고리즘을 변경하지 않는다. 기능 단위로 검증하고 커밋하며, 실제 개발·운영 DB 적용 및 서버 교체는 코드 구현과 구분해 보고한다.

- 도구 6종, 영상 80% 완료 기준, 선택 세트 수행, 그룹 참가자 스냅샷·물 기여, 개인/그룹 룰렛 발급·확률·대체 지급·멱등성은 유지한다.
- 기존 스포츠웨어 4종은 계속 제외한다. 없는 모자·하의 이미지나 가상 상품을 추가하지 않는다.
- 가입 설정 완료 상태·원자적인 닉네임/초기 캐릭터 저장 API·다른 기기에서 미완료 설정 이어가기는 이번 범위에서 제외한다.
- 개인 룰렛 API 경로·응답 전환과 표시용 확률표 반영은 FE 작업이다. 기존 BE 개인 룰렛 API를 다시 구현하거나 FE의 이전 제안 경로를 추가하지 않는다. 정책 조회 API 추가는 필수가 아니다.
- 신규 마이그레이션으로 반영하고 이미 적용된 과거 마이그레이션은 수정하지 않는다. 기존 잔액·구매·소유권·코디·운동 기록은 보존한다.

## 확정한 동작

- 기존 영상 80% 시청 완료 판정 유지. `reps` / `hold` / `timed` 처방 수행은 선택이다. FE 타이머·횟수·세트 완료는 서버 완료, 스트릭, 지급 이벤트가 아니다.
- 하루 루틴 전체 완료 시 개인 해바라기씨 1개, KST 하루 한 번. 실제 지급은 BE 트랜잭션에서 처리한다.
- 전체 루틴 완료 → 완료 화면 → 서버 현재 스트릭 → 실제 지급된 씨앗 → 실제 기여한 그룹별 물 → 메인. 미지급/이미 다른 루틴에서 지급된 경우 해당 보상 화면을 건너뛴다.
- 구매 가격과 잔액은 서버 값만 사용. `priceProvisional=true`인 상품은 가격 확정 후 구매할 수 있도록 막는다. 60개를 확정 가격으로 취급하지 않는다.
- 가입 직후 `/welcome`에서 닉네임과 햄돌이/햄콩이 선택 후 `/onboarding`으로 이동. 기존 사용자는 신규 설정 화면으로 강제 이동하지 않으며, BE 기본 지급/백필 햄돌이 코디를 사용한다. 기존에 저장한 코디를 FE가 덮어쓰지 않는다.

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

## 완료 보상 API 요청 및 개인 룰렛 연동 상태

완료 보상 영수증은 아직 BE 미구현이다. 개인 룰렛은 병합된 BE에 구현됐으나 아래에 정리한 FE 계약 변경이 남았다. 현재 `.env.example`의 두 출시 설정은 `false`로 유지한다. 활성화 설정만 바꾸면 계약 불일치로 실패한다.

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

### 2. 개인 룰렛 — 최신 BE 확정 계약

`6e79fee`의 `backend/docs/streak-roulette.md`와 실제 controller/service/migration을 검증했다. 개인 룰렛이 없다는 이전 기록은 이 커밋부터 더 이상 유효하지 않다.

- 경로: `/users/me/streak-roulette/tickets`, `/spins`, `/draws`.
- tickets: `{items, availableCount, nextCursor}`. 권은 `achievementId`, `segmentStartDate`, `streakDays`, `createdAt`, `policyVersion`, `status`, `usable`, `usedAt`을 반환한다.
- spins: UUID `Idempotency-Key`와 `{ticketId}`. `{draw,replayed}` 안의 `draw.originalResult`, `actualReward`, `fallback`, `achievement`가 지급 근거다.
- 추첨 결과에 잔액/보유 목록이 없다. 성공 뒤 기존 `/users/me/avatar/inventory`를 다시 조회한다. `source=streak_roulette` 수신은 이번 FE 호환 수정에서 반영했다.
- 실제 연속 5·10·15…일 성공마다 권 1장을 발급한다. 새 구간에서 재발급하며 과거 달성을 조회로 소급 지급하지 않는다.
- 정책 `streak-2026-10-01-v1`: 씨앗 1/3/5/10개 각각 60/25/10/4.3%, 미보유 판매 의상 0.6%, 미보유 판매 자세 0.1%. 상품 없음/전부 보유 시 의상은 씨앗 50개, 자세는 70개로 대체한다.
- 정책 조회 API는 없다. FE의 현재 제안 `getPersonalPolicy()`를 그대로 호출할 수 없다. 확정 버전의 표시용 정책표를 채택하거나 BE 조회 API를 추가해야 한다. 추첨·지급 판단은 계속 서버만 담당한다.

**남은 FE 작업:** `lib/personal-rewards.ts`의 이전 `/users/me/roulette` 경로, `personal-reward-contract.ts`의 `earnedAt/streak/result/currency/inventory` 구조, 화면의 정렬/보상/잔액 표시를 위 계약으로 교체하고 실제 API로 검증한다. 현재 페이지는 준비 상태이며 플래그는 끈다. 이전 제안 계약의 mock 테스트는 새 BE 연동 완료 근거가 아니다.

## 의상 및 자세 등록 요청 — hamster-outputter-v2

사용자 지정 `hamster-outputter-v2.zip`을 현재 출력기로 사용한다. 이전 `little-wardrobe-stage/v1` 의상 좌표 및 스포츠웨어 4종은 활성 출력기에서 제외했다. 원본 16자세 × 크림/그레이 32장과 기본 자세의 민트 티셔츠 2장만 새 registry에서 지원한다. 상세 이식 범위는 [HAMSTER-OUTPUTTER.md](HAMSTER-OUTPUTTER.md)를 참고한다.

| 제안 productId        | 이름        | slot/occupiesSlots | renderKey    | 가격                       | 지원               |
| --------------------- | ----------- | ------------------ | ------------ | -------------------------- | ------------------ |
| `clothing.mint-shirt` | 민트 티셔츠 | top / [top]        | `mint-shirt` | 확정 25                    | basic × cream/gray |

공통 `kind=clothing, ownershipScope=shared, scopeCharacterId=null`. productId는 제안이며 FE는 실제 BE catalog의 ID와 가격을 사용한다. 두 캐릭터별 `{characterId,poseId:"pose.basic",clothingIds:[<등록된 상품 ID>]}` 조합을 명시적으로 등록해야 한다. 민트 티셔츠를 다른 자세로 착용 가능한 것으로 등록하면 안 된다. 모자·하의 실물은 ZIP에 없으므로 등록하지 않는다.

### 2026-10-01 확정 상품·가격

| 가격 | renderKey |
| ---- | --------- |
| 기본 지급·비판매 | `basic` |
| 50개 | `curious`, `drink`, `lying`, `stretch`, `droopy`, `cant-hear`, `foam-roller`, `phone`, `toilet` |
| 70개 | `passion`, `victory`, `run`, `pushup`, `situp`, `weight` |

사용자 답변으로 위 분류를 확정했다. BE 상품 행에서 가격과 `priceProvisional=false`를 반영하고 기존 상품 revision 증가 규칙을 사용한다. 신규 상품은 검증된 조합을 등록한 뒤 판매한다. 임시 60개를 유지하지 않는다. 캐릭터 `character.cream`/`character.gray` 및 `pose.basic`의 기본 지급 정책과 내부 ID는 유지하며 표시 이름만 햄돌이/햄콩이다.

새 자세 `foam-roller`, `phone`, `toilet`, `weight`는 ZIP에는 있으나 현재 BE catalog에는 없다. 각 자세 상품과 두 캐릭터의 의상 없는 전체 조합을 등록한다. 등록 ID는 기존 `pose.<renderKey>` 관례를 따를 수 있고, FE는 실제 catalog의 ID와 renderKey를 사용한다.

`a-plus`는 사용자 결정으로 제외한다. 새 이미지 제작 요청은 하지 않는다. 신규 구매와 개인 룰렛 당첨 후보에서 제외하도록 기존 상품을 `retired`로 전환한다. 상품 ID·기존 소유권·저장 코디는 삭제하지 않으며, 기존 소유자 복구에 필요한 호환 정보를 보존한다. FE에서는 해당 이미지가 없어 준비 중으로 표시하고 미리보기/구매/저장을 차단하며 기본 자세로 변경할 수 있다. 구매·룰렛 모두 제외됐는지 실제 API/DB로 검증한다.

## 이번 범위에서 제외한 가입 설정 복구

2026-10-01 사용자 답변으로 다른 기기에서 미완료 가입 설정 이어가기, `profileSetupCompleted` 필드, 원자적인 닉네임/초기 캐릭터 저장 API는 이번 BE 작업에 포함하지 않는다. 현재 FE의 닉네임 저장 후 outfit 저장 및 부분 성공 재시도를 유지한다. 기존 사용자의 nickname null만으로 신규 가입자로 판정하거나 설정 화면으로 강제 이동시키지 않는다.

검증 결과와 실행 범위는 별도 테스트 로그 및 최종 변경 보고를 기준으로 한다. 제안 API의 mock 성공을 실제 지급/실제 서버 구현 완료로 보고하지 않는다.

## 이전 FE 검증 (2026-10-01, f577481 기준)

- 최종 `npm run check`: ESLint, Next route typegen/TypeScript, 단위 테스트 **155개**, 프로덕션 빌드 통과. Prettier 검사 통과.
- 관련 Playwright 시나리오 **53개** 통과(중복 실행 제외). 구매 유실/새로고침/같은 키 복구, 별도 코디 저장, 412 충돌, 대표 코디의 메인/프로필 반영, 그룹 미션·룰렛, 순차 영상 80% 완료, 만료·다시보기, 세 유형의 선택 수행, 가입 및 기존 화면 회귀를 포함한다.
- 이 브라우저 검증은 **API 계약 응답을 사용하는 FE 검사**다. 실제 BE 지급이나 의상 등록이 완료되었다는 뜻이 아니다. 기존 BE 엄격 검증은 별도 PR 검증 기록을 참조한다.
- 제안 API 관련 2개 시나리오는 `NEXT_PUBLIC_DAILY_REWARDS_ENABLED=true NEXT_PUBLIC_PERSONAL_ROULETTE_ENABLED=true`로 시작한 별도 서버에서 `E2E_PROPOSED_REWARDS=true`로 실행했다. 테스트용 확률 100%는 당첨 결과 표시 검사용이며 제품 정책이 아니다.
- 기본 false 설정의 프로덕션 빌드에서도 개인 보상 API를 호출하지 않고 씨앗/물 획득을 표시하지 않는 것을 확인했다. 기본 실행 시 제안 계약 2개 시나리오는 의도적으로 건너뛰며, 위 별도 실행에서는 모두 통과했다.
- 크림·그레이 3부위 코디를 320/390/1280px에서 확인했다. 로그와 화면은 `.local/avatar-shop-qa/`에 보관했다. 최초 회귀 실행의 옛 버튼/가입 기대값 실패는 새 흐름에 맞게 갱신한 후 재검증했으며, 개발 도구 버튼이 하단 메뉴를 가린 검사는 프로덕션에서 확인했다.
- 실제 BE가 필요한 전체 live E2E는 이번 FE 작업에서 실행하지 않았다. 운영 반영 전 실제 PR #9 API 및 추가 구현된 위 계약으로 최종 통합 검증해야 한다.
