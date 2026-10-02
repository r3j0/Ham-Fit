# 상점 오류 수정 운영 배포 (2026-10-02)

## 배포 소스와 결과

원격 최신 main `4e94707fce99bb8e47ab23aed6d8bd8431047204`를 기준으로 상점 오류 수정 커밋 `b88ec09fde006aefa0f66b1f6ec4dfeceef9a8b4`를 배포했다. 소스 브랜치는 `fix/root/shop-purchase-equipment`다. 두 배포의 Vercel metadata에 동일한 sourceCommit/baseMain을 기록하고 실제 값과 운영 alias 할당을 확인했다.

| 대상       | 운영 URL                       | 배포 ID                          | 상태                             |
| ---------- | ------------------------------ | -------------------------------- | -------------------------------- |
| 백엔드     | https://ham-fit-api.vercel.app | dpl_AJ8N1bXShVZRteypRb2udGBBQvjq | READY, production, aliasAssigned |
| 프론트엔드 | https://ham-fit.vercel.app     | dpl_CyfERyUReSvj9y2ZXLQWXc8bhEs4 | READY, production, aliasAssigned |

서로 다른 세트의 모자·상의·하의를 슬롯당 하나씩 조합하고 저장하도록 FE/BE를 함께 반영했다. 각 단품은 동일 캐릭터·자세에 등록되어야 한다. 서버가 새 코디를 하나의 불변 조합으로 원자적으로 저장하며 기존 소유권·revision·중복 슬롯 검증을 유지한다.

전체 구매의 기존 운영 404는 서버에 `/api/v1/shop/purchases/batch`가 없어서 발생했다. 최신 main의 전체 구매 API와 관련 마이그레이션을 배포했다. FE는 경로 미배포와 상품 자체가 없는 응답을 구분해 안내한다. 전체 구매를 개별 구매로 대체하지 않아 부분 결제를 만들지 않는다.

## 운영 DB 적용

운영 Supabase public 스키마의 기존 30개 마이그레이션을 원본과 대조했다. 그중 25개는 기존 CRLF 설치 체크섬과 Git LF 원본의 줄바꿈 차이이며 SQL 내용이 일치한다. 미완료 마이그레이션은 없고 대기 항목은 `20261002001000_avatar_purchase_batches` 하나였다. 기존 이력과 체크섬을 수정하지 않았다.

적용 전에 public 스키마의 PostgreSQL custom-format 백업을 생성하고 `pg_restore --list` 및 SHA-256으로 확인했다. 백업은 Git에서 제외되는 `backend/.local/shop-production-backup-2026-10-02-b88ec09/`에 보존했다.

- 백업 SHA-256: `61c9698418248046d8c0d2e219992fd71e3f6a07eb7b2d431807d08e23710a17`
- 신규 마이그레이션 적용 후 총 31개, 추가 대기 항목 없음.
- 새 `avatar_purchase_batches`에만 제한된 `ham_fit_api` 역할의 SELECT/INSERT/UPDATE/DELETE 권한을 부여했다.
- anon/authenticated/service_role/PUBLIC 권한을 제거했다. 기존 비활성 Data API 스키마 설정을 유지했다.
- 실제 런타임 역할로 새 테이블과 `avatar_purchases.batch_id`를 읽기 전용 조회하고 모든 DML 권한을 확인했다.
- 운영 가입·상품 구매·사용자 재화 변경 시나리오는 실행하지 않았다.

## 검증

배포 전 FE 단위 195개, BE 단위 372개, 실제 PostgreSQL 상점/등록 통합 24개, 브라우저 상점/옷장 22개가 통과했다. FE/BE lint, typecheck, production build와 변경 파일의 format 검사도 통과했다. Vercel에서는 실제 Linux 컨테이너 빌드, 원본 Python 추천 fixture와 272개 영상 카탈로그 검증, FE production build가 통과했다.

운영 HTTP 확인:

| 경로                                 | 결과                                              |
| ------------------------------------ | ------------------------------------------------- |
| BE `/api/v1/health`                  | 200, status=ok                                    |
| BE `/api/v1/health/ready`            | 200, database=ok                                  |
| BE 단건 및 전체 구매 POST, 무인증    | 각각 401, 인증 경계 확인; 기존 전체 구매 404 해소 |
| FE `/shop`, `/shop/wardrobe`         | 각각 200                                          |
| FE `/api/v1/health/ready`            | 200, 운영 API 프록시 정상                         |
| FE 단건 및 전체 구매 POST, 무인증    | 각각 401                                          |
| FE `/hamsters/wardrobe/catalog.json` | 200, 배포 번들의 내용 해시와 일치                 |

마지막 HTTP 확인 시각(UTC): `2026-10-02T14:04:47.613Z`. 이 HTTP 검증은 경로·연결·정적 파일 배포를 확인한다. 운영 재화를 사용하는 실제 결제는 하지 않았고, 구매 원자성·재시도·동시 코디 저장은 격리된 PostgreSQL 통합 테스트에서 확인했다.
