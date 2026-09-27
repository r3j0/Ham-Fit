BEGIN;

-- New independent settings; the previously retired profile fields stay retired.
CREATE TYPE "ExerciseVolume" AS ENUM ('less', 'standard', 'more');
CREATE TYPE "ExerciseGoal" AS ENUM (
  'fitness_grade_improvement',
  'body_composition_management',
  'general_fitness_improvement'
);

CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  exercise_volume "ExerciseVolume" NOT NULL DEFAULT 'standard',
  exercise_goal "ExerciseGoal",
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Use current creation timestamps and never infer a goal from past user data.
-- This INSERT can be repeated after an interrupted deployment without overwriting
-- saved preferences or their timestamps. Pause signup until the new app is live.
INSERT INTO user_preferences (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
