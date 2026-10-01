BEGIN;


-- CreateTable
CREATE TABLE "avatar_products" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "slot" TEXT,
    "occupies_slots" TEXT[],
    "render_key" TEXT NOT NULL,
    "ownership_scope" TEXT NOT NULL,
    "scope_character_id" TEXT,
    "sale_status" TEXT NOT NULL,
    "price" INTEGER,
    "price_provisional" BOOLEAN NOT NULL DEFAULT false,
    "catalog_revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "avatar_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avatar_combinations" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "pose_id" TEXT NOT NULL,

    CONSTRAINT "avatar_combinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avatar_combination_items" (
    "combination_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,

    CONSTRAINT "avatar_combination_items_pkey" PRIMARY KEY ("combination_id","product_id")
);

-- CreateTable
CREATE TABLE "avatar_ownerships" (
    "user_id" UUID NOT NULL,
    "product_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "acquired_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avatar_ownerships_pkey" PRIMARY KEY ("user_id","product_id")
);

-- CreateTable
CREATE TABLE "avatar_outfits" (
    "user_id" UUID NOT NULL,
    "combination_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avatar_outfits_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "avatar_purchases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "product_id" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "catalog_revision" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avatar_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "purchase_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "avatar_purchases_user_id_key_key" ON "avatar_purchases"("user_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "avatar_purchases_user_id_product_id_key" ON "avatar_purchases"("user_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "currency_transactions_purchase_id_key" ON "currency_transactions"("purchase_id");

-- CreateIndex
CREATE UNIQUE INDEX "currency_transactions_user_id_event_key_key" ON "currency_transactions"("user_id", "event_key");

-- AddForeignKey
ALTER TABLE "avatar_combinations" ADD CONSTRAINT "avatar_combinations_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "avatar_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "avatar_combinations" ADD CONSTRAINT "avatar_combinations_pose_id_fkey" FOREIGN KEY ("pose_id") REFERENCES "avatar_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "avatar_combination_items" ADD CONSTRAINT "avatar_combination_items_combination_id_fkey" FOREIGN KEY ("combination_id") REFERENCES "avatar_combinations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "avatar_combination_items" ADD CONSTRAINT "avatar_combination_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "avatar_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "avatar_ownerships" ADD CONSTRAINT "avatar_ownerships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "avatar_ownerships" ADD CONSTRAINT "avatar_ownerships_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "avatar_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "avatar_outfits" ADD CONSTRAINT "avatar_outfits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "avatar_outfits" ADD CONSTRAINT "avatar_outfits_combination_id_fkey" FOREIGN KEY ("combination_id") REFERENCES "avatar_combinations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "avatar_purchases" ADD CONSTRAINT "avatar_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "avatar_purchases" ADD CONSTRAINT "avatar_purchases_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "avatar_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "currency_transactions" ADD CONSTRAINT "currency_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "currency_transactions" ADD CONSTRAINT "currency_transactions_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "avatar_purchases"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE avatar_products ALTER COLUMN occupies_slots SET NOT NULL;
ALTER TABLE avatar_products ADD CHECK (kind IN ('character', 'pose', 'clothing')),
 ADD CHECK (ownership_scope IN ('pending', 'shared', 'character')),
 ADD CHECK ((ownership_scope = 'character') = (scope_character_id IS NOT NULL)),
 ADD CHECK (sale_status IN ('default', 'on_sale', 'held', 'retired')),
 ADD CHECK (price IS NULL OR price > 0),
 ADD CHECK (id NOT IN ('character.cream', 'character.gray', 'pose.basic') OR (sale_status = 'default' AND price IS NULL)),
 ADD CHECK (kind <> 'clothing' OR occupies_slots = ARRAY[slot]),
 ADD CHECK (catalog_revision > 0),
 ADD CHECK (sale_status <> 'on_sale' OR (price IS NOT NULL AND ownership_scope <> 'pending' AND kind <> 'character')),
 ADD CHECK ((kind = 'clothing' AND slot IN ('hat', 'top', 'bottom') AND cardinality(occupies_slots) > 0)
   OR (kind <> 'clothing' AND slot IS NULL AND cardinality(occupies_slots) = 0)),
 ADD CHECK (occupies_slots <@ ARRAY['hat', 'top', 'bottom']::text[] AND array_position(occupies_slots, NULL) IS NULL),
 ADD CONSTRAINT avatar_products_scope_fkey FOREIGN KEY (scope_character_id) REFERENCES avatar_products(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE avatar_ownerships ADD CHECK (source IN ('default', 'purchase'));
ALTER TABLE avatar_outfits ADD CHECK (revision > 0);
ALTER TABLE avatar_purchases ADD CHECK (price > 0), ADD CHECK (catalog_revision > 0);
ALTER TABLE currency_transactions ADD CHECK (balance_after >= 0),
 ADD CHECK ((kind = 'purchase' AND amount < 0 AND purchase_id IS NOT NULL)
   OR (kind = 'grant' AND amount > 0 AND purchase_id IS NULL));

-- Structural SKU identity cannot change after registration. A pending policy may
-- be resolved before sale, but never reinterprets already acquired ownership.
CREATE FUNCTION avatar_product_update() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF (NEW.id, NEW.kind, NEW.slot, NEW.occupies_slots, NEW.render_key)
   IS DISTINCT FROM (OLD.id, OLD.kind, OLD.slot, OLD.occupies_slots, OLD.render_key) THEN
   RAISE EXCEPTION 'Avatar SKU identity is immutable';
 END IF;
 IF (NEW.ownership_scope, NEW.scope_character_id) IS DISTINCT FROM (OLD.ownership_scope, OLD.scope_character_id)
   AND (OLD.ownership_scope <> 'pending' OR EXISTS (SELECT 1 FROM avatar_ownerships WHERE product_id = OLD.id)) THEN
   RAISE EXCEPTION 'Acquired ownership policy is immutable';
 END IF;
 IF (NEW.price, NEW.sale_status, NEW.price_provisional, NEW.ownership_scope, NEW.scope_character_id)
   IS DISTINCT FROM (OLD.price, OLD.sale_status, OLD.price_provisional, OLD.ownership_scope, OLD.scope_character_id) THEN
   NEW.catalog_revision := OLD.catalog_revision + 1;
 ELSE
   NEW.catalog_revision := OLD.catalog_revision;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER avatar_product_update BEFORE UPDATE ON avatar_products FOR EACH ROW EXECUTE FUNCTION avatar_product_update();

-- Verified against FE mascot-poses.js, wardrobe.js and existing PNG files on
-- 2026-09-30. No separated clothing assets are registered or inferred.
INSERT INTO avatar_products (id, kind, slot, occupies_slots, render_key, ownership_scope, sale_status, price, price_provisional) VALUES
('character.cream', 'character', NULL, ARRAY[]::text[], 'cream', 'shared', 'default', NULL, false),
('character.gray', 'character', NULL, ARRAY[]::text[], 'gray', 'shared', 'default', NULL, false),
('pose.basic', 'pose', NULL, ARRAY[]::text[], 'basic', 'shared', 'default', NULL, false),
('pose.curious', 'pose', NULL, ARRAY[]::text[], 'curious', 'shared', 'on_sale', 50, true),
('pose.a-plus', 'pose', NULL, ARRAY[]::text[], 'a-plus', 'shared', 'on_sale', 60, true),
('pose.drink', 'pose', NULL, ARRAY[]::text[], 'drink', 'shared', 'on_sale', 50, true),
('pose.lying', 'pose', NULL, ARRAY[]::text[], 'lying', 'shared', 'on_sale', 50, true),
('pose.stretch', 'pose', NULL, ARRAY[]::text[], 'stretch', 'shared', 'on_sale', 60, true),
('pose.run', 'pose', NULL, ARRAY[]::text[], 'run', 'shared', 'on_sale', 70, true),
('pose.passion', 'pose', NULL, ARRAY[]::text[], 'passion', 'shared', 'on_sale', 60, true),
('pose.victory', 'pose', NULL, ARRAY[]::text[], 'victory', 'shared', 'on_sale', 60, true),
('pose.pushup', 'pose', NULL, ARRAY[]::text[], 'pushup', 'shared', 'on_sale', 70, true),
('pose.situp', 'pose', NULL, ARRAY[]::text[], 'situp', 'shared', 'on_sale', 70, true),
('pose.droopy', 'pose', NULL, ARRAY[]::text[], 'droopy', 'shared', 'on_sale', 50, true),
('pose.cant-hear', 'pose', NULL, ARRAY[]::text[], 'cant-hear', 'shared', 'on_sale', 50, true);
INSERT INTO avatar_combinations (id, character_id, pose_id) VALUES
('["character.cream","pose.basic",[]]', 'character.cream', 'pose.basic'),
('["character.cream","pose.curious",[]]', 'character.cream', 'pose.curious'),
('["character.cream","pose.a-plus",[]]', 'character.cream', 'pose.a-plus'),
('["character.cream","pose.drink",[]]', 'character.cream', 'pose.drink'),
('["character.cream","pose.lying",[]]', 'character.cream', 'pose.lying'),
('["character.cream","pose.stretch",[]]', 'character.cream', 'pose.stretch'),
('["character.cream","pose.run",[]]', 'character.cream', 'pose.run'),
('["character.cream","pose.passion",[]]', 'character.cream', 'pose.passion'),
('["character.cream","pose.victory",[]]', 'character.cream', 'pose.victory'),
('["character.cream","pose.pushup",[]]', 'character.cream', 'pose.pushup'),
('["character.cream","pose.situp",[]]', 'character.cream', 'pose.situp'),
('["character.cream","pose.droopy",[]]', 'character.cream', 'pose.droopy'),
('["character.cream","pose.cant-hear",[]]', 'character.cream', 'pose.cant-hear'),
('["character.gray","pose.basic",[]]', 'character.gray', 'pose.basic'),
('["character.gray","pose.curious",[]]', 'character.gray', 'pose.curious'),
('["character.gray","pose.a-plus",[]]', 'character.gray', 'pose.a-plus'),
('["character.gray","pose.drink",[]]', 'character.gray', 'pose.drink'),
('["character.gray","pose.lying",[]]', 'character.gray', 'pose.lying'),
('["character.gray","pose.stretch",[]]', 'character.gray', 'pose.stretch'),
('["character.gray","pose.run",[]]', 'character.gray', 'pose.run'),
('["character.gray","pose.passion",[]]', 'character.gray', 'pose.passion'),
('["character.gray","pose.victory",[]]', 'character.gray', 'pose.victory'),
('["character.gray","pose.pushup",[]]', 'character.gray', 'pose.pushup'),
('["character.gray","pose.situp",[]]', 'character.gray', 'pose.situp'),
('["character.gray","pose.droopy",[]]', 'character.gray', 'pose.droopy'),
('["character.gray","pose.cant-hear",[]]', 'character.gray', 'pose.cant-hear');

-- Reusable repair function inserts only missing defaults, never updates currency,
-- ownership provenance, revision, timestamps or a previously saved outfit.
CREATE FUNCTION initialize_avatar(target_user uuid) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 INSERT INTO avatar_ownerships (user_id, product_id, source)
 SELECT target_user, id, 'default' FROM avatar_products
 WHERE id IN ('character.cream', 'character.gray', 'pose.basic')
 ON CONFLICT (user_id, product_id) DO NOTHING;
 INSERT INTO avatar_outfits (user_id, combination_id)
 VALUES (target_user, '["character.cream","pose.basic",[]]')
 ON CONFLICT (user_id) DO NOTHING;
END $$;
LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;
SELECT initialize_avatar(id) FROM users;
CREATE FUNCTION initialize_new_user_avatar() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 PERFORM initialize_avatar(NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER initialize_new_user_avatar AFTER INSERT ON users
 FOR EACH ROW EXECUTE FUNCTION initialize_new_user_avatar();

-- Registered combinations are append-only: editing one would silently alter
-- every saved outfit that references it. Register a new ID instead.
CREATE FUNCTION immutable_avatar_combination() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 RAISE EXCEPTION 'Registered avatar combinations are immutable';
END $$;
CREATE TRIGGER immutable_avatar_combination BEFORE UPDATE OR DELETE ON avatar_combinations
 FOR EACH ROW EXECUTE FUNCTION immutable_avatar_combination();
CREATE TRIGGER immutable_avatar_combination_item BEFORE UPDATE OR DELETE ON avatar_combination_items
 FOR EACH ROW EXECUTE FUNCTION immutable_avatar_combination();
-- Appending an item to an existing recipe also changes its meaning. Only allow
-- it in the same transaction that registers the parent combination.
CREATE FUNCTION insert_avatar_combination_item() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM avatar_combinations WHERE id = NEW.combination_id AND xmin::text = pg_current_xact_id()::text) THEN
   RAISE EXCEPTION 'Register combination and items in one transaction';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER insert_avatar_combination_item BEFORE INSERT ON avatar_combination_items
 FOR EACH ROW EXECUTE FUNCTION insert_avatar_combination_item();
COMMIT;
