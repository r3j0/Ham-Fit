-- Existing account and curriculum history is retained. No DOB is inferred.
ALTER TYPE "CurriculumAssignmentStatus" ADD VALUE IF NOT EXISTS 'in_progress';
ALTER TYPE "CurriculumAssignmentStatus" ADD VALUE IF NOT EXISTS 'not_performed';
ALTER TYPE "CurriculumAssignmentStatus" ADD VALUE IF NOT EXISTS 'interrupted';

BEGIN;
ALTER TABLE users ADD COLUMN date_of_birth DATE;
ALTER TABLE users ADD CONSTRAINT user_birth_date_valid CHECK (
  date_of_birth IS NULL OR (isfinite(date_of_birth) AND date_of_birth >= DATE '0001-01-01' AND date_of_birth <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date)
);
CREATE TABLE workout_catalogs (
  version TEXT PRIMARY KEY,
  source_commit TEXT NOT NULL,
  source_urls TEXT[] NOT NULL CHECK (cardinality(source_urls) > 0),
  checked_on DATE NOT NULL,
  content_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE workout_catalog_activation (
  id TEXT PRIMARY KEY CHECK (id = 'current'),
  catalog_version TEXT NOT NULL UNIQUE REFERENCES workout_catalogs(version) ON DELETE RESTRICT ON UPDATE RESTRICT,
  activated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE workout_videos (
  catalog_version TEXT NOT NULL REFERENCES workout_catalogs(version) ON DELETE RESTRICT ON UPDATE RESTRICT,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  original_url TEXT NOT NULL,
  age_group TEXT NOT NULL,
  equipment TEXT[] NOT NULL,
  fitness_weights JSONB NOT NULL,
  duration_seconds DOUBLE PRECISION NOT NULL CHECK (duration_seconds > 0 AND duration_seconds < 'Infinity'::float8),
  PRIMARY KEY (catalog_version, video_id)
);
CREATE TRIGGER workout_catalog_immutable BEFORE UPDATE OR DELETE ON workout_catalogs
FOR EACH ROW EXECUTE FUNCTION protect_curriculum_definition();
CREATE TRIGGER workout_video_immutable BEFORE UPDATE OR DELETE ON workout_videos
FOR EACH ROW EXECUTE FUNCTION protect_curriculum_definition();
ALTER TABLE workout_curricula
  ADD COLUMN catalog_version TEXT,
  ADD COLUMN video_id TEXT,
  ADD CONSTRAINT curriculum_video_pair CHECK ((catalog_version IS NULL) = (video_id IS NULL)),
  ADD CONSTRAINT curriculum_video_fkey FOREIGN KEY (catalog_version, video_id) REFERENCES workout_videos(catalog_version, video_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX workout_curricula_catalog_version_video_id_key ON workout_curricula(catalog_version, video_id);
ALTER TABLE user_curriculum_assignments
  ADD COLUMN assignment_date DATE,
  ADD COLUMN superseded_at TIMESTAMPTZ(6),
  ADD COLUMN algorithm_version TEXT,
  ADD COLUMN input_snapshot JSONB,
  ADD COLUMN intervals JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN position_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN result_status TEXT,
  ADD COLUMN performed_at TIMESTAMPTZ(6),
  DROP CONSTRAINT assignment_state;
CREATE UNIQUE INDEX user_curriculum_assignments_user_id_assignment_date_key ON user_curriculum_assignments(user_id, assignment_date);
ALTER TABLE user_curriculum_assignments ADD CONSTRAINT assignment_state CHECK (
  (assignment_date IS NULL AND (
    (status = 'assigned' AND completed_at IS NULL AND (current_for_user_id IS NOT NULL OR (superseded_at IS NOT NULL AND superseded_at >= assigned_at)))
    OR (status = 'completed' AND completed_at IS NOT NULL AND completed_at >= assigned_at)
  )) OR (assignment_date IS NOT NULL AND algorithm_version IS NOT NULL AND input_snapshot IS NOT NULL AND (
    (status <> 'completed' AND completed_at IS NULL) OR
    (status = 'completed' AND result_status = 'completed' AND completed_at IS NOT NULL AND completed_at >= assigned_at)
  ))
);
ALTER TABLE user_curriculum_assignments ADD CONSTRAINT assignment_progress_valid CHECK (
  revision > 0 AND position_seconds >= 0 AND position_seconds < 'Infinity'::float8 AND jsonb_typeof(intervals) = 'array'
  AND (result_status IS NULL OR result_status IN ('not_performed', 'interrupted', 'completed'))
  AND ((result_status IS NULL) = (performed_at IS NULL))
  AND (performed_at IS NULL OR performed_at >= assigned_at)
);
CREATE OR REPLACE FUNCTION protect_assignment_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.curriculum_id, NEW.request_key, NEW.assigned_at, NEW.assignment_date, NEW.algorithm_version, NEW.input_snapshot)
     IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.curriculum_id, OLD.request_key, OLD.assigned_at, OLD.assignment_date, OLD.algorithm_version, OLD.input_snapshot)
     OR (OLD.status = 'completed' AND (NEW.status, NEW.completed_at, NEW.result_status, NEW.performed_at, NEW.intervals, NEW.position_seconds, NEW.revision) IS DISTINCT FROM (OLD.status, OLD.completed_at, OLD.result_status, OLD.performed_at, OLD.intervals, OLD.position_seconds, OLD.revision))
     OR (OLD.current_for_user_id IS NULL AND NEW.current_for_user_id IS NOT NULL)
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'Assignment identity and completed history are immutable.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TABLE workout_assignment_requests (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  key UUID NOT NULL,
  assignment_id UUID NOT NULL REFERENCES user_curriculum_assignments(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE workout_progress_events (
  assignment_id UUID NOT NULL REFERENCES user_curriculum_assignments(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  key UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  device_id UUID NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  type TEXT NOT NULL CHECK (type IN ('start','progress','pause','end','complete')),
  intervals JSONB NOT NULL CHECK (jsonb_typeof(intervals) = 'array'),
  position_seconds DOUBLE PRECISION NOT NULL CHECK (position_seconds >= 0 AND position_seconds < 'Infinity'::float8),
  client_occurred_at TIMESTAMPTZ(6),
  received_at TIMESTAMPTZ(6) NOT NULL,
  resulting_revision INTEGER NOT NULL CHECK (resulting_revision > 0),
  PRIMARY KEY (assignment_id, key),
  UNIQUE (assignment_id, device_id, sequence),
  CHECK (client_occurred_at IS NULL OR client_occurred_at <= received_at)
);
CREATE TRIGGER workout_event_immutable BEFORE UPDATE ON workout_progress_events
FOR EACH ROW EXECUTE FUNCTION protect_curriculum_definition();
COMMIT;
