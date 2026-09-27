# 국민체력100 영상 전송 검증

2026-09-27에 고정 커밋 `92f3493de704c644d5aeff353488f1aff49f1836`의
**731개 원본 URL 전체**를 대상으로 직접 HTTPS, 바이트 Range와 MP4 메타데이터를
검사했다. 결과는 **729개 검증 통과, 2개 소스 오류, 길이 불일치 0개**다.
이는 731개 전체를 브라우저에서 끝까지 재생했다는 뜻이 아니다.

상세 검증 보고서는 Git에 보관하지 않는다. 검사기로 `.local/recommendation/media-verification.json`에 생성한다. 통과한 각 영상은
실제로 요청한 HTTPS URL, 관찰 시각, Content-Type, Range 위치, 다운로드한 바이트
수, 전체 파일 크기, `ftyp` 브랜드, 상위 박스, 영상 트랙 수, `mvhd` timescale과
실측 길이를 기록한다. 총 3,645개 정상 Range, 91,466,629바이트의 헤더/메타데이터를
확인했다. 미디어 본문의 전체 디코딩·재생은 이 검사 범위가 아니다.

## MIME 오타와 독립적인 MP4 확인

소스 서버는 동일 파일의 요청 구간에 따라 `video/mp4` 또는 **`video/mg4`**를
반환했다. 최초 검사기는 후자를 모두 거부하여 23개만 통과하고 708개를 실패로
기록했다. 초기 상세 결과 파일은 산출물 정리로 저장소에서 제거했다.

개선된 검사기는 MIME 문자열만으로 성공을 결정하지 않는다. 관찰된 두 MIME만
허용하고 다음을 모두 확인한다.

1. HTTPS 요청을 실제로 수행하고 리다이렉트를 따라가지 않는다.
2. HTTP 206, 정확한 Content-Range 시작/끝/전체 길이와 응답 본문 길이를 확인한다.
3. 첫 `ftyp` 박스와 알려진 MP4 브랜드, 정상 박스 크기/경계를 확인한다.
4. 파일 뒤쪽으로의 Range 이동을 포함해 `moov`를 찾는다.
5. `mvhd` 버전 0/1의 유한하고 양수인 실제 길이와 `trak/mdia/hdlr=vide`를 확인한다.
6. 실제 길이와 CSV 길이 차이가 **1초 이하**인지 확인한다.

통과 파일 중 708개에서 `video/mg4`, 709개에서 `video/mp4`를 관찰했다. 한 파일에
두 값이 함께 있을 수 있다. 통과 영상의 길이 차이는 최대 0.854초였다. HTML,
잘못된 파일 서명, 범위를 무시한 200 응답, 다른 시작 위치, 잘린 본문, 바뀐 파일
크기, 영상 트랙이 없는 파일은 성공으로 처리하지 않는다.

## 확인된 소스 오류

아래 두 영상은 반복 검사에서도 HTTPS 요청에 **302 `/error.html`**을 반환했다.
응답 Content-Type은 `text/html`이며 리다이렉트는 따라가지 않았다. HTTP 원본의
재생 가능 여부와 소스 제공자의 복구 시점은 확인하지 않았다.

| 영상 ID               | CSV 길이 | 확인 결과                          |
| --------------------- | -------: | ---------------------------------- |
| `0CBNLH06S_00037.mp4` |     74초 | 302 `/error.html`, 재생 URL 비활성 |
| `0CBPCCU5Q_00063.mp4` |     96초 | 302 `/error.html`, 재생 URL 비활성 |

두 항목도 원본 731개 카탈로그에 남긴다. 추천 결과를 다른 영상으로 바꾸거나
임의의 성공/길이로 대체하지 않는다. 배정 응답은 `playbackStatus: unavailable`,
`playbackUrl: null`로 재생 불가 상태를 전달한다.

## 운영 연결과 재현

`mediaFor()`는 보고서의 고정 소스 커밋·스키마와 개별 영상 ID·원본 URL·카탈로그
길이를 대조한다. HTTPS/Range/MP4 검증 플래그 및 실측 길이까지 맞는 `verified`
항목만 실제 검증된 HTTPS URL을 반환한다. 임의 URL 입력이나 범용 프록시는 없다.
보고서가 없거나 손상됐거나 길이/URL이 바뀌면 명시적으로 재생 불가를 반환한다.
`duration_mismatch`는 별도 상태다.

백엔드를 `backend/`에서 실행하며 보고서는 첫 미디어 조회 시 로드한다. 기본 경로는
`.local/recommendation/media-verification.json`이고 `WORKOUT_MEDIA_REPORT_PATH`로 외부 파일을
지정할 수 있다. 새 체크아웃이나 배포 환경에는 보고서가 없으므로 영상 URL을 제공하려면
먼저 아래 검사기를 실행하고 생성 파일을 별도로 배포해야 한다. 보고서가 없는 상태에서
추천·배정 API는 동작하지만 재생 URL은 unavailable로 반환한다. 새 보고서를
운영에 반영할 때는 별도 배포 절차에 따라 프로세스를 재시작해야 한다. 이 작업에서는
운영 배포나 운영 DB 적용을 수행하지 않는다.

```sh
node scripts/probe-workout-media.mjs data/recommendation/source/data-analysis/data/processed/workout_videos.json data/recommendation/source/data-analysis/data/processed/workout_videos.csv .local/recommendation/media-verification.json
# 이전 결과 중 unavailable만 재검사하고 실패 이력을 함께 보존
node scripts/probe-workout-media.mjs data/recommendation/source/data-analysis/data/processed/workout_videos.json data/recommendation/source/data-analysis/data/processed/workout_videos.csv .local/recommendation/media-verification.json --retry-unavailable
node --test scripts/probe-workout-media.test.mjs
npx vitest run src/recommendations/media.spec.ts
```

입력 CSV/JSON은 고정 SHA-256과 먼저 대조한다. 보고서는 임시 파일을 완성한 뒤
원자적으로 교체한다. 검사기는 최대 8개 병렬 요청, 요청당 20초 제한,
`moov` 최대 32MiB 제한을 둔다.

단위 검증은 미디어 응답 선택·로컬/외부 파일 로딩과 MP4/Range 검사기에 유지한다.
실행 결과 파일은 커밋하지 않는다.
실제 브라우저 플레이어의 재생·탐색 확인 범위는 전체 흐름 검증 결과에 별도로 기록한다.
