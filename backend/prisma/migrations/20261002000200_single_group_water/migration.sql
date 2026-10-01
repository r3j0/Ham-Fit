BEGIN;
CREATE TABLE group_mission_water_choices (
 achievement_id UUID PRIMARY KEY REFERENCES activity_achievements(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 options JSONB NOT NULL CHECK (jsonb_typeof(options) = 'array'),
 selection JSONB,
 selected_at TIMESTAMPTZ(6),
 request_key UUID,
 CHECK ((selection IS NULL) = (selected_at IS NULL)),
 CHECK (selection IS NOT NULL OR request_key IS NULL),
 CHECK (selection IS NULL OR (jsonb_typeof(selection) = 'object' AND selection->>'amount' = '1'))
);
CREATE INDEX group_mission_water_choices_request_key_idx ON group_mission_water_choices(request_key);
ALTER TABLE group_mission_contributions ADD COLUMN water_choice_id UUID UNIQUE
 REFERENCES group_mission_water_choices(achievement_id) ON DELETE SET NULL ON UPDATE RESTRICT;

CREATE FUNCTION protect_group_mission_water_choice() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW.achievement_id IS DISTINCT FROM OLD.achievement_id OR NEW.options IS DISTINCT FROM OLD.options
 OR OLD.selection IS NOT NULL THEN
  RAISE EXCEPTION 'Daily water options and selections cannot be changed';
 END IF;
 IF NEW.selection IS NULL OR NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(OLD.options) o
  WHERE o->>'groupId' = NEW.selection->>'groupId' AND o->>'roundId' = NEW.selection->>'roundId'
   AND o->>'groupName' = NEW.selection->>'groupName'
 ) THEN RAISE EXCEPTION 'Water requires an original completion option'; END IF;
 IF NOT EXISTS (SELECT 1 FROM activity_achievements a WHERE a.id = NEW.achievement_id
  AND a.korean_date = (NEW.selected_at AT TIME ZONE 'Asia/Seoul')::date
  AND a.achieved_at <= NEW.selected_at) THEN
  RAISE EXCEPTION 'Water must be selected on the completion day';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_group_mission_water_choice BEFORE UPDATE ON group_mission_water_choices
 FOR EACH ROW EXECUTE FUNCTION protect_group_mission_water_choice();

CREATE FUNCTION validate_single_group_water() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE choice group_mission_water_choices;
BEGIN
 SELECT * INTO choice FROM group_mission_water_choices WHERE achievement_id = NEW.achievement_id;
 IF FOUND THEN
  IF choice.selection IS NULL OR choice.selection->>'groupId' IS DISTINCT FROM NEW.group_id::text
  OR choice.selection->>'roundId' IS DISTINCT FROM NEW.round_id::text
  OR choice.selected_at IS DISTINCT FROM NEW.contributed_at
  OR NOT EXISTS (SELECT 1 FROM activity_achievements a JOIN group_mission_participants p
   ON p.user_id = a.user_id WHERE a.id = NEW.achievement_id AND p.id = NEW.participant_id
   AND p.round_id = NEW.round_id AND p.invalidated_at IS NULL)
  THEN RAISE EXCEPTION 'Contribution must match the daily water selection'; END IF;
  -- Even a caller omitting the new column cannot bypass the global unique key.
  NEW.water_choice_id := choice.achievement_id;
 ELSIF NEW.water_choice_id IS NOT NULL THEN
  RAISE EXCEPTION 'Water choice must belong to its achievement';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_single_group_water BEFORE INSERT ON group_mission_contributions
 FOR EACH ROW EXECUTE FUNCTION validate_single_group_water();

CREATE FUNCTION protect_group_mission_water_choice_deletion() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM activity_achievements WHERE id = OLD.achievement_id) THEN
  RAISE EXCEPTION 'A daily water choice cannot be reset';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER protect_group_mission_water_choice_deletion AFTER DELETE ON group_mission_water_choices
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION protect_group_mission_water_choice_deletion();
COMMIT;
