# 운영 상점의 의상 조회·추가·등록

2026-10-01 사용자 결정: import는 로컬 초안을 추가하고, 배치·픽셀·가격·판매 상태 검수 후 **서버에 등록**해야 운영 상점에 반영한다. import 즉시 운영에 공개하지 않는다. 운영 PNG는 서버의 임시 파일이 아닌 영구 저장소에 보관한다.

2026-10-02 추가 결정: Supabase DB로 이전한 환경에서는 의상 PNG도 같은 프로젝트의 Supabase Storage에 저장한다. DB 이전만으로 PNG가 이전되지는 않는다. 기존 Vercel Blob·로컬 file 저장 방식도 명시적으로 선택할 수 있다.

## 최초 운영 설정

1. 운영 NestJS에 main의 마이그레이션을 `prisma migrate deploy`로 적용한다. `20261001000500_avatar_render_catalog`까지 필요하다. 새 테이블만 생성되며 편집기의 의상 이미지와 배치는 자동 등록하지 않는다.
2. Supabase 프로젝트 **Storage → New bucket**에서 `avatar-assets`를 만든다. **Public bucket은 끄고**, 허용 MIME은 `image/png`, 최대 파일 크기는 8 MiB로 설정한다. 일반 사용자용 업로드·목록 정책은 추가하지 않는다. NestJS 서버 키로 파일을 관리한다.
3. Vercel **ham-fit-api** 프로젝트의 운영 환경에 아래를 설정한다. DB용 `DATABASE_URL`, `DIRECT_URL`, TLS 인증서 설정은 그대로 유지한다. 관리자 토큰은 로컬 편집기와 같은 소문자 64자리 hex를 사용한다. Supabase 서버 키는 **Project Settings → API Keys**의 `sb_secret_...` 키 또는 기존 `service_role` 키이며 채팅·Git·프론트엔드 `NEXT_PUBLIC_`에 넣지 않는다.

   ```dotenv
   AVATAR_ASSET_STORAGE=supabase
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SECRET_KEY=<server-only secret key>
   SUPABASE_AVATAR_BUCKET=avatar-assets
   AVATAR_MANAGER_TOKEN=<existing manager token>
   ```

4. 이 변경을 포함한 NestJS를 배포한다. Vercel의 file 설정과 누락된 Supabase 자격 증명은 기동 단계에서 거절한다. 운영 CA 파일을 Docker 이미지의 `/app/backend/deploy/supabase-prod-ca-2021.crt`에 포함하고 서울 리전 `icn1`을 유지한다. 버킷 접근·비공개 여부는 첫 저장·조회 때 검증한다.
5. Mac의 `avatar-manager/.env.local`에 `AVATAR_BACKEND_URL=https://운영-API-도메인/api/v1`과 운영 NestJS와 동일한 `AVATAR_MANAGER_TOKEN`을 설정한다. `.env.local`은 Git에서 제외되며 관리자 토큰은 Next.js 서버만 읽는다.
6. Mac에서 편집기를 실행하고 `http://127.0.0.1:3002/wardrobe`를 연다.

Supabase DB와 Storage는 각각 연결해야 한다. 코드 설치·검증 성공만으로 버킷이 생성되거나 운영 DB에 상품이 등록되지는 않는다. 기존 Blob 운영은 `AVATAR_ASSET_STORAGE=vercel-blob`과 해당 비공개 Blob 인증을 유지할 수 있다.

로컬 백엔드에서 Storage 서버 설정을 넣은 뒤 `npm ci`, `npm run build`, `npm run avatar:storage:setup -- --create --smoke-test`로 버킷 생성·실제 PNG 업로드·새 서비스 인스턴스의 다운로드·해시 일치를 확인한다. 이미 비공개 버킷을 만들었다면 `--create`를 생략한다. 검사 PNG 하나만 생성 후 삭제하며 상품·가격·카탈로그와 기존 파일은 변경하지 않는다. 이 검사는 로컬 설정을 확인하므로 배포 후 운영 연결도 별도로 확인한다.

## 운영자가 사용하는 화면

- **서버 연결·버전 확인**: 운영 상품의 가격·판매 상태, 의상 버전, 이미지 저장 방식을 조회한다. 가격을 편집한 후 다시 누르면 서버 가격으로 돌아간다.
- **서버 등록본 불러오기**: 운영 원본·수정 PNG와 배치를 내려받는다. 기존 로컬 초안은 `.local/backups`에 보관한 다음 서버 등록본으로 바뀐다. 최초 등록 전에는 서버 의상이 없다는 상태를 표시한다.
- **상품 추가 → 의상 폴더 가져오기**: 새 세트 폴더 또는 새 세트들을 담은 폴더를 선택한다. QA가 passed이고 검수자·ISO 검수 시각이 있는 1000×1000 투명 PNG만 가져온다. 기존 상품·배치·픽셀 수정본은 유지한다. 동일한 상품 ID 추가는 거절한다.
- **서비스 의상 등록**: 상품명·ID 검색, 운영 등록/로컬 초안 구분, 가격·판매 상태 설정을 제공한다. 검색한 상품만이 아니라 현재 로컬 전체 목록을 함께 등록한다.
- **조정값 저장 / 픽셀 수정 저장**: Mac에만 초안을 저장한다.
- **서버에 등록**: 검수한 PNG와 현재 전체 카탈로그·가격·지원 착용 조합을 운영에 등록한다. 새 상품의 기본 판매 상태는 보류이며, 판매하려면 **판매 중**을 선택한다.

폴더 가져오기는 세트별 추가 방식이므로 기존 제작 세트를 다시 모두 준비할 필요가 없다. 기존 터미널 `import:assets`는 전체 제작 스냅샷을 교체하는 별도 방식이며 유지할 기존 세트도 입력에 포함해야 한다. 편집 중이거나 세부 작업 패널이 열린 상태에서는 폴더 가져오기와 서버 등록이 비활성화된다.

## 등록과 서비스 조회

PNG를 검증·정규화한 뒤 Supabase의 비공개 `avatar-assets` 버킷에 `<sha256>.png`로 저장한다. 같은 이미지의 재등록은 기존 파일을 재사용하며 기존 파일을 덮어쓰지 않는다. 다른 이미지로 수정하면 새 해시를 사용하므로 과거 원본·수정본을 보존한다. 동시에 같은 파일을 업로드하더라도 바이트가 일치할 때만 성공한다. 파일 누락은 404, 버킷 누락·공개 버킷·권한·연결·파일 손상은 503이며 PNG 형식 오류와 구분한다.

이미지 저장이 성공하고 모든 원본·수정 파일이 확인되면 카탈로그·상품 가격/상태·착용 조합을 연결된 PostgreSQL 트랜잭션으로 함께 갱신한다. 버전이 오래됐으면 409로 거절한다. 기존 상품 ID·구매·소유·코디 선택은 유지한다. 기존 등록 프레임 제거는 거절하므로 판매 중단은 판매 종료 상태를 사용한다. 실패한 등록이 남긴 미참조 PNG를 자동 삭제하지 않는다.

DB와 프론트엔드의 이미지 URL 계약은 기존 `/api/v1/avatar/assets/<sha256>.png`를 유지한다. NestJS가 비공개 Supabase Storage에서 PNG를 읽어 공개 이미지 API로 응답하며 해시를 확인한다. Storage 서버 키는 브라우저에 전달하지 않는다. 프론트엔드는 운영 `/avatar/render-catalog`와 기존 상점 API를 조회하므로 콘텐츠 등록 후 화면을 새로고침하면 반영되며 프론트엔드 재배포가 필요 없다.

기존 서버 파일 또는 Blob에서 Supabase Storage로 옮길 때는 먼저 기존 PNG 원본·수정본을 보존한 로컬 편집본을 준비한다. 파일이 사라지기 전 서버 등록본을 불러오거나 백업에서 복구한 뒤, Supabase Storage 설정과 백엔드 배포 후 같은 상품 ID로 다시 등록한다. DB 주소는 그대로이며 PNG가 Supabase Storage에 업로드된다. DB만 남고 PNG 원본도 백업도 없으면 이미지 복구를 대신할 수 없다.

## 검증 범위

단위 테스트는 실제 Supabase SDK의 HTTP 요청과 응답을 대체해 중복·동시 업로드, 신규 서비스 인스턴스의 조회, 파일 무결성, 저장소 오류를 검사한다. 전용 로컬 테스트 DB의 임시 스키마에서 file·Blob·Supabase SDK 대체 방식 모두 등록 → 상점 조회 → 구매 → 코디 저장 → 재등록을 검사한다. 이 검사는 실제 운영 Storage 인증이나 운영 상품 등록을 수행하지 않는다. 운영 연결 후 최초 등록과 재기동 뒤 이미지 조회는 실제 운영 설정에서 확인한다.

공식 확인 2026-10-02: [Supabase Storage 버킷](https://supabase.com/docs/guides/storage/buckets/fundamentals), [서버 키와 접근 제어](https://supabase.com/docs/guides/storage/security/access-control), [오류 코드](https://supabase.com/docs/guides/storage/debugging/error-codes). 기존 Blob 참고: [Vercel Blob](https://vercel.com/docs/vercel-blob), [Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk), [컨테이너 동작](https://vercel.com/docs/functions/container-images).
