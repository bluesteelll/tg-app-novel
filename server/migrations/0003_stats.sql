-- Statistics (STORIES-PLAN Y8-Y11, META-PLAN M1). Same dialect as 0001 / 0002: every integer is BIGINT (Rust i64),
-- times are unix seconds, every constraint is named (tests assert (SQLSTATE, constraint)).
-- An append-only log of client-reported facts: never read by an unlock, content or grant path (STORIES-PLAN ST4).
-- Membership in the current story index is checked in code: the index changes with builds, and old rows stay valid
-- history, filtered at read (ST6).
-- A CHECK passes when its expression is NULL, and `NULL ~ '...'` and `NULL IN (...)` are NULL: so every regex or IN
-- test of a nullable column below carries its own IS NOT NULL, or a missing subject or outcome would be accepted.
CREATE TABLE stat_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id       BIGINT NOT NULL,
  event_id      TEXT   NOT NULL,                 -- client UUID v4 (crypto.randomUUID), the idempotency key
  kind          TEXT   NOT NULL,
  story_id      TEXT   NOT NULL,                 -- derived by the server from chapter_id, never sent
  chapter_id    TEXT   NOT NULL,
  subject       TEXT,                            -- ending name | PuzzleId | the picked option's line ID | NULL
  outcome       TEXT,                            -- puzzle_ended only
  story_version TEXT   NOT NULL,
  age_ms        BIGINT NOT NULL,                 -- client-measured age at send; occurred ~ received_at - age
  received_at   BIGINT NOT NULL,                 -- server clock (clock.rs), the time of record
  CONSTRAINT stat_events_pkey                PRIMARY KEY (id),
  CONSTRAINT stat_events_user_fk             FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT stat_events_event_key           UNIQUE (user_id, event_id),
  CONSTRAINT stat_events_event_id_shape      CHECK (event_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT stat_events_kind_known          CHECK (kind IN ('chapter_started', 'chapter_completed', 'ending_reached',
                                                             'puzzle_ended', 'choice_made')),
  CONSTRAINT stat_events_story_id_shape      CHECK (story_id ~ '^[a-z][a-z0-9_]{0,23}$'),
  CONSTRAINT stat_events_chapter_id_shape    CHECK (chapter_id ~ '^ch[1-9][0-9]*$'),
  CONSTRAINT stat_events_subject_by_kind     CHECK (
       (kind IN ('chapter_started', 'chapter_completed') AND subject IS NULL AND outcome IS NULL)
    OR (kind = 'ending_reached' AND subject IS NOT NULL AND subject ~ '^[a-z][a-z0-9_]{0,31}$' AND outcome IS NULL)
    OR (kind = 'puzzle_ended' AND subject IS NOT NULL AND subject ~ '^ch[1-9][0-9]*[.][a-z][a-z0-9_]*$'
        AND outcome IS NOT NULL AND outcome IN ('solved', 'failed', 'abandoned'))
    OR (kind = 'choice_made' AND subject IS NOT NULL
        AND subject ~ '^ch[1-9][0-9]*[.][a-z][a-z0-9_]*[.][0-9a-z]{4}$' AND outcome IS NULL)),
  CONSTRAINT stat_events_choice_in_chapter   CHECK (kind <> 'choice_made' OR split_part(subject, '.', 1) = chapter_id),
  CONSTRAINT stat_events_story_version_shape CHECK (story_version ~ '^[0-9a-f]{16}$'),
  CONSTRAINT stat_events_age_bounded         CHECK (age_ms BETWEEN 0 AND 2592000000),
  CONSTRAINT stat_events_received_positive   CHECK (received_at > 0)
);
-- The read ("X of Y") and the first-pick lookup: an index-only scan of one user's distinct facts.
CREATE INDEX stat_events_by_user_story ON stat_events (user_id, story_id, kind, chapter_id, subject);
-- The rolling-hour budget count.
CREATE INDEX stat_events_by_user_time ON stat_events (user_id, received_at);
-- stat_events.user_id is the leading column of stat_events_event_key: the FK is indexed.
