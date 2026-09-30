BEGIN;

-- Drain old API instances before applying this enum replacement (see owned-tools.md).
LOCK TABLE user_preferences IN ACCESS EXCLUSIVE MODE;
UPDATE user_preferences
SET owned_tools = ARRAY(
      SELECT tool FROM unnest(owned_tools) WITH ORDINALITY AS selected(tool, position)
      WHERE tool::text NOT IN ('foam_roller', 'bosu', 'agility_ladder', 'cone')
      ORDER BY position
    ),
    updated_at = clock_timestamp()
WHERE owned_tools && ARRAY['foam_roller', 'bosu', 'agility_ladder', 'cone']::"OwnedTool"[];

-- Drop type-dependent expressions, then restore their original semantics.
ALTER TABLE user_preferences
  DROP CONSTRAINT user_preferences_owned_tools_no_nulls,
  ALTER COLUMN owned_tools DROP DEFAULT;
ALTER TYPE "OwnedTool" RENAME TO "OwnedTool_old";
CREATE TYPE "OwnedTool" AS ENUM ('band', 'dumbbell', 'gym_ball', 'jump_rope', 'step_box', 'ball');
ALTER TABLE user_preferences
  ALTER COLUMN owned_tools TYPE "OwnedTool"[] USING owned_tools::text[]::"OwnedTool"[],
  ALTER COLUMN owned_tools SET DEFAULT ARRAY[]::"OwnedTool"[],
  ADD CONSTRAINT user_preferences_owned_tools_no_nulls
    CHECK (array_position(owned_tools, NULL) IS NULL);
DROP TYPE "OwnedTool_old";

COMMIT;
