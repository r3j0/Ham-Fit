# 로컬 아바타 관리자 연결

2026-10-01 사용자 요청으로 저장소의 `avatar-manager/`를 별도 Next.js 로컬 앱으로 추가했다. 기존 사용자 상점·구매·대표 코디 계약은 유지하고, 공용 의상 에셋의 등록·조회 API만 추가한다.

## 설정

`AVATAR_MANAGER_TOKEN`은 32바이트 난수의 소문자 64자리 hex 문자열이다. 없으면 관리자 API는 503으로 비활성화한다. 일반 사용자 access token으로 관리자 API에 접근할 수 없다. 로컬 관리자 Next.js 서버만 토큰을 읽고 NestJS에 전달하며, 브라우저 Origin이 붙은 직접 관리 요청은 거절한다. `avatar-manager/npm run setup:local`이 생성한 `.env.avatar-manager`도 ConfigModule에서 읽으며 기존 `.env`·환경 변수가 우선한다.

`AVATAR_ASSET_STORAGE`는 `file`, `vercel-blob`, `supabase`다. 로컬 기본값은 file이고 기존 Vercel 기본값은 vercel-blob이다. Supabase 운영에서는 `supabase`를 명시하고 `SUPABASE_URL`, 서버 전용 `SUPABASE_SECRET_KEY`, 비공개 `SUPABASE_AVATAR_BUCKET`(기본 `avatar-assets`)을 설정한다. 새 `sb_secret_...` 키 또는 기존 `service_role` 키만 허용하며 DB 비밀번호·publishable/anon 키를 받지 않는다. 버킷을 읽을 수 없거나 public이면 저장·조회를 거절한다. Blob은 기존 비공개 저장소와 인증 방식을 유지한다. 공개 PNG API 주소는 저장소와 무관하게 유지한다. file의 기본 경로는 `.local/avatar-assets`이며 Vercel에서는 file 설정을 거절한다. 자세한 운영 연결·최초 등록은 [운영 상점 등록 안내](avatar-production-publishing.md)를 따른다.

## HTTP 계약

모든 경로는 `/api/v1` 기준이다.

| 메서드·경로                    | 인증                     | 내용                                                        |
| ------------------------------ | ------------------------ | ----------------------------------------------------------- |
| GET `/avatar-manager/catalog`  | `X-Avatar-Manager-Token` | 수정본·원본 catalog, 에셋 revision, 의상 가격·상태          |
| POST `/avatar-manager/images`  | 관리자 토큰              | multipart `png`, 최대 8 MiB, 단일 프레임 1000×1000 알파 PNG |
| POST `/avatar-manager/publish` | 관리자 토큰              | multipart `metadata` JSON 파일, 최대 2 MiB                  |
| GET `/avatar/render-catalog`   | 기존 Bearer access token | 서비스용 의상 catalog·revision                              |
| GET `/avatar/assets/:filename` | 공개                     | 해시 PNG, immutable 캐시                                    |

등록 metadata는 `revision`, `catalog`, `sourceCatalog`, `products`, `combinations`, `reviewed: true`를 가진다. `products`는 catalog의 모든 renderKey에 대해 양의 정수 `price`와 `held/on_sale/retired`를 명시한다. 각 layer는 내부 PNG URL과 1000×1000 기준 `x/y/width/height/rotation/zIndex`, 선택 `opacity/fit`을 가진다. frame은 passed QA·검수자·ISO 검수 시각이 필요하다. 제작 provenance 추가 필드는 QA 안에 보존한다.

PNG 업로드는 실제 디코딩·크기·알파를 검증하고 RGBA PNG로 정규화한다. 서버의 실제 바이트 해시를 URL로 사용한다. 원본 레이어는 투명 배경과 보이는 픽셀이 모두 필요하며, 완전히 지운 수정본은 허용한다. 파일이 없거나 해시가 다르면 등록하지 않는다. 파일 업로드 실패 또는 metadata 등록 실패 시 부분 catalog를 공개하지 않는다. 업로드된 미참조 파일은 남을 수 있으며 자동 삭제하지 않는다.

## DB 일관성

신규 `avatar_render_catalogs`는 원본과 수정본 JSONB 및 에셋 revision을 가진다. 현재 catalog, SKU 조건, 확인된 착용 조합을 한 트랜잭션에서 갱신한다. 조건부 revision UPDATE가 row lock을 확보하며 오래된 등록 요청은 409 `ASSET_CONFLICT`다. 상품의 가격 revision과 에셋 revision은 독립적이다. 기존 구매 가격·소유·대표 코디 revision은 변경하지 않는다.

상품 ID는 `clothing.<renderKey>`, 소유는 기존 shared 정책이다. 기존 슬롯·renderKey는 변경할 수 없다. 기존 등록 프레임을 제거하는 snapshot은 거절한다. 새로운 자세 상품은 실제 의상 프레임에 한해 held/가격 없음으로 만들고 기존 자세 상품의 가격·상태는 유지한다.

passed 프레임은 해당 개별 의상의 캐릭터·자세 조합만 등록한다. 여러 의상 조합은 관리자가 미리보고 `combinations`에 명시한 조합만 추가한다. 다른 슬롯이 각각 지원된다고 전체 조합을 자동 추정하지 않는다. `AvatarCombination`과 저장된 코디를 삭제하거나 기존 SKU를 재사용하지 않는다.

프론트엔드 `AvatarCatalogProvider`가 기존 인증 통신으로 catalog를 읽고 상점·프로필·그룹 렌더러에 전달한다. 정적 제작 catalog는 독립 렌더러·검증 fixture로 보존하지만 서비스 화면은 서버 catalog를 명시적으로 사용한다. 실패·누락 시 생성 의상으로 대체하지 않는다.
