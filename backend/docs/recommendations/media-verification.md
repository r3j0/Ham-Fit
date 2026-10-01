# 영상 재생 메타데이터 계약

2026-09-29 사용자 요청으로 새 루틴이 사용하는 원본 complete CSV의 272개 영상을 실제 재검증했다. 기존 카탈로그 사본과 고정 해시를 복원하지 않고, 전달된 CSV를 읽기 전용으로 검사하는 `scripts/probe-workout-media.mjs`를 제공한다. 추천 알고리즘·원본 데이터는 변경하지 않는다.

`WORKOUT_MEDIA_REPORT_PATH` 또는 기본 `.local/recommendation/media-verification.json`에서 별도로 제공된 검증 자료를 읽는다. 보고서가 없거나 유효하지 않으면 `playbackUrl: null`, `playbackStatus: unavailable`이다. 임의 HTTPS 성공이나 대체 영상을 반환하지 않는다.

자료 형식은 `schemaVersion: 2`, `sourceCommit`, `durationToleranceSeconds: 1`, `videos`다. 각 영상은 ID·원본 주소·카탈로그 길이·검증 상태와 HTTPS/Range/MP4 구조·실측 길이·Content-Type 근거를 가진다. 기존 단일 영상 배정은 DB 카탈로그의 출처 커밋을 사용한다. **신규 루틴은 원본 CSV의 SHA-256인 dataVersion을 sourceCommit 필드와 대조**한다. 특정 데이터 브랜치 커밋을 코드에 고정하지 않는다. 이번 검사 스크립트는 신규 루틴용 CSV SHA-256 보고서를 생성한다.

기존 국민체력100 원본 주소와 동일 영상의 검증된 HTTPS 주소만 허용한다. 길이 차이 1초 이하인 검증 자료만 재생 가능하며, 이 수치는 추천 점수가 아닌 기존 재생 입력 검증 계약이다. 재생 위치의 초과 끝점 처리는 기존 코드를 재사용한다. 완료 판정은 기존 단일 영상의 [50% 계약](workouts-api.md)과 신규 루틴 v2의 [80% 계약](routines-api.md)을 구분한다.

기존 자료를 교체하면 서버를 재시작한다. 실행 중 프로세스의 같은 경로·같은 dataVersion 캐시는 파일 교체만으로 갱신되지 않는다. 보고서는 로컬 생성물이며 Git에 포함되지 않으므로 배포 환경에도 별도로 전달해야 한다.

## 재검증 방법

backend 디렉터리에서 실행한다. 원본 CSV는 읽기만 하며 전체 영상 다운로드 대신 MP4 헤더와 moov 메타데이터 구간을 가져온다.

```bash
node --test scripts/probe-workout-media.test.mjs
node scripts/probe-workout-media.mjs \
  ../data-analysis/data/processed/workout_videos_v2_complete.csv \
  .local/recommendation/media-verification-candidate.json
# 네트워크 실패 영상만 재검증할 때 동일 CSV/보고서로 실행
node scripts/probe-workout-media.mjs \
  ../data-analysis/data/processed/workout_videos_v2_complete.csv \
  .local/recommendation/media-verification-candidate.json --retry-unavailable
```

후보 보고서의 요약·dataVersion·BE resolver 결과를 확인한 뒤 기존 보고서를 보관하고 기본 경로에 원자적으로 교체하거나 WORKOUT_MEDIA_REPORT_PATH로 후보 경로를 지정한다. 실패나 길이 불일치를 임의로 verified로 변경하지 않는다. 실행 도중 CSV가 바뀌면 보고서 저장을 거부한다. 과거 CSV 버전의 배정에 새 검증 결과를 강제로 적용하지 않는다.

## 2026-09-29 실행 결과

- 확인 완료 시각: 2026-09-29T09:21:08.925Z (KST 18:21:08).
- 원본: `data-analysis/data/processed/workout_videos_v2_complete.csv`, 272개.
- dataVersion: `db329d71dfdbc04ca66fb6c63ea15667a5b50d6bdeb8d8e4df9db8cabc602380`.
- verified 272, unavailable 0, duration_mismatch 0. 총 22,730,690바이트의 메타데이터 구간 수신.
- 새 보고서: `.local/recommendation/media-verification-v2-2026-09-29.json`.
- 기본 `.local/recommendation/media-verification.json`에 새 보고서 적용. 이전 보고서는 `.local/recommendation/media-verification-before-v2-2026-09-29.json`에 보존.
- 실제 `createMediaResolver`에 새 보고서와 현재 CSV의 각 ID·원본 URL·길이를 전달하여 **272개 모두 verified 및 non-null playbackUrl**임을 확인.
- HTTP 206·Content-Range·수신 바이트 길이·TLS·MP4 ftyp/moov/mvhd/video handler·길이 차이 1초 이내 검사. `video/mg4` MIME 오기는 구조 검증 성공 시에만 허용.
- 전체 디코딩·브라우저 재생 테스트는 수행하지 않았다. 운영 서버 배포/재시작은 수행하지 않았다.
