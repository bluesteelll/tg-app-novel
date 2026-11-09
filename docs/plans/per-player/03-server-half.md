## 3. Server half

### 3.1 Table `puzzle_values`

```sql
-- server/migrations/0008_puzzle_values.sql (0008 is the next free number on main d31f720, after LRF's
-- 0007_auto_refunds.sql; re-checked at GM6s1's cut; E-P11, r3 m2).
-- The 0002 dialect: BIGINT, unix seconds, named constraints, the PuzzleId grammar CHECK.
CREATE TABLE puzzle_values (                    -- one per-player value per (user, puzzle), and its current run
  user_id    BIGINT   NOT NULL,
  run        BIGINT   NOT NULL,                 -- 1 at the first draw; +1 at each restart and each forced re-draw
  wrong      BIGINT   NOT NULL,                 -- wrong answers applied in this run (the server's final-attempt count)
  issued_at  BIGINT   NOT NULL,                 -- when `value` was drawn
  spent_at   BIGINT,                            -- the final wrong answer of this run; NULL while the run is live
  puzzle_id  TEXT     NOT NULL,                 -- the puzzle's storage key (§3.8), as in puzzle_progress / hint_unlocks
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
```

| Invariant | Enforced by |
|---|---|
| one value per (user, puzzle); insert-if-absent is the arbiter (never check-then-insert) | `puzzle_values_pkey` + `ON CONFLICT (user_id, puzzle_id) DO NOTHING` |
| a value only for a known user | `puzzle_values_user_fk` |
| `value` fits the u16 answer entries the API takes, 1..64 of them (`MAX_ANSWER_LEN` 64 after GM6s1) | `_value_shape`, `_value_range` |
| the `wrong <= maxAttempts` bound | not a CHECK: the cap is content; `spent_at` records the decision when it is reached |

- **Column order (m5).** The fixed-width BIGINTs first, the nullable `spent_at` last of them (0 B while NULL), then
  the varlena columns, so no padding falls between BIGINTs; the primary key's column order is independent of the
  table's. The DDL above is in that order.
- **R12, ARITHMETIC estimate.** Heap tuple: 24 B header (23 B + a 1 B null bitmap for 8 columns) + 4 x 8 B (`spent_at`
  NULL: 0 B; 8 B once spent) + `puzzle_id` 1 + 10 B + `domain` 1 + 16 B + `value` (an `int8[]` under 127 B is stored
  with a 1 B short header: 1 + 20 + 4 x 8 = 53 B) = 137 B -> MAXALIGN 144 B + 4 B line pointer = 148 B, ~55 rows per
  8 KiB page -> ~149 B per row (~157 B once spent). PK leaf entry: 8 B header + 8 + 11 -> 32 B aligned + 4 B pointer,
  ~90 % fill -> ~40 B. Total ~190 B per row; the critic's r2 re-computation with 4 B array headers and padding gives
  ~205 B, the upper figure. 10 per-player puzzles per player ~1.9-2.05 KB = 0.74-0.78 % of the 262,144 B save LIMIT
  (`server/src/api/saves.rs:18-20`).
- **R12, MEASURED by a test.** `values_row_size_measured`: 1,000 users x 1 four-entry value, `VACUUM (ANALYZE)`, then
  `(pg_relation_size + pg_indexes_size) / 1000` is printed and asserted <= 256 B. Seen red on a mutation that widens
  `value` to 64 entries (~680-730 B per row).
- **Log redaction (m12).** Every server type that holds a drawn value or a domain (`PlayerValue`, `ValueRow`,
  `Expected`, `AttemptRecord` through `ValueRow`, `Domain`, `Answer`) either has no `Debug` or a manual one that prints
  `value: <redacted>` and the domain's hash only; none derives it over a value. `AttemptRecord` keeps its derive
  (`db/puzzles.rs:12`) because its `ValueChanged(ValueRow)` variant formats through `ValueRow`'s manual `Debug`. Tests
  `values: debug output redacts the code` (GM6s1: `Domain`, `ValueRow`) and `attempt_debug_redacts_the_code` (GM6s2:
  `PlayerValue`, `Expected`, `AttemptRecord`, `ApiError::ValueChanged`): `format!("{x:?}")` of each, built with the
  value `[1, 8, 4, 7]`, contains neither `1847` nor `1, 8, 4, 7`.
- `BIGINT[]` costs ~32 B more than an encoded text per row (ARITHMETIC). Kept for the dialect and the CHECKs; the test
  shows the real cost.

### 3.2 The domain and the draw

```rust
// server/src/puzzles/values.rs (new). Pure apart from `os_rng`; no clock, no DB.
/// A per-player puzzle's domain as the server holds it: per-position inclusive ranges, optional all-distinct
/// entries, excluded tuples (the build has already added the type's `startShown` when non-null, E-P9).
pub struct Domain { positions: Vec<(u16, u16)>, distinct: bool, exclude: Vec<Vec<u16>>, size: u64, hash: DomainHash }
/// 16 lower-case hex: the first 8 bytes of SHA-256 over the canonical encoding
/// `"pv1|" + "lo-hi" per position joined by "," + "|" + "0"/"1" + "|" + sorted excludes ("a.b.c" joined by ",")`.
pub struct DomainHash(pub String);
/// The fewest values a per-player domain may hold (RULINGS 123 O1; synthesis §4.6).
pub const ENTROPY_FLOOR: u64 = 1_000;
/// The least share of the position product a domain may hold, so rejection ends fast: <= 16 tuples expected.
pub const MIN_ACCEPTANCE: (u64, u64) = (1, 16);
/// Whole-tuple rejection rounds before a draw gives up (unreachable with MIN_ACCEPTANCE: p <= (15/16)^4096 ~ e^-264).
pub const DRAW_MAX_ROUNDS: u32 = 4_096;
#[derive(Debug, thiserror::Error)]
pub enum DomainError { #[error("{0}")] Shape(&'static str), #[error("{size} values, under {ENTROPY_FLOOR}")] Floor { size: u64 },
                       #[error("too sparse to draw")] Sparse }
#[derive(Debug, thiserror::Error)]
pub enum DrawError { #[error("no value after {DRAW_MAX_ROUNDS} rounds")] Exhausted }
impl Domain {
    /// Structure (len = answer_len, lo <= hi <= answer_max, excludes well formed), the size, the floor, the acceptance.
    pub fn parse(raw: DomainFile, answer_len: usize, answer_max: u16) -> Result<Domain, DomainError>;
    /// `v` lies in the domain: length, ranges, distinctness, not excluded.
    pub fn contains(&self, v: &[u16]) -> bool;
    pub fn hash(&self) -> &DomainHash;
}
/// One uniform value of `d`: each position uniform in its range by rejection on u32 (reject r >= 2^32 - 2^32 % n;
/// never `% n` alone), the whole tuple rejected if it is not distinct (when required) or excluded.
pub fn draw(d: &Domain, rng: &mut impl FnMut() -> u32) -> Result<Vec<u16>, DrawError>;
/// The OS CSPRNG, 4 bytes per call through `getrandom::fill` (as `db/orders.rs:95`).
pub fn os_rng() -> impl FnMut() -> u32;
/// `template` with `$code(<own>)` / `$code(<own>.<n>)` replaced from `value` (the join rule of §5.1).
pub fn render(template: &str, own: &str, value: &[u16], answer_max: u16) -> String;
```

- **Size.** Not distinct: the product of the range sizes minus the excludes that lie in the domain (u128, saturating).
  Distinct: a count over positions with a bitmask of used values, allowed only with `answer_max <= 15` and
  `answer_len <= 16` (65,536 masks x 16 positions; ARITHMETIC ~1 M steps, once at load). Anything else is
  `DomainError::Shape`.
- **Why rejection, why CSPRNG, why stored:** synthesis §4.1 (kept): no key to leak or rotate; a modulo draw is biased.
- **Shared vectors.** `server/tests/fixtures/values/vectors.json` (new in GM6s1): `render` cases (template, value,
  max -> text) and `domains` cases (domain, answerLen, answerMax -> size, floor ok, acceptance ok). The Rust tests and
  GM6c1a's client tests read the same file (the precedent: `build.test.ts:1109` reads a server fixture).

### 3.3 Content format 2

`server/content/puzzles/<ch>.json` gains format 2, in two steps: GM6k adds the optional per-puzzle `key` and the
opaque `type`; GM6s2 adds `perPlayer` / `maxAttempts`. The emitter writes the **lowest format that expresses the
chapter**: format 1 when no puzzle is per-player and every puzzle's key equals its id, so `emit: server puzzle content
matches the server fixture shape` (`build.test.ts:1105`) and the committed format-1 fixture stay as they are; format 2
otherwise.

```json
{ "format": 2, "chapterId": "ch1",
  "puzzles": {
    "gate":   { "type": "order", "answerLen": 3, "answerMax": 2, "solution": [1, 0, 2], "title": {"ru": "…", "en": "…"}, "hints": [] },
    "drawer": { "type": "code", "key": "ch1.desk_drawer", "answerLen": 4, "answerMax": 9,
                "perPlayer": { "positions": [[0, 9], [0, 9], [0, 9], [0, 9]], "distinct": false, "exclude": [[0, 0, 0, 0]] },
                "maxAttempts": null,
                "title": {"ru": "…", "en": "…"},
                "hints": [ {"ru": "…", "en": "…"}, {"ru": "…", "en": "…"}, {"ru": "Код: $code(drawer).", "en": "The code: $code(drawer)."} ] } } }
```

| Rule (server load, `content.rs`) | Why |
|---|---|
| `format` is 1 or 2; format 1 is today's entry exactly | the current producer keeps working until GM6c1a / GM6c1b |
| `key` (GM6k): optional, a `PuzzleId` of any chapter (the 0002 grammar); absent = the puzzle's own id; across the whole content no two puzzles share a key and no key is another live puzzle's id (a startup error before the listener binds) | I2: one key per puzzle, one puzzle per key (§3.8) |
| `type` (GM6k) is an opaque label, grammar `^[a-z][a-z0-9_]{0,31}$`; `PuzzleKind` is deleted | a new client type needs no server edit (synthesis §3.4); engine.md GM7p waits for this, not for GM6s2 |
| format 2 (GM6s2): each entry has exactly one of `solution` / `perPlayer`; `maxAttempts` (null or 1..9) present iff `perPlayer` | the server needs the cap only where it decides failure (§3.6) |
| `perPlayer` parses through `Domain::parse` (shape, floor, acceptance) | defence in depth behind the build lint |
| every hint placeholder names this puzzle, index in `1..=answerLen` | hints render only their own value (§5.1) |
| `answer_len <= MAX_ANSWER_LEN` = 64 (GM6s1 raises the constant from 16, `puzzles/mod.rs:21`; GM6s2 adds this load rule) | a 5 x 5 grid is 25 entries (synthesis §3.4); a request stays < ~400 B (ARITHMETIC 64 x <= 6 chars) |

```rust
// server/src/ids.rs (GM6k): the key every puzzle row is stored under; distinct from PuzzleId, so a repo call that was
// handed a route id instead of a key does not compile.
/// A puzzle's storage key: the full id under which it first shipped (§3.8).
pub struct PuzzleKey(pub String);
// server/src/content.rs: the solution source of one puzzle (replaces `PuzzleDef.solution`, GM6s2).
/// How the server knows a puzzle's answer. No `Debug` (static answers are secret).
pub enum Answer {
    /// The build's solution: compared before the attempt transaction, as today.
    Static(Vec<u16>),
    /// Drawn per player; `max_attempts` is the author's cap, the server's final-attempt rule (§3.6).
    PerPlayer { domain: Domain, max_attempts: Option<u8> },
}
// PuzzleDef { id, key: PuzzleKey (GM6k), chapter, answer_len, answer_max, answer: Answer (GM6s2), title, hints }
// ContentStore gains `fn chapter_per_player(&self, ch: &ChapterId) -> impl Iterator<Item = &PuzzleDef>` (GM6s2).
```

### 3.4 HTTP API

All routes: bearer (`AuthUser`), one silent re-auth on 401 (client, as built), JSON errors as `ApiError`,
`Cache-Control: private, no-store` + `nosniff` on every 200 (the `sold_headers` pair, `api/puzzles.rs:27-32`), the
fixed check order of today's handlers (token, path grammar, query, known id, entitlement, body).

| Route | Body / response | Errors | Idempotency |
|---|---|---|---|
| **`GET /api/chapters/{chapterId}/values`** (new; handler in `api/puzzles.rs`) | 200 `ValuesResponse { values: { [localId]: PlayerValue } }`; `{}` for a chapter with none | 400 id grammar; 404 chapter not in the story index; 403 `not_entitled` for a paid chapter without its entitlement (the `entitled_puzzle` rule, applied per chapter) | issue-if-absent in **one statement per call**, rows inserted in key order: `INSERT INTO puzzle_values (user_id, run, wrong, issued_at, puzzle_id, domain, value) SELECT $1, 1, 0, $2, k, d, v::bigint[] FROM unnest($3::text[], $4::text[], $5::text[]) AS t(k, d, v) ORDER BY k ON CONFLICT (user_id, puzzle_id) DO NOTHING`. Each value travels as its array literal (`{1,8,4,7}`, built by the server from `u16`s, bound as a parameter, cast per row), because one `BIGINT[][]` parameter is a rectangular 2-D array that `unnest` flattens and values of different lengths cannot share (m6). Two issuers of one chapter (two tabs) meet the unique-index waits in the same order and never wait crosswise; two chapters' sets are disjoint (CLAIM: PostgreSQL inserts an `INSERT ... SELECT`'s rows in the select's order; pinned by `values_issue_two_tabs_no_deadlock`). N calls give the same rows |
| `POST /api/puzzles/{puzzleId}/attempts` (changed) | req `AttemptRequest { answer, run?: number }`; 200 `AttemptResponse { correct, solved, attemptsLeft: number \| null, spent: boolean }`; `spent` is true only when **this** answer spent the run | as today. A `run` sent for a static puzzle is **ignored**: a tab whose world predates a per-player -> static content update compares against the static solution exactly as a fresh tab does, instead of a hard 400 that would wedge its frame (m11; `attempt_static_ignores_run`). **409 `value_changed`** with `value: PlayerValue` (the current run) when `run` is not the current run **or the current run is spent, or (round 8, r7 W2) a per-player answer names no `run`**: nothing compared, no wrong answer counted (the window counted the request), the body carries `sold_headers`. The DTO is unchanged (`run` stays optional: a static puzzle sends none) | as today: each attempt is an attempt; the window counts it first |
| **`POST /api/puzzles/{puzzleId}/restart`** (new) | req `RestartRequest { from: number }`; 200 `PlayerValue` (the current run after the call) | the fixed order: 400 id grammar; 404 unknown id; 403 paid without the chapter; **then** 404 not per-player; then 400 body. A non-buyer therefore cannot probe which paid puzzles are per-player (m11; `restart_paid_puzzle_403_before_per_player_404`) | `from` is the guard: a repeat, a stale `from` or a live run returns the current state and changes nothing |
| `GET /api/puzzles/{puzzleId}?lang` (changed) | `PuzzleStatus` gains `valueRun: number \| null` (the run its texts were rendered with; null for a static puzzle) | as today | as today |
| `POST /api/puzzles/{puzzleId}/hints/{tier}?lang` (behaviour changed, DTO unchanged) | `HintUseResponse` unchanged: its text is rendered from the current value; the client tags it "run unknown" (§5.5), because the hint port carries only `{ text, balance }` (`session.ts:62`, `wallet.ts:76-87`) and a field there could not reach the session (m3) | as today | as today (the unlock row is the arbiter) |

```rust
// server/src/api/dto.rs (ts-rs -> client/src/api/generated/api.ts; dto-samples.json pins both sides).
#[derive(Deserialize, TS)] #[serde(rename_all = "camelCase")]
pub struct AttemptRequest { pub answer: Vec<u16>, #[serde(default)] #[ts(optional, type = "number")] pub run: Option<i64> }
#[derive(Serialize, TS)] #[serde(rename_all = "camelCase")]
pub struct AttemptResponse { pub correct: bool, pub solved: bool, pub attempts_left: Option<u8>, pub spent: bool }
#[derive(Clone, Serialize, TS)] #[serde(rename_all = "camelCase")]
pub struct PlayerValue { pub value: Vec<u16>, #[ts(type = "number")] pub run: i64, pub attempts_left: Option<u8>, pub spent: bool }
// A manual `Debug` for PlayerValue prints `run`, `spent` and `value: <redacted>`: `ApiError` derives Debug and carries
// it, and no log may print a player's code (the rule for every value-holding type: §3.1 "Log redaction", m12).
#[derive(Serialize, TS)] pub struct ValuesResponse { pub values: BTreeMap<String, PlayerValue> }
#[derive(Deserialize, TS)] #[serde(rename_all = "camelCase")] pub struct RestartRequest { #[ts(type = "number")] pub from: i64 }
// PuzzleStatus: + `#[ts(type = "number | null")] pub value_run: Option<i64>`. HintUseResponse: unchanged (m3).
// ApiErrorBody: + `#[serde(skip_serializing_if = "Option::is_none")] #[ts(optional)] pub value: Option<PlayerValue>`,
// "value_changed only" (the precedent: `current` on save_conflict, omitted when absent, api.ts:27-30).
// error.rs: ApiError::ValueChanged(PlayerValue) -> 409, code "value_changed", with sold_headers; client `META_KINDS`
// maps it to 'unavailable' and `ERROR_CODES` lists it (endpoints.ts:130-151, decode.ts:79-99 are exhaustive by type,
// so `check` fails until both are mapped).
```

```ts
// client/src/api/endpoints.ts (GM6s2, the contract commit): the calls; decoders in api/decode.ts.
getValues(chapter: ChapterId, o?: { signal?: AbortSignal }): Promise<Result<ValuesResponse, ApiError>>;
restartPuzzle(id: PuzzleId, from: number): Promise<Result<PlayerValue, ApiError>>;
postAttempt(id: PuzzleId, answer: readonly number[], o?: { signal?: AbortSignal; run?: number }): Promise<Result<AttemptResponse, ApiError>>;
```

- **Rate limits.** Attempts: the existing window, counted before the run check and the compare. Restart: none of its
  own; it acts only on a spent run, and spending a run takes `maxAttempts` wrong answers inside that same window, so
  re-draws are bounded by it; a no-op restart costs one indexed locked read, like a status read. Values: none
  (idempotent, one per chapter load).
- **Brute force, ARITHMETIC.** The ceiling stays 20 answers per 600 s per puzzle: a 9,999-value domain takes >= 9,999 /
  20 x 600 s ~ 3.5 days to sweep; with re-draws a sweep is useless, and a blind guess hits with p = 1/|D| each, so the
  expected cost is ~|D| answers instead of ~|D|/2. A domain at the floor (1,000) holds >= 8.3 h.

### 3.5 The attempt transaction (the commit model)

Per-player values exist only for `check: 'commit'` types (synthesis §3.4; today `code`; later `setting` and any secret
sequence type that opts in, §12): one submit = one attempt. `reach` types are never per-player (§4).

```rust
// server/src/db/puzzles.rs. The changed invariant (replaces :4-5): "a static solution never reaches this module; a
// per-player value is read, compared and counted only here, after the window decision, under its row lock".
pub enum Expected<'a> {
    /// The caller compared against the static solution (today's path, unchanged).
    Static { correct: bool },
    /// The player's value decides. `drawn` is used only for an absent row or a forced re-draw (§3.6).
    PerPlayer { answer: &'a [u16], domain: &'a Domain, cap: Option<u8>, run: Option<i64>, drawn: Vec<u16> },
}
pub enum AttemptRecord {
    Limited { retry_after_secs: i64, solved: bool },
    Answered { correct: bool, solved: bool, attempts_left: Option<u8>, spent: bool },
    /// Nothing compared, nothing counted: the request's run is absent (a per-player answer with no `run`, step 4)
    /// or not current, or the current run is spent.
    ValueChanged(ValueRow),
}
pub async fn record_attempt(&self, user: UserId, puzzle: &PuzzleKey, expected: Expected<'_>, now: i64)
    -> Result<AttemptRecord, sqlx::Error>;
/// The one-row read of a value, inside the caller's transaction: insert-if-absent with `drawn`, `SELECT ... FOR
/// UPDATE`, then `domain_rule`. The attempt, the restart and the hint rendering read through it (m10). The values route
/// reads many rows at once and does not call it: it applies the same `domain_rule` in its batch path (r3 m8, below).
async fn current_value(tx: &mut PgConnection, user: UserId, puzzle: &PuzzleKey, domain: &Domain, drawn: &[u16], now: i64)
    -> Result<ValueRow, sqlx::Error>;
/// The domain rule, pure: `None` when the row's hash is the content's; `KeepValue` (only the hash moves) when `domain`
/// contains the row's value; else `Redraw` (`value = drawn, run + 1, wrong = 0, spent_at = NULL, issued_at = now`, T1).
fn domain_rule(row: &ValueRow, domain: &Domain) -> Option<DomainUpdate>;
enum DomainUpdate { KeepValue, Redraw }
/// The values route's batch read, one transaction: the multi-row insert-if-absent of §3.4 (rows in key order); one
/// plain `SELECT ... WHERE user_id = $1 AND puzzle_id = ANY($2) ORDER BY puzzle_id`; then, in key order, for each row
/// whose `domain_rule` is `Some`, one guarded `UPDATE ... WHERE user_id = $1 AND puzzle_id = $k AND domain = $old
/// RETURNING *`. A guard that matches 0 rows means another path applied the rule first (it holds the newer row under
/// its lock); the row is then read again with a plain select. So the rule runs once per domain change whichever path
/// sees it first, and no path re-draws twice.
async fn chapter_values(tx: &mut PgConnection, user: UserId, set: &[(PuzzleKey, &Domain, Vec<u16>)], now: i64)
    -> Result<Vec<ValueRow>, sqlx::Error>;
```

`PerPlayer`, one READ COMMITTED transaction:

1. The `puzzle_progress` upsert counts the attempt and holds the (user, key) progress row lock (today's statement,
   `db/puzzles.rs:37-52`).
2. Window full: commit, `Limited` (no value read, nothing revealed).
3. `current_value`: `INSERT INTO puzzle_values ... VALUES ($drawn, run 1, wrong 0) ON CONFLICT (user_id, puzzle_id) DO
   NOTHING`, then `SELECT ... FOR UPDATE`. A row whose `domain` differs from the content's: if `domain.contains(value)`
   only the hash moves; otherwise `value = $drawn, run = run + 1, wrong = 0, spent_at = NULL, issued_at = now` (the
   forced exception, T1).
4. `run` **absent** (round 8, r7 W2), or != the row's run, **or** `spent_at` set: commit, `ValueChanged(row)` -> 409
   `value_changed` with the row as `PlayerValue`. Nothing compared, `wrong` unchanged; the client learns the current
   run and restarts if the world plays the puzzle with no failure of its own (§3.6, §5.5). A spent run is never
   answered `correct: false` (W1). **Why a runless answer is refused, not compared:** the client sends the newest run
   it knows in every state, so a request with none comes from a device that has shown no value of this puzzle (its
   values fetch failed, or nothing has landed yet); comparing it would judge a guess against a value the device never
   displayed and, on a capped puzzle, could spend the run on it (§2's target). The 409 instead hands that device the
   value it lacks, at the cost of one more tap for a player who remembered the code; the window still counts the
   request (step 1), so the route is no faster an oracle than the values route.
5. Compare. Correct: `solved_at` set once (today's guarded UPDATE, `:67-75`). Wrong with a cap `m`: `wrong = wrong + 1`,
   and `spent_at = now` when `wrong + 1 >= m`; the 200 then says `spent: true` (this answer spent the run). Commit.

- **Why the compare is inside:** a value read in its own statement could race a restart or a forced re-draw and judge
  an answer against a value the player no longer sees (synthesis §4.2, kept).
- **Lock order:** attempt = progress, then one values row (`current_value`). Restart = one values row (it reads
  `solved_at` unlocked). Values route = `chapter_values`: values rows in key order (the insert statement, a plain
  select, the guarded per-row updates of `domain_rule` in key order; r3 m8: this is its only read path). Hint rendering
  = one values row (`current_value`) in its own short transaction after the spend transaction commits. A guarded update
  that waits on a row an attempt holds re-checks `domain = $old` on the committed row (READ COMMITTED re-evaluates the
  `WHERE` of an `UPDATE` against the newest version after the wait) and matches 0 rows when the attempt already applied
  the rule. No path waits for progress while holding a values row, and every multi-row path takes rows in key
  order: no cycle.
- **Solved puzzles** keep counting in replays (the client's replay of a solved puzzle fails by the same server rule);
  a restart of a solved run starts a new run on the **same** value (§3.6).
- **`attempt()` (`puzzles/mod.rs:110-134`)** splits into the shape check (both kinds, 400 before any count), then
  `Static` (today's compare) or `PerPlayer` (the draw for `drawn` happens before the transaction: one `getrandom` call
  of <= a few hundred bytes, non-blocking).

### 3.6 O2: the re-draw

**Definitions (exact).**

| Term | Definition | Where decided |
|---|---|---|
| run | the server's current attempt run of one (user, per-player puzzle): `puzzle_values.run` | server |
| final attempt | the wrong answer that makes `wrong = maxAttempts` in the current run; the run is then **spent** (`spent_at` set) | server (§3.5 step 5) |
| no cap | `maxAttempts: null`: no final attempt exists; the run is never spent; the value never changes by O2 | content |
| restart | a world that **plays the puzzle with no failure of its own** meets a server run that is spent: the world holds no outcome for it (`runOf(world, p).outcome === null`, `yields.ts:154-155`), **or** (round 8, r7 W1) the story re-enters the linear puzzle while its world outcome is `solved` or `abandoned` (an authored loop, `PUZZLES-PLAN.md:303-304`: a session of p opens over the spent run). **Not a restart (round 7):** a run this device's own final answer spent, before the world records its `failed` (the session ends at once, the outcome lands after the close-up fade, `yields.ts:529-535`); the store marks it `endedHere`, which counts only while the world holds no outcome for p (§5.2) | client detects (reconcile after every successful values body, at every world replacement of the chapter (`restore`, the `reset` effect), after `ended` records an outcome, at `openPuzzle`, a 409 inside a session; **never at `chapterChanged`**, round 8, r7 m3: the store there still holds the chapter being left), server decides |
| failed world | `runOf(world, p).outcome === 'failed'` (recorded by `ended`, `yields.ts:535`): this world already failed the puzzle. Never a restart, whatever the server run; `openPuzzle` ends it `failed` without a session (the D18 replacement for per-player puzzles); its surfaces show the spent run's last value | client |
| solved / abandoned world (round 8, r7 W1) | `runOf(world, p).outcome` is `solved` or `abandoned`. Not a restart while the world does not play the puzzle: the store shows the spent run's last value (`ready`), no mask, no prompt. In a solved world that value is the code it solved with: once `solved_at` is set, a restart keeps the value (re-draw row below), so only T1 can change it. A lock puzzle never re-opens with an outcome (`reduce.ts:367-370`, `:472`), so for a lock this is final; a linear puzzle the story re-enters is a restart (row above) | client |
| re-draw | at a restart of an unsolved spent run: new value, `run + 1`, `wrong = 0`, `spent_at = NULL`. Of a solved spent run: `run + 1`, `wrong = 0`, **same value** | server |

**Which client events make a world with the puzzle fresh** (each ends in `values.reconcile()`, §5.2):

| Event | Code path | Counts |
|---|---|---|
| the chapter replayed from its start (chapter select, a new playthrough) | `chapterChanged` -> the world starts empty (`yields.ts:136-137`, `game.ts:826`), then `chapterEntered` -> `values.load` (a new store generation, the same chapter included) -> the first body's reconcile against that empty world (round 8, r7 m3: `chapterChanged` itself no longer reconciles: at that moment the store still holds the chapter being left, and a reconcile would restart that chapter's spent puzzles against the next chapter's empty world) | yes |
| a save loaded from before the failure (a manual slot, a chapter-start or checkpoint resume) | `resumeBody` -> `yields.restore(world, ...)` (`game.ts:925`) | yes |
| a section reset at its first entry (a re-versioned save) | the `reset` effect (`yields.ts:313-315`) | yes |
| another device spent the run while this device's world holds no outcome | this device learns it at its next values response (load, Retry, `activated`) or attempt (409 `value_changed` with `spent`) | yes |
| a linear puzzle re-entered by the story after it failed (an authored retry loop, `PUZZLES-PLAN.md:303-304`) | the world's outcome is `failed`: `openPuzzle` ends it `failed` without a session, as D18 ends a static puzzle at its limit (`yields.ts:571-576`) | no (its outcome stays) |
| a linear puzzle re-entered by the story after `solved` or `abandoned` (round 8, r7 W1), its server run spent (by a replay, another device, or another save) | `openPuzzle` opens the session (`open` set, so `ValuesDeps.playing()` is p) and calls `reconcile()`, which owes the restart; the frame waits `checking` until it lands and plays `renewed` (§5.5 (b)) | yes: the world plays the puzzle again from its start over a run that a failed final attempt ended, O2's two conditions. The alternative, ending it `failed` as for a failed world, was rejected: it would give this world an outcome it never earned and send the story down its failure branch for a failure that happened elsewhere, while a fresh world in the same situation restarts |
| a world that holds `solved` or `abandoned` and does not play the puzzle (a slot loaded after a replay elsewhere spent the run; another device's failure seen at a refresh) | none: no restart is owed, the entry is `ready` with the spent run's value | no |
| the session leaves the chapter for another chapter's paywall (a save of a not-owned chapter's start, `game.ts:886-907`; found while resolving r7 m3) | `chapterLeft()` installs the empty world in place of the paywall's `restore` (`game.ts:906`) and `sync`s the store with no wanted chapter, which drops it, so no reconcile sees the chapter left against an empty world (round 9, r8 W1, RULINGS 135 (a)) | no |
| a slot of the chapter left is loaded back after that paywall (`resumeBody` reuses `s.ch` and skips `enterChapter`, `game.ts:887`; round 9, r8 W1) | `restore(world)` -> `values.sync()`: the store holds no generation of the chapter, so it loads the chapter's values (a new generation, the first fetch's mask and failure state); the first body reconciles against the restored world | as for any resume: yes iff that world plays a spent run with no failure of its own |
| the app reloaded in the failed run | the save holds the outcome `failed` | no |
| a lost final response, then a reload from the autosave before it | the save holds no outcome; the server run is spent | yes (the player resumes from before the failure; the server already counted it) |

**The server-counted cap (a change to X8 for per-player puzzles only; X8's "the server does not enforce
`maxAttempts`", `PUZZLES-PLAN.md:314-315`, stays true for static puzzles).** The client's local count
(`session.ts:245-252`, saved in `PuzzleRun.attempts`) cannot be the trigger: an older slot resets it (X8,
`PUZZLES-PLAN.md:310-311`), so client and server would disagree about "final". For a per-player puzzle the session
therefore ends `failed` exactly when a 200 answer says `spent: true`, shows `attemptsLeft` from the server, and D18's
local count is replaced by the failed-world rule above, so a stale local count can neither end a live run early nor
open a session on a world that already failed. Static puzzles keep X8 and D18 as built. Consequence, stated (T2): the
cap counts guesses per value, not per save; a player who loads an older slot before failing keeps the guesses already
used on that value, and gets fresh guesses only with a fresh value. That is what makes O2's re-draw the one way to new
guesses.

**Restart, server side** (`db/puzzles.rs`):

```rust
/// The current run after a restart request from run `from`, in one transaction: the value row `FOR UPDATE` (issued
/// first if absent); if `run == from` and `spent_at` is set: re-draw (unsolved) or a new run on the same value
/// (solved, read from `puzzle_progress` without a lock); otherwise nothing changes.
pub async fn restart_value(&self, user: UserId, puzzle: &PuzzleKey, domain: &Domain, drawn: Vec<u16>, from: i64, now: i64)
    -> Result<ValueRow, sqlx::Error>;
```

| Race | Outcome |
|---|---|
| two restarts `{from: 3}` at once (two tabs) | the second waits on the row lock, then sees `run = 4 != 3`: no-op, returns run 4. One re-draw (`restart_concurrent_one_redraw`) |
| restart vs an attempt on the spent run | attempt first: step 4 answers 409 with run 3 spent, nothing compared; then the restart re-draws. Restart first: the attempt's `run` (3) != 4 -> 409 with run 4, nothing compared. No race solves or counts against a spent run |
| device B shows run 3's value V; device A spends run 3; B tries V with `run: 3` | 409 `value_changed` {run 3, spent}; B's world holds no outcome, so B restarts from 3 and shows run 4's value with the value motion and the `puzzle_value_changed` toast (round 9, r8 m1: the spans mask while the restart runs, and the toast compares V' with the last digits shown for p, V, across that mask; `yields: a restart after a spent-run Try shows the value-changed toast`). B is never told "wrong" or "failed" for a code it was shown (`attempt_on_spent_run_409_not_compared`; `puzzles: value_changed on a spent run restarts and keeps the frame open`) |
| device A shows V (run 3); device B spends run 3 and restarts to run 4 (V'); A's ladder status names `valueRun: 4`, so A masks p (`superseded`); A taps Try with V still on the dials, and its refetch then fails (round 8, r7 W2) | A's attempt carries run 3, the newest run its store knows: 409 `value_changed` with run 4, nothing compared; `learn` heals A to V' (`renewed`), whatever its refetch does. The same holds for a `restarting` entry (the spent run is sent) and a `failed` one with a last run (a restart whose 200 was lost: the 409 brings the committed run at once). Only a store that never received a body sends no run, and the server answers that 409 too (§3.5 step 4). Round 7 sent these blind, and the server compared V with V' (`puzzles: a try while superseded sends the last known run`; `attempt_without_run_409_not_compared`) |
| restart vs a values fetch | the fetch's plain select sees either state; a device that saw run 3 spent and holds the world fresh posts `{from: 3}` -> no-op, current state. **Responses in either order (round 7, r6 m5):** the restart's 200 (run 4) and a refresh body read before it (run 3 spent) may land in either order; the store's merge never lets a lower run replace a higher one, so the second body changes nothing and no surface shows run 3's value again (`values: a late response never rolls the run back`) |
| restart vs a hint spend | disjoint rows; `spend_hint` reads progress unlocked (`economy.rs:393-403`); the unlock row keys no value |
| restart vs a domain change at the same deploy | the forced re-draw and the restart both run under the row lock; whichever is second sees the newer run |
| device B has the paid tier 3 open ("The code: V", run 3); device A spends run 3; B's `activated` refresh restarts B to run 4 (V') | the store change runs `session.valueChanged(4)`: tier 3's run-3 text is dropped at once, the open ladder shows tier 3 unlocked without text and `busy`, folds it (`puzzle:hint-renewing`, R-E20, r3 m7), re-fetches (free: `AlreadyUnlocked` is never involved, a status read), shows V' and re-plays `puzzle:hint-shown`; the frame plays `puzzle:renewed`. B's next Try sends run 4 with V' on every surface. No surface shows V after the change (W3; `yields: a restart while the ladder is open re-reads tier 3`) |

**MONEY.** A restart touches only `puzzle_values`. `hint_unlocks` rows (tiers bought with hint units) stay; `status`
renders each unlocked tier's template with the current value; `post_hint` on an unlocked tier of the unsolved puzzle is
`AlreadyUnlocked` with no debit (`economy.rs:408-421`). Test `hint_unlock_survives_restart_shows_new_value`: tier 3
unlocked, three wrong answers (cap 3), restart, then `status` tier 3 contains the row's new value, `post_hint` tier 3
answers `AlreadyUnlocked`, and the ledger has no new row.

**TRUTH** is §5.3.

### 3.7 O3 and O4

- **O3.** Tier-3 texts of a per-player puzzle are templates (`"Код: $code(drawer)."`). `status` and `post_hint` render
  them with `values::render` and the row `current_value` returns (issued if absent; after a shape change the domain rule
  runs first, so the first status after a content update never renders a value outside the new domain, m10; for
  `post_hint` in its own short transaction after the spend commits); `status` returns `valueRun` (`post_hint` does not,
  m3: the client tags its text "run unknown", §5.5). Price: the catalog's `hintTierCost` as today (`api/puzzles.rs:136`); no new
  product, invoice or grant path (principle 2 untouched). The hint text stays sold content (`private, no-store`).
- **O4, what devtools give a player:** their own chapter's values at chapter load (the response and memory), before the
  clue is found. **What still holds:** another player's value is wrong for you (shared answers fail); the solve, the
  failure, the re-draw and the hint unlocks are server facts (no entitlement, hint or meta condition reads client state);
  brute force is bounded by the window and the per-run cap; no value or domain is in any public file, bundle, world JSON
  or save. "Solved without hints" achievements stay display-only (`server/src/db/achievements.rs:1-4`, synthesis §3.4).

### 3.8 I2: stable storage keys (lanes GM6k, GM6c1b)

**Decision: rows never move; the server translates the route's id to a stable key at the gate.** Round 1's startup
re-key is withdrawn: it was a one-way data migration that a rollback could not undo, and its orphan guard turned a
rollback into a start that neither release could make (W5, `deploy.md:128-136`). Round 1 rejected a resolution on read
because every query would read two ids; a storage key is **one** id per puzzle, so every query still reads one id and
`spend_hint`'s "tier n-1 unlocked" read and its unlock insert stay on one key.

- **The key.** `PuzzleKey` (§3.3): the full id (`ch<n>.<local>`, the 0002 grammar) under which the puzzle first shipped.
  A puzzle never renamed has key = id, so every row on main is already keyed correctly: no data migration, no
  migration file. `puzzle_progress`, `hint_unlocks` and `puzzle_values` hold the key in their `puzzle_id` column; the
  debit idempotency key `hint:<user>:<key>:<tier>` and the ledger `ref` `'<key>:<tier>'` (`economy.rs:237-252`,
  `0004_economy.sql:28`) are built from it, so they never change across a rename or a rollback.
- **The record** `story/puzzle-keys.json` (new, committed, build-only: never shipped, never read by the server) is an
  **append-only, hash-chained event log**; the key map is *replayed* from it and exists nowhere as editable data (W4).
  Example after `desk_drawer -> drawer` and one release:

```json
{ "format": 1,
  "log": [ "add ch1.gate", "add ch1.desk_drawer", "add ch2.cabinet", "release r1",
           "serve ch1.desk_drawer ch1.drawer" ],
  "chain": "<64 lower-case hex>" }
```

| Line | Meaning | Written only by |
|---|---|---|
| `add <id>` | a new key equal to the puzzle's full id; it serves that id | `--fix-ids` (a live puzzle that no key serves) |
| `serve <key> <id>` | the key now serves another live full id (a rename; a move to another chapter) | `--fix-ids` (from the resolved `renamed.puzzles`); `--move-puzzle <from> <to>` (a cross-chapter move, which `renamed` cannot express) |
| `retire <key>` | nothing serves the key again; its rows stay until the user's erasure | `--retire-puzzle <id>` |
| `release <label>` | a production release shipped with the log as it stands | `--mark-release <label>`, the deploy runbook's release step (GM6c1b) |

- **Chain.** `c0 = SHA-256("tg-novel puzzle-keys 1")`, `ci = SHA-256(c(i-1) || "\n" || line i)`; the file holds the hex
  of `cN`. A removed, edited, inserted or reordered line changes it. The tools verify the chain first and extend it by
  the lines they append; they never recompute it from scratch, and a broken chain is refused, not repaired. The one way
  back is deliberate: restoring the file from git (`git show <base>:story/puzzle-keys.json`, e.g. for a puzzle added
  and deleted on one unmerged branch), which review sees as removed log lines. **Threat model:** the gate catches every
  edit of the file except its replacement by an older committed version; it guards against the natural edit (deleting
  an entry), not against forgery.
- **Replay.** `add k`: map[k] = k (refused if k exists); `serve k i`: map[k] = i (k exists, not retired); `retire k`:
  map[k] = null; `release`: no map change. Each key's **history** is the ids it has served, in order.
- Checked by every gate run (the story tool, through one call `lintPuzzleKeys` after the world stage, `story.ts:630-651`
  at `525dd68`; the fixer precedent: sources are rewritten only on request, `story.ts:7`, `:540`). The six codes live in
  `keys.ts`'s `KEY_CODES`, registered in `MECHANIC_LINTS` by GM6c1b as a `runsFrom: 'story'` entry (engine.md §3.2's
  union, its R-E22 answer [engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12)), never in `LINT_CODES` (§4 "Where the codes live", r4 W1). **`keys.ts` is node-free
  (round 6, r5 m5):** the chain's SHA-256 is a parameter `sha256: (text: string) => string` of every function that reads
  or extends the chain, bound to `node:crypto`'s `createHash` by `story.ts` (and by `keys.test.ts`), as `fix.ts` takes
  its random suffixes from `story.ts` (`fix.ts:3`). The registry imports `keys.ts`, and the app program reaches the
  registry's types through `lint.ts` (`lint.ts:2-3`, `tsconfig.json:7`), so a `node:` import there could fail `check`;
  `keys: keys.ts imports no node module` pins it:

| Lint (GM6c1b) | Rule | Seen red on |
|---|---|---|
| `puzzle-key/chain` | every line parses; the replay holds; the chain equals `chain` | a fixture record with the line `add ch1.gate` deleted (W4's edit: `chain mismatch at line 1: a line was removed or edited; restore the file from git`) |
| `puzzle-key/unrecorded` | every live puzzle is served by exactly one key | a new puzzle, `--fix-ids` not run |
| `puzzle-key/dropped` | every key not retired serves a live puzzle; the message names the only fixes: restore the puzzle, rename it (`renamed.puzzles` + `--fix-ids`), or `--retire-puzzle <id>` (refused after a release, below); never "delete the line" | a deleted puzzle whose key still names it |
| `puzzle-key/retired-reused` | no live puzzle's id equals a key that is retired or serves another id | a new puzzle reusing a retired id |
| `puzzle-key/rename-agrees` | over the **resolved** `renamed.puzzles` of each chapter `ch` (engine.md §5.3: chains resolve to their final target): for each `src -> t`, the key serving `ch.t` has `ch.src` in its history (the rename was applied), and no **other** key has `ch.src` in its history (a **merge**: `t` had its own key, so two keys' rows would meet in one puzzle) (m4) | a rename edited without `--fix-ids`; `a -> c` where `c` already had its own key. **Must pass:** the chain fixture `a -> b` before `release r1`, `b -> c` after it (resolved `a -> c`, `b -> c`; one key `ch1.a` with history `a, b, c`) |
| `puzzle-key/retire-after-release` | a `retire` line after any `release` line is refused while `RETIRE_COMPENSATED` (`client/scripts/story/keys.ts`) is `false`; the lane that builds the compensation step for bought hints (OQ5) flips it (m7) | `--retire-puzzle` after `release r1` |

- **`--fix-ids`**, deterministic and idempotent: verify the chain (refuse if broken); (1) for each resolved `src -> t`
  (chapters in `chapters.json` order, sources in key order): the key serving `ch.src`, if any, gets `serve <key> ch.t`,
  refused when `ch.t` is already served by another key (merge); (2) each live puzzle served by no key gets `add <id>`,
  refused when `<id>` is an existing key (retired-reused); (3) it never writes `retire` or `release`. A second run
  appends nothing. **Retiring** is `--retire-puzzle <id>` only: before any `release` line it is free (no production row
  can exist under the key); after one it is refused until the compensation step exists (m7), so after launch a shipped
  puzzle can be renamed or moved, never dropped silently (T4). The story tool prints the retired keys from the log
  ("retired puzzles: ch1.x") for the release notes.
- **The release step checks the log extends the last released one (r3 O1).** The chain's stated limit (an older
  committed copy restored in place) would also let `--retire-puzzle` pass after a shipped `release`: the restored copy
  predates that `release` line. `--check-extends <file>` (GM6c1b) closes it outside the build: it verifies both chains,
  then refuses unless every line of `<file>` is the same line at the same index of the current log (a prefix). The
  deploy runbook's release step runs it against the last release's record (`git show <last-release>:story/puzzle-keys.json`
  into a scratch file, the runbook's own git step, never the gate's) before `--mark-release`; the story gate itself
  still needs no git. Test `keys: a log that does not extend the last released log is refused` (a restored pre-release
  copy plus a `retire` line: refused, naming the first differing index).
- **Emission** (`toServer`, GM6c1b): a server puzzle entry whose key differs from its id carries `"key"` (format 2 then,
  by the lowest-format rule, §3.3).
- **Server** (GM6k): `PuzzleDef.key` (= `key` or the id); the load refuses two puzzles with one key and a key equal to
  another live puzzle's id, before the listener binds. `entitled_puzzle` (`puzzles/mod.rs:94-107`) returns the def and
  every repo call takes `&PuzzleKey`, a newtype distinct from `PuzzleId`, so a call site handed a route id does not
  compile; every repo call site on the tree is therefore in GM6k's lock, the test call `refunds.rs:421-423` included
  (`:417-419` before LRF), since one compile error stops the whole `tests/it` binary (W1). A `PuzzleId(` that builds a
  meta fact (`meta.rs:679`, `:704`) is no repo call and stays: the meta index keeps route ids (r3 m3). The achievements read (`card_puzzles`, `achievements.rs:101-125`, from `cards.rs:62-66`) translates the meta
  index's ids to keys and maps the rows back. `stat_events` keep the client's id as history (`PuzzleEnded` feeds no
  fact, `meta.rs:555`).
- **Rollback and re-deploy (W5).** Release N+1 renames `a -> c`: c's key is `ch1.a`, its rows stay under `ch1.a`.
  Rolled back to N (live `a`, key `ch1.a`): the same rows. Forward again: the same rows. A puzzle new in N+1 that has
  rows: N does not serve it; its rows wait under its key and are served at the next forward start. Nothing refuses a
  start, nothing needs a restore. `deploy.md`'s rollback paragraph gains one sentence saying so (GM6k).
- **Retired keys.** Their rows stay until the user's erasure; nothing serves them. Before the first `release` line no
  production row exists, so nothing is lost; after it, retirement is refused until the compensation step exists (m7),
  and OQ5 asks the owner only what that step credits.
- **Client saves** are engine.md's: GM2b's step 0 maps `s.puzzles` keys through `renamed.puzzles` (E-P5, lifted in
  GM6c1b), so a save written before `a -> c` holds its run under `c`. A cross-chapter move cannot be expressed in a save
  (one world per chapter): the moved puzzle starts with no run in its new chapter while the server keeps its solve and
  unlocks under the key, and `{correct: false, solved: true}` follows X8's rule.
- **One process per database** (already assumed by the in-memory share window, `lib.rs:58-60`): unchanged, and no
  longer load-bearing here (nothing runs at startup against the data).
- **Cost:** a key map built at content load; 0 per request; no startup scan.
- **Tests.** Server (GM6k): `content_puzzle_key_defaults_to_id`, `content_loads_a_renamed_key`,
  `content_refuses_two_puzzles_one_key`, `content_refuses_key_equal_to_another_live_id`,
  `content_accepts_an_unknown_type_label`, `content_still_loads_format_1`, `rename_serves_rows_under_the_key`
  (progress and a tier-1 unlock written under `ch1.a`; content renames to `c` with `key: ch1.a`: status says solved and
  tier 1 unlocked, `post_hint` tier 1 is `AlreadyUnlocked`, the ledger has no new row), `rollback_then_forward_keeps_unlocks`
  (content N+1 -> N -> N+1 against one database: every start serves the unlock; a tier-2 buy on `a` during N is
  `AlreadyUnlocked` on `c` after; one ledger row per tier), `card_counts_a_renamed_puzzle_solved`. Values (GM6s2):
  `values_row_follows_the_key`. Client (GM6c1b): `story: a deleted record line breaks the chain` (W4),
  `story: a new puzzle without a recorded key is refused`, `story: a deleted puzzle whose key is not retired is refused`,
  `story: a retired key reused as a live id is refused`, `story: a rename chain passes` (m4),
  `story: a rename into a puzzle with its own key is refused` (m4), `story: a retire after a release is refused` (m7),
  `fix-ids: a broken chain is refused, not rewritten`, `fix-ids: a rename moves its key to the new id`,
  `fix-ids: a new puzzle gets its own key`, `fix-ids: a second run appends nothing`,
  `fix-ids: a cross-chapter move serves the new id`, `keys: a log that does not extend the last released log is
  refused` (r3 O1), `emit: a renamed puzzle's server entry carries its key`, `reconcile: step 0 maps renamed puzzle
  runs` (E-P5), `story: the key lint codes are registered once` (r4 W1), `keys: keys.ts imports no node module` (round
  6, r5 m5).

### 3.9 R13: erasure

- LPO's order (`META-PLAN.md:1860-1868` at `525dd68`, m3): children first, one transaction per user, no cascades. `puzzle_values` goes
  after `hint_unlocks`, before `puzzle_progress` (no FK between them; both reference `users`).
- **Data** (GM6k, `server/src/db/mod.rs`), the designed order for the Later `erase-user` command, in clauses that can
  express every rule of it (m6):

```rust
/// LPO's erasure order as data (META-PLAN "Erasure"): one step per table, children first.
pub const ERASURE_ORDER: &[ErasureStep] = &[/* achievement_unlocks, stat_events, hint_unlocks, (puzzle_values: GM6s1),
    puzzle_progress, saves, consents, friend_requests, friendships, friend_blocks, user_handles, invite_codes, referrals,
    resource_ledger, resource_balances, entitlements, payments, unrecorded_refunds (r3 m2), orders, users */];
// auto_refunds has no user column (keyed by charge_id, an FK to payments, 0007_auto_refunds.sql:7-17): it is in no
// step and stays with its payment, as the payment stays for accounting.
pub struct ErasureStep { pub table: &'static str, pub clauses: &'static [Clause] }
pub enum Clause {
    /// DELETE the rows whose `column` is the user, narrowed by `filter` (a fixed SQL predicate, never user input).
    Delete { column: &'static str, filter: Option<&'static str> },
    /// SET `column` = NULL where it names the user (another user's row, or a role that must survive).
    Null { column: &'static str },
    /// Overwrite the user's own row (`users` stays for `payments` / `orders`).
    Anonymize { column: &'static str, set: &'static [(&'static str, &'static str)] },
    /// The rows stay, on purpose, for the stated reason.
    Keep { column: &'static str, reason: &'static str },
}
```

  The mixed rules: `referrals` = `Delete { column: "invitee_id" }` + `Null { column: "inviter_id" }`;
  `resource_ledger` = `Null { column: "counterpart_id" }` + `Delete { column: "user_id", filter: Some("charge_id IS NULL") }`
  + `Keep { column: "user_id", reason: "rows with a charge_id stay with their payment" }`; `payments` =
  `Keep { column: "user_id", reason: "accounting" }` (a non-FK user column, below); `unrecorded_refunds` (r3 m2) =
  `Keep { column: "user_id", reason: "accounting: Stars returned to this payer" }` + `Keep { column: "admin_id",
  reason: "audit: the admin who returned them" }`; `orders` =
  `Keep { column: "user_id", reason: "accounting" }`; `users` = the **root step, last**: `Anonymize { column: "id", set:
  &[("first_name", "''"), ("language_code", "NULL")] }`; the friend tables name both columns. Column names re-located
  from the migrations at GM6k's cut, LRF's migration included (GM6k runs after LRF's merge, W1).

```rust
/// User-id columns that carry no FK to `users(id)`, each with why (W2). The gate fails for an undeclared one.
pub const NON_FK_USER_COLUMNS: &[UserColumn] = &[
    UserColumn { table: "payments", column: "user_id", why: "the payer; no FK so a payment row is never refused (0001_init.sql:15)" },
    // r3 m2, LRF (0007_auto_refunds.sql:26-27): both are Telegram user ids, so both are user columns, and both are kept.
    UserColumn { table: "unrecorded_refunds", column: "user_id", why: "the payer an admin named; no FK, the users row may be gone" },
    UserColumn { table: "unrecorded_refunds", column: "admin_id", why: "the admin who ran /refund; an operator id, not necessarily a users row" },
];
/// BIGINT columns that look like a user id (named `user_*` or `*_id`) without an FK, and are not one. Empty today.
pub const NOT_USER_COLUMNS: &[UserColumn] = &[];
pub struct UserColumn { pub table: &'static str, pub column: &'static str, pub why: &'static str }
```

- **Gate** (`tests/it/schema.rs`, on the migrated schema; W2). Let `U` = every (table, column) with an FK to
  `users(id)` (`pg_constraint`, `contype = 'f'`) ∪ `NON_FK_USER_COLUMNS` ∪ the root (`users`, `id`).

| Test | Fails when | Seen red on |
|---|---|---|
| `erasure_order_covers_every_user_table` | a member of `U` is named by no clause of its table's step | a seeded mutation: `hint_unlocks` dropped (`hint_unlocks.user_id references users but no ERASURE_ORDER clause covers it`); again at GM6s1's migration until `puzzle_values` joins |
| `erasure_order_names_no_stale_column` | a clause names a (table, column) outside `U` | a clause naming `hint_unlocks.player_id` |
| `erasure_order_ends_with_the_users_root` | `users` is not the last step, holds anything but exactly one `Anonymize { column: "id" }`, or another step anonymises or deletes from `users` | `users` moved before `entitlements` |
| `erasure_non_fk_user_columns_are_declared` | a BIGINT column named `user_*` or `*_id` with no FK to any table is in neither `NON_FK_USER_COLUMNS` nor `NOT_USER_COLUMNS`; or a declared entry does not exist or has an FK to `users` (stale declaration) | **the real tree** before `NON_FK_USER_COLUMNS` is filled: the query returns exactly `payments.user_id`, `unrecorded_refunds.user_id` and `unrecorded_refunds.admin_id` (CODE: 0001-0007 on `d31f720`; `id` columns are not `*_id`; `charge_id` columns are TEXT), each named in the message (`<table>.<column>: a BIGINT user-like column without an FK, not declared`) (r3 m2) |

  So a future table keyed like `payments` cannot escape: it is either an FK column, a declared non-FK user column, or a
  declared non-user column, and the Later `erase-user` command written from `ERASURE_ORDER` deletes nothing `orders`
  still references and anonymises `users` as META-PLAN promises (`META-PLAN.md:1866-1867`).
- **Docs (GM6s1):** META-PLAN's inventory row "Puzzle progress, hint unlocks" (`:1841`) and the erasure paragraph (`:1860-1868`) gain
  `puzzle_values`; `docs/runbooks/privacy-ops.md` gains the step. LRF's two tables get their rule in the same commit
  unless docs-errata-9 (running, it holds both docs, RULINGS 131) already wrote one (r3 m2: no doc gives it today):
  `unrecorded_refunds` kept for accounting and audit, `auto_refunds` kept with its payment (§14 Q10). The policy text already promises deletion of "puzzle
  progress and opened hints" (`privacy-policy.html:592-595`); whether it must name drawn codes is OQ6 (legal text).
  **Round 5:** docs-errata-9 (merged `525dd68`, RULINGS 133) already wrote LRF's rule into `privacy-ops.md` (the access
  read `:113-117`, `:125-126`; erasure "touches neither `auto_refunds` nor `unrecorded_refunds`", `:155-157`), which is
  what `ERASURE_ORDER`'s `Keep` clauses say. So GM6s1's docs commit adds only `puzzle_values`: a `SELECT` line in the
  access block (`:120-142`), a `DELETE` after `hint_unlocks` in the erasure block (`:165`), and META-PLAN's inventory row
  and erasure paragraph (§14 Q10 resolved).

### 3.10 Migrations

One file, `0008_puzzle_values.sql` (§3.1; `0007` is LRF's, E-P11), in GM6s1. GM6k adds no table: keys need no migration (key = id for every
existing row) and the erasure order is code. No data migration exists anywhere in this design.
