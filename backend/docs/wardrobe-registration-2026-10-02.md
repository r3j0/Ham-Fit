# 두 의상 세트 등록 (2026-10-02)

기존 의상 삭제 이후 사용자가 제공한 `hamfit-set001-final-r4.zip`과 `hamfit-second-set003-fit-r2.zip`의 최종 `after`/`source` 카탈로그만 가져온다. 삭제한 54개 의상이나 ZIP의 미리보기·실행 스크립트는 운영 카탈로그에 복원하지 않는다.

| 상품 ID | 이름 | 씨앗 가격 | 판매 상태 |
| --- | --- | ---: | --- |
| clothing.beige-hat | 베이지 모자 | 30 | on_sale |
| clothing.mint-shirt | 민트 티셔츠 | 25 | on_sale |
| clothing.navy-shorts | 네이비 반바지 | 20 | on_sale |
| clothing.set003-burgundy-beanie | 버건디 골지 비니 | 30 | on_sale |
| clothing.set003-teal-pocket-tee | 더스티 틸 포켓 티 | 25 | on_sale |
| clothing.set003-denim-shorts | 인디고 롤업 데님 쇼츠 | 20 | on_sale |

두 캐릭터의 16개 자세를 지원한다. 세트별로 단독·두 부위·세 부위 조합을 등록한다(총 448개). 서로 다른 세트를 섞는 조합은 별도 검수 전 등록하지 않는다.

PNG 203개(원본·최종본의 중복 제거)와 이미지 위치·크기는 프론트엔드 `public/hamsters/wardrobe/`에만 저장한다. 패키지 원본 SHA-256·검수 결과는 `frontend/components/hamster/provenance/registered-sets-2026-10-02.json`에 기록한다. 새 번들은 `bfef8c24f30f61a1594c33ad75d87f98936896cf29de0d18de37cd21fb8f9765`다. 기본 캐릭터·자세 이미지는 변경하지 않는다.

운영 관리자 토큰은 Vercel의 Sensitive 변수여서 복호화하지 않는다. 운영 등록은 연결된 Supabase에서 기존 v2 등록의 `parsePublish` 및 상품·슬롯·지원 프레임 검증을 통과한 메타데이터에 한해 실행한다. 프론트엔드 배포 확인 이후 한 트랜잭션에서 상품 6개와 착용 조합을 추가하고 등록 revision을 0에서 1로 변경한다. 이미지·배치 JSON은 DB에 저장하지 않고 카탈로그 두 필드는 `{}`로 유지한다. 기존 캐릭터·자세 상품, 구매·보유 기록과 재화는 수정하지 않는다. 트리거는 해제하지 않는다.

검증: 패키지 전체 파일 해시, 1000×1000 투명 PNG, 편집기 복원·재내보내기 일치, 실제 프론트엔드 렌더러 64개 전신 프레임, 상품 가격·상점 미리보기·정적 PNG 디코딩·백엔드 이미지 요청 부재를 확인한다.

운영 적용 결과:

- 프론트엔드 배포: `dpl_2e1qGEkEsqtvSXoBnAVcFezV7d1P`, `https://ham-fit.vercel.app`. 프론트엔드 소스만 분리해 배포했으며 운영 주소의 manifest가 위 번들과 일치한다. 배포 카탈로그 전체와 상품별 대표 PNG 6개의 해시도 검증했다.
- 운영 DB: 의상 6개 모두 판매 중, 동일 세트 착용 조합 448개·조합 항목 768개, 관리자 revision 1. 이미지 카탈로그는 `{}`이며 불변성·신규 조합 트리거 3개 모두 활성화 상태다. 캐릭터 2개와 자세 17개는 보존했다.
- 검증: 프론트엔드 lint·타입 검사·단위 테스트 179개·운영 빌드 통과. 상점·옷장·API 비용 회귀 E2E 19개 통과, 기존 기능 플래그에 따른 1개 skip.
- Vercel CLI의 첫 임시 배포는 운영 도메인에 반영하기 전 삭제했다. 루트 `.vercelignore`로 이후 배포에서도 로컬 편집본·백업·비밀 파일·검증 산출물을 제외한다.
