BEGIN;

CREATE TABLE workout_routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  assignment_date DATE NOT NULL,
  reference_date DATE NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  algorithm_version TEXT NOT NULL,
  data_version TEXT NOT NULL,
  estimated_minutes DOUBLE PRECISION NOT NULL CHECK (estimated_minutes > 0 AND estimated_minutes < 'Infinity'::float8),
  input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  weight_adjustment JSONB NOT NULL CHECK (jsonb_typeof(weight_adjustment) = 'object'),
  CHECK (assignment_date = reference_date + 1),
  CONSTRAINT workout_routines_user_id_assignment_date_key UNIQUE (user_id, assignment_date)
);
CREATE TRIGGER workout_routine_immutable BEFORE UPDATE ON workout_routines
FOR EACH ROW EXECUTE FUNCTION protect_curriculum_definition();

CREATE TABLE workout_routine_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id UUID NOT NULL REFERENCES workout_routines(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  "order" INTEGER NOT NULL CHECK ("order" > 0),
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  duration_seconds DOUBLE PRECISION NOT NULL CHECK (duration_seconds > 0 AND duration_seconds < 'Infinity'::float8),
  slot TEXT NOT NULL CHECK (slot IN ('flexibility_group', 'agility_power_group', 'strength_group', 'cooldown')),
  prescription JSONB NOT NULL CHECK (jsonb_typeof(prescription) = 'object'),
  status "CurriculumAssignmentStatus" NOT NULL DEFAULT 'assigned',
  intervals JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(intervals) = 'array'),
  position_seconds DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (position_seconds >= 0 AND position_seconds <= duration_seconds),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  result_status TEXT CHECK (result_status IN ('not_performed', 'interrupted', 'completed')),
  performed_at TIMESTAMPTZ(6),
  completed_at TIMESTAMPTZ(6),
  CHECK ((result_status IS NULL) = (performed_at IS NULL)),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL AND result_status IS NOT DISTINCT FROM 'completed')
      OR (status <> 'completed' AND completed_at IS NULL)),
  CONSTRAINT workout_routine_items_routine_id_order_key UNIQUE (routine_id, "order"),
  CONSTRAINT workout_routine_items_routine_id_video_id_key UNIQUE (routine_id, video_id)
);
CREATE FUNCTION protect_routine_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.routine_id, NEW."order", NEW.video_id, NEW.title, NEW.video_url, NEW.duration_seconds, NEW.slot, NEW.prescription)
     IS DISTINCT FROM (OLD.id, OLD.routine_id, OLD."order", OLD.video_id, OLD.title, OLD.video_url, OLD.duration_seconds, OLD.slot, OLD.prescription)
     OR (OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Routine prescriptions and completed items are immutable.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workout_routine_item_immutable BEFORE UPDATE ON workout_routine_items
FOR EACH ROW EXECUTE FUNCTION protect_routine_item();

CREATE TABLE workout_routine_requests (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  key UUID NOT NULL,
  routine_id UUID NOT NULL REFERENCES workout_routines(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE workout_routine_events (
  item_id UUID NOT NULL REFERENCES workout_routine_items(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  key UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  device_id UUID NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  type TEXT NOT NULL CHECK (type IN ('start', 'progress', 'pause', 'end', 'complete')),
  intervals JSONB NOT NULL CHECK (jsonb_typeof(intervals) = 'array'),
  position_seconds DOUBLE PRECISION NOT NULL CHECK (position_seconds >= 0 AND position_seconds < 'Infinity'::float8),
  client_occurred_at TIMESTAMPTZ(6),
  received_at TIMESTAMPTZ(6) NOT NULL,
  resulting_revision INTEGER NOT NULL CHECK (resulting_revision > 0),
  PRIMARY KEY (item_id, key),
  CONSTRAINT workout_routine_events_item_id_device_id_sequence_key UNIQUE (item_id, device_id, sequence),
  CHECK (client_occurred_at IS NULL OR client_occurred_at <= received_at)
);
CREATE TRIGGER workout_routine_event_immutable BEFORE UPDATE ON workout_routine_events
FOR EACH ROW EXECUTE FUNCTION protect_curriculum_definition();

-- Validate at commit so the routine and all ordered items can be inserted atomically.
CREATE FUNCTION validate_routine_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; total INTEGER; first_order INTEGER; last_order INTEGER; parent_exists BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'workout_routines' THEN target := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN target := OLD.routine_id;
  ELSE target := NEW.routine_id;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.workout_routines WHERE id = $1)', TG_TABLE_SCHEMA)
    INTO parent_exists USING target;
  IF NOT parent_exists THEN RETURN NULL; END IF;
  EXECUTE format('SELECT count(*), min("order"), max("order") FROM %I.workout_routine_items WHERE routine_id = $1', TG_TABLE_SCHEMA)
    INTO total, first_order, last_order USING target;
  IF total = 0 OR first_order <> 1 OR last_order <> total THEN
    RAISE EXCEPTION 'A routine requires contiguous ordered items.' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER workout_routine_has_items AFTER INSERT ON workout_routines
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_routine_items();
CREATE CONSTRAINT TRIGGER workout_routine_items_contiguous AFTER INSERT OR UPDATE OR DELETE ON workout_routine_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_routine_items();

COMMIT;
