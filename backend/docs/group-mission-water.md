# 하루 한 그룹 물 기여

2026-10-02 정책 변경. 여러 그룹 가입은 유지하되, 한 사용자의 KST 날짜별 첫 유효 운동 완료는 **한 그룹 미션에 물 1회**만 기여한다. 모든 그룹 자동 반영 정책을 대체한다. 성장 목표 N/3N/7N/14N, 개인 기여 7회당 룰렛권 1장, 룰렛 확률과 지급 정책은 유지한다.

## 완료와 선택

기존 `ActivityAchievement`의 사용자+KST 날짜 유일성을 유지하고, 운동 완료 시 참여 자격을 가진 활성 회차를 `GroupMissionWaterChoice.options`에 고정 저장한다. 시작 후 가입, 탈퇴·퇴출 후 재가입, 완료 후 시작한 회차는 후보가 아니다. 전체 루틴 완료와 기존 일별 운동 완료는 같은 하루 물 자격을 공유한다. 부분 루틴과 날짜 없는 내부 배정은 제외한다.

- 후보 0개: 이후 시작한 미션에 소급하거나 물을 이월하지 않는다.
- 후보 1개: 운동 완료 트랜잭션에서 자동 기여한다. 완료 → 스트릭 → 물 화면은 `그룹명 그룹에 물을 주었어요!`를 표시한다.
- 후보 2개 이상: 운동 완료와 개인 씨앗·스트릭 보상을 저장하고 물은 보류한다. 스트릭 다음 화면의 `어느 그룹에 물을 줄까요?`에서 한 그룹을 선택한다.
- 선택은 완료 당일 KST 자정까지 가능하다. 화면 이탈·새로고침 후 원래 완료 화면에서 다시 선택할 수 있다. 미선택 물은 다음 날로 이월하지 않는다.

선택 시 원래 회차·원래 참여자·현재 멤버십·영구 무효화·미완료 상태를 다시 확인한다. 삭제·완료된 회차는 제거하며 다음 회차로 대체하지 않는다. 최초에 선택이 필요했던 물은 후보가 하나만 남아도 사용자 확인으로 반영한다. 선택된 그룹 이름과 회차는 고정 영수증으로 남고, 그룹 삭제·탈퇴가 소비 상태를 초기화하지 않는다. 영수증은 그룹 접근권을 부여하지 않는다.

## 신규 v1 API

`GET /api/v1/users/me/group-mission-water?sourceKind=routine&sourceId=UUID`는 본인의 실제 완료를 확인하고 후보 또는 저장된 결과만 조회한다. `sourceKind`는 `routine`/`daily_assignment`다. GET은 기여·상태 전이·지급을 수행하지 않는다.

응답은 `{sourceKind,sourceId,koreanDate,status,reason,options,contribution}`이다.

- `pending`: reason/contribution null. options는 `{groupId,groupName,roundId,waterCount,totalTarget,stage}` 목록.
- `contributed`: reason null, options 빈 배열. contribution은 `{groupId,groupName,roundId,amount:1}`.
- `unavailable`: options 빈 배열, contribution null. reason은 `no_eligible_missions`, `not_first_completion`, `expired`, `missions_ended`.

`POST /api/v1/users/me/group-mission-water`는 JSON `{sourceKind,sourceId,groupId}`와 UUID `Idempotency-Key`를 받는다. 201 `{water,replayed}`를 반환한다. 본인 소유권·Bearer·CSRF/Origin·strict JSON·UUID 정규화·`Cache-Control: no-store`를 따른다. 물 수량·회차·보상 결과는 클라이언트가 지정하지 않는다.

사용자 행 `FOR NO KEY UPDATE`와 선택 그룹 `FOR UPDATE` 아래 선택 저장·기여 원장·개인/회차 물 증가·마지막 성장 완료·룰렛권 발급을 함께 커밋한다. 기존 전체 트랜잭션 재시도를 유지한다. 실패하면 선택 전체를 롤백하지만 이미 저장된 운동 완료·개인 씨앗을 되돌리지 않는다. 단일 자동 기여는 운동 완료와 같은 트랜잭션이다.

같은 원본+같은 그룹 재전송은 저장된 영수증을 반환한다. 다른 그룹 변경 또는 같은 키를 다른 원본에 재사용하면 409다. 소비한 물은 만료 후에도 조회/재전송할 수 있다. 잠금 대기로 자정을 넘는 새 선택은 `WATER_EXPIRED` 409, 종료·자격 상실 후보는 `WATER_OPTION_UNAVAILABLE` 409, 선택 그룹 변경은 `WATER_ALREADY_CONTRIBUTED` 409다. 외부 사용자 원본은 404, 미완료 원본은 409다.

## 무결성과 이전 데이터

마이그레이션은 `20261002000200_single_group_water`다. choice는 달성 ID당 하나이고 기여의 `water_choice_id` unique가 여러 그룹 중복을 막는다. INSERT trigger가 choice를 자동 연결하므로 신규 컬럼 생략으로 우회하지 못한다. 후보는 불변, 선택은 null에서 한 번만 확정할 수 있고 choice 삭제로 초기화하지 못한다. 계정 영구 삭제는 choice를 개인 달성과 함께 삭제하고 기존 그룹 원장의 연결을 null로 익명화한다.

기존 달성·다중 그룹 기여·성장·룰렛권·기지급 재화는 수정·회수하지 않는다. 과거 choice 백필은 없다. 도입 당일 이미 완료한 사용자도 같은 날 새 자격을 얻지 못한다.

기존 `/users/me/activity-rewards` v1 영수증은 불변이다. 단일 자동 물은 포함하지만 나중에 선택한 물은 새 API로 확인한다. 기존 waters를 UPDATE하지 않는다. FE의 물 페이지는 개인 씨앗 표시 플래그와 무관하게 새 API를 사용한다. 씨앗 화면이 활성화되어 있다면 물 다음에 기존 씨앗 화면을 표시한다.

기존 일별 운동은 완료 화면 안에 같은 물 선택 컴포넌트를 표시하며 `daily_assignment` 원본을 사용한다. 전체 루틴과 일별 운동 양쪽을 완료해도 물 자격은 공유한다. 재생 전용 화면은 선택 UI를 표시하지 않는다.

배포 시 새 마이그레이션과 서버를 먼저 적용하고 프론트를 교체한다. 브랜치 검증은 전용 로컬 테스트 DB의 임시 스키마에서 수행하며 운영 DB 적용·배포는 별도다.

## 브랜치 검증

`origin/main`에서 만든 `fix/root/group-mission-contributions`의 전용 작업 트리에서 확인했다.

- 백엔드 스키마 검증·생성, 린트·타입 검사, 단위 테스트 386개, DB 통합 테스트 556개, 빌드 통과. 마이그레이션 반복 적용과 과거 다중 그룹 기여·기지급 보상 보존 포함.
- 프론트 린트·타입 검사, 단위 테스트 177개, 프로덕션 빌드 통과.
- 물 페이지·그룹 미션 카드·운동 루틴·기본 출시 보상 설정 브라우저 검사 23개 통과. 화면 이탈/새로고침, 응답 유실 시 같은 요청 키 재전송, 320/390/1218px 가로 넘침 없음 확인.
- 임시 DB에 연결한 실제 API 브라우저 검사: 같은 그룹원으로 만든 미션 1개는 자동 기여, 2개는 선택한 그룹만 기여, 스트릭 다음 화면 순서, 새로고침 후 결과 유지 확인. 테스트 사용자·그룹 및 임시 스키마 삭제 완료.
- 씨앗 화면이 활성화된 완료→스트릭→물→씨앗 순서 확인.
- 기존 일별 운동 완료 화면에서 `daily_assignment` 원본으로 선택 요청을 보내고 반영 결과를 표시하는 브라우저 검사 1개 통과. 브라우저 검증은 위 회귀 23개, 실제 API 2개, 씨앗 순서 1개, 기존 일별 운동 1개로 총 27개다.
- Git의 `core.autocrlf=true` 체크아웃 때문에 기본 전체 `format:check`는 기존 파일의 줄바꿈을 경고한다. `prettier --check . --end-of-line auto`로 전체 코드 스타일을 검증했고, 변경 파일은 기본 포맷으로 검사했다.
