"""국민체력100 기반 개인 맞춤 운동 루틴 추천 알고리즘.

03_recommendation.ipynb에서 개발 중인 서비스 로직 중 현재 확정된 연동 구조를
백엔드 개발 참고용으로 분리한 초안 모듈입니다.

현재 확정 사항:
- 운동 목적: grade / body / general
- 오늘 운동량: light=3개, normal=5개, full=7개
- 체력요인 6개 기반 개인화
- 최근 14일 운동 노출도 반영
- 최근 7일 동일 영상 제외
- dose_type(reps/hold/timed) 기반 운동량 처방
- file_url + file_nm으로 실제 영상 URL 생성

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
- current_date: "YYYY-MM-DD" 등 pandas가 해석 가능한 날짜
- goal: "grade" | "body" | "general"
- routine_level: "light" | "normal" | "full"

출력 예시:
{
    "workouts": [
        {
            "videoId": str,
            "title": str,
            "videoUrl": str,
            "prescription": {
                "doseType": "reps" | "hold" | "timed",
                "value": str,
                "unit": str,
                "sets": int,
                "restSec": int,
                "text": str
            }
        }
    ]
}

백엔드 연동 참고:
[1] 본 파일은 연동용 초안이다. 루틴 내부의 세부 그룹 배치 로직은 변경될 수 있다.
[2] current_date는 한국 시간(KST) 기준 날짜로 전달한다.
[3] fitness 등급은 숫자로 전달한다. 숫자가 아니면 미측정으로 처리한다.
[4] CSV는 모듈 import 시 한 번 로드한다. 기본 위치가 아니면
    WORKOUT_VIDEOS_PATH 환경변수로 경로를 지정한다.
[5] side_mode는 현재 확정 데이터에 없으므로 사용하지 않는다.
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

ROUTINE_SIZE = {
    "light": 3,
    "normal": 5,
    "full": 7,
}

BODY_GOAL_WEIGHT = {
    "strength": 1.10,
    "muscularEndurance": 1.10,
    "cardiovascularEndurance": 1.20,
    "flexibility": 1.00,
    "agility": 1.00,
    "power": 1.00,
}

PRESCRIPTION_RULES = {
    "reps": {"value": "10~15", "unit": "회", "sets": 2},
    "hold": {"value": "20~30", "unit": "초 유지", "sets": 2},
    "timed": {"value": "30", "unit": "초", "sets": 2},
}

REST_SEC = 30

REQUIRED_VIDEO_COLUMNS = {
    "file_nm",
    "title",
    "file_url",
    "age_group",
    "equipment",
    "dose_type",
    *FITNESS_COLUMNS,
}


# ---------------------------------------------------------------------
# 2. 운동 영상 데이터 로드
# ---------------------------------------------------------------------

def _resolve_workout_videos_path() -> Path:
    """workout_videos_v2_complete.csv 위치를 찾는다."""
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
    """전처리된 추천 후보 데이터를 불러오고 확정 스키마를 검증한다."""
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
            "추천 데이터에 필요한 컬럼이 없습니다: "
            + ", ".join(sorted(missing_columns))
        )

    if len(videos) != 272:
        raise ValueError(f"추천 데이터는 272행이어야 합니다. 현재: {len(videos)}")

    if videos["file_nm"].nunique() != 272:
        raise ValueError("file_nm은 272개 모두 고유해야 합니다.")

    if videos["dose_type"].isna().any():
        raise ValueError("dose_type에 결측값이 있습니다.")

    invalid_dose = set(videos["dose_type"].unique()) - {"reps", "hold", "timed"}
    if invalid_dose:
        raise ValueError(f"허용되지 않은 dose_type이 있습니다: {invalid_dose}")

    videos["equipment"] = videos["equipment"].fillna("")

    for factor in FITNESS_COLUMNS:
        videos[factor] = pd.to_numeric(videos[factor], errors="coerce")
        if videos[factor].isna().any():
            raise ValueError(f"{factor}에 숫자가 아닌 값 또는 결측값이 있습니다.")

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


def _to_timestamp(value: Any, field_name: str) -> pd.Timestamp:
    """날짜 입력을 Timestamp로 변환한다."""
    try:
        timestamp = pd.to_datetime(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} 날짜 형식이 올바르지 않습니다.") from exc

    if pd.isna(timestamp):
        raise ValueError(f"{field_name} 날짜 형식이 올바르지 않습니다.")

    if timestamp.tzinfo is not None:
        timestamp = timestamp.tz_convert("Asia/Seoul").tz_localize(None)

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


def _validate_logs(
    logs: Sequence[Mapping[str, Any]] | None,
) -> list[Mapping[str, Any]]:
    """운동 로그의 필수 필드를 검증한다."""
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
        validated.append(log)

    return validated


# ---------------------------------------------------------------------
# 4. 국민체력100 등급 → 운동 필요도 / 운동 목적
# ---------------------------------------------------------------------

def get_fitness_need(level: Any) -> float | None:
    """체력등급을 추천 우선순위 계산용 필요도로 변환한다."""
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
    fitness_data: Mapping[str, Any] | None,
    goal: str,
) -> dict[str, float]:
    """운동 목적에 따른 체력요인별 목적 가중치를 계산한다."""
    if goal not in {"grade", "body", "general"}:
        raise ValueError("goal은 grade, body, general 중 하나여야 합니다.")

    fitness_data = fitness_data or {}
    weights: dict[str, float] = {}

    for factor in FITNESS_COLUMNS:
        need = get_fitness_need(fitness_data.get(factor))

        if goal == "grade":
            weights[factor] = 1.0
        elif goal == "body":
            weights[factor] = BODY_GOAL_WEIGHT[factor]
        else:
            weights[factor] = 1.0 if need is None else 1.5 / (need + 1.0)

    return weights


# ---------------------------------------------------------------------
# 5. 최근 운동 노출도
# ---------------------------------------------------------------------

def calculate_recent_exposure(
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
) -> dict[str, float]:
    """최근 14일 운동 로그로 체력요인별 recentExposure를 계산한다."""
    logs = _validate_logs(logs)
    current_date = _to_timestamp(current_date, "current_date")

    exposure = {factor: 0.0 for factor in FITNESS_COLUMNS}

    for log in logs:
        workout_date = _to_timestamp(log["date"], "log.date")
        days_ago = (current_date - workout_date).days

        if not (1 <= days_ago <= LOOKBACK_DAYS):
            continue

        matched = workout_videos[workout_videos["file_nm"] == log["videoId"]]
        if matched.empty:
            continue

        video = matched.iloc[0]
        time_weight = 0.5 ** (days_ago / HALF_LIFE)
        completion_weight = 1.0 if log["completed"] else 0.5

        for factor in FITNESS_COLUMNS:
            exposure[factor] += (
                float(video[factor]) * time_weight * completion_weight
            )

    for factor in FITNESS_COLUMNS:
        exposure[factor] = min(EXPOSURE_ALPHA * exposure[factor], 1.0)

    return exposure


# ---------------------------------------------------------------------
# 6. 체력요인별 추천 우선순위
# ---------------------------------------------------------------------

def calculate_priority(
    fitness_data: Mapping[str, Any] | None,
    recent_exposure: Mapping[str, float],
    goal: str,
) -> dict[str, float]:
    """체력 상태, 최근 노출도, 운동 목적을 결합해 priority를 계산한다."""
    fitness_data = fitness_data or {}
    goal_weight = calculate_goal_weight(fitness_data, goal)
    priority: dict[str, float] = {}

    for factor in FITNESS_COLUMNS:
        exposure = min(max(float(recent_exposure.get(factor, 0.0)), 0.0), 1.0)
        need = get_fitness_need(fitness_data.get(factor))

        if need is None:
            base_priority = MISSING_PRIORITY * (1 - exposure)
        else:
            base_priority = need + (1 - exposure)

        priority[factor] = base_priority * goal_weight[factor]

    return priority


# ---------------------------------------------------------------------
# 7. 추천 후보 필터링
# ---------------------------------------------------------------------

def filter_by_age(videos: pd.DataFrame, age: Any) -> pd.DataFrame:
    """사용자 나이에 맞는 연령 그룹 영상만 남긴다."""
    age = _validate_age(age)

    if age < 13:
        target_groups = ["유소년"]
    elif age < 19:
        target_groups = ["공통", "청소년"]
    elif age < 65:
        target_groups = ["공통", "성인"]
    else:
        target_groups = ["어르신"]

    return videos[videos["age_group"].isin(target_groups)].copy()


def exclude_recent_videos(
    candidates: pd.DataFrame,
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
) -> pd.DataFrame:
    """최근 7일 수행한 동일 영상을 후보에서 제외한다."""
    logs = _validate_logs(logs)
    current_date = _to_timestamp(current_date, "current_date")

    recent_ids = set()

    for log in logs:
        workout_date = _to_timestamp(log["date"], "log.date")
        days_ago = (current_date - workout_date).days

        if 1 <= days_ago <= RECENT_VIDEO_DAYS:
            recent_ids.add(log["videoId"])

    return candidates[~candidates["file_nm"].isin(recent_ids)].copy()


# ---------------------------------------------------------------------
# 8. 영상 점수 / 운동량 처방
# ---------------------------------------------------------------------

def calculate_video_scores(
    candidates: pd.DataFrame,
    priority: Mapping[str, float],
) -> pd.DataFrame:
    """영상 체력요인 비중 × 사용자 priority로 추천 점수를 계산한다."""
    scored = candidates.copy()
    scored["recommendation_score"] = 0.0

    for factor in FITNESS_COLUMNS:
        scored["recommendation_score"] += (
            scored[factor] * float(priority[factor])
        )

    return scored


def make_prescription(video: Mapping[str, Any] | pd.Series) -> dict[str, Any]:
    """확정된 dose_type에 따라 기본 운동량 처방을 생성한다."""
    dose_type = str(video["dose_type"])
    rule = PRESCRIPTION_RULES[dose_type]

    return {
        "doseType": dose_type,
        "value": rule["value"],
        "unit": rule["unit"],
        "sets": rule["sets"],
        "restSec": REST_SEC,
        "text": f"{rule['value']}{rule['unit']} × {rule['sets']}세트",
    }


def _video_to_response(video: pd.Series) -> dict[str, Any]:
    """추천 영상 한 개를 백엔드 응답 형태로 변환한다."""
    return {
        "videoId": str(video["file_nm"]),
        "title": str(video["title"]),
        "videoUrl": str(video["file_url"]) + str(video["file_nm"]),
        "prescription": make_prescription(video),
    }


# ---------------------------------------------------------------------
# 9. 루틴 선택
# ---------------------------------------------------------------------

def select_workout_routine(
    scored_candidates: pd.DataFrame,
    routine_size: int,
) -> list[pd.Series]:
    """현재 점수 기준으로 서로 다른 운동을 routine_size만큼 선택한다.

    주의:
    이 함수는 백엔드 연동용 초안이다.
    그룹별 슬롯 배치 및 cooldown 세부 규칙은 노트북 최종 구현에 따라
    변경될 수 있다.
    """
    if scored_candidates.empty:
        raise ValueError("추천 가능한 운동 영상이 없습니다.")

    selected: list[pd.Series] = []
    remaining = scored_candidates.copy()

    while len(selected) < routine_size and not remaining.empty:
        max_score = remaining["recommendation_score"].max()
        best = remaining[
            np.isclose(remaining["recommendation_score"], max_score)
        ].copy()

        chosen = best.sample(n=1).iloc[0]
        selected.append(chosen)

        remaining = remaining[
            (remaining["file_nm"] != chosen["file_nm"])
            & (remaining["title"] != chosen["title"])
        ].copy()

    if len(selected) < routine_size:
        raise ValueError(
            f"요청한 {routine_size}개의 서로 다른 운동을 구성할 수 없습니다."
        )

    return selected


# ---------------------------------------------------------------------
# 10. 오늘의 운동 루틴 추천
# ---------------------------------------------------------------------

def recommend_workout_routine(
    age: Any,
    fitness_data: Mapping[str, Any] | None,
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
    goal: str = "grade",
    routine_level: str = "normal",
) -> list[dict[str, Any]]:
    """사용자 정보와 오늘 운동량을 기반으로 3/5/7개 운동 루틴을 추천한다."""
    if routine_level not in ROUTINE_SIZE:
        raise ValueError("routine_level은 light, normal, full 중 하나여야 합니다.")

    logs = _validate_logs(logs)
    routine_size = ROUTINE_SIZE[routine_level]

    recent_exposure = calculate_recent_exposure(logs, current_date)
    priority = calculate_priority(fitness_data, recent_exposure, goal)

    age_candidates = filter_by_age(workout_videos, age)
    if age_candidates.empty:
        raise ValueError("사용자 연령에 해당하는 추천 후보 운동 영상이 없습니다.")

    candidates = exclude_recent_videos(age_candidates, logs, current_date)

    if len(candidates) < routine_size:
        candidates = age_candidates.copy()

    scored = calculate_video_scores(candidates, priority)
    selected = select_workout_routine(scored, routine_size)

    return [_video_to_response(video) for video in selected]


# ---------------------------------------------------------------------
# 11. 백엔드 연동용 최종 진입 함수
# ---------------------------------------------------------------------

def run_recommendation(
    profile: Mapping[str, Any],
    fitness100: Mapping[str, Any] | None,
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
    goal: str = "grade",
    routine_level: str = "normal",
) -> dict[str, Any]:
    """오늘의 운동 루틴을 백엔드 응답 형태로 반환한다."""
    if not isinstance(profile, Mapping):
        raise TypeError("profile은 dict 형태여야 합니다.")

    if "age" not in profile:
        raise ValueError("profile에 age가 필요합니다.")

    age = _validate_age(profile["age"])
    fitness_data = extract_fitness_data(fitness100)

    workouts = recommend_workout_routine(
        age=age,
        fitness_data=fitness_data,
        logs=logs,
        current_date=current_date,
        goal=goal,
        routine_level=routine_level,
    )

    return {
        "workouts": workouts,
    }


__all__ = [
    "FITNESS_COLUMNS",
    "EXPOSURE_ALPHA",
    "LOOKBACK_DAYS",
    "HALF_LIFE",
    "MISSING_PRIORITY",
    "RECENT_VIDEO_DAYS",
    "ROUTINE_SIZE",
    "BODY_GOAL_WEIGHT",
    "PRESCRIPTION_RULES",
    "extract_fitness_data",
    "get_fitness_need",
    "calculate_goal_weight",
    "calculate_recent_exposure",
    "calculate_priority",
    "filter_by_age",
    "exclude_recent_videos",
    "calculate_video_scores",
    "make_prescription",
    "select_workout_routine",
    "recommend_workout_routine",
    "run_recommendation",
]
