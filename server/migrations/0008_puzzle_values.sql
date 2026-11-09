-- Per-player puzzle values (per-player §3.1). The 0002 dialect: every integer is BIGINT (Rust i64), times are unix
-- seconds, every constraint is named (tests assert (SQLSTATE, constraint)); the puzzle id CHECK is the PuzzleId
-- grammar (server/src/ids.rs), as in puzzle_progress / hint_unlocks.
-- `value` is BIGINT[], not an encoded text: the CHECKs hold its shape (one dimension, 1..64 entries, no NULL) and each
-- entry to the u16 an answer entry is, in the dialect's one integer type; it costs ~32 B per row more than text, and
-- values_row_size_measured (server/tests/it/puzzles.rs) measures the real row. The 64 is MAX_ANSWER_LEN
-- (server/src/puzzles/mod.rs).
-- Column order (m5): the fixed-width BIGINTs first, the nullable spent_at last of them, then the varlena columns, so
-- no padding falls between BIGINTs.
CREATE TABLE puzzle_values (                    -- one per-player value per (user, puzzle), and its current run
  user_id    BIGINT   NOT NULL,
  run        BIGINT   NOT NULL,                 -- 1 at the first draw; +1 at each restart and each forced re-draw
  wrong      BIGINT   NOT NULL,                 -- wrong answers applied in this run (the server's final-attempt count)
  issued_at  BIGINT   NOT NULL,                 -- when `value` was drawn
  spent_at   BIGINT,                            -- the final wrong answer of this run; NULL while the run is live
  puzzle_id  TEXT     NOT NULL,                 -- the puzzle's storage key, as in puzzle_progress / hint_unlocks
  domain     TEXT     NOT NULL,                 -- 16 hex: the domain `value` was drawn in (or still fits)
  value      BIGINT[] NOT NULL,
  CONSTRAINT puzzle_values_pkey           PRIMARY KEY (user_id, puzzle_id),
  CONSTRAINT puzzle_values_user_fk        FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT puzzle_values_id_shape       CHECK (puzzle_id ~ '^ch[1-9][0-9]*[.][a-z][a-z0-9_]*$'),
  CONSTRAINT puzzle_values_domain_shape   CHECK (domain ~ '^[0-9a-f]{16}$'),
  CONSTRAINT puzzle_values_value_shape    CHECK (array_ndims(value) = 1 AND cardinality(value) BETWEEN 1 AND 64
                                                 AND array_position(value, NULL) IS NULL),
  CONSTRAINT puzzle_values_value_range    CHECK (0 <= ALL (value) AND 65535 >= ALL (value)),
  CONSTRAINT puzzle_values_run_positive   CHECK (run >= 1),
  CONSTRAINT puzzle_values_wrong_nonneg   CHECK (wrong >= 0),
  CONSTRAINT puzzle_values_spent_after    CHECK (spent_at IS NULL OR spent_at >= issued_at),
  CONSTRAINT puzzle_values_time_positive  CHECK (issued_at > 0)
);
-- user_id leads the primary key: the foreign key is indexed.
