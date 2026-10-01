# 개인 스트릭 룰렛 검증

검증일: 2026-10-01. 모든 변경은 backend/ 안에서 수행한다. 개발·운영 DB 적용·배포·커밋·푸시·병합은 수행하지 않는다.

## 단계별 관문

1. 발급/조회 구현 후 단위 테스트 11개, 실제 PostgreSQL 개인/활동/그룹 통합 테스트 55개 통과. 24개 마이그레이션 전체 적용 및 ledger 재적용 통과 후 2단계로 진행했다.
2. 추첨/지급 구현 후 개인 정책 단위 테스트 25개, 실제 PostgreSQL 개인/상점/그룹 통합 테스트 77개 통과. 25개 마이그레이션 전체 적용·재적용 통과 후 3단계로 진행했다.
3. 전체 회귀·타임존·기존 데이터 보존·서식/린트/타입/빌드 검증은 아래 실행 결과에 기록한다.

## 검증 범위

- `streak-ticket.spec.ts`: 실제 당일 성공만 지급, 4→5/9→10/15/20, 어제 표시 유지 배제, 월말/연말/윤일/KST 자정.
- `streak-policy.spec.ts`: 모든 확률 경계와 1,000개 경우의 정확한 가중치, 종류/금액/합계/순서/버전 오류, 의상 전체 상품 기준 균등 인덱스.
- `streak-roulette.e2e-spec.ts`: 실제 원본 전체 완료에서 발급, 부분/중단/미수행 배제, 새 구간 재발급, 기기/키/루틴·기존 배정 동시 완료, 만료/재전송/GET 무지급, 그룹 없는 사용자, 개인 권과 그룹 기여 동시 인정.
- 추첨 통합 검사: 기존 UserCurrency/거래 지급, 미보유 판매 상품 선택, 상품 상태 필터, 50/70 대체, 실제 공용 소유권 source 직렬화, 대표 코디 유지, 성공 키 재전송/충돌/권 동시 사용, 구매와 여러 권 사용 경쟁, 판매 변경을 실제 잠금 대기로 직렬화.
- 오류/원자성: 잔액 상한·재화 누락·재화 지급 후 실제 FK 실패·상품 조회의 실제 PostgreSQL 오류·아이템 소유권 저장 후 draw trigger 실패 모두 전체 롤백. 원래 권/키가 재시도 가능함을 확인.
- HTTP: Bearer·CSRF/Origin·UUID 정규화·JSON strict·페이지 검증·no-store·최초 201/재전송 200·Idempotency-Replayed·타인 권 404/타인 결과 비노출·응답 유실 복구.
- DB: 달성/구간 unique·소유자 FK·불변 권/정책/결과·권당 draw unique·개인/그룹 키/원장 namespace 분리·계정 삭제 CASCADE.
- `streak-roulette-migration.e2e-spec.ts`: 전용 테스트 DB 내 추가 격리 스키마에서 이전 전체 마이그레이션과 기존 계정/완료/달성/그룹권·추첨/상점 구매·원장/코디 fixture를 저장한 뒤 신규 두 마이그레이션 적용. 기존 모든 테이블의 모든 행을 전후 비교하고 개인 권/추첨 백필 없음·정책 snapshot·의상 실상품 미등록·기존 구매/코디 동작을 확인.

## 재현 명령

backend/에서 실행한다. 기존 test-database 실행기는 TEST_DATABASE_URL만 사용하고 개발 DB와 같은 DB를 거절한다. 매번 무작위 test_ 스키마를 생성해 모든 마이그레이션을 deploy 두 번 실행하고 테스트 후 해당 스키마만 정리한다.

```bash
npm test -- src/streak-roulette
npm run test:e2e -- test/streak-roulette.e2e-spec.ts test/activity.e2e-spec.ts test/group-missions.e2e-spec.ts
npm run test:e2e -- test/streak-roulette.e2e-spec.ts test/avatar.e2e-spec.ts test/group-missions.e2e-spec.ts
RECOMMENDATION_PYTHON=.local/recommendation-venv/bin/python PYTHONDONTWRITEBYTECODE=1 npm run check
TZ=America/Los_Angeles npm run test:e2e -- test/streak-roulette.e2e-spec.ts test/streak-roulette-migration.e2e-spec.ts test/activity.e2e-spec.ts
```

추천 회귀는 기존 backend/.local Python 환경과 원본 읽기 전용 호출을 사용한다. 기존 runner가 Python bytecode 쓰기를 금지하며 알고리즘 복사/재구현을 하지 않는다. 단위·통합 fixture는 운영 데이터와 분리한다.

## 최종 실행 결과

- `RECOMMENDATION_PYTHON=.local/recommendation-venv/bin/python PYTHONDONTWRITEBYTECODE=1 npm run check`: Prisma validate/generate, 전체 Prettier, type-aware lint, TypeScript 검사, 단위 23개 파일/357개, 실제 PostgreSQL 통합 26개 파일/502개, Nest 빌드 모두 통과.
- `TZ=America/Los_Angeles npm run test:e2e -- test/streak-roulette.e2e-spec.ts test/streak-roulette-migration.e2e-spec.ts test/activity.e2e-spec.ts`: 3개 파일/33개 통과. 프로세스 시간대가 달라도 KST 지급/마감/날짜 경계와 업그레이드 데이터 보존이 일치한다.
- 테스트 실행기에서 25개 마이그레이션의 전체 적용과 ledger 재적용을 확인했다. 기존 데이터 보존 검사는 기존 모든 테이블의 행 비교를 통과했고 추가 격리 스키마도 정리했다.
- 최초 전체 회귀 실행은 신규 업그레이드 fixture의 assignedAt 기본값 때문에 과거 완료 시각 CHECK에서 1개 실패/501개 통과했다. 실제 과거 배정 시각을 fixture에 명시한 후 재실행은 502개 모두 통과했다.
- 시작 시점 파일 SHA-256 및 git 상태 비교: backend 밖 변경 0개, 초기 진행 중 파일과 untracked 미디어 보고서 모두 보존. README는 초기 내용 해시를 보존하며 개인 룰렛 링크만 추가했다. frontend/data-analysis의 파일 27,028개 크기·mtime 비교에서도 변화 0개여서 새 캐시/결과 파일을 만들지 않았음을 확인했다.
- 최종 DB 제약 보강 후 개인 룰렛/업그레이드 통합 2개 파일/27개 재검증 통과. 동일 권과 사용자+키의 UNIQUE(P2002), 타인 달성 composite FK(P2003)를 다른 trigger 오류가 가리지 않도록 실제 지급 근거를 갖춰 확인했다. 이후 전체 서식·린트·타입 검사도 통과했다.
- `git diff --check` 통과. 개발/운영 DB 적용·배포·커밋·푸시·병합은 수행하지 않았다.

처음 통합 검사에서 sandbox의 127.0.0.1 PostgreSQL 연결 EPERM이 발생했고 허용된 실행으로 전용 테스트 DB에서 재검증했다. 최초 신규 테스트의 시작 상태 fixture와 다른 회귀 suite가 남긴 상품 fixture 간 간섭을 보완한 재실행은 통과했다. 기존 pg 동시 query deprecation 경고는 남아 있다. 실행 실패를 성공으로 기록하지 않는다.

## 적용 및 제한

새 코드의 개발·운영 적용은 수행하지 않았다. 의상 실상품/에셋/프론트 화면은 추가하지 않았다. 향후 의상은 기존 검증된 상품 등록 절차를 따라야 하며 현재 의상 당첨은 대체 지급이다. 긴 활동 이력 조회와 실제 운영 데이터에서의 인덱스/CHECK 잠금 시간은 후속 스테이징/운영 부하 검토 대상이다.
