"""국민체력100 기반 개인 맞춤 운동 추천 알고리즘.

03_recommendation.ipynb에서 검증한 최종 서비스 로직만 분리한 모듈입니다.
시뮬레이션/디버깅/출력 코드는 포함하지 않습니다.

기본 배치 예시:
data-analysis/
├── src/
│   └── recommendation.py
└── data/
    └── processed/
        └── workout_videos.csv

입력:
- profile: {"age": int, "sex": "male" | "female"}
- fitness100: {"fitness": {...}} 또는 None
- logs: [{"date": "YYYY-MM-DD", "videoId": str, "completed": bool}, ...]
- current_date: "YYYY-MM-DD" 등 pandas가 해석 가능한 날짜 (KST 기준, 참고 [2])

출력:
{
    "nextWorkout": {"videoId": str},
    "weightAdjustment": {
        "<fitnessFactor>": {
            "previous": float,
            "delta": float,
            "next": float
        }
    }
}

백엔드 연동 참고:
[1] 최고점 동점 영상 중 무작위로 고르므로 같은 입력이라도 호출마다 결과가
    다를 수 있다. 추천은 하루 한 번 계산해 저장하고, 그날은 저장값을 사용한다.
[2] current_date는 한국 시간(KST) 기준 날짜로 전달한다. log.date에 시간이나
    시간대가 포함되어 있으면 KST 날짜로 변환한 뒤 날짜만 사용한다.
[3] fitness 등급은 숫자로 전달한다. 문자열 등 숫자가 아닌 값은 미측정으로 처리된다.
[4] workout_videos.csv는 모듈 import 시 한 번 로드된다. 기본 위치가 아니면
    WORKOUT_VIDEOS_PATH 환경변수로 경로를 지정한다.
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

REQUIRED_VIDEO_COLUMNS = {
    "file_nm",
    "age_group",
    *FITNESS_COLUMNS,
}


# ---------------------------------------------------------------------
# 2. 운동 영상 데이터 로드
# ---------------------------------------------------------------------

def _resolve_workout_videos_path() -> Path:
    """workout_videos.csv 위치를 찾는다.

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
        module_dir / "data" / "processed" / "workout_videos.csv",
        module_dir.parent / "data" / "processed" / "workout_videos.csv",
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
            "workout_videos.csv를 찾을 수 없습니다. "
            f"확인한 경로: {csv_path}. "
            "필요하면 WORKOUT_VIDEOS_PATH 환경변수로 경로를 지정하세요."
        )

    videos = pd.read_csv(csv_path)

    missing_columns = REQUIRED_VIDEO_COLUMNS - set(videos.columns)
    if missing_columns:
        raise ValueError(
            "workout_videos.csv에 필요한 컬럼이 없습니다: "
            + ", ".join(sorted(missing_columns))
        )

    if videos.empty:
        raise ValueError("workout_videos.csv에 추천 가능한 영상이 없습니다.")

    if videos["file_nm"].isna().any():
        raise ValueError("workout_videos.csv의 file_nm에 결측값이 있습니다.")

    if videos["file_nm"].duplicated().any():
        raise ValueError(
            "workout_videos.csv의 file_nm은 영상별로 고유해야 합니다."
        )

    if videos["age_group"].isna().any():
        raise ValueError("workout_videos.csv의 age_group에 결측값이 있습니다.")

    for factor in FITNESS_COLUMNS:
        videos[factor] = pd.to_numeric(videos[factor], errors="coerce")

        if videos[factor].isna().any():
            raise ValueError(
                f"workout_videos.csv의 {factor}에 숫자가 아닌 값 또는 결측값이 있습니다."
            )

        if ((videos[factor] < 0) | (videos[factor] > 1)).any():
            raise ValueError(
                f"workout_videos.csv의 {factor} 값은 0~1 범위여야 합니다."
            )

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


# ---------------------------------------------------------------------
# 4. 국민체력100 등급 → 운동 필요도
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
        # 당일 로그는 WeightAdjustment에서 별도로 처리한다.
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
) -> dict[str, float]:
    """체력 상태와 최근 운동 노출도를 결합해 최종 priority를 계산한다."""
    fitness_data = fitness_data or {}
    priority: dict[str, float] = {}

    for factor in FITNESS_COLUMNS:
        exposure = float(recent_exposure.get(factor, 0.0))
        exposure = min(max(exposure, 0.0), 1.0)

        need = get_fitness_need(fitness_data.get(factor))

        if need is None:
            # 미측정 요인을 평균/최저등급으로 대체하지 않는다.
            priority[factor] = MISSING_PRIORITY * (1 - exposure)
        else:
            priority[factor] = need + (1 - exposure)

    return priority


# ---------------------------------------------------------------------
# 7. 추천 후보 필터링
# ---------------------------------------------------------------------

def filter_by_age(
    videos: pd.DataFrame,
    age: Any,
) -> pd.DataFrame:
    """사용자 나이에 맞는 연령 그룹 영상만 추천 후보로 남긴다."""
    age = _validate_age(age)

    if age < 13:
        target_groups = ["유소년"]
    elif age < 19:
        target_groups = ["공통", "청소년"]
    elif age < 65:
        target_groups = ["공통", "성인"]
    else:
        target_groups = ["어르신"]

    return videos[
        videos["age_group"].isin(target_groups)
    ].copy()


def exclude_recent_videos(
    candidates: pd.DataFrame,
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
) -> pd.DataFrame:
    """추천일 이전 최근 7일에 수행한 동일 영상을 후보에서 제외한다."""
    logs = _validate_logs(logs)
    current_date = _to_timestamp(current_date, "current_date")

    recent_file_names: set[str] = set()

    for log in logs:
        workout_date = _to_timestamp(log["date"], "log.date")
        days_ago = (current_date - workout_date).days

        if 1 <= days_ago <= RECENT_VIDEO_DAYS:
            recent_file_names.add(log["videoId"])

    return candidates[
        ~candidates["file_nm"].isin(recent_file_names)
    ].copy()


# ---------------------------------------------------------------------
# 8. 영상 추천 점수 및 최종 선택
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
# 9. 다음 운동 추천
# ---------------------------------------------------------------------

def recommend_next_workout(
    age: Any,
    fitness_data: Mapping[str, Any] | None,
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
) -> dict[str, str]:
    """사용자 체력정보와 운동기록을 기반으로 다음 운동 영상 1개를 추천한다."""
    logs = _validate_logs(logs)

    recent_exposure = calculate_recent_exposure(
        logs,
        current_date,
    )

    priority = calculate_priority(
        fitness_data,
        recent_exposure,
    )

    age_candidates = filter_by_age(
        workout_videos,
        age,
    )

    if age_candidates.empty:
        raise ValueError(
            "사용자 연령에 해당하는 추천 후보 운동 영상이 없습니다."
        )

    candidates = exclude_recent_videos(
        age_candidates,
        logs,
        current_date,
    )

    # 연령 후보가 전부 최근 7일 영상이면 중복 제외 규칙만 해제한다.
    if candidates.empty:
        candidates = age_candidates.copy()

    scored_candidates = calculate_video_scores(
        candidates,
        priority,
    )

    selected_video = select_best_video(
        scored_candidates,
        logs,
    )

    return {
        "videoId": str(selected_video["file_nm"])
    }


# ---------------------------------------------------------------------
# 10. 오늘 운동 반영 전후 WeightAdjustment
# ---------------------------------------------------------------------

def calculate_weight_adjustment(
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
) -> dict[str, dict[str, float]]:
    """오늘 운동 반영 전후의 체력요인별 내부 노출도 변화를 반환한다."""
    logs = _validate_logs(logs)
    current_date = _to_timestamp(current_date, "current_date")

    # 오늘 운동 반영 전: 추천일 이전 1~14일의 recentExposure
    previous = calculate_recent_exposure(
        logs,
        current_date,
    )

    next_weights = previous.copy()

    # 오늘 수행한 운동만 별도로 반영한다.
    for log in logs:
        workout_date = _to_timestamp(log["date"], "log.date")
        days_ago = (current_date - workout_date).days

        if days_ago != 0:
            continue

        matched_video = workout_videos[
            workout_videos["file_nm"] == log["videoId"]
        ]

        if matched_video.empty:
            continue

        video = matched_video.iloc[0]
        completion_weight = 1.0 if log["completed"] else 0.5

        for factor in FITNESS_COLUMNS:
            next_weights[factor] += (
                EXPOSURE_ALPHA
                * float(video[factor])
                * completion_weight
            )

    for factor in FITNESS_COLUMNS:
        next_weights[factor] = min(
            next_weights[factor],
            1.0,
        )

    adjustment: dict[str, dict[str, float]] = {}

    for factor in FITNESS_COLUMNS:
        adjustment[factor] = {
            "previous": round(previous[factor], 3),
            "delta": round(
                next_weights[factor] - previous[factor],
                3,
            ),
            "next": round(next_weights[factor], 3),
        }

    return adjustment


# ---------------------------------------------------------------------
# 11. 백엔드 연동용 최종 진입 함수
# ---------------------------------------------------------------------

def run_recommendation(
    profile: Mapping[str, Any],
    fitness100: Mapping[str, Any] | None,
    logs: Sequence[Mapping[str, Any]] | None,
    current_date: Any,
) -> dict[str, Any]:
    """다음 운동 추천과 오늘 운동에 따른 WeightAdjustment를 함께 반환한다.

    현재 날짜의 운동은 WeightAdjustment에 즉시 반영하고,
    NextWorkout은 다음 날 기준으로 계산하여 오늘 수행한 영상이
    recentExposure 및 최근 7일 제외 규칙에 반영되도록 한다.
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

    next_workout = recommend_next_workout(
        age,
        fitness_data,
        logs,
        next_date,
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
    "extract_fitness_data",
    "get_next_recommendation_date",
    "get_fitness_need",
    "calculate_recent_exposure",
    "calculate_priority",
    "filter_by_age",
    "exclude_recent_videos",
    "calculate_video_scores",
    "select_best_video",
    "recommend_next_workout",
    "calculate_weight_adjustment",
    "run_recommendation",
]
