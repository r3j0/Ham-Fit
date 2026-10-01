# 프론트엔드 의상과 상품 등록 API

2026-10-02 사용자 최종 결정: 이미지·크기·위치·회전은 전부 프론트엔드 정적 파일에 저장한다. 백엔드에는 상품 ID·가격과 기존 판매·구매·착용에 필요한 상태/관계만 유지한다. 이전 Blob·Supabase Storage 및 DB 표시용 카탈로그 방식을 폐기한다.

## 인증과 API

관리자 토큰은 서버 전용 64자리 소문자 hex다. 없으면 관리자 API는 503, 불일치는 403이다. 브라우저 Origin이 있는 직접 요청은 거절한다. 기존 사용자 access token으로 관리자 API에 접근할 수 없다.

- `GET /api/v2/avatar-manager/catalog`: 상품 ID·가격·판매 상태, 등록 revision 조회. 이미지나 좌표를 반환하지 않는다.
- `POST /api/v2/avatar-manager/publish`: multipart `metadata` JSON만 받는다. `revision`, `products`, `combinations`, `reviewed: true`가 필요하다.
- product: `renderKey`, `price`(양의 정수), `saleStatus`(held/on_sale/retired), `slot`(기존 착용 정책용), `frames`(지원 pose/variant 식별자). PNG·이미지 URL·좌표·회전·표시 catalog 필드를 받지 않는다.
- combination: `pose`, `variant`, `clothing` renderKey 목록. 동일 슬롯 중복과 미지원 조합을 거절한다.

구형 v1 이미지 업로드·이미지 조회·표시 catalog·등록 경로는 410 `FRONTEND_ASSETS_REQUIRED`로 종료한다. Multer 이미지 파싱, Sharp, 저장소 SDK를 실행하지 않는다. 기존 계약 대신 새로운 v2 등록 경로를 사용한다.

## 저장

상품과 착용 조합은 한 PostgreSQL 트랜잭션으로 갱신한다. 기존 revision 행의 조건부 UPDATE로 동시 등록을 제어하고 오래된 요청은 409다. 변하지 않은 상품 가격은 다시 UPDATE하지 않고 자세·조합·조합 항목을 중복 무시 일괄 INSERT로 저장한다. 프레임마다 저장소 검사나 DB upsert를 실행하지 않는다. 기존 SKU 식별자·슬롯, 구매 당시 가격, 보유·대표 코디·기존 조합은 유지한다. 표시 JSON은 저장하지 않으며 성공한 신규 등록에서 이전 `avatar_render_catalogs.catalog/source_catalog`를 빈 객체로 바꾼다. 이 테이블은 과거 스키마 호환과 관리자 등록 revision에만 사용한다.

Supabase는 PostgreSQL DB로 계속 사용한다. 의상 Storage 서비스와 전용 SDK 의존성, 저장소 환경 변수 검증을 제거한다. 이전 저장소 파일을 자동 삭제하지 않는다. DB 마이그레이션은 필요 없다.

프론트엔드는 `/hamsters/wardrobe/catalog.json`과 같은 origin의 정적 PNG를 읽는다. 관리자 등록 시 로컬 파일 검증과 프론트엔드 `deployment.json` 확인을 마친 뒤 상점 메타데이터만 전송한다. NestJS는 PNG를 다운로드하거나 원격 배포를 검사하지 않는다.

운영 순서와 다른 PC에서의 사용은 [운영 등록 안내](avatar-production-publishing.md), [편집기 안내](../../avatar-manager/README.md)를 참고한다.
