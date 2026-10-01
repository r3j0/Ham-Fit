BEGIN;
-- User-approved hamster-outputter-v2 registry, FE request 6e600bf (2026-10-01).
-- Keep permanent IDs, previous purchases/ownership and saved combinations.
UPDATE avatar_products SET price = approved.price, price_provisional = false
FROM (VALUES
 ('pose.curious',50),('pose.drink',50),('pose.lying',50),('pose.stretch',50),
 ('pose.droopy',50),('pose.cant-hear',50),('pose.passion',70),('pose.victory',70),
 ('pose.run',70),('pose.pushup',70),('pose.situp',70)
) AS approved(id,price)
WHERE avatar_products.id = approved.id;
UPDATE avatar_products SET sale_status = 'retired', price = NULL, price_provisional = false WHERE id = 'pose.a-plus';

INSERT INTO avatar_products (id, kind, slot, occupies_slots, render_key, ownership_scope, scope_character_id, sale_status, price, price_provisional) VALUES
 ('pose.foam-roller','pose',NULL,ARRAY[]::text[],'foam-roller','shared',NULL,'on_sale',50,false),
 ('pose.phone','pose',NULL,ARRAY[]::text[],'phone','shared',NULL,'on_sale',50,false),
 ('pose.toilet','pose',NULL,ARRAY[]::text[],'toilet','shared',NULL,'on_sale',50,false),
 ('pose.weight','pose',NULL,ARRAY[]::text[],'weight','shared',NULL,'on_sale',70,false),
 ('clothing.mint-shirt','clothing','top',ARRAY['top']::text[],'mint-shirt','shared',NULL,'on_sale',25,false);

INSERT INTO avatar_combinations(id,character_id,pose_id)
SELECT format('["%s","%s",[]]',c.id,p.id),c.id,p.id
FROM (VALUES ('character.cream'),('character.gray')) c(id)
CROSS JOIN (VALUES ('pose.foam-roller'),('pose.phone'),('pose.toilet'),('pose.weight')) p(id);
INSERT INTO avatar_combinations(id,character_id,pose_id)
SELECT format('["%s","pose.basic",["clothing.mint-shirt"]]',id),id,'pose.basic'
FROM (VALUES ('character.cream'),('character.gray')) c(id);
INSERT INTO avatar_combination_items(combination_id,product_id)
SELECT format('["%s","pose.basic",["clothing.mint-shirt"]]',id),'clothing.mint-shirt'
FROM (VALUES ('character.cream'),('character.gray')) c(id);
COMMIT;
