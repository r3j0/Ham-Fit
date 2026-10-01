"""Test oracle: ask the original module which catalog entries are allowed."""
import importlib.util
import json
import os
import sys

os.environ['WORKOUT_VIDEOS_PATH'] = sys.argv[2]
spec = importlib.util.spec_from_file_location('original', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
allowed = module.filter_by_equipment(module.workout_videos, json.loads(sys.argv[3]))
json.dump(allowed['file_nm'].tolist(), sys.stdout)
