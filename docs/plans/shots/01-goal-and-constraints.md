## 1. Goal and constraints

**Player outcome:** dialogue is staged as a film:
- an establishing wide, then shot / reverse shot and reaction shots;
- every frame a real drawing with the scene's light;
- every visible face blinks, moves its brows, and moves its mouth when it speaks, in every framing (S30);
- figures breathe and sway, hair moves, the camera pushes and drifts, depth layers parallax by up to 8 x 5 CSS px in
  dialogue shots and 4 x 3 CSS px in rooms (S19), the room flickers and moves, state loops run where the world says.

**Correctness and budget targets (enforced by gates, not review):**
- **Memory:** live textures <= 32 MiB steady (`STEADY_CAP_BYTES = 33,554,432`, `client/src/scene/registry.ts:14`) and
  <= 48 MiB hard (`:16`); transients <= 16 MiB (CH D14); textures <= 2048 px (`:18`).
  - Gate: `step-window <ch>` (SH3b) — the static bound of every step's window.
  - e2e: `__novelDebug.stats().scene` stays under the caps across a cinematic knot (SH6).
- **Cuts** (rev. 4, C1, W1; each part has its e2e):
  - a **certain** next image is requested at the first step whose window admits it and is resident from at least the
    presented step before it appears (gate `step-window`, §3.4); a cut to it never fetches when the link delivered it
    during that step. e2e `shots: a cut never waits for its plate` (SH5a; it taps once the window's `need` is resident,
    `stats().scene.window.pending === 0`, so it tests the steady window, not the entry);
  - a **branch** cut (a choice, a condition, an explore event or leave) never fetches once the link delivered its
    opener during the branch step: the opener is held as bytes from the branch point (S32) and waits at most one
    decode (S-D (1c): E <= 250 ms p95); rev. 5 (m3): a room's own openers are fetched before EN's neighbour shots.
    e2e `shots: a choice cut decodes from bytes held since the choice` (rev. 6, W3: SH11, the first lane whose
    content has the shape, §10 fixture ledger; SH5a: integration `window: a choice cut decodes from the bytes held
    since the choice`);
  - (rev. 5, W2) **inside a room event** both rules hold unchanged: a refused window item evicts EN's `room:*`
    holders at any step (the event's own room last; rev. 7, W2: on every path, through the window's `eventRoom`
    class, evicted after every other family, §5.8 step 6 (d); rev. 6's `hope` tail went first where it alone held the
    room), and the return to the room is the event's last step's certain appearance, so it is resident from that
    step (gate-charged, §3.4). e2e `shots: an exchange inside a room event never waits` (rev. 6, W3: SH11; SH5a:
    integration `window: an exchange inside a room event loads no cut at its tap`);
  - (rev. 6, W1) **in a chapter's ending knot** both rules hold too: a refused window item evicts the next chapter's
    `next:*` holders after EN's (§5.8 step 6 (c)), and the handover then enters the next chapter at the half tier
    (S23). Unit `preload: a refused need evicts the next chapter's holders`, integration `window: an ending knot's
    cuts load none at their tap while the next chapter is held` (SH5a);
  - (rev. 7, W1) **at the handover** a landed `next:` preload is not lost: the scheduler releases `next:<id>` only after
    the next chapter's first window joined its files (S36), so only the files that did not land start at the half
    tier. Unit `preload: the first window after a chapter change joins the next chapter's files, then releases its
    tag`, integration `window: a handover whose preload landed fetches nothing for its first window`, `game: a
    handover leaves the next chapter's tag to the scheduler` (SH5a);
  - **after an entry** (fresh start, resume, a missed handover) the first cut's half files are requested beside the
    visible upgrade; on the e2e link it is resident at the half tier ~1.2 s after the first line and sharp at ~4.7 s
    (A, §5.8 entry step 4; rev. 5, m6: one RTT per file); a tap before that waits for its half files at visible
    priority. e2e `shots: after an entry the first cut's half files are requested beside the upgrade` (SH5b), stated
    in OQ15.
- **TTFL:** <= 6 s throttled, the existing limit. Today 4,059 ms MEASURED at 200,000 B/s + 150 ms RTT (S4 :16-17).
  - Gate (rev. 3): `entry step images` <= 279,000 B per chapter: the maximum over every step a session can enter at
    (fresh start or resume) of the top image's **half-tier** bytes plus the chapter files the first line awaits,
    derived from the TTFL budget (S23, §5.11). The full tier sharpens in place after the first line.
- **Per-chapter download:**
  - ~6.16 MB of images at 20 shots with one changed expression per face (A, §5.11; rev. 3, m1).
  - With audio ~9.24 MB, over `transfer` 6 MB (`budget.ts:122`). This is owner question OQ5 (default 12 MB).
  - (rev. 5, m4) each further expression of a face adds its face + talk files, ~49 KB at CU size: ~10.6 MB at OQ17's
    typical count (2.5 per face), ~12.8 MB at its maximum (5) on every face of the 12 dialogue shots (A, §5.11), so
    OQ5 and OQ17 are asked together.
- **Paid content:**
  - every paid-only plate, sheet, face and talk file is gated and served after the entitlement check (`content.rs`,
    unchanged; rev. 4: no `gsheet`);
  - `scan-dist` derives the paid-only shot files itself, fails closed on a missing fingerprint, and fails any
    shot-family file in `dist/` whose id it does not derive as public (SH3a; rev. 4, W3).
- **Engine JS:** about +6.15 KB br in the engine closure (rev. 7: + 0.1 for the synchronous joins, the entry tag and the
  `eventRoom` class; rev. 6: + 0.1 for the recency re-insert, step 6 (c), the
  `next:*` tail class and `withEventRoom`; rev. 5: + 0.2 for W2's eviction, m3's queue, m1's slots; rev. 4, m3: + the `story/shots.ts` decoders 1.0, SH1 0.3,
  the warm form 0.3, room windows 0.1, the entry window 0.05, face files 0.1; − `flatten` 0.8, reached through the
  chunk from SH7 on) and +6.0 KB br in the lazy `scene/motion/` chunk over SH4-SH10 (E, §10); measured per lane
  against the engine row (230,000 B, `budget.ts:107`), the new chunk row (8,000 B), **the first-line row** (270,000 B,
  `budget.ts:108`) and (rev. 3, m5) **the all-JS row** (305,000 B, `budget.ts:114`); both ledgers across EN, PPL and
  this design are in §10 (S31). Entry +0.0-0.1 KB br (`catalog.ts` namespaces only; entry row 39.4 / 40.0 KB br per CH D26 — verify at SH3a's
  cut).

**Principles in play:**
- 0: the tier split per file (plates, sheets, face and talk files; rev. 5, m9), scan-dist's own derivation.
- 1: saves and entitlements unchanged.
- 4: budgets above.
- 5: audio and gestures unchanged; `deactivated` / `activated` (§5.10).
- 6: Pixi only in `scene/`, GSAP only in `executor.ts` (`client/src/arch.test.ts:160-165`).
- 7: the scene reads no story state; GameSession passes opaque step keys and talk calls.
- 8: line IDs untouched; new lines only through the normal tool.

**Platform:**
- **iOS WKWebView / Android WebView:** no Service Worker; the HTTP cache serves public immutable files; paid files
  are `no-store` (`content.rs:20-25`).
- **Portrait stage:** the stage is `aspect-ratio: 9 / 16`, full-bleed on taller screens and pillar-boxed in black
  on wider ones (`client/src/ui/Stage.svelte:42-49`); rest framing is `cover()` (`cover.ts:25-28`), which takes the
  larger of the two scales (rev. 2, W1). A 1080 x 2048 plate covers **by height** on a 9:19.5 phone (visible
  945 x 2048 source px, 135 px of horizontal slack) and **by width** on the 9:16 stage (visible 1080 x 1920, 128 px of
  vertical slack); a 1440 plate covers by height on both (visible 945 or 1152 of 1440) (A, S4 §3.8).
- **Telegram Desktop:** the stage is wider and taller. The snapshot target is capped at 2048 px per side (§5.9).
- **LOW Android:** half tier (M3c), render resolution 1, `AMBIENT_FPS.LOW = 20` (CH §6.3).

**Rulings that bind:**
- RULINGS 132: shots replace the character design; its runtime parts are inputs.
- RULINGS 12 and 14: PostgreSQL everywhere (no server change here).
- EN §8 owns the cue channel, the presenter and the motion gate (consumed in SH10, not redesigned).
- PPL §6 owns labels and anchors (GM6a before every shot lane on `scene/*`, R-A10).
