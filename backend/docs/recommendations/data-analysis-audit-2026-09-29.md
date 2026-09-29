# BE와 data-analysis 정합성 점검 — 2026-09-29

점검 기준: 로컬 `project-health` HEAD `a29fa29`. 시작 시 작업 트리는 깨끗했다. 운영 코드와 데이터는 수정하지 않았다.

후속 조치(2026-09-29): 아래 2번 영상 검증 자료는 사용자 요청으로 **272개 전체 재검증 후 기본 보고서 교체 완료**. [갱신 결과](media-verification.md)를 참고한다. 나머지 항목은 원래 점검 시점의 기록이며, below_standard 필요성과 생성 시점은 [후속 검토](below-standard-and-generation-review.md)에 정리했다.

## 판정

**새 `/api/v1/workout-routines`의 핵심 추천 계산·입출력 연결은 일치한다. 그러나 BE 전체가 data-analysis와 완전히 연결됐다고 볼 수는 없다.** 기존 단일 영상 API는 의도적으로 미연결이며, 새 루틴의 활동 프로필 반영과 영상 재생 검증 자료 갱신이 남아 있다. 등급 미달·미측정 처리와 추천 확정 시점에는 별도 BE 정책이 적용된다.

현행 기준은 `data-analysis/src/recommendation_v2.py`, `data-analysis/03_recommendation.ipynb`의 최종 알고리즘 영역, `workout_videos_v2_complete.csv`다. 이전 `recommendation.py`와 `recommendation_draft.py`를 현행 동작과 동시에 만족해야 하는 명세로 취급하지 않았다. 이 선택은 [현재 연결 경계](provenance.md)와 [루틴 계약](routines-api.md)에 명시돼 있다.

인증·계정 CRUD·사진 추출·측정 원시값 평가·그룹 관리·알림·재화에는 data-analysis 쪽 대응 서비스 명세가 없다. 이들 전체의 정확성을 이번 추천 정합성 검사로 보증하지 않는다. 측정 영역은 추천에 전달되는 저장 등급과 축 집계 경계를 확인했다. 의료적 적합성이나 공식 평가표의 외부 원문 재검증은 수행하지 않았다.

## 일치하는 부분

| 항목          | 확인 결과                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| 계산 실행     | BE에서 계산식을 복제하지 않고 Python 원본 `run_recommendation` 직접 호출                                     |
| 데이터        | 최종 complete CSV 272개 영상 사용. 모든 행에 양수 영상 길이와 계약에 맞는 원본 URL 존재                      |
| 노트북과 모듈 | 동일 난수 시드로 288개 입력 조합에서 전체 결과 일치                                                          |
| 나이          | 생년월일에서 KST 현재 만 나이 계산, 13–64세 지원. 원본의 청소년/성인 필터 직접 사용                          |
| 성별          | BE가 profile에 age만 전달하지만 현행 원본은 sex를 계산에 사용하지 않으므로 결과 누락 아님                    |
| 체력 축       | 6개 축 이름 변환과 숫자 등급 전달 일치. 1/2/3 이상 등급의 need 및 목적 가중치 계산은 원본 담당               |
| 운동 목적     | fitness_grade_improvement→grade, body_composition_management→body, general_fitness_improvement→general       |
| 운동량        | less→light, standard→normal, more→full. 3/5/7개와 6/10/14분을 반환값 그대로 저장                             |
| 도구          | 10개 API 식별자를 원본 한글 도구명으로 변환. 별칭과 생활용품 허용은 원본 필터 사용                           |
| 날짜          | KST 오늘을 current_date로 전달하고 반환 루틴은 다음날 배정. 오늘 조회는 오늘 배정만 반환                     |
| 수행 로그     | 기존 일별 배정 및 신규 항목별 대표 결과 전달. completed=true, interrupted=false. 중단 후 완료 중복 합산 없음 |
| 노출도        | 원본의 14일 조회·7일 반감기·완료 1.0/중단 0.5·최근 영상 제외와 후보 부족 fallback 그대로 사용                |
| 반환/저장     | 순서·영상·슬롯·처방·예상 시간·weightAdjustment를 보존. 영상 진행 길이는 CSV video_length                     |
| 재시도        | 하루 한 번 계산·저장, 요청 키 재사용. 무작위 동점 선택 결과가 조회마다 바뀌지 않음                           |
| 버전          | Python/CSV SHA-256 저장 및 실행 전후 변경 검증                                                               |

근거: [Python 어댑터](../../src/recommendations/routine-algorithm.ts), [실행 래퍼](../../scripts/recommendation-runner.py), [루틴 서비스](../../src/recommendations/workout-routines.service.ts), [도구 매핑](../../src/users/owned-tools.ts).

## 남아 있는 차이와 연결 경계

### 1. 새 루틴 완료가 개인·그룹 스트릭에 포함되지 않는다

`member-profile.ts:37–45`는 기존 `UserCurriculumAssignment`만 조회한다. 신규 `WorkoutRoutineItem`이나 전체 `WorkoutRoutine`의 완료는 조회하지 않는다. 따라서 새 추천 루틴만 수행한 사용자는 루틴 응답에서 completed여도 `/users/me/profile/activity`와 그룹원 프로필의 streak에는 반영되지 않는다.

이는 [그룹 API](../groups-api.md)에 기존 개인 이력 기준 유지 및 새 루틴 반영 보류로 명시된 동작이다. data-analysis 계산식 오류는 아니지만, 신규 추천 흐름이 BE 전체 활동 기능까지 연결된 상태는 아니다. 항목 1개와 전체 루틴 중 무엇을 하루 성공으로 볼지 확정하고 공통 활동 조회에 연결해야 한다.

### 2. 기본 로컬 영상 검증 보고서가 현행 카탈로그와 맞지 않는다

점검한 기본 파일 `.local/recommendation/media-verification.json`은 731개 영상과 sourceCommit `92f3493de704c644d5aeff353488f1aff49f1836`을 가진 이전 보고서다. 현행 272개 CSV SHA-256은 `db329d71dfdbc04ca66fb6c63ea15667a5b50d6bdeb8d8e4df9db8cabc602380`이다.

`media.ts:25–30`은 식별자가 정확히 일치해야 보고서 항목을 사용하고, 루틴 응답은 CSV SHA-256을 전달한다. **이 기본 보고서를 사용하는 새 루틴은 playbackStatus=unavailable, playbackUrl=null이 된다.** 원본 videoUrl과 추천 결과 자체는 보존된다.

이는 로컬 기본 자료 기준이며 운영 환경의 별도 WORKOUT_MEDIA_REPORT_PATH 설정이나 원격 영상의 현재 가용성은 검증하지 않았다. 보고서의 식별자만 변경해서 해결할 문제가 아니라 현행 데이터 기준 실제 HTTPS·Range·길이 검증 자료가 필요하다.

### 3. 최하 기준 미달과 미측정의 의미가 추천 입력에서 합쳐진다

`routine-algorithm.ts:51–54`는 status=graded인 경우에만 숫자를 전달한다. below_standard·unevaluable·not_measured는 모두 null이다. 원본의 get_fitness_need는 숫자 3 이상을 need=1.0으로, null은 미측정으로 처리한다.

예를 들어 grade 목적·노출도 0에서 숫자 3의 priority는 2.0이고, BE가 전달한 below_standard=null의 priority는 1.5다. 최하 기준 미달을 낮은 체력등급으로 취급하고 싶다면 현행 입력으로는 그 의미가 전달되지 않는다.

이 변환은 [루틴 계약](routines-api.md)에 명시된 정책이다. 임의로 4등급을 만들지 않는 결정은 지켜지고 있다. 따라서 발견된 회귀로 분류하지 않고 데이터 팀과의 입력 계약 확장 사항으로 분류한다. 노트북이 숫자 4/5를 처리할 수 있다는 사실만으로 공식 기준 미달을 4로 치환하면 안 된다.

### 4. 내일 루틴 생성 뒤 추가된 오늘 운동은 그 루틴에 반영되지 않는다

`workout-routines.service.ts:96–104`는 내일 배정이 이미 있으면 저장값을 반환한다. 예를 들어 아침에 내일 루틴을 만들고 저녁에 오늘 운동을 완료해도 내일 배정과 weightAdjustment는 바뀌지 않는다. 이후 새로운 날짜의 추천 생성부터 로그가 반영된다.

원본은 전달된 오늘 로그를 정확히 반영한다. BE의 하루 한 번 확정·스냅샷 정책 역시 문서와 일치한다. 다만 원본의 “오늘 운동 수행 후 다음날 추천” 흐름을 제품에서도 만족시키려면 최초 생성 시점이 중요하다. 현행 API는 오늘 루틴 전체 완료를 생성 전제조건으로 요구하지 않는다. weightAdjustment를 실시간 운동 완료 효과로 표시하면 현행 계약과 달라진다.

### 5. 미측정 사용자 지원 범위가 다르다

원본은 fitness100=None 또는 빈 fitness로도 추천할 수 있다. BE는 `workout-routines.service.ts:133–137`에서 측정 기록 0건이면 MEASUREMENT_REQUIRED로 거부한다. 운동 목적 미설정도 별도로 거부한다. 측정이 존재하지만 일부 축 등급이 없는 경우는 지원한다.

이는 기존 온보딩·설정 정책에 따른 의도된 제한이다. data-analysis의 모든 허용 입력이 BE에서 노출된 것은 아니다.

### 6. 기존 단일 영상 API는 계속 미연결이다

`recommendations.module.ts`는 기존 WorkoutAlgorithm에 DisconnectedWorkoutAlgorithm을 등록한다. `/api/v1/workouts`에서 추천 계산이 필요한 경로는 RECOMMENDATION_NOT_CONNECTED를 반환한다. 실제 새 Python 연결은 `/api/v1/workout-routines`에만 있다. [연결 경계](provenance.md)에 명시된 사용자 결정으로, 임의 재연결 대상이 아니다.

## 실행 검증과 한계

- `npm test`: 20개 파일, 283개 테스트 통과.
- `RECOMMENDATION_PYTHON=.local/recommendation-venv/bin/python npm run test:e2e -- test/workout-routines.e2e-spec.ts`: 실제 원본 Python/CSV 및 PostgreSQL 사용, 20개 테스트 통과.
- 전용 project_health_test의 임시 스키마에서 18개 마이그레이션 적용 및 재적용 확인 후 정리. 개발·운영 DB 마이그레이션은 실행하지 않음.
- 노트북 최종 영역에서 함수·클래스 및 정책 상수만 추출해 모듈과 비교. 나이 13/18/19/64 × 목적 3종 × 운동량 3종 × 등급 null/1/3/4 × 로그 유무 2종 = 288건. 동일 시드 42, 보유 도구 밴드/덤벨, 날짜 2026-09-29에서 전체 반환값 불일치 0건. 무제한 입력 전수 증명은 아님. KST 시각 정규화는 서비스용 모듈의 추가 처리이며 노트북 비교에는 날짜 문자열을 사용함.
- 기존 루틴 E2E에서 도구 매핑, 저장값 일치, KST 자정, 재시도, 수행 결과 입력, 실패 롤백 등을 검사했다. 이번에 전체 E2E·빌드·외부 영상 네트워크 검사를 새로 실행하지는 않음.
- 최초 샌드박스 실행은 로컬 포트/DB 연결 EPERM으로 중단됐고 권한 허용 후 같은 검사를 재실행하여 통과. pg 동시 query deprecation 경고가 있었으나 검사 실패는 없음.

이 보고서의 차이들은 자동 수정하지 않았다. 우선순위는 신규 루틴의 활동 프로필 연계와 현행 영상 검증 자료 확보이며, 등급 미달 표현·미측정 허용·추천 확정 시점은 기존 결정과 함께 입력 및 제품 계약으로 정리해야 한다.
