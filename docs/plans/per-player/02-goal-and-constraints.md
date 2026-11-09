## 2. Goal and constraints

- **Goal.** A puzzle the author marks gets a value per player, drawn and stored by the server, shown on every clue
  surface (world texts, ink lines, art labels, tier-3 hint), checked by the server, re-drawn only by O2's trigger.
  Correctness targets: no value in any public file or save; no paid hint unlock lost or charged twice by a rename or a
  re-draw; no attempt judged against a value the client did not display; every motion carries the labels.
- **Budgets.** 0 extra RTT before the first line: the fetch starts when the chapter is entered (after its load, before
  its first step, m2) and runs beside the stage restore, the first step and the first line; nothing waits on it, and a
  placeholder on the first line shows the mask until it lands; 0 requests for a chapter
  without per-player puzzles; engine growth ~3.00 KB br over the six client lanes (ARITHMETIC per lane, §10; round 10) against
  the MEASURED rows at `48bc82a`: engine 214.2 / 230.0 KB, first line 257.2 / 270.0 KB (engine.md §0 R1,
  `lfu3-client-followups/k/final-build.log:93-97`), shared with engine.md's +1.53 KB br (its round 9, [engine §0 Decision table](../engine/00-decision-table.md#0-decision-table) as read) and
  the animation / shot lanes;
  entry growth ~0.35 KB br (GM6s2 ~0.09, GM6t ~0.26; r3 W1: no Svelte transition runtime and no new main-table
  string enters the entry) against 0.6 KB headroom (MEASURED 39.4 / 40.0 KB after M3c, RULINGS 127), both lanes after
  the entry lever (RULINGS 127, §14 Q8). The rows' LIMITs are the gates;
  each lane reports its MEASURED delta and stops at the cut when it passes its estimate by > 0.5 KB br (engine.md §3.5's
  rule). Label textures <= 2 MiB per room (lint) inside the unchanged 32 / 48 MiB caps. **Reconcile P4 (supersedes the
  figures and bases above; reconcile r2, W1: this file prints no ledger total):** engine growth **+3.11 KB br**
  (reconcile r3: **+3.13**, GM6d2's labels job, critique_perplayer_r2 W1),
  entry **+0.35**, meta controller +0.004 (this file's terms, §10 "Ledgers"); the sums of the three designs, without
  and with LFL, and their verdicts are engine.md §11.1's, the one shared ledger (E-P25; RULINGS 143 QO10); every lane
  quotes §11.1's rows base -> HEAD at its cut, with this file's terms for the GM6 lanes still open, and STOPs on a
  crossing (shots I-13). The `LABELS_BOUND` of the shots' step window equals this lint's 2 MiB room bound (pinned,
  GM6d2).
- **Principles.** 0 (domain and values never public; paid chapters' values route gated), 1 (draw, compare, spent,
  restart: server; the client caches), 2 (no new payment path; unlocks keyed independent of the value), 3 (bearer as
  built), 4 (labels counted by the room-set gate), 5 (`activated` refresh; no new platform API), 6 (no new dependency),
  7 (the scene gets rendered strings; ink holds templates), 8 (placeholder lines keep their IDs; ru / en parity).
- **Invariants that must survive.** The window counts before any answer is applied (`db/puzzles.rs:23-27`); one debit
  per tier (`economy.rs:376-382`); lock order progress -> values (synthesis §4.2); `resume()` stays synchronous
  (synthesis §3.3); saves hold no value.
- **Platform.** Nothing new per platform: canvas 2D text on generic families exists in WKWebView and Android WebView;
  the `activated` event is already handled (`game.ts:1815-1834`).
