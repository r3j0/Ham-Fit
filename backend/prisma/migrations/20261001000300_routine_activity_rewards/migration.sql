BEGIN;
ALTER TABLE workout_routines ADD CONSTRAINT workout_routines_id_user_id_key UNIQUE (id, user_id);
ALTER TABLE currency_transactions ADD CONSTRAINT currency_transactions_id_user_id_key UNIQUE (id, user_id);

CREATE TABLE routine_activity_rewards (
 routine_id UUID PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 korean_date DATE NOT NULL,
 completed_at TIMESTAMPTZ NOT NULL,
 seed_status TEXT NOT NULL CHECK (seed_status IN ('granted', 'already_granted', 'not_eligible')),
 transaction_id UUID UNIQUE,
 waters JSONB NOT NULL CHECK (jsonb_typeof(waters) = 'array'),
 personal_ticket_ids UUID[] NOT NULL,
 UNIQUE(routine_id, user_id),
 UNIQUE(transaction_id, user_id),
 CHECK (korean_date = (completed_at AT TIME ZONE 'Asia/Seoul')::date),
 CHECK ((seed_status = 'granted') = (transaction_id IS NOT NULL)),
 CONSTRAINT routine_reward_source_fkey FOREIGN KEY (routine_id, user_id)
  REFERENCES workout_routines(id, user_id) ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT routine_reward_transaction_fkey FOREIGN KEY (transaction_id, user_id)
  REFERENCES currency_transactions(id, user_id) ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX routine_reward_daily_grant ON routine_activity_rewards(user_id, korean_date) WHERE seed_status = 'granted';

CREATE FUNCTION validate_routine_activity_reward() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE expected_waters JSONB; expected_tickets UUID[];
BEGIN
 IF NOT EXISTS (SELECT 1 FROM workout_routine_items WHERE routine_id = NEW.routine_id)
 OR EXISTS (SELECT 1 FROM workout_routine_items WHERE routine_id = NEW.routine_id AND (status <> 'completed' OR completed_at IS NULL OR completed_at > NEW.completed_at))
 OR (SELECT max(completed_at) FROM workout_routine_items WHERE routine_id = NEW.routine_id) IS DISTINCT FROM NEW.completed_at THEN
  RAISE EXCEPTION 'Reward requires the actual whole-routine completion';
 END IF;
 IF NEW.seed_status = 'granted' AND NOT EXISTS (
  SELECT 1 FROM currency_transactions WHERE id = NEW.transaction_id AND user_id = NEW.user_id
   AND kind = 'grant' AND amount = 1 AND event_key = 'daily-activity:' || NEW.korean_date::text
 ) THEN RAISE EXCEPTION 'Reward requires the actual daily seed transaction'; END IF;
 IF NEW.seed_status = 'already_granted' AND NOT EXISTS (
  SELECT 1 FROM routine_activity_rewards WHERE user_id = NEW.user_id AND korean_date = NEW.korean_date AND seed_status = 'granted'
 ) THEN RAISE EXCEPTION 'No prior daily grant'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('groupId', c.group_id, 'groupName', g.name, 'roundId', c.round_id, 'amount', 1) ORDER BY c.group_id), '[]'::jsonb)
 INTO expected_waters FROM activity_achievements a
 JOIN group_mission_contributions c ON c.achievement_id = a.id
 JOIN group_mission_rounds r ON r.id = c.round_id JOIN groups g ON g.id = r.group_id
 WHERE a.user_id = NEW.user_id AND a.source_kind = 'routine' AND a.source_id = NEW.routine_id;
 SELECT COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::uuid[]) INTO expected_tickets
 FROM activity_achievements a JOIN streak_roulette_tickets t ON t.achievement_id = a.id
 WHERE a.user_id = NEW.user_id AND a.source_kind = 'routine' AND a.source_id = NEW.routine_id;
 IF NEW.waters IS DISTINCT FROM expected_waters OR NEW.personal_ticket_ids IS DISTINCT FROM expected_tickets THEN
  RAISE EXCEPTION 'Receipt must match actual completion contributions and tickets';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_routine_activity_reward BEFORE INSERT ON routine_activity_rewards FOR EACH ROW EXECUTE FUNCTION validate_routine_activity_reward();
CREATE FUNCTION immutable_routine_activity_reward() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN RAISE EXCEPTION 'Routine reward receipts are immutable'; END $$;
CREATE TRIGGER immutable_routine_activity_reward BEFORE UPDATE ON routine_activity_rewards FOR EACH ROW EXECUTE FUNCTION immutable_routine_activity_reward();
CREATE FUNCTION protect_routine_reward_deletion() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN RAISE EXCEPTION 'Reward receipt deletion requires account deletion'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER protect_routine_reward_deletion AFTER DELETE ON routine_activity_rewards DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION protect_routine_reward_deletion();
CREATE FUNCTION protect_daily_reward_transaction() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW IS DISTINCT FROM OLD AND EXISTS (SELECT 1 FROM routine_activity_rewards WHERE transaction_id = OLD.id) THEN
  RAISE EXCEPTION 'Daily reward transaction is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_daily_reward_transaction BEFORE UPDATE ON currency_transactions FOR EACH ROW EXECUTE FUNCTION protect_daily_reward_transaction();
COMMIT;
