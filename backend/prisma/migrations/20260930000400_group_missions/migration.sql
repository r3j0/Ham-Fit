BEGIN;
CREATE TABLE activity_achievements (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 korean_date DATE NOT NULL,
 achieved_at TIMESTAMPTZ(6) NOT NULL,
 source_kind TEXT NOT NULL CHECK (source_kind IN ('routine', 'daily_assignment')),
 source_id UUID NOT NULL,
 UNIQUE(user_id, korean_date),
 CHECK (korean_date = (achieved_at AT TIME ZONE 'Asia/Seoul')::date)
);
CREATE TABLE group_mission_rounds (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 member_count INTEGER NOT NULL CHECK (member_count BETWEEN 2 AND 100),
 total_target INTEGER NOT NULL CHECK (total_target = 14 * member_count),
 water_count INTEGER NOT NULL DEFAULT 0 CHECK (water_count BETWEEN 0 AND total_target),
 started_at TIMESTAMPTZ(6) NOT NULL,
 completed_at TIMESTAMPTZ(6),
 policy_version TEXT NOT NULL,
 roulette_policy JSONB NOT NULL CHECK (jsonb_typeof(roulette_policy) = 'array'),
 UNIQUE(id, group_id),
 CHECK ((completed_at IS NOT NULL) = (water_count = total_target)),
 CHECK (completed_at IS NULL OR completed_at >= started_at)
);
CREATE UNIQUE INDEX group_mission_rounds_active_key ON group_mission_rounds(group_id) WHERE completed_at IS NULL;
CREATE INDEX group_mission_rounds_group_id_started_at_id_idx ON group_mission_rounds(group_id, started_at, id);
CREATE TABLE group_mission_participants (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 round_id UUID NOT NULL REFERENCES group_mission_rounds(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 user_id UUID REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
 water_count INTEGER NOT NULL DEFAULT 0 CHECK (water_count >= 0),
 invalidated_at TIMESTAMPTZ(6),
 UNIQUE(round_id, user_id), UNIQUE(id, round_id)
);
CREATE INDEX group_mission_participants_user_id_round_id_idx ON group_mission_participants(user_id, round_id);
CREATE TABLE group_mission_contributions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id UUID NOT NULL,
 round_id UUID NOT NULL REFERENCES group_mission_rounds(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 participant_id UUID NOT NULL REFERENCES group_mission_participants(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 achievement_id UUID REFERENCES activity_achievements(id) ON DELETE SET NULL ON UPDATE RESTRICT,
 contributed_at TIMESTAMPTZ(6) NOT NULL,
 UNIQUE(group_id, achievement_id),
 FOREIGN KEY(round_id, group_id) REFERENCES group_mission_rounds(id, group_id) ON DELETE CASCADE ON UPDATE RESTRICT,
 FOREIGN KEY(participant_id, round_id) REFERENCES group_mission_participants(id, round_id) ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE TABLE group_mission_start_requests (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 key UUID NOT NULL,
 round_id UUID NOT NULL REFERENCES group_mission_rounds(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 PRIMARY KEY(user_id, key)
);
CREATE TABLE group_roulette_tickets (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 round_id UUID NOT NULL REFERENCES group_mission_rounds(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 participant_id UUID NOT NULL REFERENCES group_mission_participants(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 ordinal INTEGER NOT NULL CHECK (ordinal > 0),
 created_at TIMESTAMPTZ(6) NOT NULL,
 invalidated_at TIMESTAMPTZ(6),
 UNIQUE(round_id, participant_id, ordinal),
 FOREIGN KEY(participant_id, round_id) REFERENCES group_mission_participants(id, round_id) ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE TABLE group_roulette_draws (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_id UUID NOT NULL UNIQUE REFERENCES group_roulette_tickets(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 user_id UUID REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
 key UUID NOT NULL,
 policy_version TEXT NOT NULL,
 result TEXT NOT NULL CHECK (result IN ('self_1','self_3','self_5','self_7','contributors_3','contributors_7')),
 amount INTEGER NOT NULL,
 drawn_at TIMESTAMPTZ(6) NOT NULL,
 UNIQUE(user_id, key),
 CHECK (amount = CASE result WHEN 'self_1' THEN 1 WHEN 'self_3' THEN 3 WHEN 'self_5' THEN 5 WHEN 'self_7' THEN 7 WHEN 'contributors_3' THEN 3 WHEN 'contributors_7' THEN 7 END)
);
CREATE TABLE group_roulette_rewards (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 draw_id UUID NOT NULL REFERENCES group_roulette_draws(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 user_id UUID REFERENCES users(id) ON DELETE SET NULL ON UPDATE RESTRICT,
 amount INTEGER NOT NULL CHECK (amount IN (1,3,5,7)),
 transaction_id UUID UNIQUE REFERENCES currency_transactions(id) ON DELETE SET NULL ON UPDATE RESTRICT,
 UNIQUE(draw_id, user_id)
);

-- Protect frozen difficulty/policy and irreversible eligibility. Account FK
-- SET NULL anonymizes the ledger; it must never reset accumulated water.
CREATE FUNCTION protect_group_mission_round() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id, NEW.group_id, NEW.member_count, NEW.total_target, NEW.started_at, NEW.policy_version, NEW.roulette_policy)
  IS DISTINCT FROM (OLD.id, OLD.group_id, OLD.member_count, OLD.total_target, OLD.started_at, OLD.policy_version, OLD.roulette_policy)
  OR NEW.water_count < OLD.water_count OR (OLD.completed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
  RAISE EXCEPTION 'Mission snapshot is immutable.' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER group_mission_round_immutable BEFORE UPDATE ON group_mission_rounds FOR EACH ROW EXECUTE FUNCTION protect_group_mission_round();
CREATE FUNCTION protect_group_mission_participant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id, NEW.round_id) IS DISTINCT FROM (OLD.id, OLD.round_id)
  OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL)
  OR NEW.water_count < OLD.water_count
  OR (OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at) THEN
  RAISE EXCEPTION 'Mission participant cannot regain eligibility.' USING ERRCODE = '23514';
 END IF;
 IF NEW.user_id IS NULL THEN NEW.invalidated_at := COALESCE(OLD.invalidated_at, NEW.invalidated_at, clock_timestamp()); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER group_mission_participant_immutable BEFORE UPDATE ON group_mission_participants FOR EACH ROW EXECUTE FUNCTION protect_group_mission_participant();
CREATE FUNCTION invalidate_group_mission_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Same group lock as start, completion, roulette and group administration.
 -- During whole-group cascade the parent is already gone; no reward remains.
 EXECUTE format('SELECT id FROM %I.groups WHERE id = $1 FOR UPDATE', TG_TABLE_SCHEMA) USING OLD.group_id;
 EXECUTE format('UPDATE %1$I.group_mission_participants p SET invalidated_at = COALESCE(p.invalidated_at, clock_timestamp()) FROM %1$I.group_mission_rounds r WHERE p.round_id = r.id AND r.group_id = $1 AND p.user_id = $2', TG_TABLE_SCHEMA) USING OLD.group_id, OLD.user_id;
 EXECUTE format('UPDATE %1$I.group_roulette_tickets t SET invalidated_at = COALESCE(t.invalidated_at, clock_timestamp()) FROM %1$I.group_mission_participants p JOIN %1$I.group_mission_rounds r ON r.id = p.round_id WHERE t.participant_id = p.id AND r.group_id = $1 AND p.user_id = $2 AND NOT EXISTS (SELECT 1 FROM %1$I.group_roulette_draws d WHERE d.ticket_id = t.id)', TG_TABLE_SCHEMA) USING OLD.group_id, OLD.user_id;
 RETURN OLD;
END; $$;
CREATE TRIGGER group_mission_membership_departure BEFORE DELETE ON group_memberships FOR EACH ROW EXECUTE FUNCTION invalidate_group_mission_membership();

-- A single account can belong to many groups. Lock cascades in UUID order.
CREATE FUNCTION lock_deleted_account_groups() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE format('SELECT g.id FROM %1$I.groups g JOIN %1$I.group_memberships m ON m.group_id = g.id WHERE m.user_id = $1 ORDER BY g.id FOR UPDATE OF g', TG_TABLE_SCHEMA) USING OLD.id;
 RETURN OLD;
END; $$;
CREATE TRIGGER group_mission_account_departure BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION lock_deleted_account_groups();
COMMIT;
