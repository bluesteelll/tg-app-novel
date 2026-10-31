-- Puzzles (PUZZLES-PLAN X5-X7, META-PLAN M21). Same dialect as 0001: every integer is BIGINT (Rust i64), times are
-- unix seconds, every constraint is named (tests assert (SQLSTATE, constraint)).
-- The puzzle id CHECKs are the PuzzleId grammar (server/src/ids.rs): ch<N> '.' a local id. PostgreSQL bracket ranges
-- are code-point ranges whatever the database collation, so a non-ASCII letter is refused on every host.
CREATE TABLE puzzle_progress (                  -- server facts per (user, puzzle): the attempt window + the solve
  user_id         BIGINT NOT NULL,
  puzzle_id       TEXT   NOT NULL,
  attempts        BIGINT NOT NULL,              -- lifetime; a row exists only after one
  window_start    BIGINT NOT NULL,
  window_attempts BIGINT NOT NULL,
  first_at        BIGINT NOT NULL,
  solved_at       BIGINT,                       -- set once (guarded update), never cleared
  CONSTRAINT puzzle_progress_pkey               PRIMARY KEY (user_id, puzzle_id),
  CONSTRAINT puzzle_progress_user_fk            FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT puzzle_progress_id_shape           CHECK (puzzle_id ~ '^ch[1-9][0-9]*[.][a-z][a-z0-9_]*$'),
  CONSTRAINT puzzle_progress_attempts_positive  CHECK (attempts >= 1),
  CONSTRAINT puzzle_progress_window_bounded     CHECK (window_attempts >= 1 AND window_attempts <= attempts),
  CONSTRAINT puzzle_progress_solved_after_first CHECK (solved_at IS NULL OR solved_at >= first_at),
  CONSTRAINT puzzle_progress_window_after_first CHECK (window_start >= first_at)
);

CREATE TABLE hint_unlocks (                     -- a hint tier the user unlocked from a balance (META-PLAN M21)
  user_id     BIGINT NOT NULL,
  puzzle_id   TEXT   NOT NULL,
  tier        BIGINT NOT NULL,
  unlocked_at BIGINT NOT NULL,
  CONSTRAINT hint_unlocks_pkey          PRIMARY KEY (user_id, puzzle_id, tier),
  CONSTRAINT hint_unlocks_user_fk       FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT hint_unlocks_id_shape      CHECK (puzzle_id ~ '^ch[1-9][0-9]*[.][a-z][a-z0-9_]*$'),
  CONSTRAINT hint_unlocks_tier_range    CHECK (tier BETWEEN 1 AND 3),
  CONSTRAINT hint_unlocks_time_positive CHECK (unlocked_at > 0)
);
-- user_id leads both primary keys: the foreign keys are indexed.
