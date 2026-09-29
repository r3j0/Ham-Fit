BEGIN;
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 50),
  description VARCHAR(500) NOT NULL,
  max_members INTEGER NOT NULL CHECK (max_members BETWEEN 1 AND 100),
  leader_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  invite_code VARCHAR(43) NOT NULL UNIQUE CHECK (invite_code ~ '^[A-Za-z0-9_-]{43}$'),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX groups_leader_user_id_idx ON groups(leader_user_id);
CREATE TABLE group_memberships (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  joined_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_memberships_user_id_group_id_idx ON group_memberships(user_id, group_id);
-- Exactly one leader and that leader MUST be a current member at every commit.
-- Deferral permits atomic group creation and whole-group cascade deletion.
ALTER TABLE groups ADD CONSTRAINT groups_leader_membership_fk
  FOREIGN KEY (id, leader_user_id) REFERENCES group_memberships(group_id, user_id)
  ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

-- Defense in depth for internal writers as well as the API's group lock.
CREATE FUNCTION check_group_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE capacity INTEGER; total INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'groups' THEN
    EXECUTE format('SELECT count(*) FROM %I.group_memberships WHERE group_id = $1', TG_TABLE_SCHEMA)
      INTO total USING NEW.id;
    IF total > NEW.max_members THEN
      RAISE EXCEPTION 'Group capacity exceeded.' USING ERRCODE = '23514';
    END IF;
  ELSE
    EXECUTE format('SELECT max_members FROM %I.groups WHERE id = $1 FOR UPDATE', TG_TABLE_SCHEMA)
      INTO capacity USING NEW.group_id;
    EXECUTE format('SELECT count(*) FROM %I.group_memberships WHERE group_id = $1', TG_TABLE_SCHEMA)
      INTO total USING NEW.group_id;
    IF total >= capacity THEN
      RAISE EXCEPTION 'Group capacity exceeded.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER group_membership_capacity BEFORE INSERT ON group_memberships
FOR EACH ROW EXECUTE FUNCTION check_group_capacity();
CREATE TRIGGER group_capacity_update BEFORE UPDATE OF max_members ON groups
FOR EACH ROW EXECUTE FUNCTION check_group_capacity();
-- Membership identities cannot be moved into another group to bypass admission.
CREATE TRIGGER group_membership_immutable BEFORE UPDATE ON group_memberships
FOR EACH ROW EXECUTE FUNCTION protect_curriculum_definition();

CREATE TABLE group_create_requests (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  key UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE group_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  request_key UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ(6),
  CHECK ((status = 'pending') = (processed_at IS NULL)),
  CONSTRAINT group_join_requests_user_id_request_key_key UNIQUE (user_id, request_key)
);
CREATE UNIQUE INDEX group_join_requests_pending_key ON group_join_requests(group_id, user_id) WHERE status = 'pending';
CREATE INDEX group_join_requests_group_id_status_id_idx ON group_join_requests(group_id, status, id);
CREATE TABLE group_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  request_id UUID NOT NULL REFERENCES group_join_requests(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('join_requested', 'join_approved', 'join_rejected')),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMPTZ(6),
  CONSTRAINT group_notifications_request_id_type_key UNIQUE (request_id, type)
);
CREATE INDEX group_notifications_user_id_id_idx ON group_notifications(user_id, id);
COMMIT;
