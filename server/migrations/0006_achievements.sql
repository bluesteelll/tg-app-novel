-- Achievement unlocks (META-PLAN M6). Same dialect as 0001-0005: every integer is BIGINT (Rust i64), times are unix
-- seconds, every constraint is named (tests assert (SQLSTATE, constraint)).
-- Display facts: an unlock grants nothing, and no unlock, content or grant path reads this table (principle 1). Written
-- by the card route alone, once per (user, story, achievement); never deleted, so a later edit of a condition or a
-- refund hides an unlock (M7) instead of removing it.
-- The id CHECKs are the StoryId grammar (server/src/ids.rs) and the achievement id grammar (M4), anchored at both ends.
CREATE TABLE achievement_unlocks (
  user_id        BIGINT NOT NULL,
  story_id       TEXT   NOT NULL,
  achievement_id TEXT   NOT NULL,
  unlocked_at    BIGINT NOT NULL,              -- server clock (clock.rs): the card request that first met it
  CONSTRAINT achievement_unlocks_pkey           PRIMARY KEY (user_id, story_id, achievement_id),
  CONSTRAINT achievement_unlocks_user_fk        FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT achievement_unlocks_story_id_shape CHECK (story_id ~ '^[a-z][a-z0-9_]{0,23}$'),
  CONSTRAINT achievement_unlocks_id_shape       CHECK (achievement_id ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT achievement_unlocks_time_positive  CHECK (unlocked_at > 0)
);
-- user_id leads the primary key: the foreign key is indexed, and one user's unlocks of one story are a key prefix.
