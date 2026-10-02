# 📊 햄피트 데이터 분석

국민체력100 운동 데이터를 수집·전처리하고 개인 체력과 운동 이력을 바탕으로 루틴을 추천하는 Python 영역입니다. 분석 과정은 Jupyter 노트북으로, 서비스에서 사용하는 알고리즘은 `src/recommendation_v2.py`로 관리합니다.

[프로젝트 소개](../README.md) · [백엔드](../backend/README.md) · [루틴 API·런타임 계약](../backend/docs/recommendations/routines-api.md)

## 지원 기능

- 운동 처방·영상·근골격계·표준운동·목적별 루틴 등 원본 API 데이터 수집
- 운동 영상의 연령군·도구·길이·6개 체력요인 비중 정리와 중복 후보 정제
- 체력요인별 필요도, 최근 14일 운동 노출도와 시간 감쇠를 반영한 추천 우선순위 계산
- 만 13–64세 연령·보유 도구·최근 수행 운동을 고려한 후보 선택
- 운동량별 3·5·7개 루틴, 반복·유지·시간형 처방과 정리운동 구성
- 운동 목적·운동량에 따른 걷기·뛰기 유산소 권장량
- 다음날 루틴과 오늘 운동 전후 체력요인 노출도 변화 분석

여섯 체력요인은 근력·근지구력·심폐지구력·유연성·민첩성·순발력입니다. 체력 등급 판정·계정·DB 저장·영상 시청 완료 판정은 백엔드가 담당합니다.

## 디렉토리 구조

```text
data-analysis/
├── 01_data_collection.ipynb          # 원본 API 수집
├── 02_data_preprocessing.ipynb       # 초기 전처리
├── 02_data_preprocessing_v2.ipynb    # v2 후보 정제·CSV/JSON 생성
├── 03_recommendation.ipynb           # 추천 실험·시뮬레이션·최종 로직
├── data/
│   ├── raw/                         # 수집한 API CSV
│   └── processed/                   # 전처리 CSV·JSON
└── src/
    ├── recommendation.py            # 이전 추천 모듈
    ├── recommendation_draft.py      # 초안 모듈
    └── recommendation_v2.py         # 현재 백엔드가 호출하는 원본
```

현재 서비스 입력 카탈로그는 `data/processed/workout_videos_v2_complete.csv`입니다. 이전 `workout_videos.csv`나 중간 산출물 `workout_videos_v2.csv`와 구분하세요. 현재 complete 카탈로그는 272개 영상과 `dose_type`을 포함합니다. v2 전처리 노트북은 중간 `workout_videos_v2.csv/json`을 생성하므로 이를 그대로 complete 파일로 교체하지 않습니다.

## 실행 환경 준비

Python 3.9 이상이 필요합니다. 추천 모듈의 의존성은 NumPy·pandas이며, 서비스와 같은 버전은 [백엔드 추천 requirements](../backend/requirements-recommendation.txt)에 고정되어 있습니다. 별도 데이터 분석용 requirements나 패키지 설치 CLI는 현재 없습니다.

가상환경은 백엔드의 기존 위치를 사용합니다. 아래 명령은 저장소 루트에서 시작하며 `data-analysis/`에 가상환경이나 캐시를 만들지 않습니다.

```bash
python3 -m venv backend/.local/recommendation-venv
backend/.local/recommendation-venv/bin/python -m pip install -r backend/requirements-recommendation.txt
source backend/.local/recommendation-venv/bin/activate
cd data-analysis
```

이미 백엔드에서 가상환경을 만들었다면 활성화부터 진행하면 됩니다. 다음 추천 예시는 네트워크 호출 없이 저장소의 CSV를 읽습니다.

## 추천 모듈 실행

`recommendation_v2.py`는 import해서 사용하는 모듈입니다. 파일을 직접 실행하는 CLI는 제공하지 않습니다. `data-analysis/`에서 다음 예시를 실행하세요. 입력은 실행 방법을 보여 주는 예시이며 운영 사용자 데이터와 구분합니다.

```bash
python -B - <<'PY'
import json
from datetime import datetime
from zoneinfo import ZoneInfo
from src.recommendation_v2 import extract_fitness_data, recommend_workout_routine

today = datetime.now(ZoneInfo("Asia/Seoul")).date().isoformat()
fitness = extract_fitness_data({
    "fitness": {
        "strength": 2,
        "muscularEndurance": 3,
        "cardiovascularEndurance": 2,
        "flexibility": 1,
        "agility": None,
        "power": None,
    }
})

result = recommend_workout_routine(
    age=30,
    fitness_data=fitness,
    logs=[],
    current_date=today,
    goal="general",
    routine_level="normal",
    owned_tools=[],
)
print(json.dumps(result, ensure_ascii=False, indent=2))
PY
```

반환값에는 `routine`, `estimatedMinutes`, `cardioRecommendation`이 포함됩니다. 각 운동에는 순서·영상 ID·제목·URL·슬롯·처방이 들어 있습니다. 예상 시간은 운동 1개당 2분 기준으로 유산소 시간을 포함하지 않으며, 실제 영상 길이나 재생 검증 값과 구분합니다.

### 입력과 함수 계약

| 입력            | 형식·허용값                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `age`           | 만 13–64세                                                                 |
| `fitness_data`  | 6축 등급 매핑. `extract_fitness_data(fitness100)`으로 변환                 |
| `logs`          | `date`, `videoId`, `completed`를 가진 운동 기록 목록                       |
| `current_date`  | KST 날짜, 예: `YYYY-MM-DD`                                                 |
| `goal`          | `grade`(등급 개선), `body`(체형 관리), `general`(기본 체력)                |
| `routine_level` | `light`(3개), `normal`(5개), `full`(7개)                                   |
| `owned_tools`   | 보유 도구 목록. 매트·의자·수건 등 기본 생활용품은 별도 입력 없이 사용 가능 |

등급은 숫자로 전달합니다. 미측정 값은 `None`으로 구분하며 문자열 등급을 임의로 숫자화하지 않습니다. 조건에 맞는 후보가 없거나 필요한 개수의 루틴을 구성할 수 없으면 예외를 반환합니다. 동점 후보는 무작위 선택하므로 같은 입력의 영상 ID가 매번 같지는 않습니다.

| 함수                                                                                            | 용도                                               |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `extract_fitness_data(fitness100)`                                                              | `fitness100["fitness"]`의 체력요인 입력 변환       |
| `recommend_workout_routine(...)`                                                                | 전달한 날짜의 루틴 생성. **현재 백엔드 진입 함수** |
| `run_recommendation(profile, fitness100, logs, current_date, goal, routine_level, owned_tools)` | **다음날** `nextWorkout`과 `weightAdjustment` 반환 |
| `calculate_weight_adjustment(logs, current_date)`                                               | 오늘 운동 전과 다음날 추천 시점의 노출도 변화 계산 |

백엔드는 KST 오늘 날짜로 `recommend_workout_routine`을 호출해 하루 한 루틴을 저장합니다. 다음날 추천용 `run_recommendation`을 당일 API에 연결하지 않습니다. `weightAdjustment`는 체력 등급 개선 예측이 아닌 계산상의 운동 노출도 변화이며 `delta`가 음수일 수 있습니다.

### 카탈로그 경로 변경

모듈은 import 시 CSV를 한 번 읽고 스키마를 검증합니다. 다른 파일을 사용할 때는 import 전에 환경변수를 지정하세요.

```bash
export WORKOUT_VIDEOS_PATH="$PWD/data/processed/workout_videos_v2_complete.csv"
```

카탈로그 변경 후에는 모듈을 다시 로드하거나 Python 프로세스·노트북 커널을 재시작해야 반영됩니다.

## 노트북 실행

활성화된 분석용 가상환경에 추가 도구를 설치합니다. Jupyter·requests는 추천 서비스 실행 자체에는 필요하지 않습니다.

```bash
python -m pip install jupyterlab requests
jupyter lab
```

노트북은 `data/...` 상대 경로를 사용하므로 작업 디렉토리를 `data-analysis/`로 유지합니다.

1. **기존 추천 실험 확인**: `03_recommendation.ipynb`에서 제공된 complete CSV를 읽어 실행합니다. 앞부분의 α 후보 시뮬레이션과 뒷부분의 최종 서비스 로직을 구분합니다.
2. **전처리 변경 확인**: 원본 `data/raw/`를 사용해 `02_data_preprocessing_v2.ipynb`의 데이터 정제·검증·저장 셀을 확인합니다. 초기 전처리는 별도 이전 노트북입니다.
3. **데이터 재수집**: `01_data_collection.ipynb`의 `SERVICE_KEY`를 본인에게 발급된 키로 설정한 후 필요한 수집 셀을 실행합니다. 키와 요청에 포함된 인증 정보를 커밋하거나 공유하지 않습니다.

수집·전처리 셀은 CSV·JSON을 덮어쓸 수 있습니다. v2 전처리의 마지막 영상 다운로드 셀은 네트워크와 로컬 저장 공간을 사용하므로 추천 모듈을 확인할 때는 실행할 필요가 없습니다.

## 검증과 백엔드 연동

이 디렉토리에는 별도 자동 테스트 명령이 없습니다. 간단한 import·카탈로그 확인은 다음과 같이 실행합니다.

```bash
python -B - <<'PY'
from src.recommendation_v2 import FITNESS_COLUMNS, workout_videos

assert not workout_videos.empty
assert workout_videos["file_nm"].is_unique
assert set(workout_videos["dose_type"]) <= {"reps", "hold", "timed"}
assert set(FITNESS_COLUMNS) <= set(workout_videos.columns)
print(f"카탈로그 로드 완료: {len(workout_videos)}개 영상")
PY
```

서비스 연결은 [백엔드 Python runner](../backend/scripts/recommendation-runner.py)와 `RoutineAlgorithm`이 담당합니다. 원본·CSV의 SHA-256을 보존하고 출력 형식·순서·중복·영상 길이 등을 검증한 후 DB에 저장합니다.

실제 연결 검증은 백엔드의 `npm run check`에 포함된 `test/workout-routines.e2e-spec.ts`에서 원본 Python·CSV·격리 PostgreSQL을 사용합니다. 준비와 실행은 [백엔드 README](../backend/README.md)를 따릅니다. 연결 검사는 운동 효과나 추천 적합성의 임상 검증을 의미하지 않습니다.

## 기여하기

1. [공통 기여 규칙](../CONTRIBUTING.md)과 [루틴 연동 계약](../backend/docs/recommendations/routines-api.md)을 읽고 변경 목적·입출력 영향을 정리합니다.
2. 원본 데이터·중간 산출물·서비스 complete 카탈로그를 구분합니다. 수집 출처·시점·전처리 규칙과 변경 이유를 기록합니다.
3. 알고리즘 변경은 현재 서비스 원본 `src/recommendation_v2.py`와 관련 노트북을 함께 검토합니다. 백엔드에 계산 규칙을 복사하지 않습니다.
4. 연령 경계·미측정·빈 이력·도구 필터·3/5/7개 구성·KST 날짜·동점 선택을 확인합니다. 무작위 선택에서는 특정 영상 ID보다 개수·중복·필터·처방 계약을 검증합니다.
5. 스키마·처방·영상 ID·시간 의미가 바뀌면 백엔드와 프론트 계약·통합 테스트를 함께 확인하고 PR에 영향과 검증 결과를 적습니다.
6. 실제 개인정보·API 키·영상 대량 다운로드·가상환경·캐시를 변경에 포함하지 않습니다. 예시 입력과 운영 데이터를 분리합니다.

추천 규칙과 외부 데이터 이용 조건은 별개입니다. 원본 API·영상의 이용 조건을 확인하고 출처를 유지하세요.
