BEGIN;
-- Preserve default/purchase provenance; roulette is a grant, never a purchase.
ALTER TABLE avatar_ownerships DROP CONSTRAINT avatar_ownerships_source_check;
ALTER TABLE avatar_ownerships ADD CONSTRAINT avatar_ownerships_source_check
  CHECK (source IN ('default', 'purchase', 'streak_roulette'));

CREATE TABLE streak_roulette_draws (
  id UUID PRIMARY KEY,
  ticket_id UUID NOT NULL UNIQUE REFERENCES streak_roulette_tickets(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  key UUID NOT NULL,
  policy_version TEXT NOT NULL,
  result TEXT NOT NULL,
  actual_kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  product_id TEXT REFERENCES avatar_products(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transaction_id UUID UNIQUE REFERENCES currency_transactions(id) ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  fallback_reason TEXT,
  drawn_at TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT streak_roulette_draws_user_id_product_id_fkey FOREIGN KEY (user_id,product_id)
    REFERENCES avatar_ownerships(user_id,product_id) ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK ((
    (result = 'seeds_1' AND actual_kind = 'seeds' AND amount = 1 AND fallback_reason IS NULL) OR
    (result = 'seeds_3' AND actual_kind = 'seeds' AND amount = 3 AND fallback_reason IS NULL) OR
    (result = 'seeds_5' AND actual_kind = 'seeds' AND amount = 5 AND fallback_reason IS NULL) OR
    (result = 'seeds_10' AND actual_kind = 'seeds' AND amount = 10 AND fallback_reason IS NULL) OR
    (result IN ('clothing','pose') AND actual_kind = result AND amount = 1 AND fallback_reason IS NULL) OR
    (result = 'clothing' AND actual_kind = 'seeds' AND amount = 50 AND fallback_reason = 'no_eligible_product') OR
    (result = 'pose' AND actual_kind = 'seeds' AND amount = 70 AND fallback_reason = 'no_eligible_product')
  ) IS TRUE),
  CHECK ((actual_kind = 'seeds' AND transaction_id IS NOT NULL AND product_id IS NULL)
    OR (actual_kind IN ('clothing','pose') AND transaction_id IS NULL AND product_id IS NOT NULL))
);
CREATE UNIQUE INDEX streak_roulette_draws_user_id_key_key ON streak_roulette_draws(user_id,key);
CREATE INDEX streak_roulette_draws_user_id_id_idx ON streak_roulette_draws(user_id,id);
CREATE TRIGGER immutable_streak_draw BEFORE UPDATE ON streak_roulette_draws
  FOR EACH ROW EXECUTE FUNCTION immutable_streak_roulette_row();

-- Match the receipt to its owner, retained policy and actual grant. These
-- cross-table rules supplement CHECK/FK/UNIQUE constraints, without changing
-- existing purchase/default/group reward behavior.
CREATE FUNCTION validate_streak_draw() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM streak_roulette_tickets t WHERE t.id = NEW.ticket_id
    AND t.user_id = NEW.user_id AND t.policy_version = NEW.policy_version AND t.created_at <= NEW.drawn_at) THEN
    RAISE EXCEPTION 'Streak draw must match its ticket';
  END IF;
  IF NEW.actual_kind = 'seeds' AND NOT EXISTS (
    SELECT 1 FROM currency_transactions c WHERE c.id = NEW.transaction_id AND c.user_id = NEW.user_id
    AND c.kind = 'grant' AND c.amount = NEW.amount AND c.event_key = 'streak-roulette:' || NEW.id::text
  ) THEN RAISE EXCEPTION 'Streak currency grant does not match receipt'; END IF;
  IF NEW.actual_kind IN ('clothing','pose') AND NOT EXISTS (
    SELECT 1 FROM avatar_products p JOIN avatar_ownerships o ON o.product_id = p.id
    WHERE p.id = NEW.product_id AND p.kind = NEW.actual_kind AND p.sale_status = 'on_sale'
      AND o.user_id = NEW.user_id AND o.source = 'streak_roulette' AND o.acquired_at = NEW.drawn_at
  ) THEN RAISE EXCEPTION 'Streak item grant does not match receipt'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_streak_draw BEFORE INSERT ON streak_roulette_draws
  FOR EACH ROW EXECUTE FUNCTION validate_streak_draw();
COMMIT;
