# 지난 루틴 시청과 수행 기록 분리

2026-09-30 확정 정책. 이번 구현은 `backend/`에 한정한다. FE 소스는 아래 호출 경로 확인에만 사용했으며 수정하지 않았다. 추천 알고리즘·CSV·DB 테이블·마이그레이션·기존 단일 영상 API는 변경하지 않는다.

## BE에서 보장하는 기록 보호

`POST /api/v2/workout-routines/:routineId/items/:itemId/events`는 사용자 행 잠금 획득 후 DB `clock_timestamp()`를 KST로 해석한다. 배정일이 서버 KST 오늘보다 이전이면 신규 `start`, `progress`, `pause`, `end`, `complete`를 모두 409 `ROUTINE_EXPIRED`로 거절한다. 미시작·진행 중·미수행·중단·완료 상태 모두 같은 규칙이다. 완료 항목의 새 중단/완료 감사 이벤트도 추가하지 않는다.

거절은 운동 항목 UPDATE와 이벤트 INSERT 전에 발생한다. 진행률·시청 구간·재생 위치·대표 수행 결과·수행일·완료일·revision·이벤트 행이 그대로 유지된다. 추천 입력은 기존 대표 수행 로그를 읽으므로 지난 루틴 시청 때문에 달라지지 않는다. 기존 완료 기록과 활동 집계도 소급 변경하지 않는다.

당일 항목별 80% 시청 판정과 모든 영상 항목 완료 조건을 유지한다. 그날 전체 완료·스트릭을 얻으려면 마지막 항목도 배정일 다음 KST 자정 **미만**의 서버 접수 시각에 완료되어야 한다. 클라이언트 `occurredAt`은 감사 정보일 뿐이다. 자정 전 발생했더라도 자정 이후 처음 접수된 이벤트는 거절한다. 잠금 대기 중 자정이 지나도 거절한다. 미래 배정일은 기존 409 `ROUTINE_NOT_DUE`다.

이미 저장된 동일 항목·요청 키·본문의 재시도는 날짜 검사 전에 처리한다. 자정 이후에도 200 / `Idempotency-Replayed: true`이며 DB 쓰기를 하지 않는다. 같은 키·다른 본문은 기존 409 `WORKOUT_CONFLICT`다. 재시도 응답에는 현재 저장 상태와 현재 서버 날짜가 담기므로 FE는 성공 응답에서도 기록 가능 여부를 다시 확인해야 한다.

`GET /api/v2/workout-routines/:id`와 `/history`는 과거 루틴과 모든 항목 상태를 계속 반환한다. `videoUrl`, `playbackUrl`, `playbackStatus`, `verifiedDurationSeconds`, 저장 진행·처방·입력 스냅샷을 날짜 때문에 숨기거나 수정하지 않는다. `/current`는 오늘 배정만 반환하며 없으면 JSON null이다. 영상 파일 접근은 기존 미디어 URL로 수행하며, 조회를 위해 start 이벤트를 보낼 필요가 없다. 서버가 자정에 영상 스트림을 끊는 처리도 없다. 기존 미디어 검증이 unavailable/null인 영상의 가용성을 새로 보장하지는 않는다.

## API에서 전달하는 서버 기준

모든 루틴 응답(today/current의 비-null 응답, 상세, history의 각 항목, 이벤트 응답)에 다음 필드를 제공한다.

| 필드                 | 의미                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `koreanDate`         | 저장된 배정일, YYYY-MM-DD                                                     |
| `serverKoreanDate`   | 판정 시각의 서버 KST 날짜                                                     |
| `serverTime`         | 판정 시각, ISO UTC                                                            |
| `recordingAllowed`   | 배정일 = 서버 KST 오늘. 날짜상 자격이며 항목별 상태·순서 검증을 대체하지 않음 |
| `recordingExpiresAt` | 배정일 다음 KST 자정, ISO UTC. 이 시각부터 새 기록 불가                       |

예를 들어 9월 29일 루틴은 `recordingExpiresAt: "2026-09-29T15:00:00.000Z"`다. 서버 KST 날짜가 9월 30일이면 기록 불가다. 이 필드들은 응답 시 계산하며 DB 컬럼·revision을 추가하거나 갱신하지 않는다.

만료 오류 예시:

```json
{
  "statusCode": 409,
  "code": "ROUTINE_EXPIRED",
  "message": "지난 루틴의 시청은 운동 기록에 반영되지 않습니다.",
  "serverTime": "2026-09-29T15:00:00.000Z",
  "serverKoreanDate": "2026-09-30",
  "recordingAllowed": false,
  "recordingExpiresAt": "2026-09-29T15:00:00.000Z"
}
```

## 확인한 현재 FE 호출 경로

현재 FE에는 v2 루틴 API 연결이 없다. 실제 화면과 전송 경로는 다음과 같다.

- `frontend/app/(private)/workouts/[id]/page.tsx` 및 `[id]/replay/page.tsx` → `components/workout-screen.tsx` → `components/workout-player.tsx`.
- `/account/workouts/...` 화면은 위 화면을 재사용한다. `workout-screen.tsx`는 현재 replay에서 미완료 영상을 차단한다.
- `frontend/lib/workouts.ts`는 `/workouts/current`, `/today`, `/history`, `/:id`, `/:id/events`를 사용한다. `frontend/lib/http.ts`의 기본 base는 `/api/v1`이므로 실제 대상은 **단일 영상 `/api/v1/workouts`**다.
- `workout-player.tsx`는 `in_progress|completed`와 세션 연결·복구·저장 오류를 재생 조건으로 사용한다. start 성공을 기다린 뒤 재생하며, timeupdate(5초), seeked, pause, ended에서 진행/중단을 기록한다. pagehide, visibility hidden, 컴포넌트 해제에서도 pause를 기록한다.
- `frontend/lib/playback-session.ts`의 `record()`가 `workout-journal.ts` 저장 큐에 먼저 추가하고 `drain()`이 POST한다. connect와 retry가 기존 큐를 재전송한다. 현재 오류 처리만으로는 만료된 큐가 자동으로 제거되지 않는다.

따라서 이번 BE 보호가 현재 `/workouts` 플레이어에 자동 적용되는 것은 아니다. v2 연결 시 단일 영상 ID를 루틴 ID처럼 사용하거나, 기존 인증/측정 API까지 일괄 v2로 전환하면 안 된다. 인증·CSRF·세션 갱신은 기존 v1을 유지하면서 루틴 요청에 별도 `/api/v2/workout-routines` base를 사용한다. 새 이벤트에는 **루틴 ID와 해당 항목 ID 모두** 필요하며 키·sequence·큐도 항목별로 관리한다. 영상 ID로 수행 대상을 선택하지 않는다.

## 후속 FE 구현 계약

1. 미디어 가용성(`playbackStatus === verified`와 `playbackUrl`)에 따른 시청 자격과 서버의 `recordingAllowed`를 분리한다. 과거 상세·이력의 모든 상태에서 일반 영상 재생·일시정지·탐색을 제공한다. start 성공·in_progress·쓰기 큐 복구를 과거 영상의 재생 조건으로 요구하지 않는다.
2. 과거 루틴에는 운동 시작·이어하기·완료/중단 처리를 제공하지 않는다. 저장된 상태와 수행 날짜를 UI 편의를 위해 바꾸지 않는다. **“지난 루틴의 시청은 운동 기록에 반영되지 않습니다”**를 표시한다. 기존 저장 재생 위치를 읽어 복원할 수 있으나 새로운 위치·시청 구간은 운동 기록에 저장하지 않는다.
3. 가장 낮은 공통 `record()` 진입점에서 기록 가능 여부를 검사하여, 자동 저장·탐색·pause/ended·pagehide·visibilitychange·화면 이탈·컴포넌트 해제의 어느 경로도 만료 항목을 큐에 추가하지 않게 한다. 전송 직전 `drain()`에서도 검사한다. 직접 fetch, sendBeacon, keepalive 등의 별도 이탈 전송 경로에도 같은 규칙을 적용한다. 당일 누적 `media.played`를 과거 항목으로 다시 저장하지 않는다.
4. 페이지를 열어둔 채 자정을 넘기면 서버의 `serverTime`과 `recordingExpiresAt` 간 남은 시간을 기준으로 기록 없는 시청으로 전환한다. 요청 시작부터 응답 도착까지의 시간을 보수적으로 차감하고, `performance.now()`로 경과 시간을 계산해 단말의 날짜/시간 설정에 의존하지 않게 한다. 타이머만 믿지 말고 모든 기록/전송 진입점에서 마감을 재검사한다. 백그라운드 복귀 시 서버 상세를 다시 읽는다. FE의 시간 추정과 무관하게 최종 저장 판정은 BE가 한다.
5. 날짜상 만료 또는 409 `ROUTINE_EXPIRED`를 확인하면 해당 루틴 항목의 큐·재시도·복구 POST를 종료한다. 이미 전송 중인 요청의 응답은 확인할 수 있지만 새로운 이벤트로 바꾸거나 새 키로 재시도하지 않는다. 미확정 결과는 GET으로 확인한다. 자정 전 저장 완료된 동일 요청의 BE 멱등 재시도는 허용되지만, 과거 시청을 위해 복구 큐 전송을 요구하지 않는다. 만료를 영상 오류나 연결 차단으로 처리하여 재생 중인 video를 pause/reset/unmount하지 않는다.
6. revision이 그대로인 GET이나 멱등 재시도 응답도 서버 시각·기록 가능 여부는 갱신한다. 현재 세션의 `saved.revision >= ...` 필터와 별개로 날짜 메타데이터를 반영해야 한다. 저장 오류·pending 상태가 일반 영상 시청을 막지 않게 한다.
7. 같은 영상이 오늘 루틴에도 있다면 오늘 상세에서 선택한 `(routineId, itemId)`로 정상 start/progress/pause/end/complete를 보낸다. 과거 화면에서 같은 videoId라는 이유만으로 오늘 항목을 자동 수행시키지 않는다.

## 검증 범위

BE 통합 테스트는 과거의 5개 항목 상태에서 모든 이벤트 유형 거절, 어제 중단 후 오늘 start→pause 불변, occurredAt 소급 우회 거절, 상세/이력·미디어 필드 보존, 자정 직전 전체 완료·스트릭, 자정/직후 최초 완료 거절, 진행 중 자정 이후 기록 불변, 동일 키·본문 재시도와 다른 본문 충돌, 전후 실제 Python 추천 입력 로그 일치, 동일 영상의 오늘 항목 저장, 미래 배정 수행 제한을 검증한다.

후속 FE에서는 미완료 과거 영상 재생·탐색, 각 이탈 경로의 POST/큐 추가 0건, 재생 중 자정/만료 오류 수신 후 영상 연속 재생, 만료 큐 재시도 중단, 날짜만 바뀌는 동일 revision 응답 처리, 오늘 항목의 정상 저장을 브라우저에서 검증해야 한다. 이번 작업에서는 프론트 구현·브라우저 검증·외부 미디어 스트리밍·운영 DB 적용을 수행하지 않았다.

### 실행 결과 (2026-09-30)

- `npm test`: 20개 파일, 302개 단위 테스트 통과.
- 아래 PostgreSQL 통합 실행: 6개 파일, 86개 테스트 통과. 실제 원본 Python·CSV를 읽기 전용으로 호출했다. 루틴 마감 보호 외에 기존 단일 영상 API·개인/그룹 활동 집계·기존 커리큘럼 호환을 확인했다.
- 전용 `project_health_test` DB의 임시 스키마에서 기존 22개 마이그레이션 적용·재적용을 확인하고 실행기가 스키마를 정리했다. 이번 변경으로 마이그레이션을 추가하거나 수정하지 않았다.
- `npm run typecheck`, `npm run lint`, `npm run build`, 변경 파일 Prettier와 `git diff --check` 통과.

```bash
RECOMMENDATION_PYTHON=.local/recommendation-venv/bin/python npm run test:e2e -- \
  test/workout-routines.e2e-spec.ts test/activity.e2e-spec.ts \
  test/daily-routine-migration.e2e-spec.ts test/workouts.e2e-spec.ts \
  test/groups.e2e-spec.ts test/curricula.e2e-spec.ts
```

최초 샌드박스 실행에서는 로컬 DB 연결 및 기존 단위 테스트의 HTTP listen이 EPERM으로 차단됐다. 허용된 환경에서 재실행하여 위 검사가 모두 통과했다. 기존 pg 동시 `client.query()` deprecation 경고는 남아 있다. 전체 E2E 회귀·FE 동작·실제 외부 영상 재생은 이번 검증 범위가 아니다. `frontend/`, `data-analysis/`, 저장소 루트의 변경은 없으며 커밋·푸시·병합·배포와 개발/운영 DB 적용은 수행하지 않았다.
