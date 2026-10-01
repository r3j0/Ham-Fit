# Project Health Avatar Manager

운영자가 로컬에서 의상 PNG·배치를 편집하고 NestJS에 등록하는 별도 Next.js 앱입니다. 서비스 프론트엔드와 독립적으로 실행합니다. 편집 중의 변경은 로컬 초안이며, **서버에 등록**을 누르면 PostgreSQL·서버 이미지 저장소·상품·착용 조합에 반영됩니다.

## 로컬 실행

전체 프로젝트는 backend의 요구 사항에 맞춰 Node.js 24.15 이상(24.x) 또는 26 이상을 사용하세요. 편집 앱 단독 요구 사항은 Node.js 20.9 이상입니다. 기존 backend `.env`의 DB·JWT 설정을 먼저 준비합니다.

```bash
npm ci
npm run setup:local
```

`setup:local`은 관리자 전용 토큰을 생성해 이 앱의 `.env.local`과 `../backend/.env.avatar-manager`에 저장합니다. 기존 backend `.env`의 DB·로그인 설정은 그대로 사용합니다. 값이 서로 다르면 덮어쓰지 않습니다. 토큰은 브라우저에 전달하지 않습니다.

백엔드 터미널:

```bash
cd ../backend
npm ci
npm run db:migrate:deploy
npm run start:dev
```

다른 터미널에서 이 폴더로 돌아와 실행합니다.

```bash
npm run dev
```

편집기는 `http://127.0.0.1:3002/wardrobe`, 기본 NestJS 주소는 `http://127.0.0.1:3001/api/v1`입니다. 서비스 프론트엔드는 기존대로 3000번 포트를 사용합니다. 별도 서버가 이미 실행 중이면 포트를 변경하세요. 백엔드를 다른 주소에 두면 `.env.local`의 `AVATAR_BACKEND_URL`을 변경합니다.

## 편집·등록

1. 의상·자세·색상·레이어를 선택하고 크기·위치·회전을 조정합니다. **조정값 저장**은 `.local/placements.json`에 저장합니다.
2. **의상 세부 작업**에서 크기 1–160px 펜·지우개와 스포이드로 수정합니다. **픽셀 수정 저장**은 원본 PNG를 유지하고 수정본을 저장합니다. 25–1600% 확대, 400%부터 픽셀 격자, 실행 취소·다시 실행을 제공합니다.
3. 서비스 등록 패널에서 가격과 판매 상태를 정합니다. 새 의상은 기본 판매 보류입니다. 초기 가격은 모자 30·상의 25·하의 20 해바라기씨이며 등록 전에 변경할 수 있습니다.
4. 자세별 미리보기를 확인합니다. 여러 의상을 함께 착용하려면 **여러 의상의 착용 조합 검수**에서 조합을 미리보고 추가합니다. 개별 의상 프레임만으로 여러 의상의 조합을 자동 추정하지 않습니다.
5. 검수 확인란을 선택하고 **서버에 등록**을 누릅니다. 저장하지 않은 배치 변경이나 열린 픽셀 패널이 있으면 등록할 수 없습니다.
6. 서비스 프론트엔드를 다시 열거나 새로고침하면 DB에 등록된 이미지와 배치를 표시합니다. 열려 있는 화면은 포커스 복귀와 60초 주기로 의상 목록을 갱신합니다. 프론트엔드 재빌드는 필요하지 않습니다.

**서버 등록본 불러오기**는 원본·수정 PNG와 배치 정보를 내려받아 계속 편집할 수 있습니다. 이전 로컬 메타데이터는 `.local/backups`에 보관합니다. 다른 관리자가 먼저 등록했다면 버전 충돌로 거절됩니다. 서버 버전과 변경 내용을 확인한 후 다시 등록하세요.

로컬 저장·등록·불러오기는 공유 파일 잠금으로 동시 실행을 거절합니다. 서버를 강제 종료한 후 잠금이 남았다면 모든 편집 서버가 종료됐는지 확인하고 `.local/workspace.lock`을 제거합니다.

## 새 의상 import

화면에서 **상품 추가 → 의상 폴더 가져오기**를 누르면 `manifest.json`과 PNG가 들어 있는 새 세트 폴더를 선택할 수 있습니다. 여러 새 세트를 담은 상위 폴더도 가능합니다. 기존 상품·배치·픽셀 수정본을 유지하면서 검수된 새 상품만 추가합니다. 동일한 상품 ID는 거절하며 QA가 passed·검수자·ISO 검수 시각을 가진 프레임만 가져옵니다. 가져오기는 로컬 초안 추가이며, 가격·판매 상태·배치를 확인한 다음 **서버에 등록**해야 서비스에 표시됩니다. 상품 검색과 **운영 등록 / 로컬 초안** 표시는 서비스 의상 등록 영역에 있습니다.

다음 터미널 명령은 **전체 제작 스냅샷 교체** 방식입니다. 화면의 폴더 가져오기와 달리 기존 세트도 모두 함께 입력해야 합니다.

기존 제작 파일의 `sets` 폴더를 사용합니다. 각 set에 `manifest.json`과 1000×1000 투명 PNG가 필요하며 `qa.status=passed`, 검수자·검수 시각을 기록해야 합니다. 개발 서버를 종료한 뒤 실행합니다.

```bash
npm run import:assets -- "/absolute/path/to/art-production/sets"
npm run check
npm run dev
```

입력은 모든 세트를 담은 **sets 폴더**입니다. 유지할 의상 세트를 모두 포함하세요. 서버 등록은 기존 등록 의상·자세·색상의 제거를 거절합니다. 기본 햄스터 그림은 이 앱의 `public/hamsters/base`에 있으며 의상 조정으로 변경하지 않습니다.

macOS Finder에서 `sets` 폴더를 선택하고 Option 키를 누른 상태로 우클릭 → **경로 이름 복사**를 선택하면 절대 경로를 얻습니다. 터미널 명령의 경로를 큰따옴표로 감싸면 공백이 있는 폴더도 사용할 수 있습니다.

현재 포함된 의상도 유지하려면 이 폴더에서 다음 명령으로 제작용 sets를 먼저 복원하고, 그 안에 새 세트를 추가하세요.

```bash
mkdir -p "$HOME/avatar-art/sets"
for avatar_manifest in docs/imports/*.json; do
  avatar_set=$(basename "$avatar_manifest" .json)
  mkdir -p "$HOME/avatar-art/sets/$avatar_set"
  cp -R "public/hamsters/wardrobe/$avatar_set/." "$HOME/avatar-art/sets/$avatar_set/"
  cp "$avatar_manifest" "$HOME/avatar-art/sets/$avatar_set/manifest.json"
done
npm run import:assets -- "$HOME/avatar-art/sets"
```

폴더 형식은 `sets/set-new/manifest.json`, `sets/set-new/top/basic-cream.png`처럼 구성합니다. [manifest 예시](docs/import-manifest.example.json)의 `setId`는 폴더 이름과 같아야 합니다. `items[].id`는 등록 후 바꾸지 않는 상품 식별자이며 `slot`은 `hat`, `top`, `bottom` 중 하나입니다. `frames.<pose>.<cream|gray>.src`는 세트 폴더 안의 PNG 상대 경로입니다. 예시의 pending QA는 가져오지 않으므로 실제 이미지 검수 후 passed·검수자·ISO 시각을 입력하세요. 누락한 자세·색상은 지원하지 않으며 다른 이미지를 대신 표시하지 않습니다.

import는 검수된 원본 카탈로그와 PNG 목록을 교체합니다. 서버에서 불러온 이미지까지 유지해야 한다면 먼저 해당 원본 세트를 제작 폴더에 함께 준비하세요. import 뒤에는 미리보기를 확인하고 **서버에 등록**해야 서비스가 바뀝니다.

## 연결 구조

`src/app/wardrobe`는 배치·픽셀 편집 화면, `src/app/api/wardrobe`는 로컬 초안 저장, `src/lib/publish.ts`는 저장본의 PNG 업로드와 카탈로그 등록을 담당합니다. 관리자 토큰은 Next.js 서버에서만 읽습니다.

NestJS `backend/src/avatar/assets.*`는 PNG 검증·파일 보관·카탈로그와 상품·착용 조합의 DB 갱신을 담당합니다. 프론트엔드 `AvatarCatalogProvider`는 이 서버의 카탈로그를 받아 상점·옷장·프로필·그룹의 공통 햄스터 렌더러에 전달합니다. PNG 바이트는 영구 파일 저장소, 배치와 PNG URL·연결 정보는 DB의 JSONB에 저장합니다.

## 저장과 배포

- 로컬 초안: `.local/catalog.json`, `.local/placements.json`, `.local/artwork.json`.
- 서버 배치·이미지 연결: PostgreSQL `avatar_render_catalogs`. 상품·구매·보유·대표 코디 테이블과 별개입니다.
- 서버 PNG: Vercel 운영은 Private Blob 저장소의 `avatar-assets/<SHA-256>.png`, 로컬은 `AVATAR_ASSET_DIR`의 파일입니다. 로컬 기본값은 backend 실행 경로의 `.local/avatar-assets`입니다.
- 서비스 조회: 인증된 `GET /api/v1/avatar/render-catalog`와 PNG `GET /api/v1/avatar/assets/<hash>.png`.
- 등록 API: 관리자 토큰으로 보호된 `/api/v1/avatar-manager/catalog`, `/images`, `/publish`.

Vercel 운영에서는 `AVATAR_ASSET_STORAGE=vercel-blob`과 Private Blob 저장소를 사용합니다. Blob 인증 정보는 NestJS에만 설정합니다. 다른 온라인 서버에서 file 방식을 사용한다면 `AVATAR_ASSET_DIR`을 **영구 볼륨의 절대 경로**로 지정하고 DB와 함께 백업하세요. 여러 NestJS 인스턴스라면 같은 이미지 저장 볼륨을 사용해야 합니다. 이 편집 앱을 종료해도 서비스는 서버에 등록된 파일을 표시합니다. 외부 NestJS에 연결할 때 관리자 토큰은 서버의 비밀 설정과 이 앱의 `.env.local`에만 설정하고 HTTPS를 사용합니다. 최초 운영 설정은 [운영 상점 등록 안내](../backend/docs/avatar-production-publishing.md)를 따릅니다.

등록은 기존 상품 ID·소유권·코디 선택을 유지합니다. 새로운 자세 이미지가 있으면 해당 자세 상품은 판매 보류로 등록하며 기존 유료 자세 가격은 변경하지 않습니다. 원본·과거 수정 PNG는 보존하고 파일을 자동 삭제하지 않습니다.

## 검증

```bash
npm run check
```

NestJS의 DB·등록·구매·착용 검사는 `../backend`에서 `npm run test:e2e -- test/avatar-assets.e2e-spec.ts`로 실행합니다. 전용 `TEST_DATABASE_URL`의 임시 스키마를 사용하며 운영 DB에는 적용하지 않습니다.
