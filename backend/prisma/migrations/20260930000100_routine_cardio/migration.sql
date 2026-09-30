-- No default/backfill: legacy routines keep SQL NULL and immutable history.
ALTER TABLE workout_routines ADD COLUMN cardio_recommendation JSONB;
