## 9. Lanes

All lanes: red-first per commit, the gate commands of CLAUDE.md, every test counted by name, every new gate seen
failing on the named mutation. Locks are the expected touch set on main; each cut re-locates them. Twelve lanes
(round 1: seven; round 2: eleven): GM6s split in two (m4), GM6r became GM6k (W5), GM6c1 and GM6c2 split by subsystem to
stay inside ~15 files once W2 and W4 added their files; round 3 adds **GM6t** (toast motion, W6). The shared-file
table at the end of this section names every other holder; engine.md §12's table owns the order of every file both
designs hold (m9).

### GM6a `scene-anchors` (client)

- **Goal.** §6.1, behaviour-identical for today's stage: the e2e pixel samples and `debugPropRects` unchanged; plus
  E-P1's `at`-keyed prop anchors with the in-anchor image crossfade and the patch child.
- **After** M3c (`scene/controller.ts`) and engine.md's GM2a (`PropPlacement.at`); **before** the first animation or
  shot lane holding `scene/*` (MD2, then MA1a, MA1b, MA2, MR1, MR2 in `characters.md` rev. 3 §11.7: `GM6a -> MD2 ->
  ...`; `design-shots` re-sets the names, RULINGS 132) and GM6d1; never beside any lane holding `scene/*` (r3 W2).
  **Reconcile P2 (shots I-2, I-9, §9.14):** `GM2a's field -> GM6a -> SH1 -> SH4 -> ...`: before SH1, so before SH4.
  **Commit 1 builds `AnchorRef`** (§6.1: `anchor > depth > motion > content`, the batch motions on `anchor`, the art,
  patch and later labels in `content`); added test `executor: an anchor's art lives in its content node` (predicted
  red: the sprite's parent is `anchor`), and commit 4 gains `scene: content follows the anchor, depth and motion nodes`
  (move each of the three outer nodes, read the sprite's bounds). Mutation **M-PR1i**: the art parented to `anchor`
  (red: both tests). Engine row ~+0.15 KB br (was +0.13).
- **Lock (4):** `client/src/scene/executor.ts`, `client/src/scene/executor.test.ts`, `client/src/scene/controller.ts`
  (`pixiAdapter` and `createLayers` become named exports for the test; `:136`, `:148`),
  `client/src/scene/adapter.svelte.test.ts` (new; decided, r3 m9: vitest's happy-dom project, `vite.config.ts:59-60`,
  because the node project has no `document` and no vitest imports `pixi.js` today; Pixi `Container` / `Sprite` need
  no renderer for a transform test). If even happy-dom cannot import `pixi.js`, the cut is BLOCKED and names it: the
  e2e form needs a debug hook in `app/game.ts`, which GM6a does not hold.
- **Commits:**
  1. the adapter's `anchor`; views carry `node`; bg / cg placement through the anchor. Red
     `executor: a bg crossfade fades the anchors, not the sprites` (predicted: the fake's `set` log shows
     `{sprite: n}` where `{group: m}` is expected; `adapter.anchor is not a function` means the fake was not updated).
  2. props: `executor: a prop's box is its anchor's position and its sprite's size`, `executor: a taken prop's anchor
     fades out with its sprite`, `executor: a prop whose image changes at the same anchor crossfades inside it`
     (E-P1; predicted red: two anchors in the fake's live-group log), `executor: a patch is a child of its base anchor`,
     `executor: prop anchors follow the command's order` (E-P7; predicted red: a state image added at the same `at`
     lands last in the fake's layer order, `executor.ts:461-473` appends).
  3. rebind / relayout / reacquire / destroy: `executor: rebind re-creates each anchor before its sprite`,
     `executor: destroy leaves no anchor alive`.
  4. Pixi adapter (`adapter.svelte.test.ts`): `scene: an anchor's children share its transform` (the adapter over a
     bare `Container` stage: move and scale the anchor, read the child sprite's `getBounds()`), `scene: a prop sprite
     sits at the anchor's origin` (the sprite's global box equals the placement box, not twice its origin); predicted
     red on the parent: TypeError, `adapter.anchor is not a function`; a different red (an import error from
     `pixi.js`) is the STOP above.
- **Gates:** check, test, build (engine row; ARITHMETIC +0.13 KB br, one figure, r3 m4; reconcile P2: +0.15;
  MEASURED in the log; the first-line row quoted base -> HEAD at the cut, §10 "Ledgers"), e2e full (pixel samples,
  memory, perf unchanged).
- **Conflicts:** the motion lanes target anchors from here on (orchestrator forwards §12 R-A1-R-A6 and R-A9 to
  `design-animation` / `design-shots`).

### GM6k `puzzle-keys` (server slot)

- **Goal.** §3.8's server half, §3.9's data and gate, the opaque `type`, content format 2 with `key` only.
  Behaviour-identical for today's content (key = id everywhere).
- **After** **LRF's merge** (done, `a93fe54`: `server/tests/it/refunds.rs` is LRF's money area, RULINGS 126; its
  `0007_auto_refunds.sql` is in the schema the erasure gate reads). **By launch against M3s, never beside** (both hold
  `server/src/content.rs` and `server/tests/it/content.rs`, `MEMORY-PLAN.md:1328-1329`; round 3 said "after M3s",
  but RULINGS 132 re-sets M3s's order with `design-shots`, so GM6k does not wait for it; the later cut re-locates).
  Before GM6s1. Unblocks engine.md GM7p (opaque `type`, R-E12).
- **Lock (15):** `server/src/ids.rs`, `server/src/content.rs`, `server/src/puzzles/mod.rs`, `server/src/db/puzzles.rs`,
  `server/src/db/economy.rs`, `server/src/db/achievements.rs`, `server/src/db/mod.rs`, `server/src/api/puzzles.rs`,
  `server/src/api/cards.rs`, `server/tests/it/content.rs`, `server/tests/it/puzzles.rs`, `server/tests/it/cards.rs`,
  `server/tests/it/refunds.rs` (one hunk: `refunds.rs:421` builds a `PuzzleKey`, `:423` calls `spend_hint`; W1, r3 m2),
  `server/tests/it/schema.rs`, `docs/runbooks/deploy.md`. The cut re-runs the call-site grep of §1 on its base, in two
  parts (r3 m3): **repo calls** `\.(spend_hint|record_attempt|is_solved|unlocked_tiers|card_puzzles)\(` over
  `server/tests`, `server/dev`, `server/src`: a hit outside this lock is a STOP item; **constructors** `PuzzleId\(`: the
  expected hits outside the lock are exactly `server/src/meta.rs:679` and `:704` (meta-fact test helpers keyed by the
  meta index's ids, which stay `PuzzleId`), any other is a STOP item.
- **Commits (4):**
  1. `PuzzleKey`, `PuzzleDef.key` = id, every repo call on `&PuzzleKey` (`refunds.rs:421-423` included), the
     achievements read translated. Red `content_puzzle_key_defaults_to_id` (predicted: E0609 no field `key` on
     `PuzzleDef`; an E0308 at a `spend_hint` / `record_attempt` call means a call site is missing from the commit; a red
     in an existing `attempt_*` / `hint_*` / `card_*` / `economy_*` / `refund_*` test means a call site changed
     behaviour). Every existing test of those families stays green, counted by name.
  2. format 2 with `key` + the opaque type: `content_loads_a_renamed_key`, `content_refuses_two_puzzles_one_key`,
     `content_refuses_key_equal_to_another_live_id`, `content_accepts_an_unknown_type_label`,
     `content_still_loads_format_1`, `rename_serves_rows_under_the_key`, `rollback_then_forward_keeps_unlocks`,
     `card_counts_a_renamed_puzzle_solved`. Red: `format 2, expected 1` (`content.rs:793-795`); a red that is an
     unsolved status or a second ledger row means a route still keys by the id.
  3. `ERASURE_ORDER`, `NON_FK_USER_COLUMNS`, `NOT_USER_COLUMNS` and the four gates of §3.9 (W2). Order: first
     `erasure_non_fk_user_columns_are_declared` with `NON_FK_USER_COLUMNS` empty, red on **the real tree's** three
     undeclared columns, `payments.user_id`, `unrecorded_refunds.user_id`, `unrecorded_refunds.admin_id` (r3 m2; a
     red naming fewer or more means the query or the schema differs from §3.9: re-read before going on); then the
     three declarations; then `erasure_order_covers_every_user_table` seen red on the seeded
     mutation (`hint_unlocks` dropped from the list), `erasure_order_names_no_stale_column` on a clause naming
     `hint_unlocks.player_id`, `erasure_order_ends_with_the_users_root` on `users` moved before `entitlements`; then
     green on the full list (`payments`, `unrecorded_refunds` and `orders` kept, `users` anonymised last). LRF is
     merged, so its clauses are in this commit from the start (§3.9).
  4. `deploy.md`'s rollback paragraph: one sentence (§3.8). **Ruled since: RULINGS 160 / 161** — the sentence is a carry for a docs lane after GM6k merges (`docs-adopt` held `deploy.md`); GM6k's lock drops `deploy.md` and takes `server/tests/it/stats.rs` (the erasure order's allow-list row), 15 files.
- **Gates:** `cargo fmt --all --check`, clippy `-D warnings`, `cargo test --workspace --all-targets --no-fail-fast`
  (names counted; PostgreSQL 18 slot), e2e full through the kit with a `server-dev` built from the lane (routes
  behaviour-identical).
- **Conflicts:** `content.rs` never beside M3s (by launch); `tests/it/refunds.rs`, `db/economy.rs` and `api/cards.rs`
  after LRF's merge and held by no other open lane (re-checked at the cut against any meta or money lane).

### GM6s1 `values-domain` (server slot)

- **Goal.** §3.1, §3.2: the table, the domain, the draw, `render`, the shared vectors, `MAX_ANSWER_LEN` 64,
  `puzzle_values` in the erasure order and the docs. No route, no content change.
- **After** GM6k. Unblocks engine.md GM7g (`MAX_ANSWER_LEN` 64, R-E12).
- **Lock (9):** `server/migrations/0008_puzzle_values.sql` (new; E-P11), `server/src/puzzles/values.rs` (new),
  `server/src/puzzles/mod.rs` (`pub mod values`, the constant), `server/src/db/mod.rs` (`ERASURE_ORDER` +=
  `puzzle_values`), `server/tests/it/puzzles.rs`, `server/tests/it/schema.rs`, `server/tests/fixtures/values/vectors.json`
  (new), `docs/META-PLAN.md`, `docs/runbooks/privacy-ops.md`.
- **Commits (4):**
  1. migration + its erasure clause: `schema_puzzle_values_pk`, `schema_puzzle_values_checks` (each CHECK by
     `(SQLSTATE, constraint)`), `values_row_size_measured` (R12). Red: `relation "puzzle_values" does not exist`; with
     the migration alone `erasure_order_covers_every_user_table` is red (`puzzle_values.user_id references users ...`),
     the gate seen failing on a real table; the clause makes it green.
  2. `values.rs`: `values: draw is uniform over a small domain` (an injected PRNG, chi-square over 10^5 draws),
     `values: draw rejects the top of the u32 range` (an RNG returning `u32::MAX` first: never `% n`),
     `values: draw never returns initial or an excluded value`, `values: domain sizes match the vectors`,
     `values: render matches the vectors`, `values: a sparse domain is refused at parse`, `values: debug output
     redacts the code` (m12: `Domain`, `ValueRow`; seen red on the mutation `#[derive(Debug)]` on `ValueRow`). Red:
     `unresolved import crate::puzzles::values`. `pub` items of the library crate, so no `dead_code` until GM6s2 calls
     them.
  3. `attempt_answer_len_64_accepted`, `attempt_answer_len_65_400` (a format-1 fixture edited to 64 entries through
     `FixtureCopy::edit_json`). Red: 400 on 64 entries.
  4. docs: META-PLAN's inventory row and erasure paragraph; `privacy-ops`'s access line and erasure step for
     `puzzle_values` (`privacy-ops.md:120-142`, after `:165` at `525dd68`). LRF's two tables already have their rule
     there (docs-errata-9, §3.9, §14 Q10 resolved).
- **Gates:** the server gates; link check of the two docs.

### GM6s2 `values-routes` (server slot; both sides of the HTTP contract)

- **Goal.** §3.3's per-player half, §3.4-§3.7: the values and restart routes, per-player attempts with the server cap
  and the 409, hint rendering through `current_value`, the HTTP contract on both sides.
- **After** GM6s1, and after the **entry lever** (RULINGS 127: the `MetaEndpoints` split, `endpoints.ts:189-193`), since
  commit 2 adds entry code (§14 Q8; m8). Format 2 with `perPlayer` is accepted from here on; nothing emits it until
  GM6c1a. **Reconcile P4:** the entry lever is merged (LEL, RULINGS 141; `7b37278`), so this "after" holds; LEL moved
  `META_KINDS` to `client/src/api/meta.ts:206-227`, typed `satisfies Record<ErrorCode, MetaError['kind']>`, so the new
  `ErrorCode` `value_changed` fails `check` until it is mapped there (`value_changed: 'unavailable'`): the lock gains
  `client/src/api/meta.ts` (16 -> **17**, stated: the contract unit grows by the one file `tsc` forces). Its bytes ride
  the meta controller chunk (one row, ~0.004 KB br, ARITHMETIC 1 x 4.3 B), not the entry.
- **Lock (17; round 10: 16, + `client/src/api/meta.ts`, reconcile P4):** `server/src/content.rs`, `server/src/db/puzzles.rs`, `server/src/puzzles/mod.rs`,
  `server/src/api/puzzles.rs`, `server/src/api/mod.rs`, `server/src/api/dto.rs`, `server/src/error.rs`,
  `server/tests/it/puzzles.rs`, `server/tests/it/dto_samples.rs`, `server/tests/fixtures/values/content-v2.json` (new),
  `client/src/api/generated/api.ts`, `client/src/api/decode.ts`, `client/src/api/decode.test.ts`,
  `client/src/api/endpoints.ts`, `client/src/api/endpoints.test.ts` (new), `client/src/api/fixtures/dto-samples.json`.
  16 > ~15 on purpose: `bindings_are_fresh`, `dto_samples_are_fresh` and `decode: rust dto samples decode` tie
  `dto.rs` to the four client api files byte for byte, so the contract moves as one unit; the server-only half is
  GM6s1 already (m4's split taken).
- **Commits (7), the DTO change in exactly one (W3):**
  1. content format 2 per-player: `content_loads_format_2_per_player_puzzle` (the content-v2 fixture),
     `content_refuses_per_player_below_floor`, `content_refuses_hint_placeholder_of_another_puzzle`,
     `content_refuses_max_attempts_without_per_player`, `content_refuses_answer_len_over_64`. Red: ``unknown field
     `perPlayer` ``. Until commit 4 the attempt route answers a per-player def 404 and the status route renders its
     templates unrendered (arms inside the lane, replaced by commits 4 and 7, never merged).
  2. **the HTTP contract, both sides, one commit:** `dto.rs` (every new and changed DTO, `ApiErrorBody.value`),
     `error.rs` (`ValueChanged`), `dto_samples.rs` (samples for `ValuesResponse`, `PlayerValue`, `RestartRequest`, the
     new fields, `value_changed`), `api.ts` regenerated (`write_bindings`), `dto-samples.json` regenerated, `decode.ts`
     (decoders, `ERROR_CODES`), `decode.test.ts` (`NAMES`, `MALFORMED`), `endpoints.ts` (`getValues`,
     `restartPuzzle` inside `createEndpoints`, `api/endpoints.ts:71-100`, under GM3p's port row, so no request-site row
     is needed for them, E-P23 (a) corrected; `postAttempt`'s `run`), `api/meta.ts` (`META_KINDS`' `value_changed`
     row; reconcile P4: round 10 placed `META_KINDS` in `endpoints.ts`, where it was before LEL), `endpoints.test.ts`. `HintUseResponse` is not changed (m3). The handlers
     fill the new fields with their static-puzzle values (`attemptsLeft: null`, `spent: false`, `valueRun: null`).
     Red: client `endpoints: values and
     restart routes` (TS2339 `getValues` missing on `Endpoints`) and server `dto_samples_are_fresh` (the new types
     unsampled). From this commit on `bindings_are_fresh`, `dto_samples_are_fresh` and `decode: rust dto samples decode`
     are green and stay green: commits 3-7 change no DTO.
  3. issue + the values route: `values_issued_once_per_user`, `values_issue_concurrent_one_row`,
     `values_issue_two_tabs_no_deadlock`, `values_paid_chapter_403_without_entitlement`, `values_private_no_store`,
     `values_empty_for_a_chapter_without_per_player`, `values_row_follows_the_key`. Red: 404 (no route).
  4. per-player attempts: `attempt_per_player_compares_own_value`, `attempt_per_player_before_fetch_issues_value`
     (round 8: the runless attempt issues the row and answers 409 with it, nothing compared),
     `attempt_without_run_409_not_compared` (round 8, r7 W2: a live row, the right value sent with no `run`: 409
     `value_changed` with the row, `wrong` unchanged, `solved_at` still NULL; seen red on round 7's step 4, which
     compares a runless answer and answers 200 `correct: true`),
     `attempt_stale_run_409_value_changed_not_counted`, `attempt_window_counts_before_value_read` (the 21st in the
     window is 429 and reads no value), `attempt_409_carries_private_no_store`, `attempt_static_ignores_run` (m11: a
     static puzzle answered with `run: 7` is compared as today, 200), `attempt_debug_redacts_the_code` (m12; seen red
     on the mutation `#[derive(Debug)]` on `PlayerValue`). The existing `attempt_*` names stay green. Red: 404 from
     commit 1's arm.
  5. the server cap: `attempt_final_wrong_spends_run` (the 200 says `spent: true`), `attempt_on_spent_run_409_not_compared`
     (W1: a same-run answer on a spent run is 409 with the spent value, `wrong` unchanged; round 8: a runless one is
     409 by commit 4's rule),
     `attempt_uncapped_never_spends`, `attempt_solved_replay_counts_and_spends`.
  6. restart: `restart_redraws_spent_run`, `restart_live_run_noop`, `restart_stale_from_returns_current`,
     `restart_concurrent_one_redraw`, `restart_solved_keeps_value_new_run`, `restart_static_puzzle_404`,
     `restart_paid_puzzle_403_before_per_player_404` (m11). Red: 404 (no route).
  7. hints and content updates: `hint_tier3_renders_own_value`, `hint_unlock_survives_restart_shows_new_value` (MONEY),
     `status_reports_value_run`, `status_after_domain_change_renders_a_fitting_value` (m10),
     `values_domain_change_keeps_fitting_value`, `values_domain_change_redraws_misfit_new_run`,
     `values_domain_change_races_an_attempt_redraws_once` (r3 m8: a values call and an attempt on a misfit row at once
     end at `run + 1` exactly, one re-draw; seen red on the mutation "the guarded update drops `AND domain = $old`",
     which re-draws twice). Red: the text holds `$code(drawer)` verbatim.
- **Gates:** the server gates (names counted), client check + test (the api tests), build (entry row MEASURED;
  ARITHMETIC ~+0.09 KB br, ~21 lines; reconcile P4: the entry, first-line and all-JS rows quoted base -> HEAD at the
  cut against §10 "Ledgers", STOP if a sum crosses its LIMIT), e2e full through the kit (the attempt DTO gained fields; old clients ignore them,
  `decode.ts:3`; the server ignores unknown request fields, `dto.rs:179`).
- **Conflicts:** the server files after GM6k / GM6s1; the client api files: no lane of either design holds them.
