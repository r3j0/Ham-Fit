# 캐릭터·대표 코디·상점 검증 기록

이 문서는 2026-09-30 초기 구현의 검증 기록이다. 현재 가격·등록 상품·완료 보상은 [출력기 v2](avatar-outputter-v2.md)와 [완료 보상](activity-rewards.md)의 2026-10-01 계약을 따른다.

검증일: 2026-09-30. [API·정책·FE 연동 계약](avatar-shop-api.md).

## 구현 결과

- 캐릭터 2종 + basic 기본 소유, 크림/basic/미착용 대표 코디. 신규 가입 INSERT와 같은 트랜잭션에서 초기화하고 기존 사용자 백필은 누락 행만 추가한다.
- 영구 소유·획득 경로, 공용 소유 정책, 안정적인 상품/렌더링 식별자, 검증된 전체 조합 등록 구조.
- 자세 12종 판매(50~70 임시 가격), 기본 캐릭터/basic 비판매. 사용자 답변대로 합본 스포츠웨어 4종 제외, 의상 상품 0개. 분리 의상의 hat/top/bottom 슬롯과 초기 가격 기준은 계약에 명시했다.
- 기존 UserCurrency의 조건부 차감·소유 추가·구매/재화 거래 이력의 단일 트랜잭션, 영구 요청 키, 중복 소유 방지, DB 가격과 조건 revision 검증.
- 별도 원자적 코디 저장·If-Match 충돌 검증. 사용자/그룹 프로필에 같은 저장 코디를 직렬화한다.
- 서버 내부 전용 지급 함수·지급 이벤트 중복 방지. 가입/운동/그룹에 보상을 연결하지 않았다.

## 실제 수행한 검사

| 검사                                         | 결과                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Prisma validate / generate                   | 통과                                                                                           |
| TypeScript typecheck                         | 통과                                                                                           |
| oxlint type-aware                            | 통과                                                                                           |
| Prettier format:check                        | 통과                                                                                           |
| Nest production build                        | 통과                                                                                           |
| 단위 검사                                    | 20개 파일, **302건 통과**                                                                      |
| PostgreSQL 통합 검사                         | 22개 파일, **417건 통과**                                                                      |
| 전체 마이그레이션 최초 적용 + 두 번째 deploy | 전용 DB의 새 임시 스키마에서 성공, 두 번째 미적용 항목 없음                                    |
| FE 렌더링 데이터 읽기 전용 조사              | 2캐릭터 × 13자세 × (미착용+기존 4합본)의 130개 참조 PNG 존재 확인; 실제 등록은 미착용 26조합만 |
| git diff --check                             | 통과                                                                                           |

최종 실행 명령은 backend/에서 다음과 같다. 기존 `.local/`에는 다른 작업자의 검증용 프로젝트 복사본이 있어 실제 src/test 파일만 실행하도록 복사본을 제외했다. 파일을 삭제하거나 변경하지 않았다.

```sh
npm run db:validate
npm run db:generate
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test -- --exclude '**/.local/**'
RECOMMENDATION_PYTHON=.local/recommendation-venv/bin/python npm run test:e2e -- --exclude '**/.local/**'
```

통합 runner는 `TEST_DATABASE_URL`을 요구하고 개발 DATABASE_URL과 같은 DB를 거부한다. 실제 사용한 DB는 `project_health_test`, 매 실행 `test_<uuid>` 스키마였다. 업그레이드 검사는 같은 전용 DB에 추가 `test_avatar_<uuid>` 스키마를 만들었다. 모든 테스트 스키마는 종료 시 정리된다. 개발/운영 마이그레이션·배포는 실행하지 않았다.

검증 과정에서 수정/해결한 항목:

- 초기 trigger의 비기본 schema 함수 참조를 `SET search_path FROM CURRENT`로 고정했다.
- AvatarModule의 DatabaseModule import 누락을 수정했다.
- 업그레이드 fixture 닉네임의 금지된 공백을 제거했다.
- 기본 Python 실행 시 추천 루틴 통합 25건이 503으로 실패했다. 기존 추천용 가상환경 지정 후 전체 417건이 통과했다. 추천 코드는 이 작업에서 수정하지 않았다.
- 단위 HTTP 검사 4건의 sandbox `listen EPERM`은 로컬 포트 사용 권한으로 재실행해 통과했다. 테스트 DB 접속도 sandbox 차단 이후 권한을 받아 수행했다.
- 기존 pg 테스트 일부의 동시 `client.query` deprecation warning은 남아 있으나 최종 실패·스킵은 없다.

## 새 기능 상세 증거

`test/avatar.e2e-spec.ts` 13건과 `test/avatar-migration.e2e-spec.ts` 1건이 추가됐다.

- 기본 소유 3개, balance=0, 최초 코디, 15상품/26조합, basic 구매 금지, 기존 합본 상품 제외.
- 정상 구매·실제 가격·구매 당시 revision·차감 거래 이력·source=purchase, 구매 시 코디 불변.
- 잔액 부족·위조 가격/추가 body 필드·미등록 상품 거절 및 실패 후 정상 재시도.
- 같은 요청 5건 동시 실행: 신규 성공 1회, 재반환 4회. 서로 다른 상품/키 경쟁도 한 번만 잔액을 사용하고 음수 잔액 없음.
- 마지막 재화 거래 INSERT에 DB CHECK 오류를 주입해 이미 수행된 차감·구매·소유 INSERT까지 모두 롤백함을 확인하고, 같은 키로 다시 구매 성공.
- 가격 변경 후 stale catalogRevision 거절, 새 가격 구매, 판매 종료 후 예전 성공 요청의 원래 가격 재반환.
- 가격 변경 트랜잭션을 실제로 유지하고 `pg_stat_activity`에서 구매가 상품 잠금을 기다림을 확인한 뒤 커밋: 이전 가격 요청은 차감 없이 CATALOG_CHANGED.
- 미보유 착용 거절·상품 종류·중복 상품/슬롯·지원되지 않는 전체 조합 거절. 테스트 전용 분리 의상 fixture로 서로 다른 슬롯의 전체 조합 저장 및 미지원 캐릭터 조합 거절.
- 테스트 전용 상의 상품을 25개에 구매하고 크림/그레이 공용 착용, 재구매 거절. 가상 의상 fixture는 테스트 DB에만 있고 배포 카탈로그에 없다.
- 두 기기의 같은 revision 저장 경쟁은 성공 1건/412 1건. 조회·미리보기용 카탈로그 조회가 저장을 변경하지 않음. 재로그인·새 Nest 앱 인스턴스에서 동일 저장 코디 반환.
- 같은 그룹원이 최신 코디를 확인하고, 외부인 접근은 403. 그룹 응답에 잔액·보유·구매·이메일·비밀번호 없음.
- 내부 지급 동일 이벤트 동시 실행의 1회 지급, 내용 충돌·상한 초과·구매 namespace 위조 거절, 공개 지급 경로 없음.
- 인증·CSRF·Origin·JSON/추가 필드·If-Match 필수 형식 검증.
- 기존 계정·비밀번호·닉네임·시각·잔액·설정·세션을 보존하는 실제 이전 스키마 업그레이드. 구매/저장 후 실제 초기화 함수를 두 번 재실행해 잔액·소유/시각·코디/revision·구매/거래 이력 불변 확인.
- 구버전 방식의 사용자 INSERT도 기본 지급, 사용자 생성 롤백 시 기본 소유 롤백, 음수 잔액/중복 소유 DB 제약, 상품 렌더링 의미·조합 수정 거절, 계정 삭제 시 개인 데이터 정리와 다른 사용자/카탈로그 보존.

기존 groups 테스트는 이전 `profileCharacter:null` 기대값을 기본 저장 코디로 갱신했다. 인증·계정·닉네임/생년월일·설정·활동·그룹·측정·운동 관련 전체 기존 검사도 최종 전체 실행에 포함됐다.

## 변경 파일 (이 작업 소유 범위)

다른 작업자의 추천·운동 도구 관련 변경은 보존했으며 아래 목록에서 제외한다. 모든 파일은 backend/ 내부다.

- `src/avatar/avatar-input.ts`, `avatar-view.ts`, `avatar.controller.ts`, `avatar.module.ts`, `avatar.service.ts`: 입력·직렬화·API·트랜잭션·내부 지급.
- `src/app.module.ts`, `src/database/database.service.ts`, `src/setup-app.ts`, `src/users/member-profile.ts`: 모듈 등록·스키마별 잠금/health·캐시 방지·그룹/본인 프로필 연동.
- `prisma/schema.prisma`: 새 7개 모델과 User 관계만 이 작업의 변경이다. 기존 추천/도구 모델의 동시 변경은 보존했다.
- `prisma/migrations/20260930000300_avatar_shop/migration.sql`: 새 테이블·제약·카탈로그·백필·신규 사용자 초기화·상품/조합 보호.
- `test/avatar.e2e-spec.ts`, `test/avatar-migration.e2e-spec.ts`, `test/groups.e2e-spec.ts`: 새 기능/마이그레이션 검사와 그룹 기대값 확장.
- `docs/avatar-shop-api.md`, `docs/avatar-shop-verification.md`: 계약과 검증 기록.
- `docs/groups-api.md`, `docs/groups-verification.md`, `docs/group-missions.md`, `docs/activity-streaks.md`, `docs/database.md`, `README.md`: 기존 설명의 현재 코디 연동 반영 및 문서 링크.

## 미검증·남은 작업

- FE 마이룸/상점 화면, 실제 브라우저에서 구매→미리보기→저장→그룹 렌더링은 구현·검증하지 않았다. FE 담당자가 위 계약으로 연동해야 한다.
- 분리 모자·상의·하의의 실제 에셋·레이어 렌더러·개별 상품 ID·전체 지원 조합은 아직 없다. 준비 후 FE 요청 규격으로 등록해야 한다. 합본 4종의 자동 분리/이전 정책은 만들지 않았다.
- 유료 자세의 최종 가격, 재화 획득 조건·지급량은 미정이다. 임시 가격과 내부 지급 함수만 제공한다. 공용 소유/합본 제외는 사용자 답변으로 확정돼 추가 결정이 필요하지 않다.
- 운영 규모의 대량 백필 잠금 시간·고부하/장기 부하·프로세스 강제 종료/네트워크 장애 주입은 별도 스테이징 검증 대상이다. 테스트는 실제 PostgreSQL 경합·오류 주입·새 앱 인스턴스 재조회까지 수행했다.
- 개발·운영 DB 적용 및 배포는 요청 범위 밖이며 수행하지 않았다.
