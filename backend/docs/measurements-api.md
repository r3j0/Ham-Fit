# 국민체력100 측정 기록 API

국민체력100 결과를 사용자가 확인하여 실제 DB에 저장·조회·수정·삭제한다. 2026-09-21 사용자 결정으로 [사진 추출 API](measurement-extraction-api.md)를 저장 전 초안 단계에 추가했다. 2026-09-23에는 성인 간이측정 저장·공식 종목 평가·6축 조회를 추가했다. [평가 API·프론트 계약](measurement-evaluation-api.md)을 함께 따른다. 운동 추천·커리큘럼 변경은 포함하지 않는다. [측정 데이터 명세](measurement-data-spec.md)의 지원 연령, 공식 항목, 부분 저장 정책을 따른다.

## 실행과 인증

아래 명령은 `backend/`에서 실행한다.

```bash
npm run db:local:start
npm run auth:secret
npm run db:migrate:deploy
npm run start:dev
```

기본 주소는 `http://localhost:3001/api/v1`다. 카탈로그 외의 모든 경로는 `Authorization: Bearer <access_token>`이 필요하다. access token은 [이메일 인증 API](auth-api.md)에서 회원가입·로그인·갱신으로 얻는다. 로그아웃·세션 만료 후에는 측정 경로도 401을 반환한다. 소유자 ID는 인증 정보로 결정하며 요청 본문의 `userId`는 거절한다.

아래 경로는 기본 주소 뒤에 붙인다. HTTP API의 `v1`과 검사 정의의 `catalogVersion`, 개별 기록의 `revision`은 별개다. [API 버전 관리](api-versioning.md)를 따른다.

## 경로와 응답

| 요청                               | 성공 응답         | 설명                                                           |
| ---------------------------------- | ----------------- | -------------------------------------------------------------- |
| `GET /measurement-catalog?age=25`  | 200               | 해당 연령의 실제 검사 정의·단위·출처·버전. 공개 기준 데이터    |
| `POST /measurements`               | 201, 재시도는 200 | 최소 한 개 측정값과 회차 정보 생성                             |
| `POST /measurements/extract`       | 200               | 사진 1장 추출 초안. 저장·온보딩 변경 없음. 별도 multipart 계약 |
| `GET /measurements`                | 200               | 내 기록의 페이지별 목록                                        |
| `GET /measurements/latest-polygon` | 200               | 내 최신 회차 하나의 6축 대표 등급·상태                         |
| `GET /measurements/:id`            | 200               | 내 기록 상세와 ETag                                            |
| `PATCH /measurements/:id`          | 200               | 지정한 필드 수정, revision 증가                                |
| `DELETE /measurements/:id`         | 204               | 회차와 모든 항목 삭제                                          |

다른 사용자의 기록과 존재하지 않는 기록은 모두 404다. 개인 기록 응답은 `Cache-Control: no-store`다. 이 경로들은 프론트 화면이 아니라 HTTP API다. 주소창은 GET만 보내므로 생성·수정·삭제는 curl, Postman 또는 프론트 코드로 요청한다.

### 카탈로그

`age`는 선택 사항이며 13~64세 정수다. 생략하면 청소년·성인 합집합을 반환한다. `version`이 없으면 DB에서 확인일·버전 내림차순으로 최신 카탈로그를 선택한다. 지정한 버전이 없으면 404, 카탈로그가 준비되지 않았으면 503이며 임의 목록으로 대체하지 않는다.

응답의 `version`을 생성 요청의 `catalogVersion`에 넣는다. `definitions`에는 `code`, `label`, `category`, `factor`, `unit`, `valueType`, `minAge`, `maxAge`, `minValue`, `minInclusive`, `maxValue`, `sourceUrls`, `availableForNewMeasurements`, `unavailabilityReason`이 있다. 숫자 경계는 문자열 또는 null이다. `checkedOn`은 자료 확인일이며 공식 시행일과 구분한다.

최신 `nfa100-2026-09-24`는 전체 20개(성인 16개·청소년 15개) 정의를 제공한다. 공식 수치 기준을 확보하지 못한 성인 `self_curl_up`을 제외했으며 청소년 `curl_up`은 유지한다. 과거 카탈로그는 그대로 조회되지만 `self_curl_up` 정의에는 `availableForNewMeasurements: false`, `unavailabilityReason: "official_criteria_unverified"`를 반환한다. 나머지는 true와 null이다. 신규 입력 화면은 사용 가능 여부를 확인한다.

### 생성 입력

사진 추출 응답 전체를 저장 요청으로 보내지 않는다. 사용자 확인 후의 메타데이터와 items만 전송한다. `entryMethod`는 생략하면 `manual`이며 사진 초안 확인 저장도 이를 유지한다. 간이측정 완료 저장은 `self_assessment`를 보낸다. 변환 예시는 [사진 추출 안내](measurement-extraction-api.md)를 따른다. 아래 Idempotency-Key·revision 계약은 저장 CRUD에 적용한다.

필수: `catalogVersion`, `measuredOn`(YYYY-MM-DD), `ageAtMeasurement`(13~64), `items`(1개 이상).

선택: `entryMethod`(manual/self_assessment, 기본 manual), `sexAtMeasurement`(male/female/null), `reportKind`(standard/simple/unknown), `centerName`, `reportedOverallGrade`. 성별·시설·등급 생략은 null, 측정 유형 생략은 unknown이다. 빈 선택 텍스트는 null 또는 생략으로 보내며 빈 문자열은 오류다. 텍스트 필드의 앞뒤 공백은 제거한다.

각 항목은 `measurementCode`, `value`, `unit`, 선택 `reportedGrade`를 받는다. **value는 모든 숫자를 10진수 문자열로 보낸다.** 실제 0회는 `"0"`이다. JSON 숫자·공백·빈 문자열·지수 표기·NaN·Infinity는 거절한다. 소수 정밀도를 잃지 않도록 저장·응답 모두 Decimal을 사용하며 자릿수를 반올림하지 않는다. `"165.00"`과 `"165"`처럼 같은 수치의 표기는 정규화한다.

요청 크기 제한: 숫자 문자열은 부호·소수점 포함 128자, 항목은 최대 100개, 시설명 200자, 등급 100자다. 이는 시스템 입력 크기 제한이며 생리학적 정상 범위가 아니다. 실제 허용 항목과 수치 범위는 요청 카탈로그의 DB 정의로 검증한다. 알 수 없는 필드·코드·단위·중복 코드는 거절한다.

측정일은 한국 시간 기준 미래가 아니어야 하며 측정 당시 나이로 검사를 선택한다. 잘못된 항목이 하나라도 있으면 전체 요청을 거절한다. 오류는 `{ "statusCode": 400, "message": "...", "errors": [{ "field": "items.0.unit", "message": "..." }] }`처럼 필드별로 반환한다.

`self_curl_up` 신규 생성은 등록 방식·카탈로그 버전에 관계없이 400(`items.<index>.measurementCode`)으로 거절한다. 제외 전에 성공한 생성 요청의 동일 키·동일 입력 재시도는 아래 재시도 계약을 유지한다.

### 생성 요청 재시도

POST에는 UUID 형태의 **`Idempotency-Key` 헤더가 필수**다. 프론트는 한 번의 저장 작업에 키를 하나 생성하고 네트워크 재시도에서는 그대로 사용한다. 별도 회차를 저장하려면 새 키를 만든다. 같은 날의 회차도 서로 독립적이다.

- 처음 성공: 201, `Idempotency-Replayed: false`, Location, ETag.
- 같은 사용자·키·정규화한 입력: 기존 기록의 **현재 상태**를 200으로 반환한다. 수정된 기록을 최초 값으로 되돌리지 않는다. `Idempotency-Replayed: true`.
- 같은 키에 다른 입력: 409. 항목 순서·동일한 수치의 소수점 표기 차이는 다른 입력으로 취급하지 않는다.
- 생성 검증/트랜잭션 실패: 키 예약도 롤백되어 수정한 입력으로 다시 요청할 수 있다.
- 그 키로 생성한 기록을 삭제한 뒤 재시도: 410. 삭제된 기록을 재생성하지 않는다.

`measurement_create_requests`에 사용자별 키·입력 해시·기록 ID를 실제 생성과 같은 트랜잭션으로 저장한다. 삭제 후에는 입력 해시와 키만 남기고 기록 연결을 null로 바꾼다. 다른 계정은 같은 키를 독립적으로 쓸 수 있다. 이 작은 이력에는 별도의 자동 만료를 두지 않으며 계정 삭제 시 함께 삭제한다. 입력 원문이나 과거 응답을 중복 보관하지 않는다.

### 조회·수정·삭제

상세는 저장한 메타데이터와 실제 입력 `items`만 반환한다. 적용 연령에 속하지만 입력하지 않은 코드는 `missingMeasurementCodes`에 나열한다. 다른 연령 전용 검사와 신규 입력에서 제외한 `self_curl_up`은 누락으로 계산하지 않는다. `items[].evaluation`은 저장된 종목별 평가, `axes`는 이 회차의 6축 대표값이다. 기존 최상위 `evaluation`은 종합 인증 미산출을 나타내며 `status = not_evaluated`, `reason = overall_certification_not_computed`다. 종목 등급으로 종합 인증을 만들지 않는다. 상세 필드와 과거 기록 미평가 상태는 [평가 계약](measurement-evaluation-api.md)을 따른다.

상세 조회와 생성 재시도는 회차·항목·카탈로그를 Repeatable Read 트랜잭션의 같은 스냅샷에서 읽는다. 조회 도중 수정·삭제가 완료되더라도 응답의 메타데이터·items·누락 항목·revision·ETag는 같은 시점의 기록을 나타낸다. 조회와 겹친 삭제에서는 삭제 직전 기록이 반환될 수 있으며, 삭제 완료 후 시작한 상세 조회는 404, 생성 재시도는 410이다.

목록은 `{ "items": [...], "nextCursor": "..." 또는 null }` 형태다. 각 행에 항목 개수 `itemCount`와 회차 정보가 있으며 값 전체는 상세 경로로 조회한다. 2026-09-24 사용자 결정으로 측정일 내림차순, 같은 날은 생성 시각(`createdAt`) 내림차순, 생성 시각까지 같으면 ID 오름차순으로 정렬한다. 값만 수정해도 순서는 바뀌지 않는다. `limit` 기본 20·최대 50, `cursor`는 직전 응답의 nextCursor, `from`·`to`는 측정일 범위이며 양 끝을 포함한다. 빈 목록은 200과 빈 배열이다. 페이지 도중 기록 날짜가 변경되는 경우까지 고정된 스냅샷을 보장하지 않는다. 커서가 가리키는 행이 삭제되어도 측정일·생성 시각·ID 경계로 계속 조회할 수 있다. 생성 시각은 DB의 마이크로초 정밀도를 커서 안에 보존한다. 페이지 조회 사이에 경계보다 앞에 추가된 기록은 첫 페이지를 새로 조회하면 보인다.

커서는 클라이언트가 해석하거나 생성하지 않는 불투명한 값이다. 새 조회는 v2 커서를 발급한다. 변경 전에 발급된 v1 커서는 해당 페이지 체인이 끝날 때까지 기존 측정일 내림차순·ID 오름차순을 유지하고 v1 커서를 계속 발급한다. 커서 없이 새로 조회하면 새 정렬을 적용한다. 각 페이지의 경계·요약 조회는 같은 Repeatable Read 스냅샷에서 수행한다.

대표 등급은 `GET /measurements/latest-polygon`으로 조회한다. 가장 최근 측정일의 기록 중 생성 시각(`createdAt`)이 가장 늦은 회차 하나의 6축 등급·상태를 반환한다. 생성 시각까지 같으면 ID 오름차순으로 결정하며 수정 시각은 선택에 영향을 주지 않는다. 새로 조회한 전체 목록의 첫 행과 대표 회차는 같은 정렬 기준을 사용한다. 다만 기간을 제한한 목록, 변경 전 v1 커서로 이어보는 목록, 서로 다른 시점에 조회한 응답은 다를 수 있으므로 대표 등급은 이 전용 API로 조회한다.

상세·생성·수정 응답에 `revision`과 `ETag: "1"` 형식의 헤더가 있다. 이 응답(동일 생성 키 재시도 포함)은 `Cache-Control: no-store, no-transform`으로 중간 서버의 압축·변환에 의한 강한 ETag 변경을 금지한다. 캐시 저장 금지는 유지한다. PATCH·DELETE에는 **`If-Match: "조회한 revision"`**을 보낸다. 헤더 누락은 428, 형식 오류는 400, 오래된 버전은 412다. 프론트는 412를 받으면 다시 조회해 사용자 변경과 비교한 후 재요청한다. `*`나 약한 ETag로 무조건 덮어쓰는 동작은 허용하지 않는다.

PATCH에서 생략한 필드는 유지하고, 선택 필드를 null로 보내면 지운다. `items`를 보내면 목록 전체를 교체하므로 유지하려는 항목도 함께 보내야 한다. 빈 items로 마지막 값을 없앨 수 없다. `catalogVersion`, 소유자, ID, sourceProgram, revision은 수정 입력에 넣지 않는다. `entryMethod`는 수정 가능하며 생략하면 유지한다. 나이·등록 방식을 바꾸면 기존 항목도 다시 검증한다. 매 수정에서 종목 평가를 새 revision으로 다시 계산하며, 항목·평가·revision을 같은 트랜잭션으로 반영한다. 성공한 PATCH는 같은 값을 다시 보내도 revision이 증가한다.

PATCH는 revision 조건이 붙은 UPDATE로 회차를 잠근 뒤 현재 항목을 읽고 검증한다. 먼저 완료된 동시 수정은 412, 삭제는 404로 처리하며 이전 나이와 새 항목을 섞어 입력 오류로 판정하지 않는다. 항목 검증에 실패하면 같은 트랜잭션에서 변경한 메타데이터·revision도 모두 롤백된다.

기존 기록에 이미 저장된 `self_curl_up`은 PATCH에서 유지·값 수정·제거할 수 있다. 원래 없던 기록에 추가하거나 제거한 항목을 다시 추가하면 400이다. 기존 기록·과거 카탈로그·저장된 평가는 자동 삭제하거나 일괄 재평가하지 않는다.

## 직접 테스트 순서

개발용 더미 한 건을 먼저 만들고 API·DB 저장 결과를 대조하려면 `npm run demo:measurement`를 실행한다. 이 명령은 프로젝트 전용 로컬 PostgreSQL에서만 실행되며, 별도 `demo-measurement-...@example.test` 계정에 `[개발용 더미] 실제 측정 아님`으로 표시한 한 회차를 남긴다. 임시 API 서버는 확인 후 종료하고, 기존 계정·기록은 변경하지 않는다. 다시 실행해도 동일 요청 키를 사용한다. 더미 입력을 실제 API로 검증·저장하는 것이며 API 응답이나 점수를 흉내 내지 않는다.

입력·실제 조회 결과·검증 내역은 `.local/measurement-demo/input.json`, `record.json`, `verification.json`에 저장한다. 테스트 계정 로그인용 `credentials.json`은 파일 권한 600으로 보관하며 모든 파일은 Git에서 제외된다. 더미를 직접 수정·삭제했다면 재실행으로 원래 값을 자동 복원하지 않는다. 삭제하려면 `state.json`의 기록 ID로 아래 DELETE API를 호출한다.

서버는 켜 두고 **다른 터미널**에서 `backend/`로 이동한다. 아래 TOKEN에는 로그인 응답의 access_token을 넣는다. 실제 비밀번호·토큰을 문서나 Git에 저장하지 않는다.

```bash
cd /Users/idonghyeon/project-health/backend
TOKEN='여기에_로그인_응답의_access_token'
curl -sS 'http://localhost:3001/api/v1/measurement-catalog?age=25'
```

다음 JSON의 `catalogVersion`은 위 응답의 version을 사용한다. 아래 버전·날짜·측정값은 재현용 예시이며, 운영 서비스가 생성하는 사용자 결과가 아니다. 최신 카탈로그는 `nfa100-2026-09-24`다. 아래 기존 `nfa100-2026-09-19` 예시도 계속 지원한다. 직접 측정값으로 바꿔도 같은 검증·저장 경로를 거친다.

새 저장 요청 키를 한 번 생성하고 기록을 추가한다:

```bash
MEASUREMENT_REQUEST_KEY=$(uuidgen)
curl -i -X POST http://localhost:3001/api/v1/measurements \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $MEASUREMENT_REQUEST_KEY" \
  --data '{"catalogVersion":"nfa100-2026-09-19","measuredOn":"2026-09-17","ageAtMeasurement":25,"items":[{"measurementCode":"sit_and_reach","value":"-3.25","unit":"cm"}]}'
```

201과 저장된 실제 ID·시각·값을 확인한다. 생성 응답의 id를 다음 변수에 넣는다:

```bash
MEASUREMENT_ID='여기에_생성_응답의_id'
curl -i http://localhost:3001/api/v1/measurements -H "Authorization: Bearer $TOKEN"
curl -i "http://localhost:3001/api/v1/measurements/$MEASUREMENT_ID" -H "Authorization: Bearer $TOKEN"
```

최초 기록의 revision이 1이면 아래 요청으로 수정한다. 200과 revision 2가 나오는지 확인한다:

```bash
curl -i -X PATCH "http://localhost:3001/api/v1/measurements/$MEASUREMENT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "1"' \
  --data '{"items":[{"measurementCode":"sit_and_reach","value":"-1.5","unit":"cm"}]}'
```

실제로 저장된 값은 상세 GET이나 Prisma Studio의 `measurements`·`measurement_items`에서 확인한다. 마지막으로 **이 예시에서 만든 기록**을 삭제하려면 수정 후 revision 2를 사용한다:

```bash
curl -i -X DELETE "http://localhost:3001/api/v1/measurements/$MEASUREMENT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'If-Match: "2"'
```

204 후 같은 ID 조회는 404, 같은 생성 요청 키·본문 재전송은 410이어야 한다. access token이 만료되면 인증 API에서 갱신하거나 다시 로그인한다. 측정 API는 refresh 쿠키만으로 인증하지 않는다.

## 온보딩 연계 (2026-09-21 정정)

기존 Measurement·MeasurementItem과 측정 CRUD를 유지한다. `GET /api/v1/auth/me`의 `currentFitness` 응답만 제거하며 실제 수치는 위 측정 목록·상세 경로에서 조회한다. 선호 운동·운동 목적·개인별 목표/기준값은 폐기했다.

남은 유효한 회차가 있으면 `isOnboarded: true`, 마지막 회차 삭제 후 false다. 기존 측정 CRUD·부분 입력·소유권·revision·Decimal 계약과 데이터는 변경하지 않는다. MVP 온보딩 조건과 계정 정보 변경은 [사용자 API](users-api.md)를 따른다.
