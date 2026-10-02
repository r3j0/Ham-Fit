# Avatar Manager

의상 이미지·크기·위치·회전을 서비스 프론트엔드의 정적 파일로 관리하는 로컬 Next.js 편집기입니다. **백엔드에는 이미지나 배치를 저장하지 않습니다.** 상품 ID·가격·판매 상태와 기존 구매·착용에 필요한 관계만 DB에 저장합니다.

2026-10-02 사용자 요청으로 기존 의상 54개와 기본 의상 목록을 비웠습니다. 새 환경은 **상품 추가 → 의상 폴더 가져오기**부터 시작합니다. 이전 PC에 로컬 초안이 남아 있다면 최신 코드를 받은 뒤 **프론트엔드 편집본 불러오기**를 눌러 빈 목록을 적용하세요. 기존 초안·배치·픽셀 수정은 `.local/backups/`에 백업하고 현재 목록을 비웁니다. 이 작업은 운영 API를 호출하지 않습니다.

## 실행 (Mac / Windows)

Node.js 24.15 이상(24.x) 또는 26 이상을 설치하고 저장소 전체를 준비합니다.

```sh
cd avatar-manager
npm ci
npm run setup:local
npm run dev
```

편집기 주소: `http://127.0.0.1:3002/wardrobe`. `setup:local`은 관리자 토큰을 `.env.local`과 `../backend/.env.avatar-manager`에 저장합니다. 운영 API를 사용할 때는 기존 운영 토큰을 사용하고 아래 설정을 `.env.local`에 넣습니다. 비밀키를 Git이나 `NEXT_PUBLIC_`에 넣지 마세요.

```dotenv
AVATAR_BACKEND_URL=https://ham-fit-api.vercel.app/api/v1
AVATAR_MANAGER_TOKEN=<운영 백엔드와 같은 64자리 hex 토큰>
AVATAR_FRONTEND_URL=https://서비스-프론트엔드-주소
# 기본값은 ../frontend. 다른 위치라면 실제 절대 경로를 지정합니다.
# AVATAR_FRONTEND_DIR=C:\work\project-health\frontend
```

로컬 백엔드·프론트엔드를 사용할 때는 각각 `http://127.0.0.1:3001/api/v1`, `http://127.0.0.1:3000`을 지정하고 두 앱을 별도 터미널에서 실행하세요. Windows에서도 Node의 파일 경로 처리와 같은 명령을 사용합니다. 편집기는 외부 공개 서버로 배포하지 않습니다.

## 작업 순서

1. **상품 추가 → 의상 폴더 가져오기**에서 `manifest.json`과 PNG가 있는 세트 폴더 또는 여러 세트의 상위 폴더를 선택합니다. 기존 로컬 초안을 유지하고 새 상품만 추가합니다. 가져오기는 운영 등록을 실행하지 않습니다.
2. 의상·자세·색상을 선택해 크기·위치·회전을 조정하고 **조정값 저장**을 누릅니다. **의상 세부 작업**에서 펜·지우개·스포이드로 수정한 뒤 **픽셀 수정 저장**을 누릅니다. 로컬 변경을 저장하고 세부 작업 패널을 닫습니다.
3. **프론트엔드 이미지·배치 내보내기**를 누릅니다. 인터넷 요청 없이 `frontend/public/hamsters/wardrobe/`에 이미지, 표시용 카탈로그, 편집 원본과 배포 확인 파일을 생성합니다. 이전 PNG는 삭제하거나 덮어쓰지 않습니다.
4. 해당 프론트엔드 파일을 Git에 커밋하고 서비스 프론트엔드를 배포합니다. **이미지·좌표 수정은 프론트엔드 배포로 반영**됩니다. 이미지가 같아도 좌표를 바꾸면 다시 내보내고 배포해야 합니다.
5. **서버 연결·버전 확인**을 눌러 상품 ID·가격·판매 상태를 조회합니다. 가격을 입력하고 새 상품을 판매하려면 **판매 중**을 선택합니다. 확인 버튼을 다시 누르면 입력 중인 가격은 DB 값으로 돌아갑니다.
6. 자세·색상과 착용 조합을 미리보고 검수 확인란을 선택한 뒤 **상품 ID·가격 DB 등록**을 누릅니다. 프론트엔드의 작은 `deployment.json` 하나로 배포 버전을 확인한 뒤 상품 정보만 한 번 전송합니다. 아직 배포하지 않았다면 DB 등록을 거절합니다.

**가격만 수정**할 때는 프론트엔드 내보내기·재배포 없이 5–6번만 진행합니다. **크기·위치·픽셀만 수정**할 때는 2–4번만 진행하면 되며 DB 등록은 필요 없습니다. 새 상품·지원 자세·검수한 조합을 추가한 경우에는 6번까지 진행하세요.

**프론트엔드 편집본 불러오기**는 이 PC에 있는 최신 frontend 파일에서 이미지와 배치를 읽어 편집 초안으로 복원합니다. 이 작업은 인터넷과 백엔드 연결 없이 실행됩니다. 가격 조회는 **서버 연결·버전 확인** 버튼에서 별도로 합니다. 다른 PC에서는 먼저 프론트엔드의 최신 Git 변경을 받고 이 버튼을 눌러 초기 편집본을 준비하세요. 기존 초안 JSON은 `.local/backups`에 보관합니다. 서버의 오래된 revision으로 가격을 등록하면 409 충돌을 반환하므로 버전을 다시 확인합니다.

## 파일과 API

- 로컬 초안: `.local/catalog.json`, `.local/placements.json`, `.local/artwork.json`.
- 프론트엔드 이미지: `frontend/public/hamsters/wardrobe/assets/<sha256>.png`. 1000×1000 RGBA PNG를 로컬에서 검증·정규화합니다. 원본은 투명 배경과 보이는 픽셀이 필요하고 완전히 지운 수정본은 허용합니다.
- 프론트엔드 표시·편집 카탈로그: `catalog.json`, `source-catalog.json`. 좌표·회전·픽셀 수정 결과·검수 정보를 포함합니다.
- 배포 확인: `deployment.json`과 `bundles/<sha256>.json`. 이미지와 좌표가 바뀌면 배포 버전도 달라집니다.
- 상품 조회: 관리자 전용 `GET /api/v2/avatar-manager/catalog`.
- 상품 등록: 관리자 전용 `POST /api/v2/avatar-manager/publish`. 상품 ID·가격·판매 상태와 착용 지원 정보만 전송합니다. 사진·이미지 URL·좌표 필드는 허용하지 않습니다.
- 구형 `/api/v1/avatar-manager/catalog`, `/images`, `/publish`, `/api/v1/avatar/assets/*`, `/api/v1/avatar/render-catalog`는 410을 반환합니다. 저장소나 이미지 처리기를 호출하지 않습니다.

상품 ID·소유권·구매 내역·대표 코디는 유지합니다. 기존 구매·착용 검증에 필요한 슬롯·지원 조합은 기존 DB 관계를 사용하며 표시용 좌표와 분리합니다. 구형 DB의 표시용 JSON은 새 방식으로 상품 등록이 성공하면 비웁니다. Supabase **DB 연결은 그대로 사용**하고 Blob·Supabase Storage 설정은 의상 기능에서 사용하지 않습니다. 과거 저장소 파일은 자동 삭제하지 않습니다.

정적 파일도 호스팅/CDN의 요청·전송량을 사용합니다. 이 구조는 PNG마다 API 함수를 실행하거나 서버에서 Storage를 다시 읽는 비용을 제거합니다. 새로운 이미지나 배치를 운영에 반영하려면 프론트엔드 배포가 필요합니다.

## import 형식과 검증

각 세트에 `manifest.json`과 1000×1000 투명 PNG를 준비합니다. `items[].id`는 등록 후 바꾸지 않는 상품 식별자이고 `slot`은 `hat/top/bottom`입니다. 프레임의 QA는 `passed`, 검수자와 ISO 시각이 필요합니다. [manifest 예시](docs/import-manifest.example.json)를 참고하세요. 지원하지 않는 자세는 다른 그림으로 대체하지 않습니다.

터미널에서 전체 제작 스냅샷을 교체할 때만 아래 명령을 사용합니다. 유지할 세트를 모두 포함하세요. Mac Finder의 **Option + 우클릭 → 경로 이름 복사**, Windows 탐색기의 **경로로 복사**로 얻은 절대 경로를 큰따옴표로 감쌉니다.

```sh
npm run import:assets -- "/absolute/path/to/sets"
npm run check
```

일반 검증은 `npm run check`, backend의 로컬 DB 등록·구매·착용 검증은 `npm run test:e2e -- test/avatar-assets.e2e-spec.ts`입니다. 테스트는 운영 API·Storage에 접근하지 않습니다.
