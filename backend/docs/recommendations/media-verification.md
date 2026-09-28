# 영상 재생 메타데이터 계약

2026-09-28 알고리즘 연결 제거 후에도 영상 API와 재생 진행 저장 설계는 유지한다. 데이터 브랜치에서 복사한 카탈로그와 해당 데이터 전용 MP4 검사 스크립트는 제거했다. 이번 변경은 외부 영상을 새로 검사하지 않았다.

`WORKOUT_MEDIA_REPORT_PATH` 또는 기본 `.local/recommendation/media-verification.json`에서 별도로 제공된 검증 자료를 읽는다. 보고서가 없거나 유효하지 않으면 `playbackUrl: null`, `playbackStatus: unavailable`이다. 임의 HTTPS 성공이나 대체 영상을 반환하지 않는다.

자료 형식은 `schemaVersion: 2`, `sourceCommit`, `durationToleranceSeconds: 1`, `videos`다. 각 영상은 ID·원본 주소·카탈로그 길이·검증 상태와 HTTPS/Range/MP4 구조·실측 길이·Content-Type 근거를 가진다. 보고서의 `sourceCommit`은 해당 배정이 참조하는 **DB 카탈로그의 출처 커밋**과 일치해야 한다. 특정 데이터 브랜치 커밋을 코드에 고정하지 않는다.

기존 국민체력100 원본 주소와 동일 영상의 검증된 HTTPS 주소만 허용한다. 길이 차이 1초 이하인 검증 자료만 재생 가능하며, 이 수치는 추천 점수가 아닌 기존 재생 입력 검증 계약이다. 재생 위치의 초과 끝점 처리와 50% 판정은 [운동 API](workouts-api.md)를 따른다.

기존 자료를 교체하면 서버를 재시작한다. 보고서 파일을 제공하는 방법은 데이터 코드 재연결 단계에서 정하며, 삭제한 검사 스크립트를 실행하라는 안내는 더 이상 적용하지 않는다. BE 검사는 합성 미디어 자료로 형식·출처 일치·실패 처리를 검증한다.
