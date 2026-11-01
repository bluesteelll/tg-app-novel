-- The social graph (META-PLAN M10-M12, M15; revision 1: C1, W1). Same dialect as 0001-0004: every integer is BIGINT
-- (Rust i64), times are unix seconds, every constraint is named (tests assert (SQLSTATE, constraint)). A link holder
-- asks, the code's owner accepts (friend_requests -> friendships); a decline or removal is durable (friend_blocks);
-- other users only ever receive a handle (user_handles), never a Telegram id.
CREATE TABLE invite_codes (
  code       TEXT   NOT NULL,
  user_id    BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  revoked_at BIGINT,
  CONSTRAINT invite_codes_pkey          PRIMARY KEY (code),
  CONSTRAINT invite_codes_user_fk       FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT invite_codes_shape         CHECK (code ~ '^[0-9a-f]{32}$'),
  CONSTRAINT invite_codes_revoked_after CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE UNIQUE INDEX invite_codes_one_active ON invite_codes (user_id) WHERE revoked_at IS NULL;
CREATE INDEX invite_codes_by_user ON invite_codes (user_id, created_at);       -- FK index; rotations per day
CREATE TABLE friend_requests (                  -- revision 1 (C1): the holder asks, the owner accepts
  from_id    BIGINT NOT NULL,                   -- the requester: a holder of to_id's invite code who tapped Send
  to_id      BIGINT NOT NULL,                   -- the code's owner, who accepts or declines this person
  created_at BIGINT NOT NULL,
  CONSTRAINT friend_requests_pkey     PRIMARY KEY (from_id, to_id),
  CONSTRAINT friend_requests_from_fk  FOREIGN KEY (from_id) REFERENCES users (id),
  CONSTRAINT friend_requests_to_fk    FOREIGN KEY (to_id) REFERENCES users (id),
  CONSTRAINT friend_requests_not_self CHECK (from_id <> to_id)
);
CREATE INDEX friend_requests_by_to ON friend_requests (to_id);
CREATE TABLE friendships (
  user_lo    BIGINT NOT NULL,
  user_hi    BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT friendships_pkey    PRIMARY KEY (user_lo, user_hi),
  CONSTRAINT friendships_lo_fk   FOREIGN KEY (user_lo) REFERENCES users (id),
  CONSTRAINT friendships_hi_fk   FOREIGN KEY (user_hi) REFERENCES users (id),
  CONSTRAINT friendships_ordered CHECK (user_lo < user_hi)       -- one row per pair, whoever accepted
);
CREATE INDEX friendships_by_hi ON friendships (user_hi);
CREATE TABLE friend_blocks (                    -- revision 1 (C1): a decline or a removal is durable
  user_id    BIGINT NOT NULL,                   -- the remover
  blocked_id BIGINT NOT NULL,                   -- whose requests to user_id now create nothing
  created_at BIGINT NOT NULL,
  CONSTRAINT friend_blocks_pkey       PRIMARY KEY (user_id, blocked_id),
  CONSTRAINT friend_blocks_user_fk    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT friend_blocks_blocked_fk FOREIGN KEY (blocked_id) REFERENCES users (id),
  CONSTRAINT friend_blocks_not_self   CHECK (user_id <> blocked_id)
);
CREATE INDEX friend_blocks_by_blocked ON friend_blocks (blocked_id);   -- FK index
CREATE TABLE user_handles (                     -- revision 1 (W1): the only user id other users receive
  user_id BIGINT NOT NULL,
  handle  TEXT   NOT NULL,
  CONSTRAINT user_handles_pkey    PRIMARY KEY (user_id),
  CONSTRAINT user_handles_user_fk FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT user_handles_handle  UNIQUE (handle),
  CONSTRAINT user_handles_shape   CHECK (handle ~ '^[0-9a-f]{24}$')
);
CREATE TABLE consents (                         -- append-only; the latest row per (user, purpose) wins
  id             BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id        BIGINT  NOT NULL,
  purpose        TEXT    NOT NULL,
  granted        BOOLEAN NOT NULL,
  policy_version TEXT    NOT NULL,
  text_version   TEXT    NOT NULL,
  at             BIGINT  NOT NULL,
  CONSTRAINT consents_pkey                 PRIMARY KEY (id),
  CONSTRAINT consents_user_fk              FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT consents_purpose_known        CHECK (purpose IN ('friends_profile')),
  CONSTRAINT consents_policy_version_shape CHECK (policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?$'),
  CONSTRAINT consents_text_version_shape   CHECK (text_version ~ '^[a-z_]+[.]v[1-9][0-9]*$')
);
CREATE INDEX consents_latest ON consents (user_id, purpose, id DESC);
CREATE TABLE referrals (                        -- one per invitee, written on the invitee's first launch (M11)
  invitee_id    BIGINT NOT NULL,
  inviter_id    BIGINT,                         -- NULL only after the inviter's erasure (Later)
  attributed_at BIGINT NOT NULL,
  qualified_at  BIGINT,
  outcome       TEXT,
  CONSTRAINT referrals_pkey          PRIMARY KEY (invitee_id),
  CONSTRAINT referrals_invitee_fk    FOREIGN KEY (invitee_id) REFERENCES users (id),
  CONSTRAINT referrals_inviter_fk    FOREIGN KEY (inviter_id) REFERENCES users (id),
  CONSTRAINT referrals_not_self      CHECK (inviter_id IS NULL OR inviter_id <> invitee_id),
  -- `outcome IS NOT NULL` is load-bearing: `NULL IN (...)` is NULL, and a CHECK that evaluates to NULL passes.
  CONSTRAINT referrals_outcome_known CHECK ((qualified_at IS NULL AND outcome IS NULL)
                                         OR (qualified_at IS NOT NULL AND outcome IS NOT NULL
                                             AND outcome IN ('granted', 'capped')))
);
CREATE INDEX referrals_by_inviter ON referrals (inviter_id, outcome, qualified_at);
