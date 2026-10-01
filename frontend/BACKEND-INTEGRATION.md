# 프론트엔드 연동 계약과 남은 확인

확인일: 2026-09-24. 프론트 브랜치 `feat/frontend/fitness-onboarding`, PR [#7](https://github.com/r3j0/project-health/pull/7).
백엔드 PR [#6](https://github.com/r3j0/project-health/pull/6)의 실제 head `3c9b91ce56205356f8a5ea9a0059b091794f0aed`를 별도 체크아웃하여 연결했다. 이전 임시 백엔드 구현은 사용하지 않는다. 이 프론트 브랜치의 `backend/`를 변경하지 않는다.

평가·최신 프로필의 이전 제안 계약은 폐기했다. 아래는 [실제 평가 API 명세](https://github.com/r3j0/project-health/blob/3c9b91ce56205356f8a5ea9a0059b091794f0aed/backend/docs/measurement-evaluation-api.md)에 연결한 현재 계약이다. 이후 백엔드가 변경되면 어댑터·fixture·실제 API 테스트를 함께 검증한다.

## 연결된 API

경로는 `NEXT_PUBLIC_API_BASE_URL` 뒤에 붙으며 기본값은 `http://localhost:3001/api/v1`이다.

| 기능                       | 경로 및 응답                                                                |
| -------------------------- | --------------------------------------------------------------------------- |
| 계정·온보딩·재화·현재 배정 | `GET /auth/me`                                                              |
| 이메일/비밀번호 변경       | `PATCH /users/me`, 현재 비밀번호 확인, 성공 후 재로그인                     |
| 회원 탈퇴                  | `DELETE /users/me`                                                          |
| 카탈로그·측정 CRUD         | `/measurement-catalog`, `/measurements`, `/measurements/:id`                |
| 사진 추출                  | `POST /measurements/extract`                                                |
| 성인 간이측정 저장         | `POST /measurements`, `entryMethod: self_assessment`, `reportKind: unknown` |
| 종목별 평가·6축            | 생성·수정·상세 응답의 `items[].evaluation`, 최상위 `axes`                   |
| 최신 한 회차의 대표 프로필 | `GET /measurements/latest-polygon`                                          |

생성의 `Idempotency-Key`, 수정·삭제의 ETag/`If-Match`, Decimal 문자열, 부분 저장, 소유권과 세션 격리는 기존 흐름을 유지한다. `axes`와 계산된 `evaluation`은 저장 요청에 포함하지 않는다.

## 사진 추출

[실제 사진 API 명세](https://github.com/r3j0/project-health/blob/3c9b91ce56205356f8a5ea9a0059b091794f0aed/backend/docs/measurement-extraction-api.md)를 따른다.

- Bearer 인증, `FormData` 파일 필드 `image` 1장, JPEG/PNG/WebP, 최대 10 MiB. multipart boundary는 브라우저가 작성한다. 프론트 제한은 90초로 서버 75초와 전송 여유를 포함한다.
- OpenAI 전송을 안내하며 API 키·모델은 백엔드에서 관리한다. 사진 바이트는 브라우저 저장소에 보관하지 않는다.
- 추출값·메타데이터·확인 대상 원문을 사용자에게 보여 주고 확인·수정 후 저장한다. 추출 자체는 기록·온보딩·커리큘럼을 변경하지 않는다.
- 혼합 회차·여러 사람·지원 연령 밖 결과를 자동 입력하지 않는다. 성별·나이·날짜를 계정이나 현재 날짜로 추정하지 않는다.
- 숫자 문자열을 보존하고 `evidence`, `reviewItems`, `issues`는 저장 본문에서 제외한다. 사진 확인 저장은 `manual`이며 `reportKind` 기본값은 `unknown`이다.
- 취소·화면 이탈 이후 응답 폐기, 429 대기, 오류 후 직접 입력을 지원한다. 비용이 발생하는 추출을 자동 재호출하지 않는다.
- 사진 확인 초안은 계정별 `photo` 공간에 격리한다. 명시적인 재선택은 사용자 확인 후 사진 초안만 지운다. 저장 중이거나 결과가 불확실하면 원래 요청을 보존한다. 새로고침 시 값과 메모는 복원하지만 사진 미리보기는 복원하지 않는다.

## 간이측정은 기록 등록의 한 방법

시작점은 `/onboarding`이며 `/workout?mode=assessment`에서 공용 `WorkoutRunner`로 성인 절차를 실행한다. 기존 `?curriculum=adult-self-assessment-v1` 북마크도 유지한다. 일반 `/workout`은 기존 배정 조회를 유지한다.

`AssessmentWorkout`이 저장을 담당하며 커리큘럼 배정·교체·완료 요청은 보내지 않는다. 신규 저장은 `entryMethod: self_assessment`, `reportKind: unknown`이다. `simple`은 기관의 공식 간편측정이므로 자동으로 설정하지 않는다. 저장 결과가 미확정인 기존 요청은 키와 본문을 그대로 재전송하며 이 변경 때문에 본문을 다시 작성하지 않는다.

- 만 19~64세, 신체정보·체력 항목은 건너뛸 수 있고 실제 값 1개 이상만 저장한다. 빈 값 대신 가짜 0을 넣지 않는다.
- 성인 `self_curl_up`은 프론트엔드 신규 등록에서 제거했다. 간이측정 근지구력은 `cross_sit_up`으로 고정하고, 직접 입력·사진 확인·미입력 목록에서도 성인 윗몸말아올리기를 제외한다. 공식 청소년 `curl_up`은 유지한다.
- 기존에 저장된 `self_curl_up` 기록은 조회·수정 시 보존한다. 이전 간이측정 초안의 해당 횟수는 다른 종목으로 변환하지 않고 제외하며 다른 측정값은 유지한다. 서버에 이미 전달했을 수 있는 미확정 저장 요청은 원래 키·본문으로 재확인한다. 이 프론트 브랜치의 `backend/`는 변경하지 않는다.
- YMCA 10초 맥박 횟수는 ×6한 bpm을 보내며 VO₂max로 환산하지 않는다. 실제 카탈로그의 `ymca_recovery_heart_rate`는 양수 Decimal이라 기록 수정에서 소수도 보존한다.
- BMI는 신장·체중이 모두 있을 때 계산한다. 유연성은 기준선으로부터의 부호 있는 cm다.
- 인증 만료 후 같은 계정의 mode와 진행을 복원한다. 로그아웃·다른 계정 전환 시 초안을 지운다.

## 종목 평가와 상세 리포트

생성·수정·상세 응답의 `items[].evaluation`을 읽는다. 최상위 `evaluation.status: not_evaluated`와 `reason: overall_certification_not_computed`는 종합 인증을 계산하지 않았다는 뜻이므로 종목 리포트를 숨기는 조건으로 쓰지 않는다.

`lib/fitness-contract.ts`가 실제 응답을 검증하고 공통 표시 상태로 변환한다. 프론트에서 등급·대표 종목을 계산하지 않는다. 서버 계산과 결과표 원문 `reportedGrade`/`reportedOverallGrade`를 별도로 표시한다.

| 종목 상태                  | 표시                                  |
| -------------------------- | ------------------------------------- |
| `graded`                   | 서버가 반환한 1~3등급                 |
| `below_standard`           | 기준 미달, 원점 바깥의 가장 작은 고리 |
| `insufficient_information` | 평가 불가 · 정보 부족, 원점           |
| `criteria_unavailable`     | 평가 불가 · 기준 없음, 원점           |
| `not_evaluated`            | 평가 미존재, 원점                     |

상세 기준은 `criterion`의 연령·성별·단위·방향·버전·적용 기간·출처와 `thresholds`, `nextTarget`을 표시한다. `intervals`는 대안(OR), 하나의 interval의 lower/upper는 모두 충족(AND)이며 열린 경계도 보존한다. `adjustments`의 증가/감소 방향, 차이, 경계 초과 필요 여부를 보여 준다. 최고 등급이면 목표를 만들지 않는다. 조건이 두 등급뿐인 항목에 임의 3등급을 추가하지 않는다.

동일 수치의 `57.0`과 `57`은 Decimal 비교로 같다고 검증하되 원문 문자열은 표시에서 보존한다. 값·경계를 JavaScript 부동소수점으로 반올림하지 않는다. HTTP(S) 출처만 링크로 사용한다.

검증은 기록 ID·revision·나이·성별·카탈로그·단위·평가 대상, 중복/누락 축, 대표 종목과 평가의 일치를 확인한다. 잘못되거나 부분적으로 누락된 응답은 오류 안내를 보여 주며 원본 기록과 수정·삭제 기능은 유지한다. 평가 필드 자체가 없는 이전 서버 응답도 원본은 읽을 수 있다. 마이그레이션 전 기록의 `not_evaluated`는 미측정·기준 미달과 구분한다.

## 6축과 최신 한 회차

축은 12시부터 시계 방향으로 심폐지구력 → 근력 → 근지구력 → 유연성 → 민첩성 → 순발력이다. `axes[]`의 `axis`, `status`, `grade`, `representativeMeasurementCode`, `measuredMeasurementCodes`, `recordRevision`을 읽는다.

- `graded`는 해당 등급 위치, `below_standard`는 최소 고리, `unevaluable`과 `not_measured`는 원점이다. 상세 응답에 같은 원인의 종목 평가가 있으면 원점 사유를 더 자세히 표시한다.
- 평가 가능한 종목이 0·1·2개여도 여섯 축과 점을 모두 유지하고 시계 방향으로 연결해 닫는다. 좌표 0을 DB의 0등급으로 해석하지 않는다.
- 같은 축에서 가장 좋은 등급과 대표 종목 선택은 서버 결과를 사용한다. 다른 회차나 원문 등급으로 빈 축을 보충하지 않는다.

`lib/latest-fitness.ts`는 `/measurements/latest-polygon`의 `measurementId`, `measuredOn`, `revision`, `axes`를 읽는다. 상세 종목·기준 필드는 요구하지 않는다. 기록이 없으면 식별 필드 세 개가 모두 null이고, revision이 null인 미측정 축 여섯 개가 있어야 한다. 404/501·잘못된 응답·통신 오류를 빈 기록으로 처리하지 않는다.

계정의 체력 프로필은 측정 저장/수정/삭제, 다른 탭 변경, 창 복귀 후 다시 조회한다. 조회 중에는 이전 차트를 숨기고 늦은 응답을 폐기한다. 현재 서버의 대표 선정은 `measuredOn DESC, createdAt DESC, id ASC`다. 목록 정렬은 `measuredOn DESC, id ASC`로 남아 있어 같은 날 첫 목록 항목과 대표 기록이 다를 수 있다. 프론트에서 응답 순서를 임의로 바꾸지 않는다.

## 검증과 남은 사항

`npm run check`, `npm run format:check`, 실제 API를 실행한 상태에서 `npm run test:e2e`로 검증한다. `fitness-live`는 실제 응답으로 등록 → 상세 → 내 프로필 → 수정 → 삭제를 검사한다. `fitness-report`와 `latest-fitness`는 실제 구조의 fixture로 잘못된 응답·경계·동시성을 검사한다. 상세 결과는 [검증 기록](VERIFICATION.md)에 있다.

1. 백엔드 목록과 대표 조회의 같은 날짜 정렬 순서가 다르다. 목록과 대표의 일관성은 별도 정렬 계약 작업이다.
2. 성인 YMCA bpm은 아래 환산 계약으로 참고 평가한다. 센터의 측정 정확도와 동일하다고 표시하지 않는다. 성인 `self_curl_up`의 신규 등록은 제거했으며 과거 기록의 평가 사유는 서버 응답대로 표시한다.
3. 실제 OpenAI 판독 성공은 사용자가 별도로 확인했다. 이번 절대악력 변경에서는 유료 분석을 다시 호출하지 않고 추출 계약·검증 로직·사진 확인 후 저장 흐름을 검사했다. 다양한 결과지의 실제 판독 품질은 별도 확인 범위다.
4. 실제 iOS/Android 카메라·키보드·음향과 Safari는 별도 확인 범위다.

## 절대악력 입력과 환산 리포트 (2026-09-24)

백엔드 `3c9b91c`의 `nfa100-2026-09-24-grip-v1` 카탈로그와 연결한다. [백엔드 환산 계약](https://github.com/r3j0/project-health/blob/3c9b91ce56205356f8a5ea9a0059b091794f0aed/backend/docs/absolute-grip.md).

- 카탈로그의 `absolute_grip_strength`를 기존 항목 선택 UI에서 선택한다. 원본 `kg`을 그대로 저장하고 프론트가 % 또는 등급을 만들어 제출하지 않는다.
- 같은 회차 체중이 없으면 원본만 저장할 수 있음을 안내하고 `측정 당시 체중 추가`를 제공한다. 계정이나 다른 기록에서 체중을 가져오지 않는다.
- 사진 추출의 절대악력 kg을 공용 입력 폼으로 전달한다. 원문이 아닌 상대악력을 사진 단계에서 만들지 않는다.
- `items[].evaluation.conversion`은 선택 필드다. 공식 평가 대상은 `relative_grip_strength`, 단위는 `%`이고 원본 항목의 코드·단위는 `absolute_grip_strength`·`kg`이다. 이 차이는 유효한 환산 근거가 있을 때만 허용한다.
- 어댑터는 환산 버전·단위·출처 및 원본 악력·체중이 현재 기록의 값과 일치하는지 검사한다. 기존 응답 검증을 무조건 완화하지 않는다. 환산 수치와 목표 차이만 512자까지 허용하여 서버의 긴 Decimal 표현을 보존한다. 입력 한도 128자는 유지한다.
- 상세 리포트에서 원본 kg, 환산 %, 같은 기록의 체중, 공식 등급 기준·다음 목표 %를 구분한다. 화면에서는 긴 소수를 6자리까지 줄여 `약` 또는 `미만`으로 표시하며 등급 판정에는 관여하지 않는다.
- 체중 변경·제거 후 서버 재평가를 표시한다. 상대악력 직접 입력도 유지하며 두 항목이 함께 있으면 기존 서버의 근력 축 최고 등급을 표시한다.
- 기존 카탈로그·과거 평가 스냅샷은 보존되므로 절대악력 항목 추가는 새 카탈로그의 신규 기록에서 제공된다. 간이측정의 운동 절차·기존 커리큘럼에는 악력계 검사를 추가하지 않는다.

목록과 대표 조회의 같은 날짜 정렬 차이는 이 변경에 포함하지 않는다. 확인한 `4b90bbe`의 목록은 날짜·ID, 대표 조회는 날짜·생성 시각·ID 기준이다. 삭제 종목에 대한 사진 검토 안내 문구도 사용자 요청으로 유지한다.

## 성인 스텝검사 환산 리포트 (2026-09-24)

백엔드 `ad1f698`의 [스텝검사 계약](https://github.com/r3j0/project-health/blob/ad1f698/backend/docs/step-assessment.md)에 연결한다. 기존 카탈로그와 원본 `ymca_recovery_heart_rate`(bpm)를 유지한다. API 경로와 입력 스키마는 변경하지 않는다.

- 준비·검토·기록 편집에서 측정 당시 성별·나이·신장·체중이 필요함을 안내한다. 신장·체중 항목을 추가할 수 있으며 생략하거나 스텝검사를 건너뛰는 기존 부분 저장을 유지한다.
- 러너는 10초 맥박 × 6을 한 번 수행한다. 편집·직접 입력은 이미 bpm인 값을 그대로 제출하고 VO₂max나 등급은 계산하지 않는다.
- `evaluation.conversion`은 기존 악력 환산과 구분되는 `nfa100-adult-step-vo2max-v1`이다. `measurementCode: step_test_vo2max`, `unit: ml/kg/min`, 양수 Decimal value, 원본 맥박·신장·체중 inputs, 같은 기록의 성별·나이, `assessmentKind: reference`, `protocol: nfa100-self-step-30cm-96bpm-180s-rest60s-pulse10s-v1` 및 출처 URL을 검증한다.
- 원본·환산 입력 불일치, 잘못된 단위/공식/측정 방식, 누락된 근거가 있으면 평가 응답 오류를 표시한다. 기존 환산 전 YMCA 스냅샷은 원래 평가 불가 사유와 원본으로 읽는다.
- 상세에는 bpm 원본, 추정 VO₂max, 남녀별 공식과 측정 당시 입력, 참고 등급, VO₂max 기준 및 다음 목표를 표시한다. 등급 판정은 서버에 맡기며 표시용 소수 축약으로 다시 판정하지 않는다.
- 6축 집계는 서버 응답을 그대로 따른다. 대표가 YMCA일 때 계정·상세 다각형에 자가측정 기반 참고 등급임을 표시한다. 최신 조회는 종목 상세 근거를 주지 않으므로 평가 불가 사유의 상세 내용은 기록 화면에서 확인한다.
- 사용자 커리큘럼과 과거 기록은 자동 변경하지 않는다. 사용자가 기록을 수정하면 서버가 새 revision에서 재평가한다.


## 운동량·목적 설정 연동 (2026-09-26)

[백엔드 PR #8](https://github.com/r3j0/project-health/pull/8)의 `87981e82b6a73023e412af7a663cd9457dcc01e7`를 확인하고 `/account/preferences`를 [운동 설정 계약](https://github.com/r3j0/project-health/blob/87981e82b6a73023e412af7a663cd9457dcc01e7/backend/docs/user-preferences-api.md)에 연결했다.

- 조회: `GET /api/v1/users/me/preferences`. `exerciseVolume`, nullable `exerciseGoal`, `ownedTools`, UTC `updatedAt` 응답을 검증한 뒤 표시한다. 실패·누락·잘못된 응답을 기본값으로 대체하지 않는다.
- 저장: 같은 경로의 `PATCH`. 마지막 서버 응답과 비교한 변경 필드만 전송한다. `updatedAt`, `null`, 빈 객체를 보내지 않는다. 운동 목적 미선택 상태에서는 운동량만 저장할 수 있으며 선택한 목적을 지우는 기능은 제공하지 않는다.
- 기존 `api`의 Bearer 인증·쿠키·401 갱신과 `X-CSRF-Protection: 1`을 사용한다. 저장 응답으로 선택 상태를 갱신하므로 다른 곳에서 수정한 미변경 필드도 서버 값으로 반영한다.
- 중복 제출을 막고 서버 필드 오류와 429 대기 시간을 표시한다. 통신 오류·5xx·잘못된 저장 응답에서는 성공을 표시하지 않는다. 서버가 이미 저장했을 가능성이 있으므로 원래 변경분을 유지하고 같은 요청을 재시도한다. 확인 전에는 선택을 잠근다.
- 미저장 이탈 확인과 세션/컴포넌트별 비동기 작업 보호를 재사용한다. 이탈·계정 전환 후 도착한 응답을 다른 사용자 화면에 반영하지 않는다. 브라우저 저장소에 개인 설정 사본을 만들지 않는다.
- `/users/me` 계정 변경, `/auth/me` 프로필, 측정·등급·재화·온보딩·커리큘럼 계약은 그대로 사용한다. 설정 API 자체는 추천을 실행하지 않는다. 2026-09-29 이후 신규 루틴 생성 시 저장된 운동량·목적·보유 도구를 사용한다.
- 서버에 `20260926000100_user_preferences`와 후속 `20260929000200_owned_tools`·`20260929000300_home_training_tools` 마이그레이션이 필요하다. 기존 사용자 설정 누락 시 503을 처리하며 프론트에서 대체 행이나 임의 데이터를 생성하지 않는다.


## 닉네임 조회·설정 탭 (2026-09-27)

백엔드 PR #9의 최신 커밋 [`31278eb`](https://github.com/r3j0/project-health/commit/31278ebcf47d678e9e0f9bc43c46b5deab6e8cf9)과 [닉네임 계약](https://github.com/r3j0/project-health/blob/31278ebcf47d678e9e0f9bc43c46b5deab6e8cf9/backend/docs/nickname-profile.md)을 따른다.

- `GET /auth/me`의 `nickname: string | null`을 프로필 제목으로 표시한다. `null`은 미설정이며 이메일로 대체하지 않는다. 누락·형식 오류 응답은 기존 프로필 오류/재시도로 처리한다.
- 계정 설정은 이메일·비밀번호·생년월일·닉네임·회원 탈퇴를 각각 선택한다. 기본 탭은 이메일이고 `?tab=birth`, `?tab=nickname`으로 직접 진입할 수 있다. 운동 추천의 생년월일 안내는 생년월일 탭으로 연결한다.
- `GET /users/me/profile`로 저장된 닉네임을 읽고 `PATCH /users/me/profile`에 `{ "nickname": "건강친구" }`만 전송한다. 생년월일 탭은 기존 `{ "dateOfBirth": "2000-02-29" }`만 보낸다. 두 필드가 서로 덮어쓰이지 않는다.
- 입력은 trim → NFC 정규화 후 한글 완성형/호환 자모·영문·숫자·밑줄 2~20자로 검증한다. 중복 닉네임을 허용하며 중복 확인 API는 호출하지 않는다. `INVALID_NICKNAME` 및 필드 오류·429·조회/저장 실패는 성공으로 표시하지 않고 입력과 재시도를 유지한다.
- 프로필 변경은 현재 비밀번호 입력이나 로그아웃 없이 저장한다. 성공과 불확실한 응답 이후 `/auth/me`를 재조회하며 다른 탭에도 프로필 갱신을 알린다. 계정이 바뀐 뒤 늦은 응답은 반영하지 않는다.
- 모든 설정 탭의 미저장 입력은 탭 이동 시 보존하고 화면 이탈은 공통 가드가 한 번만 확인한다. 저장 중에는 탭 이동을 막는다. 이메일·비밀번호·탈퇴의 기존 `/users/me` 처리와 세션 무효화는 유지한다.
- 서버에는 `20260927000200_user_nickname` 마이그레이션이 필요하다. 검증용 로컬 DB와 서버를 해당 커밋으로 갱신했으며 운영 배포는 수행하지 않았다.
- 활동 리포트 다섯 값은 계속 요청된 목업이다. 화면에서 제목·예시 표기를 제거한 것은 실제 데이터 연동을 의미하지 않는다. 메인 운동 스트릭은 실제 이력 집계를 유지한다.

검증: `check`(단위 123개), 서식 검사, 관련 Chromium 시나리오 25개 통과. `nickname-settings-live`는 실제 API의 별도 테스트 계정으로 부분 저장·새로고침·기존 토큰/정보 보존을 확인하고 계정을 정리한다. `nickname-settings`는 계약 대역으로 오류·정규화·탭/계정 전환을 검사한다.


## 보유 운동 도구 (2026-09-29)

`/account/preferences`에서 저장된 `ownedTools`를 읽어 복수 선택으로 표시한다. 밴드/band, 덤벨·아령/dumbbell, 짐볼/gym_ball, 폼롤러/foam_roller, 줄넘기/jump_rope, 스텝박스·스텝퍼/step_box, 공/ball, 콘/cone, 사다리/agility_ladder, 보슈/bosu의 10종 순으로 정규화한다. 없음은 빈 배열이며 다른 선택과 동시에 켜지지 않는다. 변경된 필드만 기존 인증·CSRF 보호 PATCH로 전송하며 배열 전체를 교체한다. 응답에 도구가 누락되거나 지원하지 않는 값이 있으면 편집 가능한 기본값으로 대체하지 않고 조회 오류를 표시한다. 따라서 DB 마이그레이션 → 새 API → 프론트 순서로 반영한다.

저장 중 입력 잠금, 실패 안내, 결과 불명 시 동일 요청 재시도, 성공 안내는 기존 흐름을 사용한다. 실제 API와 DB에서 새로고침·재로그인·별도 브라우저 세션 복원을 검증하는 `tests/e2e/workout-preferences-live.spec.ts`와 실패·복수 선택을 검증하는 `workout-preferences.spec.ts`를 유지한다. 설정 화면은 추천을 실행하지 않는다. 도구 변경은 다음 신규 루틴 생성부터 사용하며 이미 배정된 루틴은 유지한다.
