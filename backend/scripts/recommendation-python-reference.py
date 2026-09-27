"""Reproduce original 61/3 evidence and export parity fixtures without editing source.

Requires Python 3.12, numpy 2.3.5, pandas 2.2.3. The original checker intentionally
exits 1 for its three real defects. That result remains a failure in the report;
the TypeScript implementation has separate passing regression evidence.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/recommendation"
OUTPUT = DATA / "validation"
SOURCE = DATA / "source/data-analysis/src/recommendation.py"
# Do not allow a caller's development CSV override to replace the pinned input.
os.environ["WORKOUT_VIDEOS_PATH"] = str(DATA / "source/data-analysis/data/processed/workout_videos.csv")
manifest = json.loads((DATA / "source-manifest.json").read_text())
for item in manifest["files"]:
    actual = hashlib.sha256((DATA / "source" / item["source"]).read_bytes()).hexdigest()
    assert actual == item["sha256"], f"Source modified: {item['source']}"

with tempfile.TemporaryDirectory(prefix="project-health-python-reference-") as tmp:
    isolated = Path(tmp)
    (isolated / "snapshot").symlink_to(DATA / "source", target_is_directory=True)
    (isolated / "manifest.json").write_text(json.dumps(manifest))
    shutil.copyfile(DATA / "source/run_checks.py", isolated / "run_checks.py")
    completed = subprocess.run([sys.executable, str(isolated / "run_checks.py")],
                               text=True, capture_output=True, check=False,
                               env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    report = json.loads((isolated / "results.json").read_text())
    report["processExitCode"] = completed.returncode
    report["sourceCheckerSha256"] = hashlib.sha256((DATA / "source/run_checks.py").read_bytes()).hexdigest()
    (OUTPUT / "original-reference-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    assert report["summary"] == {"baseline": {"passed": 61}, "robustness": {"failed": 3}}, report["summary"]
    print("Original reference, unchanged:", json.dumps(report["summary"]))

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("pinned_recommender", SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
V = m.workout_videos
FACTORS = list(m.FITNESS_COLUMNS)
DAY = pd.Timestamp("2026-09-27")
cases = []


def record(name, age, fitness, logs, date):
    # Match the required fix at the engine entry. This filter deliberately keeps
    # older than 14-day logs because the original tie algorithm needs them.
    accepted = [log for log in logs if m._to_timestamp(log["date"], "date") <= date]
    exposure = m.calculate_recent_exposure(accepted, date)
    priority = m.calculate_priority(fitness, exposure)
    age_candidates = m.filter_by_age(V, age)
    candidates = m.exclude_recent_videos(age_candidates, accepted, date)
    if candidates.empty:
        candidates = age_candidates
    scored = m.calculate_video_scores(candidates, priority)
    best = scored[np.isclose(scored.recommendation_score, scored.recommendation_score.max())]
    latest = {}
    for log in accepted:
        date_value = str(m._to_timestamp(log["date"], "date").date())
        latest[log["videoId"]] = max(latest.get(log["videoId"], date_value), date_value)
    unused = [str(row.file_nm) for _, row in best.iterrows() if row.file_nm not in latest]
    if unused:
        tied = unused
    else:
        oldest = min(latest[str(row.file_nm)] for _, row in best.iterrows())
        tied = [str(row.file_nm) for _, row in best.iterrows() if latest[str(row.file_nm)] == oldest]
    selected = m.recommend_next_workout(age, fitness, accepted, date)["videoId"]
    assert selected in tied
    cases.append(dict(name=name, age=age, fitness=fitness, logs=list(logs), referenceDate=str(date.date()),
                      exposure=exposure, priority=priority,
                      ageCandidateIds=list(age_candidates.file_nm), candidateIds=list(candidates.file_nm),
                      scores={str(row.file_nm): float(row.recommendation_score) for _, row in scored.iterrows()},
                      tiedCandidateIds=tied, pythonSelected=selected,
                      weightAdjustment=m.calculate_weight_adjustment(accepted, date)))
    return selected


pure = V[V.strength == 1].iloc[0]
mixed = V[(V[FACTORS] > 0).sum(axis=1) > 1].iloc[0]
for offset in [-10, -1, 0, 1, 7, 8, 14, 15, 30]:
    for completed in [True, False]:
        logs = [dict(videoId=str(mixed.file_nm), date=str((DAY - pd.Timedelta(days=offset)).date()), completed=completed)]
        record(f"boundary-{offset}-completed-{completed}", 30, {"strength": 2, "flexibility": 1}, logs, DAY)

record("capped-exposure", 30, {}, [dict(videoId=str(pure.file_nm), date=str((DAY-pd.Timedelta(days=i)).date()), completed=True) for i in range(15)], DAY)
record("kst-instant", 19, {}, [dict(videoId=str(mixed.file_nm), date="2026-09-26T15:30:00Z", completed=True)], DAY)
record("all-candidates-recent-fallback", 30, {}, [dict(videoId=str(row.file_nm), date="2026-09-26", completed=True) for _, row in m.filter_by_age(V,30).iterrows()], DAY)
record("unmeasured-user", 13, {}, [], DAY)

simulations = []
for age in [13, 18, 19, 30, 64]:
    np.random.seed(927+age)
    history = []
    days = []
    for offset in range(21):
        date = DAY + pd.Timedelta(days=offset)
        selected = record(f"simulation-age-{age}-day-{offset}", age, {"strength": 3, "flexibility": 1}, history, date)
        recent = {r["videoId"] for r in history if 1 <= (date-pd.Timestamp(r["date"])).days <= 7}
        assert selected not in recent
        history.append(dict(videoId=selected, date=str(date.date()), completed=offset % 3 != 0))
        days.append(dict(date=str(date.date()), videoId=selected, completed=offset % 3 != 0))
    simulations.append(dict(age=age, days=days, distinctVideos=len({r['videoId'] for r in history})))

parity = dict(sourceCommit=manifest['sourceCommit'], sourceModified=False,
              python=platform.python_version(), numpy=np.__version__, pandas=pd.__version__,
              caseCount=len(cases), cases=cases, simulations=simulations,
              comparison="Exact candidate sets; numeric tolerance 1e-12; final random choice must be in valid tied candidates")
(OUTPUT / "python-parity.json").write_text(json.dumps(parity, ensure_ascii=False, indent=2)+"\n")
print(f"Exported {len(cases)} Python reference cases and five 21-day simulations")
