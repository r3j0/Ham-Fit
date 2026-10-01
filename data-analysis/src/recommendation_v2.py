"""국민체력100 기반 개인 맞춤 운동 루틴 추천 알고리즘.

03_recommendation.ipynb에서 검증한 최종 서비스 로직만 분리한 모듈입니다.
시뮬레이션/디버깅/출력 코드는 포함하지 않습니다.

기본 배치 예시:
data-analysis/
├── src/
│   └── recommendation.py
└── data/
    └── processed/
        └── workout_videos_v2_complete.csv

입력:
- profile: {"age": int, "sex": "male" | "female"}
- fitness100: {"fitness": {...}} 또는 None
- logs: [{"date": "YYYY-MM-DD", "videoId": str, "completed": bool}, ...]
  (오늘 완료한 운동 로그까지 포함해서 전달)
- current_date: "YYYY-MM-DD" 등 pandas가 해석 가능한 날짜 (KST 기준, 참고 [2])
- goal: "grade" | "body" | "general"
  (국민체력100 등급 개선 / 체형 관리 / 기본 체력 증진)
- routine_level: "light" | "normal" | "full"  (가볍게 3개 / 기본 5개 / 충분히 7개)
- owned_tools: 보유 도구 목록 (예: ["밴드", "덤벨"]) 또는 None
  (매트·의자·수건·물병 등 생활용품은 입력하지 않아도 항상 사용 가능)

출력:
{
    "nextWorkout": {
        "routine": [
            {
                "order": int,              # 화면 표시 순서 (1부터)
                "videoId": str,
                "title": str,
                "videoUrl": str,
                "slot": "flexibility_group" | "agility_power_group"
                        | "strength_group" | "cooldown",
                "prescription": {
                    "doseType": "reps" | "hold" | "timed",
                    "value": str,          # 예: "10~15"
                    "unit": str,           # 예: "회", "초 유지", "초"
                    "sets": int,
                    "restSec": int,
                    "text": str            # 예: "10~15회 × 3세트"
                }
            }
        ],
        "estimatedMinutes": int,           # 운동 1개당 2분 기준 (유산소 시간 제외)
        "cardioRecommendation": {
            "activity": "걷기" | "뛰기",    # 운동량 기준: light·normal → 걷기 / full → 뛰기
            "minutes": int                 # 운동 목적 기준: body 30 / general 20 / grade 15
        }
    },
    "weightAdjustment": {
        "<fitnessFactor>": {
            "previous": float,
            "delta": float,
            "next": float
        }
    }
}

백엔드 연동 참고:
[1] 동점 그룹·동점 영상 중 무작위로 고르므로 같은 입력이라도 호출마다 결과가
    다를 수 있다. 추천은 하루 한 번 계산해 저장하고, 그날은 저장값을 사용한다.
[2] current_date는 한국 시간(KST) 기준 "오늘" 날짜로 전달한다. 반환되는
    nextWorkout은 다음날(current_date + 1일)을 기준으로 계산된 루틴이다.
    log.date에 시간이나 시간대가 포함되어 있으면 KST 날짜로 변환한 뒤 날짜만 사용한다.
[3] fitness 등급은 숫자로 전달한다. 문자열 등 숫자가 아닌 값은 미측정으로 처리된다.
[4] workout_videos_v2_complete.csv는 모듈 import 시 한 번 로드된다. 기본 위치가
    아니면 WORKOUT_VIDEOS_PATH 환경변수로 경로를 지정한다.
[5] MVP 대상 연령은 13~64세이다. 범위 밖이면 ValueError가 발생한다.
[6] weightAdjustment의 delta는 음수일 수 있다. (오늘 운동하지 않은 체력요인은
    시간 감쇠로 노출도가 줄어듦)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------
# 1. 기본 설정
# ---------------------------------------------------------------------

FITNESS_COLUMNS = [
    "strength",
    "muscularEndurance",
    "cardiovascularEndurance",
    "flexibility",
    "agility",
    "power",
]

EXPOSURE_ALPHA = 0.30
LOOKBACK_DAYS = 14
HALF_LIFE = 7
MISSING_PRIORITY = 1.50
RECENT_VIDEO_DAYS = 7

# 오늘의 운동량 → 루틴 운동 개수
ROUTINE_SIZE = {
    "light": 3,
    "normal": 5,
    "full": 7,
}

GOALS = {"grade", "body", "general"}

BODY_GOAL_WEIGHT = {
    "strength": 1.10,
    "muscularEndurance": 1.10,
    "cardiovascularEndurance": 1.20,
    "flexibility": 1.00,
    "agility": 1.00,
    "power": 1.00,
}

# 루틴 구성용 체력요인 그룹
# - 근지구력 단독 영상이 없어 근력과 묶고, 민첩성·순발력도 함께 묶음
# - 심폐지구력은 홈트 영상이 2개뿐이라 루틴 슬롯에 포함하지 않음
ROUTINE_GROUPS = {
    "strength_group": ["strength", "muscularEndurance"],
    "agility_power_group": ["agility", "power"],
    "flexibility_group": ["flexibility"],
}

# 루틴 안 반복 감점: 한 그룹을 배정하면 그 운동을 한 번 수행한 것으로 보고
# 노출도 증가분(α × 영상 비중 1.0)만큼 그룹 우선순위를 낮춘다.
# group_cap(주운동 슬롯의 절반 상한)은 한 그룹 과점을 막고, 이 감점은 그룹 간 혼합을 만든다.
IN_ROUTINE_DECAY = EXPOSURE_ALPHA

# 슬롯 그룹에 해당하는 영상으로 인정하는 최소 비중
MIN_GROUP_WEIGHT = 0.5

# 화면 표시 순서: 동적 유연성 → 근력 → 민첩·순발 → 정리 스트레칭
SLOT_ORDER = [
    "flexibility_group",
    "strength_group",
    "agility_power_group",
    "cooldown",
]

# 정리운동으로 우선 사용할 정적 스트레칭 동작
COOLDOWN_KEYWORDS = ["스트레칭", "자세", "숙이기", "늘리기"]

# 항상 사용할 수 있는 생활용품
BASIC_TOOLS = {
    "매트", "물병", "물통", "의자", "테이블", "소파", "수건", "베개",
    "벽", "막대", "봉", "줄", "물병(밴드)", "수건(낮은 쿠션)", "봉(의자)",
}

# 영상 도구명을 사용자 선택지 이름으로 통일
TOOL_ALIASES = {
    "아령": "덤벨",
    "스탭퍼": "스텝박스",
    "스텝퍼": "스텝박스",
    "박스": "스텝박스",
    "큰공": "공",
    "메디신볼": "공",
    "테니스공": "공",
    "줄사다리": "사다리",
}

# 처방 유형별 기본 운동량 (MVP 정책값, 방향 근거: Garber et al. 2011)
PRESCRIPTION_RULES = {
    "reps": {"value": "10~15", "unit": "회", "sets": 3},
    "hold": {"value": "20~30", "unit": "초 유지", "sets": 3},
    "timed": {"value": "30", "unit": "초", "sets": 3},
}
REST_SEC = 20
MINUTES_PER_EXERCISE = 2

# (추가) 루틴 외 추가 유산소 권장량
# 운동 목적별 유산소 시간(분): 체형관리 30 / 체력 늘리기 20 / 체력 등급 올리기 15
CARDIO_MINUTES = {
    "body": 30,
    "general": 20,
    "grade": 15,
}

# 오늘의 운동량별 유산소 종류: 가볍게·기본 → 걷기 / 충분히 → 뛰기
CARDIO_ACTIVITY = {
    "light": "걷기",
    "normal": "걷기",
    "full": "뛰기",
}

REQUIRED_VIDEO_COLUMNS = {
    "file_nm",
    "title",
    "file_url",
    "age_group",
    "equipment",
    "dose_type",
    *FITNESS_COLUMNS,
}


class RoutineCompositionError(ValueError):
    """조건을 만족하는 영상이 부족해 요청한 개수의 루틴을 구성하지 못한 경우."""


# ---------------------------------------------------------------------
# 2. 운동 영상 데이터 로드
# ---------------------------------------------------------------------

def _resolve_workout_videos_path() -> Path:
    """workout_videos_v2_complete.csv 위치를 찾는다.

    우선순위:
    1) 환경변수 WORKOUT_VIDEOS_PATH
    2) recommendation.py와 같은 폴더 기준 data/processed
    3) src/recommendation.py 구조를 고려한 상위 폴더 기준 data/processed
    """
    env_path = os.getenv("WORKOUT_VIDEOS_PATH")
    if env_path:
        return Path(env_path).expanduser().resolve()

    module_dir = Path(__file__).resolve().parent

    candidates = [
        module_dir / "data" / "processed" / "workout_videos_v2_complete.csv",
        module_dir.parent / "data" / "processed" / "workout_videos_v2_complete.csv",
    ]

    for path in candidates:
        if path.exists():
            return path

    return candidates[-1]


def _load_workout_videos(path: Path | None = None) -> pd.DataFrame:
    """전처리된 추천 후보 운동 영상 데이터를 불러오고 스키마를 검증한다."""
    csv_path = path or _resolve_workout_videos_path()

    if not csv_path.exists():
        raise FileNotFoundError(
            "workout_videos_v2_complete.csv를 찾을 수 없습니다. "
            f"확인한 경로: {csv_path}. "
            "필요하면 WORKOUT_VIDEOS_PATH 환경변수로 경로를 지정하세요."
        )

    videos = pd.read_csv(csv_path)

    missing_columns = REQUIRED_VIDEO_COLUMNS - set(videos.columns)
    if missing_columns:
        raise ValueError(
            "workout_videos_v2_complete.csv에 필요한 컬럼이 없습니다: "
            + ", ".join(sorted(missing_columns))
        )

    if videos.empty:
        raise ValueError("workout_videos_v2_complete.csv에 추천 가능한 영상이 없습니다.")

    for column in ["file_nm", "title", "file_url", "age_group", "dose_type"]:
        if videos[column].isna().any():
            raise ValueError(
                f"workout_videos_v2_complete.csv의 {column}에 결측값이 있습니다."
            )

    if videos["file_nm"].duplicated().any():
        raise ValueError(
            "workout_videos_v2_complete.csv의 file_nm은 영상별로 고유해야 합니다."
        )

    invalid_dose = set(videos["dose_type"].unique()) - set(PRESCRIPTION_RULES)
    if invalid_dose:
        raise ValueError(f"허용되지 않은 dose_type이 있습니다: {invalid_dose}")

    for factor in FITNESS_COLUMNS:
        videos[factor] = pd.to_numeric(videos[factor], errors="coerce")

        if videos[factor].isna().any():
            raise ValueError(
                f"workout_videos_v2_complete.csv의 {factor}에 숫자가 아닌 값 또는 결측값이 있습니다."
            )

        if ((videos[factor] < 0) | (videos[factor] > 1)).any():
            raise ValueError(
                f"workout_videos_v2_complete.csv의 {factor} 값은 0~1 범위여야 합니다."
            )

    # 도구 정보가 없으면 맨몸 운동
    videos["equipment"] = videos["equipment"].fillna("")

    return videos


workout_videos = _load_workout_videos()


# ---------------------------------------------------------------------
# 3. 입력 처리
# ---------------------------------------------------------------------

def extract_fitness_data(
    fitness100: Mapping[str, Any] | None,
) -> Mapping[str, Any]:
    """국민체력100 중첩 데이터에서 체력요인 측정값을 추출한다."""
    if fitness100 is None:
        return {}

    if not isinstance(fitness100, Mapping):
        raise TypeError("fitness100은 dict 형태이거나 None이어야 합니다.")

    fitness = fitness100.get("fitness")

    if fitness is None:
        return {}

    if not isinstance(fitness, Mapping):
        raise TypeError("fitness100['fitness']는 dict 형태여야 합니다.")

    return fitness


def get_next_recommendation_date(current_date: Any) -> pd.Timestamp:
    """오늘 운동 수행 후 다음 운동 추천에 사용할 기준 날짜를 계산한다."""
    return _to_timestamp(current_date, "current_date") + pd.Timedelta(days=1)


def _to_timestamp(value: Any, field_name: str) -> pd.Timestamp:
    """날짜 입력을 Timestamp로 변환하고 유효하지 않은 날짜를 차단한다."""
    try:
        timestamp = pd.to_datetime(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} 날짜 형식이 올바르지 않습니다.") from exc

    if pd.isna(timestamp):
        raise ValueError(f"{field_name} 날짜 형식이 올바르지 않습니다.")

    # 시간대가 붙어 있으면 한국 시간으로 바꾼 뒤 시간대 정보를 제거한다.
    if timestamp.tzinfo is not None:
        timestamp = timestamp.tz_convert("Asia/Seoul").tz_localize(None)

    # 시간은 버리고 날짜만 사용한다. (경과일 계산 기준 통일)
    return timestamp.normalize()


def _validate_age(age: Any) -> int | float:
    """추천에 사용할 나이를 검증한다."""
    if age is None or isinstance(age, bool) or not isinstance(
        age, (int, float, np.integer, np.floating)
    ):
        raise ValueError("사용자 나이는 숫자로 입력해야 합니다.")

    if not np.isfinite(age) or age < 0:
        raise ValueError("사용자 나이는 0 이상의 유효한 숫자여야 합니다.")

    return age


def _validate_logs(logs: Sequence[Mapping[str, Any]] | None) -> list[Mapping[str, Any]]:
    """WorkoutLog의 서비스 필수 필드를 검증한다."""
    if logs is None:
        return []

    if isinstance(logs, (str, bytes)) or not isinstance(logs, Sequence):
        raise TypeError("logs는 WorkoutLog 목록이어야 합니다.")

    validated = []

    for index, log in enumerate(logs):
        if not isinstance(log, Mapping):
            raise TypeError(f"logs[{index}]는 dict 형태여야 합니다.")

        missing = {"date", "videoId", "completed"} - set(log)
        if missing:
            raise ValueError(
                f"logs[{index}]에 필수 필드가 없습니다: "
                + ", ".join(sorted(missing))
            )

        _to_timestamp(log["date"], f"logs[{index}].date")

        if not isinstance(log["videoId"], str) or not log["videoId"].strip():
            raise ValueError(f"logs[{index}].videoId는 비어 있지 않은 문자열이어야 합니다.")

        if not isinstance(log["completed"], (bool, np.bool_)):
            raise ValueError(f"logs[{index}].completed는 bool이어야 합니다.")

        validated.append(log)

    return validated


def _validate_goal(goal: Any) -> str:
    if goal not in GOALS:
        raise ValueError("goal은 grade, body, general 중 하나여야 합니다.")
    return goal


def _validate_routine_level(routine_level: Any) -> str:
    if routine_level not in ROUTINE_SIZE:
        raise ValueError("routine_level은 light, normal, full 중 하나여야 합니다.")
    return routine_level


def _validate_owned_tools(owned_tools: Any) -> list[str]:
    if owned_tools is None:
        return []

    if isinstance(owned_tools, (str, bytes)) or not isinstance(owned_tools, Sequence):
        raise TypeError("owned_tools는 도구 이름 목록이어야 합니다.")

    return [str(tool) for tool in owned_tools]


# ---------------------------------------------------------------------
# 4. 국민체력100 등급 → 운동 필요도 / 운동 목적 가중치
# ---------------------------------------------------------------------

def get_fitness_need(level: Any) -> float | None:
    """체력등급을 추천 우선순위 계산용 운동 필요도로 변환한다.

    1등급 -> 0.25
    2등급 -> 0.50
    3등급 이상 -> 1.00
    미측정/유효하지 않은 값 -> None
    """
    if level is None or isinstance(level, (bool, np.bool_)):
        return None

    if not isinstance(level, (int, float, np.integer, np.floating)):
        return None

    if not np.isfinite(level):
        return None

    if level == 1:
        return 0.25

    if level == 2:
        return 0.50

    if level >= 3:
        return 1.00

    return None


def calculate_goal_weight(
    goal: str,
    fitness_data: Mapping[str, Any] | None,
) -> dict[str, float]:
    """운동 목적에 따른 체력요인별 목적 가중치를 계산한다.

    grade   -> 모든 요인 1.0
    body    -> 심폐 1.2, 근력·근지구력 1.1, 나머지 1.0
    general -> 1.5 / (need + 1), 미측정 요인은 1.0
    """
    goal = _validate_goal(goal)
    fitness_data = fitness_data or {}
    goal_weight: dict[str, float] = {}

    for factor in FITNESS_COLUMNS:
        need = get_fitness_need(fitness_data.get(factor))

        if goal == "grade":
            goal_weight[factor] = 1.0
        elif goal == "body":
            goal_weight[factor] = BODY_GOAL_WEIGHT[factor]
        else:
            goal_weight[factor] = 1.0 if need is None else 1.5 / (need + 1)

    return goal_weight


# ---------------------------------------------------------------------
# 5. 최근 운동 노출도
# ---------------------------------------------------------------------

def calculate_recent_exposure(
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
) -> dict[str, float]:
    """최근 14일 운동 로그로 체력요인별 recentExposure를 계산한다.

    exerciseExposure_f
      = Σ(videoWeight_f × 0.5^(daysAgo/7) × completionWeight)

    recentExposure_f
      = min(EXPOSURE_ALPHA × exerciseExposure_f, 1)
    """
    logs = _validate_logs(logs)
    current_date = _to_timestamp(current_date, "current_date")

    exposure = {factor: 0.0 for factor in FITNESS_COLUMNS}

    for log in logs:
        workout_date = _to_timestamp(log["date"], "log.date")
        days_ago = (current_date - workout_date).days

        # 추천일 이전 1~14일 로그만 반영한다.
        if not (1 <= days_ago <= LOOKBACK_DAYS):
            continue

        time_weight = 0.5 ** (days_ago / HALF_LIFE)
        completion_weight = 1.0 if log["completed"] else 0.5

        matched_video = workout_videos[
            workout_videos["file_nm"] == log["videoId"]
        ]

        # 과거 로그의 영상이 현재 추천 데이터에 없으면 계산에서 제외한다.
        if matched_video.empty:
            continue

        video = matched_video.iloc[0]

        for factor in FITNESS_COLUMNS:
            exposure[factor] += (
                float(video[factor])
                * time_weight
                * completion_weight
            )

    for factor in FITNESS_COLUMNS:
        exposure[factor] = min(
            EXPOSURE_ALPHA * exposure[factor],
            1.0,
        )

    return exposure


# ---------------------------------------------------------------------
# 6. 체력요인별 추천 우선순위
# ---------------------------------------------------------------------

def calculate_priority(
    fitness_data: Mapping[str, Any] | None,
    recent_exposure: Mapping[str, float],
    goal: str,
) -> dict[str, float]:
    """체력 상태·최근 운동 노출도·운동 목적을 결합해 최종 priority를 계산한다."""
    fitness_data = fitness_data or {}
    goal_weight = calculate_goal_weight(goal, fitness_data)
    priority: dict[str, float] = {}

    for factor in FITNESS_COLUMNS:
        exposure = float(recent_exposure.get(factor, 0.0))
        exposure = min(max(exposure, 0.0), 1.0)

        need = get_fitness_need(fitness_data.get(factor))

        if need is None:
            # 미측정 요인을 평균/최저등급으로 대체하지 않는다.
            base_priority = MISSING_PRIORITY * (1 - exposure)
        else:
            base_priority = need + (1 - exposure)

        priority[factor] = base_priority * goal_weight[factor]

    return priority


# ---------------------------------------------------------------------
# 7. 추천 후보 필터링
# ---------------------------------------------------------------------

def filter_by_age(
    videos: pd.DataFrame,
    age: Any,
) -> pd.DataFrame:
    """사용자 나이에 맞는 연령 그룹 영상만 추천 후보로 남긴다.

    13~18세 -> 공통 + 청소년
    19~64세 -> 공통 + 성인 + 청소년
      (성인 전용 영상이 전처리 조건을 통과하지 못해, 일반 맨몸·소도구 동작으로
       구성된 청소년 영상을 성인 후보에 보완 포함)
    """
    age = _validate_age(age)

    if 13 <= age <= 18:
        target_groups = ["공통", "청소년"]
    elif 19 <= age <= 64:
        target_groups = ["공통", "성인", "청소년"]
    else:
        raise ValueError("MVP 대상 연령(13~64세)이 아닙니다.")

    return videos[
        videos["age_group"].isin(target_groups)
    ].copy()


def normalize_tool(tool: Any) -> str:
    """도구명을 사용자 선택지 기준 이름으로 통일한다."""
    tool = str(tool).strip()
    return TOOL_ALIASES.get(tool, tool)


def filter_by_equipment(
    candidates: pd.DataFrame,
    owned_tools: Sequence[str] | None,
) -> pd.DataFrame:
    """사용자가 가진 도구(+항상 사용 가능한 생활용품)로 수행 가능한 영상만 남긴다."""
    owned_tools = _validate_owned_tools(owned_tools)

    available_tools = set(BASIC_TOOLS) | {
        normalize_tool(tool) for tool in owned_tools
    }

    def is_available(equipment: Any) -> bool:
        # 도구 정보가 없으면 맨몸 운동
        if pd.isna(equipment) or str(equipment).strip() == "":
            return True

        required_tools = {
            normalize_tool(tool)
            for tool in str(equipment).split("|")
            if tool.strip()
        }
        return required_tools <= available_tools

    return candidates[
        candidates["equipment"].apply(is_available)
    ].copy()


def exclude_recent_videos(
    candidates: pd.DataFrame,
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
) -> pd.DataFrame:
    """추천일 당일을 포함한 최근 7일에 수행한 동일 영상을 후보에서 제외한다."""
    logs = _validate_logs(logs)
    current_date = _to_timestamp(current_date, "current_date")

    recent_file_names: set[str] = set()

    for log in logs:
        workout_date = _to_timestamp(log["date"], "log.date")
        days_ago = (current_date - workout_date).days

        if 0 <= days_ago <= RECENT_VIDEO_DAYS:
            recent_file_names.add(log["videoId"])

    return candidates[
        ~candidates["file_nm"].isin(recent_file_names)
    ].copy()


# ---------------------------------------------------------------------
# 8. 영상 추천 점수 및 영상 선택
# ---------------------------------------------------------------------

def calculate_video_scores(
    candidates: pd.DataFrame,
    priority: Mapping[str, float],
) -> pd.DataFrame:
    """영상의 체력요인 비중 × 사용자 priority로 추천 점수를 계산한다."""
    scored_candidates = candidates.copy()
    scored_candidates["recommendation_score"] = 0.0

    for factor in FITNESS_COLUMNS:
        scored_candidates["recommendation_score"] += (
            scored_candidates[factor] * float(priority[factor])
        )

    return scored_candidates


def select_best_video(
    scored_candidates: pd.DataFrame,
    logs: Sequence[Mapping[str, Any]] | None,
) -> pd.Series:
    """최고점 영상 중 수행 이력을 고려해 최종 영상 1개를 선택한다.

    선택 순서:
    1. 추천점수 최고 영상
    2. 한 번도 수행하지 않은 영상 우선
    3. 모두 수행했다면 가장 오래전에 수행한 영상 우선
    4. 위 조건까지 동일하면 무작위 1개
    """
    if scored_candidates.empty:
        raise ValueError("추천 가능한 운동 영상이 없습니다.")

    logs = _validate_logs(logs)

    max_score = scored_candidates["recommendation_score"].max()

    best_candidates = scored_candidates[
        np.isclose(
            scored_candidates["recommendation_score"],
            max_score,
        )
    ].copy()

    last_workout_dates: dict[str, pd.Timestamp] = {}

    for log in logs:
        file_nm = log["videoId"]
        workout_date = _to_timestamp(log["date"], "log.date")

        if (
            file_nm not in last_workout_dates
            or workout_date > last_workout_dates[file_nm]
        ):
            last_workout_dates[file_nm] = workout_date

    best_candidates["last_workout_date"] = (
        best_candidates["file_nm"].map(last_workout_dates)
    )

    never_used = best_candidates[
        best_candidates["last_workout_date"].isna()
    ]

    if not never_used.empty:
        return never_used.sample(n=1).iloc[0]

    oldest_date = best_candidates["last_workout_date"].min()
    oldest_candidates = best_candidates[
        best_candidates["last_workout_date"] == oldest_date
    ]

    return oldest_candidates.sample(n=1).iloc[0]


# ---------------------------------------------------------------------
# 9. 루틴 구성
# ---------------------------------------------------------------------
def _recent_titles(
    videos: pd.DataFrame,
    logs: Sequence[Mapping[str, Any]],
    current_date: Any,
) -> set[str]:
    """최근 수행 영상의 제목 집합.

    기간 조건은 exclude_recent_videos()와 동일하게 0 <= days_ago <= RECENT_VIDEO_DAYS.
    run_recommendation()이 추천일(내일)을 넘기므로 실제로는 오늘 포함 7일치 기록이다.
    동일 제목의 다른 파일도 함께 제외하기 위해 file_nm → title로 변환한다.
    """
    current_date = _to_timestamp(current_date, "current_date")
    recent_ids: set[str] = set()

    for log in logs:
        days_ago = (current_date - _to_timestamp(log["date"], "log.date")).days
        if 0 <= days_ago <= RECENT_VIDEO_DAYS:
            recent_ids.add(log["videoId"])

    return set(videos.loc[videos["file_nm"].isin(recent_ids), "title"])


def _last_dates_by_title(
    videos: pd.DataFrame,
    logs: Sequence[Mapping[str, Any]],
) -> dict[str, pd.Timestamp]:
    """제목별 가장 최근 수행일 (같은 제목의 여러 파일을 하나로 묶음)."""
    last_by_file: dict[str, pd.Timestamp] = {}
    for log in logs:
        date = _to_timestamp(log["date"], "log.date")
        file_nm = log["videoId"]
        if file_nm not in last_by_file or date > last_by_file[file_nm]:
            last_by_file[file_nm] = date

    last: dict[str, pd.Timestamp] = {}
    for file_nm, title in zip(videos["file_nm"], videos["title"]):
        date = last_by_file.get(file_nm)
        if date is not None and (title not in last or date > last[title]):
            last[title] = date
    return last


def _group_pool(
    scored: pd.DataFrame,
    group: str,
    excluded_titles: set[str],
) -> pd.DataFrame:
    """슬롯 그룹에 해당하는 후보 (제외 제목 제거)."""
    factors = ROUTINE_GROUPS[group]
    pool = scored[
        (scored[factors].sum(axis=1) >= MIN_GROUP_WEIGHT)
        & ~scored["title"].isin(excluded_titles)
    ]
    # 유연성 주운동 슬롯은 정적 스트레칭과 분리 (정적 스트레칭은 정리운동에서 사용)
    if group == "flexibility_group" and (pool["dose_type"] != "hold").any():
        pool = pool[pool["dose_type"] != "hold"]
    return pool


def _cooldown_pool(scored: pd.DataFrame, excluded_titles: set[str]) -> pd.DataFrame:
    """정리 스트레칭 후보: 유연성 유지형 영상 중 스트레칭·요가 자세 동작 우선."""
    pool = scored[
        (scored["flexibility"] == 1)
        & (scored["dose_type"] == "hold")
        & ~scored["title"].isin(excluded_titles)
    ]
    stretch_pool = pool[pool["title"].str.contains("|".join(COOLDOWN_KEYWORDS))]
    return stretch_pool if not stretch_pool.empty else pool


def _select_oldest(
    pool: pd.DataFrame,
    last_by_title: Mapping[str, pd.Timestamp],
    logs: Sequence[Mapping[str, Any]],
) -> pd.Series:
    """최근 영상 재사용: 가장 오래전에 수행한 영상 → 추천점수 최고 → 무작위.

    수행 이력이 있는 title만 대상으로 하며(NaT 제외),
    이력이 있는 후보가 하나도 없으면 기존 select_best_video()로 선택한다.
    """
    p = pool.copy()
    p["_last"] = p["title"].map(last_by_title)
    p = p[p["_last"].notna()]

    if p.empty:
        return select_best_video(pool, logs)

    p = p[p["_last"] == p["_last"].min()]
    p = p[np.isclose(p["recommendation_score"], p["recommendation_score"].max())]
    return p.sample(n=1).iloc[0]


def compose_workout_routine(
    candidates: pd.DataFrame,
    priority: Mapping[str, float],
    logs: Sequence[Mapping[str, Any]] | None,
    routine_size: int,
    current_date: Any,
) -> list[tuple[str, pd.Series]]:
    """슬롯별 영상 선택과 정리 스트레칭으로 루틴을 구성한다.

    - light(3개): 주운동 3개, 정리 스트레칭 없음
    - normal(5개)/full(7개): 주운동 N-1개 + 마지막 정리 스트레칭 1개
    - 같은 제목의 영상은 한 루틴에 중복되지 않음

    후보 부족 처리 (슬롯마다 다시 판단):
    1) 최근 7일에 수행하지 않은 제목이 남은 그룹 중 우선순위 최고 그룹에 배정
       → 후보가 바닥난 그룹은 자동으로 빠지고 다른 그룹으로 재배정됨
    2) 모든 그룹에 새 제목이 없을 때만, 그 슬롯 1개에 한해
       최근 수행 영상 중 가장 오래전에 수행한 영상을 재사용
       (이미 선택된 영상은 유지, 다음 슬롯은 다시 1)부터 판단)
    3) 정리 스트레칭도 같은 규칙을 따로 적용하며, 주운동의 최근 영상 제한에는 영향 없음
    - 그룹 상한(주운동 슬롯 절반 올림)과 IN_ROUTINE_DECAY는 기존과 동일
    """
    logs = _validate_logs(logs)

    if routine_size == 3:
        main_slot_count = 3
        include_cooldown = False
    else:
        main_slot_count = routine_size - 1
        include_cooldown = True

    scored = calculate_video_scores(candidates, priority)
    recent = _recent_titles(scored, logs, current_date)
    last_by_title = _last_dates_by_title(scored, logs)

    used_titles: set[str] = set()
    selected: list[tuple[str, pd.Series]] = []

    # 정리 스트레칭 1개 예약 (주운동이 먼저 가져가지 않도록)
    cooldown = None
    if include_cooldown:
        pool = _cooldown_pool(scored, recent)
        if not pool.empty:
            cooldown = select_best_video(pool, logs)
        else:
            # 최근 7일에 안 한 정리 스트레칭이 없을 때만, 이 1개만 가장 오래된 영상으로 재사용
            pool = _cooldown_pool(scored, set())
            if not pool.empty:
                cooldown = _select_oldest(pool, last_by_title, logs)
        if cooldown is not None:
            used_titles.add(cooldown["title"])

    # 주운동 슬롯
    group_priority = {
        group: max(float(priority[factor]) for factor in factors)
        for group, factors in ROUTINE_GROUPS.items()
    }
    group_cap = int(np.ceil(main_slot_count / 2))
    assigned_count = {group: 0 for group in ROUTINE_GROUPS}

    for _ in range(main_slot_count):
        open_groups = [g for g in ROUTINE_GROUPS if assigned_count[g] < group_cap]

        # 1) 최근 7일에 안 한 새 제목이 남은 그룹
        pools = {g: _group_pool(scored, g, used_titles | recent) for g in open_groups}
        pools = {g: p for g, p in pools.items() if not p.empty}
        reuse = False

        # 2) 새 제목이 어디에도 없을 때만 이 슬롯에 한해 최근 영상 재사용
        if not pools:
            pools = {g: _group_pool(scored, g, used_titles) for g in open_groups}
            pools = {g: p for g, p in pools.items() if not p.empty}
            reuse = True

        if not pools:
            break

        adjusted = {
            g: group_priority[g] - IN_ROUTINE_DECAY * assigned_count[g]
            for g in pools
        }
        top_score = max(adjusted.values())
        top_groups = [g for g, s in adjusted.items() if np.isclose(s, top_score)]
        selected_group = str(np.random.choice(top_groups))

        if reuse:
            video = _select_oldest(pools[selected_group], last_by_title, logs)
        else:
            video = select_best_video(pools[selected_group], logs)

        assigned_count[selected_group] += 1
        used_titles.add(video["title"])
        selected.append((selected_group, video))

    if cooldown is not None:
        selected.append(("cooldown", cooldown))

    if len(selected) != routine_size:
        raise RoutineCompositionError("조건을 만족하는 운동 영상이 부족합니다.")

    # 화면 표시 순서로 정렬
    selected.sort(key=lambda item: SLOT_ORDER.index(item[0]))

    return selected

def make_prescription(video: Mapping[str, Any] | pd.Series) -> dict[str, Any]:
    """처방 유형(dose_type)별 운동량 문구를 생성한다."""
    rule = PRESCRIPTION_RULES[str(video["dose_type"])]

    return {
        "doseType": str(video["dose_type"]),
        "value": rule["value"],
        "unit": rule["unit"],
        "sets": rule["sets"],
        "restSec": REST_SEC,
        "text": f"{rule['value']}{rule['unit']} × {rule['sets']}세트",
    }


# ---------------------------------------------------------------------
# 10. 운동 루틴 추천
# ---------------------------------------------------------------------

def recommend_workout_routine(
    age: Any,
    fitness_data: Mapping[str, Any] | None,
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
    goal: str,
    routine_level: str,
    owned_tools: Sequence[str] | None = None,
) -> dict[str, Any]:
    """체력정보·운동기록·목적·운동량·보유 도구를 기반으로 current_date의 루틴을 추천한다."""
    logs = _validate_logs(logs)
    goal = _validate_goal(goal)
    routine_level = _validate_routine_level(routine_level)
    routine_size = ROUTINE_SIZE[routine_level]

    # 1. 최근 운동 노출도 → 체력요인별 우선순위 (목적 가중치 포함)
    recent_exposure = calculate_recent_exposure(logs, current_date)
    priority = calculate_priority(fitness_data, recent_exposure, goal)

    # 2. 연령 → 보유 도구 → 최근 7일 수행 영상 순으로 후보 필터링
    base_candidates = filter_by_equipment(
        filter_by_age(workout_videos, age),
        owned_tools,
    )

    if base_candidates.empty:
        raise ValueError("사용자 연령·보유 도구에 해당하는 추천 후보 운동 영상이 없습니다.")

    # 3. 루틴 구성 (최근 7일 제외·그룹 재배정·오래된 영상 재사용은 compose 내부에서 처리)
    selected = compose_workout_routine(
        base_candidates,
        priority,
        logs,
        routine_size,
        current_date,
    )

    routine = [
        {
            "order": order,
            "videoId": str(video["file_nm"]),
            "title": str(video["title"]),
            "videoUrl": str(video["file_url"]),
            "slot": slot,
            "prescription": make_prescription(video),
        }
        for order, (slot, video) in enumerate(selected, start=1)
    ]

    # 유산소: 종류는 운동량, 시간은 운동 목적으로 결정
    cardio = {
        "activity": CARDIO_ACTIVITY[routine_level],
        "minutes": CARDIO_MINUTES[goal],
    }

    return {
        "routine": routine,
        "estimatedMinutes": len(routine) * MINUTES_PER_EXERCISE,
        "cardioRecommendation": cardio,
    }


# ---------------------------------------------------------------------
# 11. 오늘 운동 반영 전후 WeightAdjustment
# ---------------------------------------------------------------------

def calculate_weight_adjustment(
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
) -> dict[str, dict[str, float]]:
    """오늘 운동 전과 다음날 추천 시점의 체력요인별 노출도 변화를 반환한다.

    previous: 오늘 추천 시점의 노출도 (오늘 운동 반영 전, 1~14일 전 기록)
    next:     다음날 추천에 실제로 쓰이는 노출도 (오늘 운동이 daysAgo=1로 반영됨)
    delta:    next - previous (오늘 운동하지 않은 요인은 시간 감쇠로 음수 가능)
    """
    logs = _validate_logs(logs)

    previous = calculate_recent_exposure(
        logs,
        current_date,
    )

    next_exposure = calculate_recent_exposure(
        logs,
        get_next_recommendation_date(current_date),
    )

    adjustment: dict[str, dict[str, float]] = {}

    for factor in FITNESS_COLUMNS:
        adjustment[factor] = {
            "previous": round(previous[factor], 3),
            "delta": round(
                next_exposure[factor] - previous[factor],
                3,
            ),
            "next": round(next_exposure[factor], 3),
        }

    return adjustment


# ---------------------------------------------------------------------
# 12. 백엔드 연동용 최종 진입 함수
# ---------------------------------------------------------------------

def run_recommendation(
    profile: Mapping[str, Any],
    fitness100: Mapping[str, Any] | None,
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
    goal: str,
    routine_level: str,
    owned_tools: Sequence[str] | None = None,
) -> dict[str, Any]:
    """다음 운동 루틴과 오늘 운동에 따른 WeightAdjustment를 함께 반환한다.

    logs에는 오늘 완료한 운동 로그까지 포함한다.
    오늘 운동은 WeightAdjustment에 반영하고, nextWorkout은 다음날 기준으로
    계산하여 오늘 수행한 영상이 recentExposure 및 최근 7일 제외 규칙에
    반영되도록 한다.
    """
    if not isinstance(profile, Mapping):
        raise TypeError("profile은 dict 형태여야 합니다.")

    if "age" not in profile:
        raise ValueError("profile에 age가 필요합니다.")

    logs = _validate_logs(logs)
    age = _validate_age(profile["age"])

    fitness_data = extract_fitness_data(fitness100)

    weight_adjustment = calculate_weight_adjustment(
        logs,
        current_date,
    )

    next_date = get_next_recommendation_date(
        current_date,
    )

    next_workout = recommend_workout_routine(
        age,
        fitness_data,
        logs,
        next_date,
        goal,
        routine_level,
        owned_tools,
    )

    return {
        "nextWorkout": next_workout,
        "weightAdjustment": weight_adjustment,
    }


__all__ = [
    "FITNESS_COLUMNS",
    "EXPOSURE_ALPHA",
    "LOOKBACK_DAYS",
    "HALF_LIFE",
    "MISSING_PRIORITY",
    "RECENT_VIDEO_DAYS",
    "ROUTINE_SIZE",
    "GOALS",
    "BODY_GOAL_WEIGHT",
    "CARDIO_MINUTES",
    "CARDIO_ACTIVITY",
    "ROUTINE_GROUPS",
    "IN_ROUTINE_DECAY",
    "BASIC_TOOLS",
    "PRESCRIPTION_RULES",
    "RoutineCompositionError",
    "extract_fitness_data",
    "get_next_recommendation_date",
    "get_fitness_need",
    "calculate_goal_weight",
    "calculate_recent_exposure",
    "calculate_priority",
    "filter_by_age",
    "filter_by_equipment",
    "exclude_recent_videos",
    "calculate_video_scores",
    "select_best_video",
    "compose_workout_routine",
    "make_prescription",
    "recommend_workout_routine",
    "calculate_weight_adjustment",
    "run_recommendation",
]
