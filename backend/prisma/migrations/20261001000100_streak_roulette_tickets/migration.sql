BEGIN;
CREATE TABLE streak_roulette_policies (
  version TEXT PRIMARY KEY,
  snapshot JSONB NOT NULL
);
INSERT INTO streak_roulette_policies VALUES ('streak-2026-10-01-v1',
  '[{"result":"seeds_1","weight":600,"amount":1},{"result":"seeds_3","weight":250,"amount":3},{"result":"seeds_5","weight":100,"amount":5},{"result":"seeds_10","weight":43,"amount":10},{"result":"clothing","weight":6,"amount":50},{"result":"pose","weight":1,"amount":70}]');
CREATE FUNCTION immutable_streak_roulette_row() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  RAISE EXCEPTION 'Streak roulette evidence and policies are immutable';
END $$;
CREATE TRIGGER immutable_streak_policy BEFORE UPDATE OR DELETE ON streak_roulette_policies
  FOR EACH ROW EXECUTE FUNCTION immutable_streak_roulette_row();

CREATE UNIQUE INDEX activity_achievements_id_user_id_korean_date_key ON activity_achievements(id,user_id,korean_date);
CREATE TABLE streak_roulette_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  achievement_id UUID NOT NULL UNIQUE,
  korean_date DATE NOT NULL,
  segment_start_date DATE NOT NULL,
  streak_days INTEGER NOT NULL CHECK (streak_days > 0 AND streak_days % 5 = 0),
  created_at TIMESTAMPTZ(6) NOT NULL,
  policy_version TEXT NOT NULL REFERENCES streak_roulette_policies(version) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT streak_ticket_achievement_fkey FOREIGN KEY (achievement_id,user_id,korean_date)
    REFERENCES activity_achievements(id,user_id,korean_date) ON DELETE CASCADE ON UPDATE RESTRICT,
  CHECK (korean_date = segment_start_date + (streak_days - 1)),
  CHECK (korean_date = (created_at AT TIME ZONE 'Asia/Seoul')::date)
);
CREATE UNIQUE INDEX streak_roulette_tickets_user_id_korean_date_key ON streak_roulette_tickets(user_id,korean_date);
CREATE UNIQUE INDEX streak_roulette_tickets_user_id_segment_start_date_streak_days_key ON streak_roulette_tickets(user_id,segment_start_date,streak_days);
CREATE INDEX streak_roulette_tickets_user_id_id_idx ON streak_roulette_tickets(user_id,id);
CREATE TRIGGER immutable_streak_ticket BEFORE UPDATE ON streak_roulette_tickets
  FOR EACH ROW EXECUTE FUNCTION immutable_streak_roulette_row();
COMMIT;
