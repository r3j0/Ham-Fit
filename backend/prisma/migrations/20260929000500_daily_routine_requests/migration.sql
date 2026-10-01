BEGIN;

-- Keep existing future assignments, snapshots, progress and request keys intact.
ALTER TABLE workout_routines
  DROP CONSTRAINT workout_routines_check,
  ALTER COLUMN weight_adjustment DROP NOT NULL;

ALTER TABLE workout_routines
  -- NOT VALID preserves historical next-day rows while checking every new insert.
  ADD CONSTRAINT workout_routines_daily_date_check
    CHECK (assignment_date = reference_date) NOT VALID;

COMMIT;
