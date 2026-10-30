//! The `saves` table: one row per (user, slot), replaced only through an optimistic `rev`.
//!
//! Every statement binds the token's user, so a slot of another user is never read or written. The body is opaque
//! here: the table's CHECK (`json_valid`, length) is the backstop of the edge checks in `api/saves.rs`.

use crate::db::Repo;
use crate::ids::{SaveSlot, UserId};

/// A stored save without its body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaveMeta {
    /// The slot.
    pub slot: SaveSlot,
    /// The revision: 1 on create, one more per accepted write.
    pub rev: i64,
    /// The chapter the save is in.
    pub chapter_id: String,
    /// The story version the body was written against.
    pub story_version: String,
    /// The line the save resumes at.
    pub line_id: Option<String>,
    /// The client's idempotency key of the write that stored this revision.
    pub write_id: String,
    /// When this revision was stored, in unix seconds.
    pub saved_at: i64,
}

/// One save write. No `Debug`: it carries the body.
pub struct NewSave<'a> {
    /// `None` creates the slot; `Some(rev)` replaces revision `rev`.
    pub expected_rev: Option<i64>,
    /// The client's idempotency key of this write.
    pub write_id: &'a str,
    /// The chapter the save is in.
    pub chapter_id: &'a str,
    /// The story version the body was written against.
    pub story_version: &'a str,
    /// The line the save resumes at.
    pub line_id: Option<&'a str>,
    /// The save body: a JSON document.
    pub body: &'a str,
    /// The time of the request, stored as `saved_at`.
    pub now: i64,
}

/// What [`Repo::put_save`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PutOutcome {
    /// A row was inserted or updated.
    Written {
        /// The new revision.
        rev: i64,
        /// The stored `saved_at`.
        saved_at: i64,
    },
    /// Nothing was written: the slot's row as it stands, or `None` when the slot has no row.
    Conflict(Option<SaveMeta>),
}

/// A `saves` row without its body. `slot` is checked into a [`SaveSlot`] by [`SaveMeta::try_from`].
#[derive(sqlx::FromRow)]
struct SaveRow {
    slot: String,
    rev: i64,
    chapter_id: String,
    story_version: String,
    line_id: Option<String>,
    write_id: String,
    saved_at: i64,
}

/// A whole `saves` row.
#[derive(sqlx::FromRow)]
struct SaveBodyRow {
    #[sqlx(flatten)]
    meta: SaveRow,
    body: String,
}

impl TryFrom<SaveRow> for SaveMeta {
    type Error = sqlx::Error;

    fn try_from(row: SaveRow) -> Result<SaveMeta, sqlx::Error> {
        // The CHECK on `saves.slot` makes this unreachable; a 500 beats a panic if the schema ever drifts.
        let slot = SaveSlot::parse(&row.slot)
            .ok_or_else(|| sqlx::Error::Decode("saves.slot outside the SaveSlot union".into()))?;
        Ok(SaveMeta {
            slot,
            rev: row.rev,
            chapter_id: row.chapter_id,
            story_version: row.story_version,
            line_id: row.line_id,
            write_id: row.write_id,
            saved_at: row.saved_at,
        })
    }
}

impl Repo {
    /// Every save of `user` without its body, in slot order (`auto` < `s1` < `s2` < `s3` as text).
    pub async fn list_saves(&self, user: UserId) -> Result<Vec<SaveMeta>, sqlx::Error> {
        let rows: Vec<SaveRow> = sqlx::query_as(
            "SELECT slot, rev, chapter_id, story_version, line_id, write_id, saved_at FROM saves \
             WHERE user_id = ? ORDER BY slot",
        )
        .bind(user.0)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(SaveMeta::try_from).collect()
    }

    /// The save of `user` in `slot` with its body, or `None` when the slot is empty.
    pub async fn get_save(
        &self,
        user: UserId,
        slot: SaveSlot,
    ) -> Result<Option<(SaveMeta, String)>, sqlx::Error> {
        let row: Option<SaveBodyRow> = sqlx::query_as(
            "SELECT slot, rev, chapter_id, story_version, line_id, write_id, saved_at, body FROM saves \
             WHERE user_id = ? AND slot = ?",
        )
        .bind(user.0)
        .bind(slot.as_str())
        .fetch_optional(&self.pool)
        .await?;
        row.map(|r| Ok((SaveMeta::try_from(r.meta)?, r.body)))
            .transpose()
    }

    /// Writes `s` into `user`'s `slot` if `s.expected_rev` matches: `None` creates the slot at rev 1, `Some(n)`
    /// replaces rev `n` with rev `n + 1`. Each branch is ONE write statement with no explicit transaction (K19): it
    /// takes SQLite's write lock at its start, so two concurrent writers serialize under `busy_timeout` and no
    /// read is upgraded to a write. The split matters: one UPSERT would create rev 1 for `Some(5)` on an empty slot.
    pub async fn put_save(
        &self,
        user: UserId,
        slot: SaveSlot,
        s: NewSave<'_>,
    ) -> Result<PutOutcome, sqlx::Error> {
        let written: Option<(i64, i64)> = match s.expected_rev {
            None => {
                sqlx::query_as(
                    "INSERT INTO saves (user_id, slot, rev, chapter_id, story_version, line_id, write_id, body, \
                     saved_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?) \
                     ON CONFLICT (user_id, slot) DO NOTHING RETURNING rev, saved_at",
                )
                .bind(user.0)
                .bind(slot.as_str())
                .bind(s.chapter_id)
                .bind(s.story_version)
                .bind(s.line_id)
                .bind(s.write_id)
                .bind(s.body)
                .bind(s.now)
                .fetch_optional(&self.pool)
                .await?
            }
            Some(expected) => {
                sqlx::query_as(
                    "UPDATE saves SET rev = rev + 1, chapter_id = ?, story_version = ?, line_id = ?, \
                     write_id = ?, body = ?, saved_at = ? \
                     WHERE user_id = ? AND slot = ? AND rev = ? RETURNING rev, saved_at",
                )
                .bind(s.chapter_id)
                .bind(s.story_version)
                .bind(s.line_id)
                .bind(s.write_id)
                .bind(s.body)
                .bind(s.now)
                .bind(user.0)
                .bind(slot.as_str())
                .bind(expected)
                .fetch_optional(&self.pool)
                .await?
            }
        };
        if let Some((rev, saved_at)) = written {
            return Ok(PutOutcome::Written { rev, saved_at });
        }
        // Nothing written. The read sees a state committed at or after the failed condition (revs only grow), so
        // the answer is the row as it stands now.
        Ok(PutOutcome::Conflict(self.save_meta(user, slot).await?))
    }

    /// The save of `user` in `slot` without its body.
    async fn save_meta(
        &self,
        user: UserId,
        slot: SaveSlot,
    ) -> Result<Option<SaveMeta>, sqlx::Error> {
        let row: Option<SaveRow> = sqlx::query_as(
            "SELECT slot, rev, chapter_id, story_version, line_id, write_id, saved_at FROM saves \
             WHERE user_id = ? AND slot = ?",
        )
        .bind(user.0)
        .bind(slot.as_str())
        .fetch_optional(&self.pool)
        .await?;
        row.map(SaveMeta::try_from).transpose()
    }
}
