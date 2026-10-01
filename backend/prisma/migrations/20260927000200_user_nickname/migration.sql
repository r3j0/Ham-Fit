BEGIN;

-- Preserve existing accounts without inventing display names. Nicknames are
-- not unique identifiers; multiple accounts may share the same nickname.
ALTER TABLE users ADD COLUMN nickname VARCHAR(20);
ALTER TABLE users ADD CONSTRAINT user_nickname_valid CHECK (
  nickname IS NULL OR (
    char_length(nickname) BETWEEN 2 AND 20
    AND nickname !~ '[^가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9_]'
  )
);

COMMIT;
