"""Execute the pinned, unmodified recommender with real data and boundary fixtures.

Run with a Python environment containing numpy and pandas. Synthetic data is used
only for isolated boundary checks; production-data simulations use all 731 rows.
"""
from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
import math
import platform
import tempfile
import time
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

BASE = Path(__file__).resolve().parent
SOURCE = BASE / "snapshot/data-analysis/src/recommendation.py"
spec = importlib.util.spec_from_file_location("original_recommendation", SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
VIDEOS = m.workout_videos
FACTORS = list(m.FITNESS_COLUMNS)
DAY = pd.Timestamp("2026-09-27")
results = []


def check(name, fn, category="baseline"):
    started = time.perf_counter()
    try:
        detail = fn()
        results.append(dict(name=name, category=category, status="passed", detail=detail,
                            milliseconds=round((time.perf_counter()-started)*1000, 2)))
    except Exception as exc:
        results.append(dict(name=name, category=category, status="failed",
                            error=f"{type(exc).__name__}: {exc}",
                            milliseconds=round((time.perf_counter()-started)*1000, 2)))


def expect(condition, detail="assertion failed"):
    if not condition:
        raise AssertionError(detail)


def raises(kind, fn):
    try:
        fn()
    except kind:
        return
    raise AssertionError(f"expected {kind.__name__}; invalid input was accepted")


def close(actual, expected):
    expect(math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-12),
           f"expected {expected}, got {actual}")


PURE = VIDEOS[(VIDEOS.strength == 1)].iloc[0]
MIXED = VIDEOS[(VIDEOS[FACTORS] > 0).sum(axis=1) > 1].iloc[0]


def log(video, days_ago, completed=True):
    return dict(videoId=str(video.file_nm), date=str((DAY-pd.Timedelta(days=days_ago)).date()),
                completed=completed)


def validate_real_data():
    manifest = json.loads((BASE / "manifest.json").read_text())
    for item in manifest["files"]:
        actual = hashlib.sha256((BASE/"snapshot"/item["source"]).read_bytes()).hexdigest()
        expect(actual == item["sha256"], "snapshot was modified")
    rows = json.loads((BASE/"snapshot/data-analysis/data/processed/workout_videos.json").read_text())
    expect(VIDEOS.shape == (731, 12), str(VIDEOS.shape))
    expect(len(rows) == 731 and VIDEOS.file_nm.is_unique)
    expect(np.isfinite(VIDEOS[FACTORS].to_numpy()).all())
    expect(np.allclose(VIDEOS[FACTORS].sum(axis=1), 1, rtol=0, atol=1e-12))
    expect(((VIDEOS[FACTORS] >= 0) & (VIDEOS[FACTORS] <= 1)).all().all())
    indexed = {row["videoId"]: row for row in rows}
    expect(set(indexed) == set(VIDEOS.file_nm))
    for _, row in VIDEOS.iterrows():
        j = indexed[row.file_nm]
        expect(j["title"] == row.title and j["videoUrl"] == row.file_url)
        expect(j["ageGroup"] == row.age_group)
        expect(j["equipment"] == ast.literal_eval(row.equipment))
        for f in FACTORS:
            close(j["fitnessWeights"].get(f, 0), row[f])
    return dict(rows=731, columns=12, length_min=int(VIDEOS.video_length.min()),
                length_max=int(VIDEOS.video_length.max()),
                length_median=float(VIDEOS.video_length.median()),
                ten_minutes_or_more=int((VIDEOS.video_length >= 600).sum()),
                age_groups=VIDEOS.age_group.value_counts().to_dict(),
                json_has_duration=any("durationSeconds" in r or "video_length" in r for r in rows))


check("real dataset, hashes, CSV/JSON parity and weights", validate_real_data)

for grade, expected in [(1, .25), (2, .5), (3, 1), (4, 1), (np.int64(2), .5)]:
    check(f"grade {grade!r} -> need {expected}", lambda g=grade,e=expected: close(m.get_fitness_need(g), e))
for invalid in [None, True, "2", 0, -1, float("nan"), float("inf")]:
    check(f"unusable grade {invalid!r} stays unmeasured", lambda x=invalid: expect(m.get_fitness_need(x) is None))

check("missing Fitness100 and fitness fields", lambda: expect(all(m.extract_fitness_data(v) == {} for v in [None, {}, {"fitness": None}])))
check("malformed Fitness100 rejected", lambda: raises(TypeError, lambda: m.extract_fitness_data({"fitness": []})))


def priority_case():
    actual = m.calculate_priority({"strength": 2}, {f: .4 for f in FACTORS})
    close(actual["strength"], 1.1)
    close(actual["flexibility"], .9)


check("measured and missing factor priority", priority_case)

for age, groups in [(12, {"유소년"}), (13, {"공통", "청소년"}), (18, {"공통", "청소년"}),
                    (19, {"공통", "성인"}), (64, {"공통", "성인"}), (65, {"어르신"})]:
    check(f"age boundary {age}", lambda a=age,g=groups: expect(set(m.filter_by_age(VIDEOS,a).age_group) == g))
for age in [None, True, -1, "30", float("nan")]:
    check(f"invalid age {age!r} rejected", lambda a=age: raises(ValueError, lambda: m.filter_by_age(VIDEOS,a)))

for days in [-1, 0, 1, 7, 14, 15]:
    def exposure_case(d=days):
        actual = m.calculate_recent_exposure([log(MIXED, d)], DAY)
        for f in FACTORS:
            expected = .3 * float(MIXED[f]) * .5**(d/7) if 1 <= d <= 14 else 0
            close(actual[f], expected)
    check(f"exposure boundary daysAgo={days}", exposure_case)


def half_completion():
    full = m.calculate_recent_exposure([log(MIXED, 1)], DAY)
    half = m.calculate_recent_exposure([log(MIXED, 1, False)], DAY)
    for f in FACTORS:
        close(half[f], full[f]/2)


check("incomplete exposure is half complete", half_completion)
check("unknown historical video ignored per source contract", lambda: expect(all(v == 0 for v in m.calculate_recent_exposure([dict(videoId="missing.mp4",date="2026-09-26",completed=True)], DAY).values())))
check("empty history exposure zero", lambda: expect(all(v == 0 for v in m.calculate_recent_exposure([], DAY).values())))
check("invalid date rejected", lambda: raises(ValueError, lambda: m.calculate_recent_exposure([dict(videoId=PURE.file_nm,date="not-a-date",completed=True)], DAY)))
check("non-boolean completion rejected", lambda: raises(ValueError, lambda: m.calculate_recent_exposure([dict(videoId=PURE.file_nm,date="2026-09-26",completed="false")], DAY)))
check("timezone normalized to KST date", lambda: expect(m._to_timestamp("2026-09-26T15:30:00Z","test") == DAY))

for days in [0, 1, 7, 8]:
    check(f"duplicate exclusion boundary {days}", lambda d=days: expect((PURE.file_nm in set(m.exclude_recent_videos(VIDEOS,[log(PURE,d)],DAY).file_nm)) == (d not in range(1,8))))


def fallback():
    candidates = m.filter_by_age(VIDEOS,30)
    logs = [log(row,1) for _,row in candidates.iterrows()]
    answer = m.recommend_next_workout(30,{},logs,DAY)
    expect(answer["videoId"] in set(candidates.file_nm), "fallback escaped age group")


check("all recent age candidates: relax duplicate rule only", fallback)


def scoring():
    priority = {f:i/4 for i,f in enumerate(FACTORS)}
    candidates = VIDEOS.iloc[:9]
    actual = m.calculate_video_scores(candidates, priority)
    for _,row in actual.iterrows():
        close(row.recommendation_score, sum(float(row[f])*priority[f] for f in FACTORS))


check("weighted score with real mixed videos", scoring)
TIES = VIDEOS.iloc[:2].copy()
TIES["recommendation_score"] = 1.0
A, B = TIES.iloc[0], TIES.iloc[1]
check("tie selects never performed video", lambda: expect(m.select_best_video(TIES,[log(B,30)]).file_nm == A.file_nm))
check("tie selects oldest last performance", lambda: expect(m.select_best_video(TIES,[log(A,30),log(B,20),log(A,10)]).file_nm == B.file_nm))
check("final random tie remains in tied candidates", lambda: expect(all(m.select_best_video(TIES,[]).file_nm in set(TIES.file_nm) for _ in range(20))))


def same_day_adjustment():
    logs = [log(PURE,0)]
    close(m.calculate_recent_exposure(logs,DAY)["strength"], 0)
    expect(m.calculate_weight_adjustment(logs,DAY)["strength"] == dict(previous=0,delta=.3,next=.3))
    close(m.calculate_recent_exposure(logs,DAY+pd.Timedelta(days=1))["strength"], .3*.5**(1/7))


check("today adjustment and tomorrow decay", same_day_adjustment)
check("today incomplete adjustment .15", lambda: close(m.calculate_weight_adjustment([log(PURE,0,False)],DAY)["strength"]["delta"],.15))


def clipping():
    actual = m.calculate_weight_adjustment([log(PURE,i) for i in range(5)],DAY)["strength"]
    previous = .3*sum(.5**(i/7) for i in range(1,5))
    expect(actual == dict(previous=round(previous,3),delta=round(1-previous,3),next=1))


check("exposure cap limits actual delta", clipping)
check("multiple today workouts accumulate", lambda: close(m.calculate_weight_adjustment([log(PURE,0),log(PURE,0,False)],DAY)["strength"]["delta"],.45))


def integrated(fitness):
    answer = m.run_recommendation({"age":30,"sex":"male"},fitness,[log(PURE,0)],DAY)
    expect(set(answer) == {"nextWorkout","weightAdjustment"})
    expect(answer["nextWorkout"]["videoId"] != PURE.file_nm)
    expect(set(answer["weightAdjustment"]) == set(FACTORS))
    expect(all(set(x) == {"previous","delta","next"} for x in answer["weightAdjustment"].values()))
    expect(any(x["delta"] > 0 for x in answer["weightAdjustment"].values()))


check("integrated partial fitness and today's workout", lambda: integrated({"fitness":{"strength":2,"flexibility":None}}))
check("integrated unmeasured user", lambda: integrated(None))


def simulation(age):
    np.random.seed(927+age)
    history = []
    allowed = set(m.filter_by_age(VIDEOS,age).file_nm)
    for offset in range(21):
        date = DAY+pd.Timedelta(days=offset)
        result = m.recommend_next_workout(age,{"strength":3,"flexibility":1},history,date)
        chosen = result["videoId"]
        recent = {r["videoId"] for r in history if 1 <= (date-pd.Timestamp(r["date"])).days <= 7}
        expect(chosen in allowed and chosen not in recent)
        history.append(dict(videoId=chosen,date=str(date.date()),completed=offset%3 != 0))
        adjustment = m.calculate_weight_adjustment(history,date)
        expect(all(0 <= x["previous"] <= x["next"] <= 1 for x in adjustment.values()))
    return dict(days=21,distinct_videos=len({r["videoId"] for r in history}))


for age in [13,30,65]:
    check(f"21-day real catalogue simulation age={age}", lambda a=age: simulation(a))


def bad_csv(transform):
    frame = VIDEOS.iloc[:2].copy()
    frame = transform(frame)
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder)/"videos.csv"
        frame.to_csv(path,index=False)
        raises(ValueError,lambda:m._load_workout_videos(path))


check("loader rejects duplicate IDs", lambda: bad_csv(lambda f: pd.concat([f.iloc[:1],f.iloc[:1]])))
check("loader rejects missing factor column", lambda: bad_csv(lambda f: f.drop(columns=["power"])))
check("loader rejects out of range weight", lambda: bad_csv(lambda f: f.assign(strength=1.1)))
check("loader rejects nonnumeric weight", lambda: bad_csv(lambda f: f.assign(strength="invalid")))

# Defensive requirements: failures are reported, never relabelled as successes.
check("future log must not change current tie-break", lambda: expect(m.select_best_video(TIES,[log(B,30),log(A,-10)]).file_nm == A.file_nm,
      "future-dated A is treated as performed; B is selected instead"), "robustness")
check("loader must reject zero-sum weights", lambda: bad_csv(lambda f: f.assign(**{k:0 for k in FACTORS})), "robustness")
check("loader must reject weights summing to 1.4", lambda: bad_csv(lambda f: f.assign(**{k:(.7 if k in ["strength","muscularEndurance"] else 0) for k in FACTORS})), "robustness")

report = dict(source_commit="92f3493de704c644d5aeff353488f1aff49f1836",
              python=platform.python_version(),numpy=np.__version__,pandas=pd.__version__,
              source_modified=False,results=results,
              summary={category:dict(Counter(r["status"] for r in results if r["category"] == category))
                       for category in ["baseline","robustness"]})
(BASE/"results.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
print(json.dumps(report["summary"],ensure_ascii=False))
for result in results:
    if result["status"] == "failed":
        print(json.dumps(result,ensure_ascii=False))
raise SystemExit(1 if any(r["status"] == "failed" for r in results) else 0)
