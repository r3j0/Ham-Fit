BEGIN;

CREATE TYPE "OwnedTool" AS ENUM (
  'band', 'dumbbell', 'gym_ball', 'foam_roller', 'jump_rope', 'step_box'
);

-- Existing settings, timestamps and routines are preserved. Existing and new
-- preference rows both receive an empty list without an application backfill.
ALTER TABLE user_preferences
  ADD COLUMN owned_tools "OwnedTool"[] NOT NULL DEFAULT ARRAY[]::"OwnedTool"[],
  ADD CONSTRAINT user_preferences_owned_tools_no_nulls
    CHECK (array_position(owned_tools, NULL) IS NULL);

COMMIT;
