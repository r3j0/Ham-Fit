"""JSON transport for the original data-team module; no recommendation rules."""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True


def main():
    source = Path(sys.argv[1]).resolve(strict=True)
    data = Path(sys.argv[2]).resolve(strict=True)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    data_hash = hashlib.sha256(data.read_bytes()).hexdigest()
    os.environ["WORKOUT_VIDEOS_PATH"] = str(data)
    spec = importlib.util.spec_from_file_location("data_team_recommendation", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    payload = json.load(sys.stdin)
    # The service requests the routine for this date, not the post-workout
    # wrapper which advances the date and computes tomorrow's exposure delta.
    result = {"workout": module.recommend_workout_routine(
        age=payload["profile"]["age"],
        fitness_data=module.extract_fitness_data(payload["fitness100"]),
        logs=payload["logs"],
        current_date=payload["current_date"],
        goal=payload["goal"],
        routine_level=payload["routine_level"],
        owned_tools=payload["owned_tools"],
    )}
    # Enrich output with actual catalog durations for BE playback validation.
    # estimatedMinutes is an exercise estimate, not a video duration.
    catalog = module.workout_videos.set_index("file_nm")
    durations = {}
    for item in result["workout"]["routine"]:
        row = catalog.loc[item["videoId"]]
        if item["title"] != row["title"] or item["videoUrl"] != row["file_url"]:
            raise ValueError("Recommendation/catalog mismatch")
        duration = float(row["video_length"])
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("Missing or invalid catalog video duration")
        durations[item["videoId"]] = duration
    # A changing deployment must not mix source/data versions in one result.
    if (source_hash != hashlib.sha256(source.read_bytes()).hexdigest()
            or data_hash != hashlib.sha256(data.read_bytes()).hexdigest()):
        raise ValueError("Recommendation artifacts changed during execution")
    json.dump({
        "result": result,
        "durations": durations,
        "algorithmVersion": "recommendation_v2:" + source_hash,
        "dataVersion": data_hash,
    }, sys.stdout, ensure_ascii=False, allow_nan=False)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Do not expose profiles, logs, paths, or Python tracebacks over HTTP.
        sys.stderr.write("Recommendation execution failed\n")
        sys.exit(1)
