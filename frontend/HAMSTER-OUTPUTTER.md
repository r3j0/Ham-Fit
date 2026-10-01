# 햄스터 출력기 v2 적용

원본: 사용자가 제공한 `hamster-outputter-v2.zip` / `hamster-production` (2026-10-01).

## 적용 범위

- `components/hamster`: ZIP의 순수 SVG renderer, resolver, 타입, 자세 배치, 검수된 의상 catalog. 프로젝트 서식 및 Node 단위 테스트용 명시적 import 확장자만 정리했다.
- `public/hamsters`: 원본 WebP 32개, 민트 티셔츠 PNG 2개, 원본 inventory. 그림은 수정하지 않았다.
- `components/hamster/provenance`: 원본 해시, 배치, 의상 검수/누락 범위 기록.
- 홈, 내 프로필, 상점/옷장, 그룹 프로필, 가입/안내용 햄스터 모두 새 renderer를 사용한다. 기존 호흡/얼굴 분리 애니메이션은 ZIP의 정적 자세 표시로 교체했다.
- 기존 blue/black/white/green-sportswear는 상점·옷장 목록과 로그인 장식에서 제외한다. 이전 원본 코드/에셋은 보존하지만 서비스의 활성 컴포넌트에서 불러오지 않는다. 이전 studio 의상 좌표도 새 베이스에 혼합하지 않는다.

## 실제 지원 범위

16자세: basic, cant-hear, curious, drink, droopy, foam-roller, lying, passion, phone, pushup, run, situp, stretch, toilet, victory, weight. 각 자세는 cream/gray를 모두 제공한다.

실제 의상은 `mint-shirt` 1종이며 basic/cream, basic/gray에만 존재한다. 모자 30·상의 30·하의 30은 원본 제작 목표일 뿐 제공량이 아니다. 슬롯 구조는 유지하되 없는 그림을 만들거나 다른 자세의 그림으로 대체하지 않는다.

renderer 자체는 지원하지 않는 의상 프레임을 생략하고 선택을 유지한다. 서비스의 `canRenderAvatar`는 저장 코디의 일부만 표시해 잘못 전달하지 않도록 전체 조합을 확인한다. 이미지가 누락된 코디는 준비 중 표시, 구매/저장 비활성으로 처리한다. 옷장에서 의상 해제와 지원 자세로의 변경은 가능하다. 미리보기의 자세/색상 변경으로 의상 선택을 자동 삭제하지 않는다.

BE에서 상품/조합을 등록하기 전까지 민트 티셔츠 및 신규 4자세가 실제 상점에 자동 생성되지는 않는다. FE는 BE 상품 가격·소유권을 그대로 사용한다. [BE 요청 규격](BACKEND-REQUESTS.md)에 ID/slot/renderKey/조합을 정리했다.

## 검증

- 원본 바이너리 SHA-256, 32개 배치 좌표와 검수된 catalog 범위 확인.
- 16 × 2 조합, 민트 티셔츠 지원/미지원 범위, 독립 슬롯의 전경 순서, 깨진 레이어/잘못된 슬롯 차단 단위 검사.
- Chromium에서 32개 원본 디코딩, 양색상 티셔츠 합성, 코디 저장/새로고침, 미지원 구매/저장 차단, a-plus에서 기본 자세로 복구, 스포츠웨어 제외 확인.
- 320/390/1280px 홈·프로필·상점·로그인·가입·그룹·측정 안내 화면 회귀 확인. 브라우저 시나리오는 API fixture이며 BE 상품 등록 완료를 의미하지 않는다.

향후 ZIP 교체 시 컴포넌트와 public 이미지를 함께 교체하고, 등록 범위와 BE catalog/combinations를 대조해야 한다. 이미지 없이 판매하거나 기존 보유권을 임의로 지우지 않는다.
