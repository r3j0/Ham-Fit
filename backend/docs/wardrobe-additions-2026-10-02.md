# set004·set005 추가 등록 (2026-10-02)

사용자가 제공한 `hamfit-third-set004-fit-r1.zip`, `hamfit-fourth-set005-editable-fit.zip`의 최종 `after`와 편집 가능한 `source`를 기존 두 세트에 추가한다. 기존 6개 상품과 이미지·배치는 변경하지 않는다.

| 상품 ID | 이름 | 씨앗 가격 | 판매 상태 |
| --- | --- | ---: | --- |
| clothing.set004-mustard-beret | 머스터드 베레모 | 30 | on_sale |
| clothing.set004-lavender-henley | 라벤더 헨리 티셔츠 | 25 | on_sale |
| clothing.set004-olive-cargo | 올리브 카고 반바지 | 20 | on_sale |
| clothing.set005-skyblue-visor | 하늘색 선바이저 | 30 | on_sale |
| clothing.set005-green-raglan | 아이보리 그린 래글런 티 | 25 | on_sale |
| clothing.set005-striped-track-shorts | 차콜 두 줄 트랙 반바지 | 20 | on_sale |

추가 후 총 4세트·12개 상품이다. 각 세트는 햄돌이·햄콩이의 16개 자세를 지원한다. 같은 세트의 단독·두 부위·세 부위 조합 448개를 추가한다(전체 896개). 다른 세트와 섞는 조합은 별도 검수 전 등록하지 않는다.

이미지 417개(전체 원본·최종본의 중복 제거)와 배치는 프론트엔드 정적 파일에만 보관한다. 최종 번들은 `3c35bac6c3850075a338e36c4ac9ae8e16ee7ddde2298e238f995de17544d1c9`이며 원본 ZIP 해시와 검수 결과는 `frontend/components/hamster/provenance/added-sets004-005-2026-10-02.json`에 기록한다.

이전 등록과 동일하게 연결된 운영 Supabase에서 백엔드 v2의 엄격한 입력·착용 관계 검증을 통과한 상품 메타데이터만 등록한다. 프론트엔드 배포를 확인한 다음, 기존 등록 revision 1의 행을 잠그고 한 트랜잭션에서 새 6개 상품·조합을 추가해 revision을 2로 증가시킨다. 기존 상품 모든 필드가 유지되는지 트랜잭션 안에서 검증한다. 기존 구매·보유·재화·캐릭터·자세는 수정하지 않고 트리거를 해제하지 않는다. DB의 이미지 카탈로그는 계속 `{}`로 유지한다.

운영 적용 결과:

- 프론트엔드: `dpl_6DHs1vPD8em1UPY6juAWW1V7vvoi`를 `https://ham-fit.vercel.app`에 반영했다. 프론트엔드 소스만 배포했고 실제 운영 카탈로그·manifest가 로컬 검증본과 일치한다. 추가 상품 6개의 대표 PNG 해시도 확인했다.
- DB: 의상 12개 모두 판매 중, 의상 착용 조합 896개·조합 항목 1536개, 관리자 revision 2. 기존 6개 상품 필드 보존을 트랜잭션 안에서 확인했다. 캐릭터 2개·자세 17개와 모든 조합 보호 트리거는 유지했다. DB 이미지 카탈로그는 `{}`다.
- 검증: 패키지 모든 파일 해시, 1000×1000 투명 PNG, 공식 편집기 복원·재내보내기 일치, 실제 렌더러 128개 전신 프레임과 896개 조합 확인. 프론트엔드 lint·타입 검사·단위 테스트 179개·운영 빌드 및 상점·옷장·API 비용 E2E 8개 통과. 검증용 로컬 서버는 종료했다.
- 작업 중 PR #37의 병합을 확인하고 최신 main 기준 `feat/root/add-wardrobe-sets004-005` 브랜치로 분리했다. 직접 운영 배포와 GitHub 소스 병합은 별개이므로 후속 PR을 병합해 소스를 맞춘다.
