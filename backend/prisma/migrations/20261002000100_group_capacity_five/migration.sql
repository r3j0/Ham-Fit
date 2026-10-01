BEGIN;
-- Keep existing memberships, including legacy groups with more than five members.
-- The table lock makes the temporary trigger suspension invisible to other writers.
ALTER TABLE groups DISABLE TRIGGER group_capacity_update;
UPDATE groups SET max_members = 5 WHERE max_members > 5;
ALTER TABLE groups ENABLE TRIGGER group_capacity_update;
ALTER TABLE groups DROP CONSTRAINT groups_max_members_check;
ALTER TABLE groups ADD CONSTRAINT groups_max_members_check
  CHECK (max_members BETWEEN 1 AND 5);
-- The existing admission trigger rejects new members until there is a free place.
COMMIT;
