# 개인 맞춤 하루 운동 API와 저장 계약

2026-09-27 사용자 결정. 추천 계산·원본 데이터 출처는 [출처 문서](provenance.md), 측정 원본은 [측정 평가 API](../measurement-evaluation-api.md)를 따른다. 아래 `/api/v1` API는 모두 기존 Bearer 인증·소유권·개인 응답 캐시 금지 규칙을 사용한다. 로그인, `/auth/me`, GET은 추천을 생성하지 않는다.

## API

| 요청                                                | 의미                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/workouts/today`                       | 빈 본문 `{}`과 UUID `Idempotency-Key`. 서버 KST 오늘 배정을 생성(201)하거나 저장된 배정 재사용(200). 클라이언트 날짜·영상 ID를 받지 않는다. |
| `GET /api/v1/workouts/current`                      | 현재 일자별 배정 또는 null. 전날 배정일 수 있으며 생성하지 않는다.                                                                          |
| `GET /api/v1/workouts/:id`                          | 소유한 일자별 배정 상세. 다른 사용자와 legacy 배정은 404.                                                                                   |
| `GET /api/v1/workouts/history?limit=20&cursor=UUID` | 배정시각 내림차순 이력. limit 1~50, `{items,nextCursor}`. 미시작·미진행도 보존.                                                             |
| `POST /api/v1/workouts/:id/events`                  | UUID `Idempotency-Key`와 재생 이벤트. 저장된 최신 배정 응답(200).                                                                           |

배정 응답은 `id`, `koreanDate`(배정일), `serverKoreanDate`(조회 시 서버 KST 날짜), `status`, `resultStatus`, `revision`, `assignedAt`, `performedAt`, `completedAt`, `video`, `progress`, `algorithmVersion`, `inputSnapshot`, `weightAdjustment`를 포함한다. `video`는 `id`, `title`, 원본 URL·카탈로그 버전·장비·연령·가중치·`durationSeconds`와 검증한 `playbackUrl`, `playbackStatus`, `verifiedDurationSeconds`를 제공한다. 검증되지 않은 주소나 길이는 성공으로 대체하지 않는다. 장비 빈 배열은 장비 정보 없음이다.

`progress`는 `{watchedSeconds,positionSeconds,intervals:[{start,end}],ratio}`. 초 단위 실수이며 실제 재생한 구간의 합집합으로 계산한다. 앞으로 이동한 위치 자체는 시청량이 아니다. 구간은 0 이상, end > start, end <= duration이며 유한해야 한다. 반복·겹침·동시 기기 보고는 한 번만 계산한다. 시청은 운동 수행의 대리 지표이고 완료는 사용자 확인이다.

```json
{
  "type": "progress",
  "deviceId": "fc3d1804-de09-4fbb-8556-eacfa346e451",
  "sequence": 2,
  "intervals": [{ "start": 0, "end": 12.5 }],
  "positionSeconds": 12.5
}
```

이벤트 type은 `start|progress|pause|end|complete`. 기기별 sequence는 배정 내 양의 증가 정수다. 불확실한 전송은 **같은 키·동일 본문**으로 재시도한다. 같은 키의 다른 본문, 재사용/역순 sequence는 409 `WORKOUT_CONFLICT`. 서로 다른 기기는 같은 배정에 각각 증가 순서를 사용하고 서버가 사용자 행 잠금으로 직렬화한다. 최대 1,000개의 구간을 한 요청에 보낸다. 선택 `occurredAt`은 타임존 포함 ISO 시각이며 서버보다 미래이면 400. 감사용 입력으로만 보존하고 실제 수행일은 서버 접수 시각을 사용한다.

## 상태와 날짜

| 현재 동작               | 저장 상태     | 대표 수행 결과                                 |
| ----------------------- | ------------- | ---------------------------------------------- |
| 배정                    | assigned      | null, 엔진 제외                                |
| start/progress/pause    | in_progress   | 최초에는 null; 이어하기 중 이전 확정 결과 유지 |
| end, 합집합 시청 < 50%  | not_performed | 계수 0, 엔진 제외, 시청 기록 보존              |
| end, 합집합 시청 >= 50% | interrupted   | 계수 0.5                                       |
| 명시적 complete         | completed     | 계수 1.0, 별도 시청 비율 조건 없음             |

미시작에는 먼저 start가 필요하다. not_performed/interrupted는 start로 이어갈 수 있다. 종료를 누르지 않은 50% 도달은 확정 결과를 만들지 않는다. completed는 최종 불변이며 새 complete는 중복 확인으로만 처리한다. 완료 후 start/progress/end는 충돌이다. 기기 이벤트 감사 이력과 배정의 대표 resultStatus는 별개다. 중단 후 완료는 같은 대표 행을 갱신하여 0.5+1.0으로 합산하지 않는다.

매일 새로운 **명시적 POST**가 현재 포인터를 해당 KST 날짜 배정으로 전환한다. 전날 미완료 또는 기존 legacy assigned를 완료로 조작하지 않고 포인터만 해제하며 supersededAt을 남긴다. 과거 배정은 ID/이력으로 이어갈 수 있고 현재 포인터를 다시 가져오지 않는다. 자정 이후 접수한 과거 배정 결과는 접수일의 수행으로 기록한다. 오늘 배정과 실제 수행일은 다르다. 동일 배정을 다음 날 이어 완료하면 최종 대표 수행일·결과가 갱신되며 이전 중단 이벤트는 감사 이력에 남는다.

처음 사용한 생성 요청 키는 날짜가 지나도 원래 배정으로 재생된다. 새 날짜 배정에는 새 요청 키를 사용한다. 같은 날 다른 키도 별도 영상 없이 같은 배정을 가리킨다. 완료·미진행 종료 이후에도 같은 날 두 번째 영상을 생성하지 않는다.

추천 준비 오류는 HTTP 409의 `DATE_OF_BIRTH_REQUIRED`, `MEASUREMENT_REQUIRED`, `AGE_UNSUPPORTED`. 신규 배정에만 준비 상태를 검사하여 이미 저장된 배정의 복원·재시도는 이후 측정 삭제/프로필 수정으로 바뀌지 않는다. 활성 카탈로그 부재/정의 누락은 503 `WORKOUT_CATALOG_UNAVAILABLE`. 입력 오류는 400 `INVALID_PLAYBACK_EVENT`, 소유권은 404다.

## 일관성과 출처

기존 UserCurriculumAssignment·WorkoutCurriculum·currentForUserId를 확장한다. 변경 요청은 Read Committed 트랜잭션에서 사용자 행을 먼저 잠가 앞선 요청이 저장한 당일 배정을 확인한 후에만 추천·RNG를 호출한다. 최신 측정 한 건은 정렬 조회의 FOR SHARE 잠금 후 항목을 읽어 수정·삭제와 일관되게 처리한다. 선택 이후 새로 등록된 측정은 다음 선택에 반영된다. 카탈로그 정의는 불변이고 수행 결과 쓰기는 같은 사용자 잠금을 따른다. 순수 조회는 Repeatable Read 스냅샷을 유지한다. `(user_id,assignment_date)` DB UNIQUE와 사용자별 요청 키 별칭 테이블이 일일 한 배정을 보장한다. 기존 완료 정의/정체성 불변 트리거는 유지·확장하고 legacy complete 경로로 새 운동의 상태 검사를 우회하지 못하게 한다.

측정은 `measuredOn DESC,createdAt DESC,id ASC` 최신 한 건만 선택하고 serializeRecord의 저장 평가를 재사용한다. 빈 요인을 과거 측정으로 채우지 않는다. snapshot에는 측정 ID/revision·평가 근거·측정 카탈로그·생년월일/현재 나이·추천 기준일·알고리즘 버전·영상 카탈로그와 계산 입력을 보존한다. 측정이 수정/삭제되더라도 이미 저장된 배정과 snapshot은 변경하지 않는다.

엔진에는 interrupted/completed 대표 행만 전달한다. 오늘 배정 계산은 D를 사용하고 과거 1~14일만 노출도 계산에 사용하지만 동점 판정용 오래된 이력은 유지한다. 서버 시각 이후 수행은 조회와 입력에서 모두 제외한다. WeightAdjustment는 조회 시점의 오늘 노출도 전후 변화로 확정 대표 결과에서 재계산하며 실제 체력 개선 점수가 아니다. 내부 정밀도는 유지하고 응답만 3자리로 반올림한다. 완료 응답은 내일 배정을 만들거나 현재 영상을 교체하지 않는다.

## 마이그레이션과 데이터 수입

`20260927000100_daily_workouts`는 nullable DATE 생년월일, 카탈로그/활성 포인터/영상/요청키/이벤트 테이블과 기존 배정의 nullable 일자·진행 필드를 추가한다. 기존 사용자 생년월일은 null, 과거 측정 나이와 평가·커리큘럼은 그대로다. 새 상태 enum 추가는 명시적 트랜잭션 밖, 나머지 DDL은 하나의 트랜잭션으로 적용한다. 기존 마이그레이션·원본 검증 증거는 수정하지 않는다.

배포는 별도 승인 후 대상 DB 확인·백업·마이그레이션·코드 교체 절차를 따른다. 이 작업에서는 격리된 테스트 DB만 사용한다. 카탈로그는 GET/앱 시작 때 자동 수입하지 않는다.

```bash
# backend/에서, 검토한 대상 DATABASE_URL로만 실행
npm run db:migrate:deploy
npm run build
node scripts/recommendation-import-catalog.mjs
# 영상 검증 파일은 Git에 없으므로 아래 미디어 문서의 검사/별도 배포 절차 필요
```

재생 URL은 별도 생성한 [미디어 검증 자료](media-verification.md)가 필요하다. 기본 `.local/recommendation/media-verification.json` 또는 `WORKOUT_MEDIA_REPORT_PATH` 경로로 제공하고, 누락 시 API는 `playbackStatus: unavailable`을 반환한다.

수입은 CSV/JSON ID 대응·가중치/합계/길이/출처 전체 검증 후 advisory lock 아래 원자적으로 정의와 영상 731개를 저장하고 활성 포인터를 전환한다. 재수입은 같은 버전·hash를 재사용한다. 같은 버전의 다른 내용은 거부하고 실패하면 기존 활성 버전을 보존한다. 영상·카탈로그·커리큘럼 정의는 불변이며 새 버전 추가로만 바꾼다. 과거 배정이 참조하는 버전은 삭제/덮어쓰지 않는다.

## 검증 명령

```bash
npm test -- src/recommendations/playback.spec.ts
npm run test:e2e -- test/workouts.e2e-spec.ts
npm run check
```

E2E runner는 `TEST_DATABASE_URL`만 사용하고 DATABASE_URL과 동일 DB면 거부한다. 임시 test_* 스키마에 모든 마이그레이션을 두 번 적용한다. 실제 DB에서 소유권·동시 배정·요청키·구간 합집합·50%·중단→완료·미래/역순 입력·자정/지연 결과·기존 미완료·731개 원자 수입/버전 보존을 검증한다.
