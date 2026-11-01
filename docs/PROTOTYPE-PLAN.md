# Architecture: prototype vertical slice

Status: design (campaign deliverable, architect round 1, 2026-10-30; revision 15 — see [Revision log](#revision-log)).
Extended by [PUZZLES-PLAN.md](PUZZLES-PLAN.md) (RULINGS 10: puzzles, exploration, inventory, paid hints). Every
decision that extension changes is marked "changed by PUZZLES-PLAN" here, and the lane cut below is re-cut for it
(revision 3).
Extended by [STORIES-PLAN.md](STORIES-PLAN.md) (RULINGS 20: several stories with their own casts, the first chapter
of each free, saves per story, the player-statistics foundation). Every item that extension changes is marked
"changed by STORIES-PLAN" here, and the lane cut below is re-cut for it (revision 11).
Inputs:
- spec `D:/tmp/novel-orch/design/spec.md`;
- RULINGS 1–5 (`D:/tmp/novel-orch/RULINGS.md`);
- `D:/tmp/novel-orch/inventory.md`;
- research R1–R4 (`D:/tmp/novel-orch/design/research_R*.md`);
- the owner's stack research (repo root).

Companion contract: [STAGING-DSL.md](STAGING-DSL.md) (the ink tag language).

Labels:
- **[R1]–[R4]**: a research report (verified facts).
- **[O]**: the owner's stack doc.
- **verify:** a fact not yet confirmed; the named lane confirms it before relying on it.

---

## Goal

A vertical slice that proves the whole stack end to end, locally in a plain browser against a mock Telegram
environment (RULINGS 5), deployable to a real bot later by the owner (bot token + HTTPS URL).

The player:
1. taps to start;
2. plays free chapter 1 (choices, state, staging, music);
   - explores a few rooms (changed by PUZZLES-PLAN): taps doors, picks up items and documents, inserts three found
     items into a gate, solves a code lock and an order puzzle, buys a hint with (mock) Stars; the outcomes branch
     the story;
3. saves, reloads and resumes;
4. reaches the paywall;
5. buys chapter 2 with (mock) Stars;
6. plays chapter 2, which reacts to chapter-1 choices.

Changed by STORIES-PLAN: the game holds several stories with their own casts. Boot lands on Home (Continue + one
card per story); steps 2–6 are story A, `manor`; the player also plays story B, `tide` (its first chapter free, its
second bought), meets a story ending ("The End") and returns to Home, and each story keeps its own saves. The server
records chapter, ending and puzzle facts per story ([STORIES-PLAN "Goal"](STORIES-PLAN.md#goal)).

**Correctness targets** — each is a gate, not a review item:

| # | Target | Proved by |
|---|---|---|
| T1 | No paid chapter JSON, paid English table or paid art in `client/dist/` or under any public/static route | `scan-dist.ts` in `build`; `paid_chapter_403_without_entitlement` test |
| T2 | Grant only on `successful_payment`, exactly once per `telegram_payment_charge_id`, even under concurrent redelivery; refund revokes | server integration tests (per-test PG database; deterministic two-connection races; changed by RULINGS 14, decision section 6) |
| T3 | `pre_checkout_query` answered < 7.5 s worst case, typically < 50 ms + one Bot API call | `precheckout_*` tests with a fake gateway and paused time (as merged, L8b cut Q2: real time, 5.0 s ≤ elapsed < 7.5 s, since tokio's `test-util` is off and a paused clock would fire the timers falsely while sqlx waits on socket I/O; see "Test strategy") |
| T4 | Identity only from server-verified initData (HMAC, constant time, `auth_date` window) | initData vector tests (independently signed fixtures) |
| T5 | A save from an older story version resumes (exact → knot checkpoint → chapter start), never throws; an ink error after a resume steps the next resume down a level, never loops | `resume_*` vitest tests on edited fixture chapters, incl. `resume: ink error after checkpoint resume falls back to chapter start` |
| T6 | Every player line and choice has a unique, stable line ID; English complete for the demo | `npm run story` |
| T7–T11 | Changed by PUZZLES-PLAN: no hint text, solution or paid world text in `dist/`; a hint tier granted once per charge, never out of order or after a solve, revoked on refund; no exploration soft-lock; the host writes ink only at a yield; a save restores the open puzzle's start and the exact exploration state, and a story update never strands the player | [PUZZLES-PLAN "Goal"](PUZZLES-PLAN.md#goal) |
| ST1–ST8 | Changed by STORIES-PLAN: no paid ending vocabulary or paid meta in client outputs; the first chapter of every story free, every chapter in one story, carry within a story; saves per story; statistics never unlock; one row per client event, a fact counted once; X ≤ Y; paid-chapter events need the entitlement, the story derived by the server; capture never blocks play | [STORIES-PLAN "Goal"](STORIES-PLAN.md#goal) |
| MT1–MT13 | Changed by META-PLAN: choice events by line ID in a server-only vocabulary; no ending count in any response; meta texts server-only and gated per viewer; achievements display only, `new` once; friendships both-sided and profiles friends-only by a separate revocable consent (revision 1: a link holder asks, the owner accepts per person, a decline or removal is durable, no Telegram id reaches another user); shares without titles, codes unguessable and revocable; attribution from verified initData on the first launch only; a balance never negative and reconciled with the ledger; a pack credited once in the grant, clawed back on refund (revision 1: the amount bound to the order, the clawback from the credited ledger row); a hint tier unlocked and debited once, in order; gifts between friends, once per request, capped; a referral only on server-observed evidence, capped (revision 1: re-evaluated on every batch); the privacy policy public and versioned (revision 1: production refuses to start with a placeholder left); choice volume never refuses or evicts a fact (revision 1). T7's hint part is replaced: a hint tier is unlocked once from the balance (MT10), not bought per charge | [META-PLAN "Goal"](META-PLAN.md#goal) |

**Budget targets** (numbers and gates in [Budgets](#budgets-and-validation)):
- initial JS ≤ 40 KB brotli; all JS before the first line ≤ 270 KB brotli; first-load ≤ 800 KB;
- time to first line ≤ 6 s at 4× CPU and 1.6 Mbps;
- live texture bytes ≤ 32 MiB steady (hard cap 48 MiB); steady memory ≤ 135.5 MiB (142.1 MB) at the gated limits
  (principle 4: < 150 MB). All memory figures are MiB (2^20 B) unless marked MB.
- Changed by STORIES-PLAN: the first-load row holds for **every story** (one row per story's first chapter, with
  the Home covers); Home is unmounted during play (≤ 2.6 MiB of cover bitmaps worst case → 138.1 MiB).
- Changed by META-PLAN: the entry closure gains about 2.9 KB br (the meta controller) inside the 40 KB row; the meta
  UI is one lazy chunk ≤ 14 KB br; all JS ≤ 305 KB br (was 290); the steady memory ≤ 138.6 MiB (145.3 MB)
  ([META-PLAN "Budgets"](META-PLAN.md#budgets-and-validation)).

Changed by META-PLAN: the player also sees a completion card at each ending and from Home (found endings and unlocked
achievements only), invites friends and shares progress through Telegram, sees friends' progress when they allow it,
buys hint packs for (mock) Stars and spends or gifts hints; step 2's "buys a hint with (mock) Stars" becomes "uses a
hint from a pack bought with (mock) Stars" ([META-PLAN "Goal"](META-PLAN.md#goal)).

---

## Context and constraints

- **Principles at stake:** all of CLAUDE.md 0–8.
  - 0/1/2 — paid content, server truth, payments: [Payment flow](#payment-flow-end-to-end), [Paid-content protection](#paid-content-protection).
  - 3 — initData.
  - 4 — budgets.
  - 5 — WebView: the Telegram module.
  - 6 — thin layers: one importer per library, enforced by `arch.test.ts`.
  - 7 — one-way staging.
  - 8 — line IDs.
- **Rulings:**
  - **1** — the stack.
  - **2** — the workflow: English artifacts, owner-only commits.
  - **3** — ru primary, en second.
  - **4** — generated placeholder art through the real pipeline.
  - **5** — local mock, dev-signed initData, simulated payment through the same webhook handler, mock compiled out of
    production.
- **Baseline:** empty tree (inventory). No gate exists; the first lanes create them. Red-first is impossible until a
  runner exists, and the cuts say so.
- **Machine:** 15.4 GB RAM; ≤ 2 lanes in parallel; `CARGO_BUILD_JOBS=6` per lane when two run. The cold cargo
  build is 5 min 11 s [R2], longer than the shell's per-call timeout, so the gate kit is needed from L2 (open
  question E1).
- **Platform differences that shape the design:**

| Concern | iOS WKWebView | Android WebView | Desktop (WebView2 / WebKitGTK) |
|---|---|---|---|
| Service Worker | none [O] | yes, not used | not used |
| Audio | silent until a gesture; `HTMLMediaElement.volume` not settable from JS (verify: on-device, L12) | gesture policy | gesture policy |
| AVIF | iOS ≥ 16 [O] | yes (Chromium-based; verify the oldest supported WebView, L11) | yes; WebP fallback everywhere |
| Build target | Vite 8 default = Safari ≥ 16.4 [R4] → iOS ≥ 16.4 (owner question V1) | Chrome ≥ 111 | ok |
| Memory | tight for WebGL [O]; 150 MB steady target | `performance_class` LOW/AVERAGE/HIGH in the UA [R1 §6] | relaxed |
| Back | BackButton only | hardware back closes the app when our BackButton is hidden [R1 §2] | BackButton |

- **Invariants that must survive every lane:**
  - the scene and the overlay never read ink variables;
  - nothing on the client unlocks content;
  - `server/content/` is never under the Vite root, never under a static route;
  - the dev mock and the dev routes are never in a production artifact;
  - every gate prints every failure (no bail);
  - (changed by PUZZLES-PLAN) the host writes ink variables only through `StoryRunner.enter()` at a yield, and only
    declared projection variables; no puzzle solution or hint text exists in any client build output; the world
    reducer is pure and shared by the runtime, the soft-lock checker and the playthroughs;
  - (changed by STORIES-PLAN) chapter ids are unique across all stories and a shipped chapter never changes story;
    carry never crosses stories; no unlock or content path reads the statistics log; a stat row's story comes from
    the server's story index; paid ending names exist only under `server/content/` and in entitled payloads.

---

## Key decisions

Each decision: **What / Why / Alternatives / Trade-off.** "Deviation" marks a departure from the owner's doc [O]; the
research is newer and verified (brief), so it wins, and the deviation is recorded here.

**K1. Telegram SDK: the official `telegram-web-app.js` behind our own facade** (Deviation: [O] names
`@tma.js/sdk-svelte`.)
- **What.** `<script src="https://telegram.org/js/telegram-web-app.js?64">` first in `<head>`. `client/src/telegram/`
  is the only code that touches `window.Telegram`.
- **Why:**
  - 16.2 KB brotli, against 23.8 KB (minimal set) to 28.6 KB gzip (prototype set) for @tma.js 3.3.0 [R1 §1].
  - tma.js 4.0 is a full rewrite already at RC (2026-10-28), and its docs describe v4.
  - sdk-svelte is a `svelte/store` adapter, not runes.
  - The dev mock can fake the *native transport*, so dev and e2e run Telegram's real script [R1 §5b].
- **Alternatives:**
  - tma.js 3.3 — migrate soon or start on an RC.
  - Own bridge — re-implement launch params, CloudStorage custom methods and the iframe handshake.
- **Trade-off.** A third-party script on the critical path (4-day cache); no shipped types (our facade types it);
  silent upstream changes (the e2e pins a fixture copy; owner question V6 on keeping that copy).

**K2. TypeScript 6.0.3, not 7.0.2** (Deviation: `latest` is 7.0.2; inventory.)
- **Why.** TS 7 ships no JS API, so svelte-check 4.7.7 (peer `^5 || ^6`) fails with ERESOLVE and throws at startup
  [R4 §1.2]. Vite, the Svelte plugin and vitest strip TS with Oxc, so the TS version affects only `check`.
- **Alternatives.** The TS 7 + TS 6 dual install with `--tsgo` (measured working, but platform binaries in the
  lockfile and the rootDir limitation).
- **Trade-off.** Revisit at TS 7.1 (Later). The config stays TS-7-clean: `moduleResolution: "bundler"`,
  `verbatimModuleSyntax`, no `baseUrl`.

**K3. Two-stage boot: entry chunk + engine chunk.**
- **What.** `main.ts` (Svelte, telegram facade, API session, tap screen, audio unlock) is the entry. `app/engine.ts`
  is imported dynamically at boot, not at tap, so it downloads while the player reads the tap screen. It holds Pixi,
  inkjs, GSAP, scene, story and audio.
- **Why.** The libraries measure 212.7 KB brotli together [R4 §4.1]; Pixi alone is 145.1 KB and loads at once.
  Splitting lets `ready()` hide Telegram's placeholder after about 40 KB instead of about 270 KB. On a budget
  Android at 1.6 Mbps, that is about 0.3 s against about 1.5 s to a visible UI.
- **Alternatives.** One bundle (simpler, but the slowest first paint). Lazy Pixi only after the tap (adds about
  1.5 s after the tap).
- **Trade-off.** Two budget rows, and one rule: the tap handler must not await the engine for the audio unlock
  (`audio/unlock.ts` lives in the entry, about 0.5 KB).
- **Changed by PUZZLES-PLAN (X14).** Beyond the two stages, four lazy chunk families are dynamic entries outside the
  entry and engine static closures, each with its own budget row:
  - one per puzzle type (`puzzles/ui/*.svelte`);
  - the puzzle host (`ui/puzzles/*`);
  - the explore UI (`explore/controller.ts` + `ui/explore/*`).

  The pure world, rules and session code (about 7 KB br) stays in the engine chunk. Every lazy `import()` lives in
  `app/yields.ts` (L15), so the lazy rows stay PENDING until that importer exists, as the engine row waits for
  `app/engine.ts`.
- **Changed by STORIES-PLAN (Y13, Y14).** Home (the story cards, L14b's `StoryPicker`) and the statistics reporter
  (`stats/reporter.ts`, created by `boot.ts` after auth) are in the entry chunk: about +3.2 KB br inside the 40 KB
  row. The card buttons are the gesture that unlocks audio, so no tap is added before the first line.
- **Changed by META-PLAN (M27).** The meta controller `app/meta.ts` with its services and decoders is in the entry
  (about +2.9 KB br inside the 40 KB row); the meta overlays (`ui/meta/*` + `i18n/meta.ts`) are a fifth lazy family,
  one dynamic chunk `meta-ui` ≤ 14 KB br imported only by `app/meta.ts` and prefetched after the first line. Its
  budget row is PENDING until `app/meta.ts` exists (LMI).

**K4. Own image loader, not Pixi `Assets`.**
- **What.** `scene/loader.ts`: the injected `FetchAsset` (implemented by `api/http.ts`: bearer and the single-flight
  re-auth for gated URLs; `AbortSignal`) → `createImageBitmap(blob)` → `Texture`. The loader never calls `fetch`
  itself (arch rule), so a paid image after the 30-min token TTL re-auths like any `/api` call.
  `scene/registry.ts` refcounts the result. Release = `texture.destroy(true)` + `bitmap.close()`.
- **Why.** Pixi's loader cannot send headers [R3 §4.1], so paid art needs our own fetch anyway; one path for public
  and paid art. `Assets.unload` has no ref-counting and shares one texture per URL, so release-after-scene needs our
  own registry anyway. Pixi never calls `ImageBitmap.close()`; we do, which frees the CPU copy deterministically
  instead of at GC. We get cancellation for preloads.
- **Alternatives.** Pixi `Assets` with bundles for public art and a custom path for paid art (two caches, two
  lifetimes).
- **Trade-off.** We lose Pixi's format detection: we detect AVIF once at boot with a 1 px probe and pick the variant.
  verify: the `Texture.from(ImageBitmap)` / `ImageSource` constructor in 8.22 (L11).

**K5. Holder-based ref-counted asset registry with byte caps.**
- **What.** Each asset has a set of holders (`scene:bg`, `scene:char:<id>`, `scene:cg`, `preload:<knot>`,
  `next:<chapterId>` for the next chapter's first knot, F5, released again on entering a knot without `-> END`, F2).
  It is destroyed when the set empties.
  - A preload is refused if it would take live decoded bytes above 32 MiB (the steady cap).
  - A visible load may take them up to 48 MiB (the hard cap).
  - Above 48 MiB, a visible load first evicts every `preload:*` and `next:*` holder. If it still does not fit, it is
    refused with `AssetError { kind: 'over-cap' }`: the executor skips that visual (the asset-failure path: logged,
    counted in `stats().overCap`, the story continues). The cap is never exceeded.
  - Changed by RULINGS 35 (as merged, L11 `1e2f421`; cut Q2): the visible load evicts every preload-priority holder,
    `room:*` included, not only `preload:*` and `next:*` (`client/src/scene/registry.ts:183-204`).
- **Why.**
  - A counter can be decremented twice by a buggy path; a set makes release idempotent.
  - The caps make principle 4 a runtime invariant. 32 / 48 MiB come from the steady total at the gated limits
    ([Steady total](#scene-controller-and-asset-registry): 135.5 MiB = 142.1 MB < 150 MB, CPU bitmaps counted).
  - Arithmetic: 1080×2048×4 = 8.4 MiB per background; ≤ 768×1536×4 = 4.5 MiB per sprite.
- **Alternatives.** A plain refcount (double-release bugs); an LRU cache (no deterministic release point); letting a
  visible load exceed the hard cap (unbounded memory on an un-gated path).
- **Trade-off.** Preload can be refused on art-heavy knots; the budget gate catches that statically, carried stage
  included (K9, `budget/knot-set`). An over-cap visible load drops a visual instead of growing memory; a gated story
  never reaches it.
- **Changed by PUZZLES-PLAN (X11, X13).** Two more holder families:
  - `room:<roomId>` — neighbour room backgrounds + props, requested in exit order by the explore controller and
    refused by the same 32 MiB rule. Released on moving to a non-neighbour, on opening a puzzle with a close-up, on
    section exit and on chapter change.
  - `scene:prop:<id>` — prop sprites, released by any `bg` / `scene`.

  Exploration steady state: 12.4 MiB room + 16.9 MiB for two neighbours = 29.3 MiB; with a close-up open,
  20.9 MiB.

**K6. On-demand rendering.**
- **What.** `Application.init({ autoStart: false })`. `scene/render-loop.ts` renders on the GSAP ticker only while
  at least one timeline is active or the stage is dirty; otherwise no frames.
- **Why.** A VN frame is static more than 95% of the time. Rendering 60 fps of an unchanged frame costs battery and
  heat on phones. It also gives one render clock, not two [R3 §4.5].
- **Alternatives.** The Pixi ticker always on (simplest; constant GPU load).
- **Trade-off.** Every visual mutation must call `requestRender()`; the executor is the only mutator, so that is one
  call site.

**K7. GSAP core only, plain properties, no PixiPlugin.**
- **Why.** 24.3 KB brotli [R4]. The PixiPlugin registration order breaks v8 detection under ESM [R3 §4.5]; `alpha`,
  `x`, `y` and `scale` are all we tween.
- **Crossfades.** New over old for backgrounds and expressions, never a symmetric fade of semi-transparent sprites
  [R3 §4.5].
- **Alternatives.** PixiPlugin (filters we do not use); hand-written tweens (GSAP's `progress(1)` gives skip for
  free).

**K8. Story: one compiled JSON per chapter, shared globals by INCLUDE, explicit carry set.**
- **What.** `story/<ch>/main.ink` → its own JSON. `story/common/globals.ink` declares the `g_*` scalars. At chapter
  end the runtime reads them and writes them into the next chapter's `Story` [R4 §2.2].
- **Why.** ink cannot split one compiled story into several files [R4 §2.2]. Per-chapter JSON is what keeps paid text
  out of the public bundle (principle 0).
- **Alternatives:**
  - One story with paid knots (impossible to split).
  - Server-side ink (bladeink) [O] — unneeded: the anti-cheat value is low and it adds risk.
- **Trade-off.** Cross-chapter state is limited to declared scalars; DSL v1 has no `LIST` at all (STAGING-DSL §10:
  checkpoint and carry state hold scalars only).
- **Changed by STORIES-PLAN (Y1–Y3).** A story is the `next` chain from its first chapter (`story/stories.json`);
  chapter ids stay `ch<N>`, unique across stories. Carry flows only along a story's chain; a story's first chapter
  starts from the defaults. `cast.json` and `globals.ink` stay shared (new globals named `g_<story>_<name>`). The story
  tool's playthroughs drop runs that ended in a declared story ending from the next chapter's carry.

**K9. Build-time knot index for preloading, instead of runtime `TagsForContentAtPath`.** (Deviation: [O] and the
architect baseline preload from `TagsForContentAtPath` of the next node.)
- **What.**
  - The story tool records per knot: every asset named by its literal tags, and its successor knots (the diverts
    written in it; DSL v1 has no tunnels).
  - **Every knot is entered at its top.** A divert from one knot to a stitch or labelled gather of another
    (`-> k.s`, `-> k.g`) is the lint error `graph/entry-below-top`; diverts to a stitch or gather inside the same knot
    stay allowed.
  - It also derives, per knot, the **carried stage**: the image assets a predecessor may leave on stage that K's
    **opening tag lines** do not clear (input to `budget/knot-set`, K5; written to `usage.json`, not to the public
    meta). The opening tag lines are the tag-only lines before K's first other line, as `classify.ts` classifies
    them (STAGING-DSL §3.3). On every entry the runner applies them in K's first batch: knot-level tags arrive with
    the first line, and tag-only steps merge forward (§3.5). So the build credits only clears that run on every
    path, without a second batch parser.
  - On entering knot K the runtime preloads `assets(next(K))`.
  - Dynamic tags and variable diverts are lint errors, so the index is complete.
- **Why:**
  - `TagsForContentAtPath` sees only tags before the first content, and throws on a dynamic tag [R3 §2.1].
  - At a choice point, `choice.targetPath` points into the choice's content, not at a knot, so "the next node" is not
    known at runtime without our own graph.
  - The static index sees mid-knot tags too.
  - It enables a static memory check per knot (`budget/knot-set`).
  - Entry at the top only: a cross-knot `-> k.s` skips k's opening tags (ink starts at the named container), so a
    per-knot carried stage would assume a clear that never ran. A checkpoint resume (`ChoosePathString(k)`) would
    also restart at k's top and replay lines the player never saw.
- **Alternatives.**
  - Runtime `TagsForContentAtPath` on `next` knots from a graph (still needs the graph, and misses mid-knot tags).
  - A carried stage per entry point (knot top plus every stitch or label a cross-knot divert targets): one stage
    and one first-batch boundary per entry, and the checkpoint resume would still restart at the knot top.
- **Trade-off.** An ink subset: no threads, no variable diverts, no EXTERNAL; no tunnels, knot or stitch parameters,
  or `LIST`, because a checkpoint resume (`ChoosePathString`, which resets the call stack — inkjs `Story.ts`
  1677-1686) restarts a knot with no call context and scalar-only variables (STAGING-DSL §10). No divert into another
  knot below its top: a writer who wants to enter a scene in the middle splits it into its own knot. A clear written
  anywhere but the opening tag lines (for example a `scene` at the end of the first line) is not credited by the
  budget, so a knot may read as fuller than it is.
- **Changed by PUZZLES-PLAN (X1, DSL v2).** The yield tags add edges:
  - `puzzle: <id> then=<K>` → K is a successor (preload and reachability).
  - `explore: <S>` → every knot named by section S's effects and exits is a reachability edge, but not in the
    preload `next`: the explore controller preloads per room, so a hub never preloads every event knot.
  - An event knot's carried stage is seeded with the background and props of every room that triggers it.
  - `-> DONE` is legal only directly after a yield line.
- **Changed by STORIES-PLAN (Y4, Y5).** The meta gains `endings: { <knot>: <ending name> }`, the chapter's declared
  story endings (`story/stories.json`; a paid chapter's endings travel only in its paid meta). Entering a declared
  ending knot reports `ending_reached` and does **not** trigger F5: the story ends there.

**K10. Speaker as a text prefix `ally: …`, not a `#speaker` tag.**
- **Why.**
  - It is readable in Inky and needs one tag fewer on about two thirds of the lines.
  - Russian narration starts with Cyrillic, so the Latin `id:` prefix is unambiguous.
  - The registry check (`speaker/unknown`) catches the rest [R3 §2.1].
  - The prefix carries no expression, so staging stays in tags.
- **Alternatives.** A `# speaker:` tag (more noise); Pixi'VN's `id@expr:` (staging hidden in text, invisible to the
  knot index).
- **Trade-off.** The extractor and the runtime strip the prefix; covered by tests.

**K11. Localization by runtime ID lookup; ru from ink, en from tables; no inline logic in ID'd lines** [R3 §3 option
A].
- **What.** The line-ID format and tooling are in STAGING-DSL §4. The backlog stores `{lineId, speaker, ru}`, so a
  language switch re-resolves the backlog. Paid en tables travel with the paid chapter.
- **Why.** One JSON per chapter plus a small table, not about 2× JSON; saves are language-independent; live switch.
- **Alternatives.** Per-locale compiled JSON [R3 B]; the .NET Ink-Localiser (needs inklecate DLLs; we write a Node
  tool).
- **Trade-off.** Writers cannot interpolate; they write whole alternative lines.

**K12. Saves: server-authoritative, opaque body, optimistic `rev`, write-id idempotency; story-version hash + knot
checkpoint + chapter-start fallback** [R3 §2.4 option B].
- **What.**
  - **Storage.** The server stores the client's `SaveBodyV1` string (size-capped, `IS JSON`; changed by RULINGS 14,
    decision DB-3: `TEXT`, never `jsonb`, so the bytes round-trip) plus typed envelope columns.
  - **On version mismatch** we do not call `LoadJson`: R3's probe shows a silent wrong resume when lines are removed.
    We restore the knot checkpoint (variables + staging snapshot + `ChoosePathString`).
  - **If the knot is gone,** we fall back to the chapter start + carry.
  - **Error floor.** Each ink error in the current chapter lowers the next "Return to last save" by one level
    (exact → checkpoint → chapter start, the floor), so a save whose resume errors cannot loop.
  - **Conflicts are never overwritten silently** (`409` → the player chooses).
- **Why:**
  - Principle 1 (one writer: the server).
  - It covers every probed failure mode: knot renamed → throw; line removed → silent skip; choice inserted → visit
    counts shift.
- **Alternatives.**
  - A typed body on the server: couples the server to client staging types for no trust gain.
  - Refuse mismatched saves: loses progress on every patch.
- **Trade-off.** A checkpoint fallback loses visit counts inside the knot, so once-only choices of that knot can
  reappear. Accepted.
- **Changed by PUZZLES-PLAN (X9).** `SaveBodyV1` is born with:
  - `world: WorldState` — rooms, inventory, slots, triggers, puzzle runs;
  - `worldVersion` — the public world's version stamp at save time (changed by PUZZLES-PLAN revision 2: the stamp
    excludes world texts and line IDs, so a text-only edit keeps it);
  - `at.yield` — the yield the story is stopped at.

  On load:
  - `reconcile(world, …, worldVersion)` never throws. With the same version it returns the state unchanged. After
    a world change it drops ids the current world lacks, resizes slots and re-arms gifts held nowhere. It then keeps
    the current section's state only if the current world can produce it from section entry (a search bounded by
    the build's `RESUME_STATE_CAP`); otherwise the section restarts from its entry (changed by PUZZLES-PLAN revision
    2). Every other section is marked `unproved` and gets the same check at its next entry, before the player can act
    in it (changed by PUZZLES-PLAN revision 3);
  - an exact resume at a yield rebuilds the yield step from `at.yield`;
  - the chapter-start level resets the world;
  - an open puzzle restarts from its beginning, with the attempts used kept: a linear one at its yield, an
    exploration one (an overlay) on the next tap of its lock.
- **Changed by STORIES-PLAN (Y7).** Saves are per story: the row key is `(user_id, story_id, slot)`, each story has
  its own `auto` and `s1`–`s3`, the routes are `/api/saves/{storyId}/{slot}`, and `GET /api/saves` lists every story.
  `SaveBodyV1` is unchanged. LS2 rewrites the `saves` table in `0001` (nothing is deployed).

**K13. Client caches.** (Deviation: [O] suggests the autosave cache in CloudStorage and DeviceStorage for manifests.)
- **What:**
  - Settings and the read-set (32-bit FNV hashes of read line IDs, base64, one key per chapter, chunked at 4,000
    chars) live in **CloudStorage**.
  - One pending autosave (written only while the server PUT has not succeeded) lives in **DeviceStorage** (Bot API
    9.0+, feature-gated).
  - Nothing is in `localStorage` (the arch test forbids it outside the dev mock).
  - Tokens, entitlements and paid content are in memory only.
- **Why.** A full ink state plus snapshot can exceed CloudStorage's 4,096 characters per value [R1]; DeviceStorage
  holds 5 MB locally. Its per-value limit is undocumented [R1] (verify: L10); a failed set means no pending cache,
  never an error. Settings and the read-set are tiny and benefit from Telegram's cross-device sync. None of them
  unlocks anything (principle 1); on conflict, the server wins.
- **Trade-off.** Older clients (< 9.0) have no offline autosave cache; the server copy still exists.
- **Changed by STORIES-PLAN (Y7, Y13).** The pending autosave is one DeviceStorage entry per story,
  `pending_<storyId>`. The statistics queue is DeviceStorage `stats_queue` (≤ 64 events, about 14 KB; memory only
  below 9.0). Neither unlocks anything.

**K14. Server: axum 0.8.9 + sqlx 0.9.0 runtime queries (no `query!` macros) behind a `db/` module seam;
PostgreSQL 18; the whole schema in one migration** [R2 §4].
- **Changed by RULINGS 14 (decision section 6; DB-1, DB-2; as merged, `fee9da7`).** PostgreSQL 18 in development,
  the gates and production alike, replacing "SQLite WAL" (RULINGS 1, superseded by RULINGS 12). sqlx carries
  `postgres` in place of `sqlite-bundled`. Detail: `D:/tmp/novel-orch/design/db/decision.md` §1.3.
- **Why:**
  - PostgreSQL passes the money path natively: `INSERT … ON CONFLICT DO NOTHING RETURNING` returns no row for a
    duplicate, and a concurrent twin waits for the first inserter, then skips. Single-row conditional UPDATEs re-check
    their WHERE on the winner's row version under READ COMMITTED. CHECK, FK and UNIQUE constraints map 1:1.
  - One PostgreSQL server serves several app instances later, which SQLite could not.
  - The `db/` seam (`server/src/db/mod.rs:1-2`) confines the switch. sqlx is the only candidate with a migrator
    already wired (`migrate!`) and `SqlSafeStr`, so `no_dynamic_sql` stays valid unchanged.
  - Schema floor 16 (`IS JSON`); the gates and pgdev run 18 only, and `pool_session_settings` asserts major 18.
  - Runtime `query_as` + `FromRow` needs no `.sqlx/` offline data under `--locked` gates and causes no lane friction.
  - sqlx 0.9 refuses non-`'static` SQL unless wrapped in `AssertSqlSafe`, so string concatenation is impossible by
    type. A grep test bans `AssertSqlSafe` entirely.
  - Erratum (RULINGS 7 f): `no_dynamic_sql` cannot see SQL built into a `String` held in a `static`
    (`LazyLock` / `OnceLock`): such a string is `'static`, so sqlx accepts it. Reviewers of every `db/` change check
    for such statics.
  - One migration up front: the schema is fully designed here, so no two lanes fight over `server/migrations/`.
  - The case for runtime queries holds harder on PostgreSQL: `query!` needs a live database or `.sqlx/` per lane,
    and sqlx-cli can no longer be installed `--locked` in 0.9. Every statement runs in a repository test against
    PostgreSQL 18 instead, the substitute for compile-time checks.
- **Alternatives:**
  - The `query!` macros + `.sqlx/` (compile-time checks; cross-lane merge conflicts and a cli that cannot be pinned).
  - tokio-postgres + deadpool: no migrator, no `SqlSafeStr`, more code.
  - Diesel / SeaORM: a DSL or ORM over 6 tables.
  - SQLite WAL (the prototype's first choice): its single writer kept K18's single statement safe, it cannot serve
    several app instances, and a later move would be a rewrite.
- **Trade-off.** Column and type errors surface in repository tests, not at compile time. A server process runs
  locally (`server/pgdev`, a cluster per slot port, started on demand) and in hosting, instead of a file.
  `query!` with PostgreSQL: decided no (it was "Later").

**K15. Own HMAC session token, not a JWT** [R2 §5.1].
- **What.** `v1.<user_id>.<exp>.<hex HMAC-SHA256(TOKEN_KEY, "v1.<user_id>.<exp>")>`. TTL 30 min, in memory on the
  client, `Authorization: Bearer`.
- **Why.** About 25 lines; constant-time `verify_slice`; no alg/header attack surface. jsonwebtoken 11 needs a
  crypto-provider choice and pulls a second RustCrypto stack.
- **Trade-off.** Not interoperable; nobody else reads it.

**K16. initData validation:**
- **Rule.** HMAC over **all** received fields except `hash`; `signature` stays in the data-check-string.
- **Window.** Max age 24 h (configurable); at most 60 s in the future.
- **Rejected.** Duplicate keys.
- **No field whitelist.**

(R1 §4: the docs plus two independent implementations plus a local probe.)
- **Why.** An unknown future field (e.g. `chat_join_request_query_id`, 10.1) must still verify.
- **Trade-off.** No real-launch vector yet (owner step: a test-environment launch, open question E6).

**K17. Webhook: `Bytes` → `serde_json` → frankenstein `Update`; on a decode failure, an own lenient payment probe;
ACK 200 unless a money fact would be lost; explicit `allowed_updates = [message, pre_checkout_query]`** [R2 §2.3].
- **What.** If the full `Update` decode fails, the body is decoded again as `PaymentProbe` (our own serde struct with
  only the payment subset: `message.from.id`, `message.successful_payment`, `message.refunded_payment`; unknown fields
  ignored, `provider_payment_charge_id` optional).
  - A readable `successful_payment` becomes the same `PaymentFact` and goes through the same grant transaction (K19);
    a readable `refunded_payment` goes through the same revoke (K20). 200 only after the commit.
  - The JSON carries `message.successful_payment` or `message.refunded_payment`, but its money fields (payer id,
    currency, amount, payload, `telegram_payment_charge_id`) are unreadable → **500** + `tracing::error!`: Telegram
    redelivers (R2 §1.6) and the fact is never ACKed away.
  - Anything else that fails to decode (an unknown update kind, a changed non-payment type) → 200 + log. An
    undecodable `pre_checkout_query` stays unanswered, so Telegram cancels that payment: no money moves.
- **Why.**
  - `UpdateContent` has no `#[serde(other)]` arm, so `Json<Update>` would answer 4xx to an unknown update kind and
    build a redelivery backlog.
  - A blanket 200 would drop a paid charge: a `SuccessfulPayment` without `provider_payment_charge_id` fails the pinned
    0.52.1 decode with "missing field" (R2 §2.3 MEASURED), Telegram already makes that field optional on
    `RefundedPayment` (R2 §1.4), and Telegram never redelivers a 2xx. K19's "never lose money facts" needs the probe.
- **Alternatives.** Persist the raw body and answer non-2xx for every undecodable payment update (a redelivery
  backlog for a fact we could have read; a new table).
- **Trade-off.** Two decoders for the payment subset (the probe is ~20 lines of serde structs, covered by
  `webhook_payment_undecodable_by_frankenstein_still_recorded`). The 500 path keeps Telegram retrying the update whose
  money fields changed shape until a fixed build reads it, or until Telegram "gives up" (R2 §1.6); that case needs a
  code change anyway (verify: whether a failing update delays later ones — `getWebhookInfo.pending_update_count` in
  the owner's test-environment run, E6).

**K18. Pre-checkout: one conditional `UPDATE` (the order enters `checkout`), then an outbound
`answerPreCheckoutQuery`.**
- **Timeouts.** Ours: DB step ≤ 2 s, answer ≤ 5 s (`tokio::time::timeout`). The reqwest client: connect 2 s, total
  5 s.
- **Why:**
  - One indexed write is still bounded work. It closes both double-pay races: "two orders, two pre-checkouts, two
    charges", and "one order opened on two devices" (P3 reuses a `created` order, so both devices hold one slug).
    No order for a (user, product) — the same order included — passes pre-checkout while an order for it entered
    `checkout` less than 120 s ago. The payments-stars guide puts this on the bot ("only accepts multiple payments
    when the order can be processed correctly").
  - The cost: a player whose payment failed after a successful pre-checkout waits up to 120 s before paying again.
  - The outbound call's result is known and testable through the gateway trait [R2 §6.1].
  - The worst case is 7.5 s < 10 s.
- **Alternatives.** Answer in the webhook response body (faster, blind) [R2 §1.2]; a pure read (leaves the
  double-pay race open).
- **Changed by RULINGS 14 (decision section 6, DB-4).** The DB step is the payer-row lock, then the conditional
  UPDATE, in one READ COMMITTED transaction (`SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE` first). On
  PostgreSQL the single statement alone lets two concurrent pre-checkouts both pass, in both races above: each
  `NOT EXISTS` reads a snapshot without the other's uncommitted `checkout`. After the lock wait the next statement
  takes a fresh snapshot, sees the committed `checkout` and refuses (`InProgress`). `NO KEY UPDATE` does not conflict
  with the `KEY SHARE` locks of FK checks, so saves, grants and puzzle attempts never wait on it. The worst case is
  unchanged (≤ 2 s DB + ≤ 5 s answer).
- **Changed by PUZZLES-PLAN (X6).** Products are chapters and hint tiers (`hint:<puzzleId>:<tier>`). Pre-checkout
  becomes three indexed statements in one transaction, all inside the same 2 s DB timeout (worst case still about
  7.5 s; changed by RULINGS 14, it read "two indexed statements, both inside", without the lock):
  1. the payer-row lock of the RULINGS 14 bullet above;
  2. a PK read of the order's `product_id`;
  3. the conditional UPDATE above, plus three nullable predicates computed in Rust from the catalog:
     - tier n−1 owned;
     - the paid chapter owned;
     - the puzzle not solved.

  A failed predicate → `RejectReason::Unavailable`. For a chapter product all three parameters are NULL, so the
  effect is unchanged.
- **Changed by META-PLAN (M19, M21).** The bullet above is superseded: hint-tier products no longer exist (RULINGS 25;
  hints are spent from a balance). Products are chapters and hint packs (`pack:<id>`). Pre-checkout is the RULINGS 14
  form again — two indexed statements in one transaction: the payer-row lock, then the conditional UPDATE — with no PK
  read, no `$6`–`$8` predicates and no `Unavailable`. A pack passes the `NOT EXISTS entitlements` predicate trivially
  (packs are never entitlements); the 120 s checkout lock serializes two orders of the same pack as it does for a
  chapter.

**K19. Grant: one transaction, write-first.**
- **Steps.**
  1. `INSERT INTO payments … ON CONFLICT (telegram_payment_charge_id) DO NOTHING RETURNING`.
  2. Only if that inserted a row: the order → `paid`.
  3. `INSERT INTO entitlements … ON CONFLICT (user_id, product_id) DO NOTHING`.
  4. Commit, then 200.
- **Why.** Principle 2; R2 MEASURED the RETURNING behaviour. Changed by RULINGS 14 (decision section 6, DB-4): the
  steps rely on UNIQUE/PK arbiters and single-row conditions under READ COMMITTED; no payer lock.
- **Never lose money facts.** A payment row is recorded even if the order is unknown, and even if the pinned
  frankenstein types cannot decode the update (K17 probe).
- **Unapplied charges reach the payer.** A charge that ends `OrderMismatch` or `AlreadyEntitled` (recorded, no grant)
  triggers, after the commit, a bot message to the payer and to every `ADMIN_TELEGRAM_IDS` entry (charge id,
  `/paysupport`); `/paysupport` lists it as "not applied" from then on (derived: a `payments` row with no
  `entitlements` row and `refunded_at IS NULL`). The refund is the admin's `/refund` (V4 default); automatic refund
  is the owner's V4 call.
- **Changed by META-PLAN (M19).** Step 3 branches on `parse_product_id(order.product_id)`: `Chapter` → the
  entitlement insert (L8b); `Pack` → `credit_in_tx` (a `resource_ledger` row keyed `pay:<charge>` plus the balance
  upsert, LE1), in the same transaction before the commit. "Not applied" becomes: a `payments` row with no
  `entitlements` row **and** no `resource_ledger` row of that charge, and `refunded_at IS NULL` (L9). Revision 1 (W3):
  the credit is of the kind and amount bound to the order at P3 (`orders.pack_kind`, `orders.pack_amount`, CHECK
  `orders_pack_binding`), returned by step 2's `UPDATE orders … RETURNING`; the grant never reads the catalog.

**K20. Refunds: admin `/refund <charge_id>` → `refundStarPayment` → revoke transaction; `refunded_payment` →
the same revoke, idempotent** [R2 §1.4].
- **Why.** The docs do not say whether `refunded_payment` arrives for bot-issued refunds, so revoke on our own call's
  success and also on the update.
- **Trade-off.** No user self-service refund (owner question V4).
- **Changed by META-PLAN (M20).** When the refunded order's product is a pack, the revoke transaction also claws back
  (`clawback_in_tx`, key `refund:<charge>`): the balance drops by min(balance, amount), the shortfall is recorded as
  `debt`, which later credits pay first. Hints already spent or gifted stay spent or gifted; a gift recipient's
  balance is never touched (L9). Revision 1 (W3): the kind and amount come from the charge's `pay:<charge>` ledger row
  (what was credited), never the catalog; a charge without that row claws back nothing.

**K21. Dev tooling is a separate crate `server/dev` (package `server-dev`), never linked into the `server` binary.**
- **What.** It holds the dev-signed initData launch, the fake bot gateway, simulated payments and refunds. It calls
  the real webhook handler function (`server::telegram::webhook::webhook`) with the real secret header.
- **Why:**
  - RULINGS 5 ("compiled out of production").
  - The CLAUDE.md gates run `--workspace --all-targets` without `--all-features`, so a cargo `dev` feature would be
    neither linted nor tested.
  - A workspace member is both checked and absent from the production binary.
- **Alternative.** A cargo feature (untested by the gates); a runtime env flag (forbidden: a dev bypass that ships).

**K22. Shared types: Rust is the source of truth, via ts-rs 12.0.1.**
- **What.** Every HTTP DTO derives `TS`. One committed file `client/src/api/generated/api.ts` is built from
  `T::decl()` of each DTO (verify: the `decl()` API in 12.0.1, L6a).
- **Staleness.** The Rust test `bindings_are_fresh` fails on staleness. `write_bindings` (`#[ignore]`) regenerates.
  No `#[ts(export)]` side effects inside the gates [R4 §6.2].
- **Ids and timestamps.** `i64` ids and timestamps are `#[ts(type = "number")]` (< 2^53).
- **Decoding.** TS decoders in `api/decode.ts` validate at the edge. A Rust-written sample file is decoded by a
  vitest test (the round trip).

**K23. Asset pipeline: `assets/catalog.json` is the single source list.**
- **What:**
  - Placeholders are catalog entries with generator parameters, rendered in memory to SVG.
  - SVG is rasterized and encoded by **sharp 0.35.5** (new devDependency, build-only, never bundled) to AVIF + WebP —
    the exact path real PNG sources will take.
  - Placeholder audio is **synthesized to WAV** by our own script (Deviation: AAC/M4A [O], CLAUDE.md layout).
- **Why:**
  - RULINGS 4 ("same pipeline").
  - No binaries in git.
  - sharp is maintained (lovell/sharp, 25 prebuilt platform packages from the npm registry, including
    `@img/sharp-win32-x64`; verified on npm).
  - No AAC encoder exists without ffmpeg.
- **WAV rule.** WAV is allowed only for catalog entries with `placeholder`, capped at 400 KB (`budget.ts`).
- **Trade-off.** The real-audio lane adds ffmpeg → AAC (Later).

**K24. Audio:**
- **Context.** One `AudioContext`, created and resumed synchronously in the tap handler.
- **Buses.** BGM, SFX and master gain buses (voice later).
- **BGM.** Two `HTMLAudioElement`s (A/B crossfade) through `MediaElementAudioSourceNode` → bus gain.
  - Public tracks stream by URL.
  - Paid tracks: the injected `FetchAsset` (bearer + single-flight re-auth, K4) → blob URL (compressed bytes, not
    PCM).
- **SFX.** Decoded `AudioBuffer`s, ≤ 3 s each.
- **Why:**
  - A decoded 3-min stereo BGM is about 60 MiB of float32 [architect principle 1].
  - iOS ignores element volume, so bus gains do it.
  - A media element cannot send `Authorization`.
- **Alternatives.** Decode everything (memory); Howler (a dependency we do not need).

**K25. e2e against a production-like build with the mock (`vite build --mode e2e` → `dist-e2e/`), not the dev
server.**
- **Why.** Time to first line and memory measured on unbundled dev modules are meaningless. The mock is enabled by
  `define: { __TG_MOCK__: mode !== 'production' }`, so `vite build` (mode `production`) eliminates it, and the scanner
  proves it absent from `dist/`.
- **Trade-off.** Two builds in `npm run e2e`.

**K26. No router.**
- **What.** An in-app overlay stack bound to Telegram `BackButton` (visible iff the stack is non-empty).
  `enableClosingConfirmation` (6.2+, verified on core.telegram.org/bots/webapps) during play.
- **Why.** TWA keeps launch params in the URL hash, which a hash router clobbers [R1 §4]. Principle 5 (no
  `history`).
- **Changed by PUZZLES-PLAN (X12).** `ui/screens.ts` stays the only owner of the BackButton and gains a root-back
  slot, `setRootBack(fn | null)`:
  - Visible = overlay stack non-empty, or a root-back is set.
  - A press pops the top overlay; with no overlay, it calls the root-back.
  - While exploring with a non-empty room path, the root-back walks one room back. `yields.ts` sets and clears it at
    the path's empty ↔ non-empty edges (the controller's `onPath`). It is cleared while an event knot runs and
    restored at the event's return.

  The overlay kinds gain `inventory`, `document`, `lock`, `puzzle` (exploration puzzles) and `hints`. A linear
  puzzle is a mode, not an overlay, so Back cannot abandon it by accident.
- **Changed by STORIES-PLAN (Y14).** The root after boot is Home (`TapToStart` with Continue + the story cards); it
  has no BackButton, like the game root. ChapterSelect is an overlay of one story (BackButton closes it to Home). The
  menu gains "Back to stories" (`Game.exitToStories()`); a declared story ending shows the `Notice` kind `the_end`.
- **Changed by META-PLAN (M9, M27).** The overlay kinds gain `card` (the completion card, pushed over `the_end` or
  opened from Home; Back returns to where it opened), `friends`, `friend`, `wallet`, `gift`, `consent` and `invite`.
  Each closes with BackButton; none adds a root-back.

**K27. Same origin everywhere.**
- **Dev / e2e.** Vite (`server.proxy` / `preview.proxy`) forwards `/api`, `/dev`, `/telegram` to `server-dev` on
  `127.0.0.1:$DEV_API_PORT` [R4 §5.2]. The port comes from per-lane env (default 8787; the preview port is
  `$DEV_WEB_PORT`, default 4173), so two parallel lanes never share a server ([gate mapping](#gate-commands-mapping)).
- **Production.** The axum binary optionally serves `client/dist` (`STATIC_DIR`), and refuses to start if
  `STATIC_DIR` contains `CONTENT_DIR`.
- **Why.** No CORS; Bot API 10.2 origin hardening is satisfied trivially [R1 §3].

**K28. System fonts only.**
- **Why.** Zero font bytes. The Cyrillic fallback comes from the OS [O: DOM text for Cyrillic].
- **Trade-off.** Art direction may want a face later (Q2).

**K29. Default language from the server's auth response.**
- **What.** `user.languageCode` from verified initData: `ru` for `ru|uk|be|kk`, otherwise `en` (owner question V2).
  The player can switch in Settings.
- **Why.** Avoids even a UX read of `initDataUnsafe` (principle 3's spirit).

**K30. Renderer: WebGL only in the prototype.** (Deviation: [O] says "WebGPU optional by `navigator.gpu`".)
- **What.** `preference: 'webgl'`; Pixi falls back to its other renderers only if WebGL fails [R3 §4.3].
- **Why.** WebGPU availability in WKWebView and Android WebView is undocumented [O]. One renderer path means one
  context-loss path to test.
- **Trade-off.** No WebGPU speed-up (Pixi's own team says it is "not guaranteed" [O]). Later.

### Deviations from the owner's stack doc (summary)

| Owner doc [O] | This design | Decision |
|---|---|---|
| `@tma.js/sdk-svelte` | official `telegram-web-app.js` + our facade | K1 |
| (TS not pinned; `latest` is 7.0.2) | TypeScript 6.0.3 | K2 |
| Preload from `TagsForContentAtPath` of the next node | build-time knot index (all literal tags + successors) | K9 |
| Autosave cache in CloudStorage; DeviceStorage for manifests | CloudStorage: settings + read-set; DeviceStorage: one pending autosave | K13 |
| AAC/M4A audio | AAC/M4A for real audio (Later); synthesized WAV for placeholders only, gate-capped | K23 |
| WebGPU optional | WebGL only | K30 |
| HMAC + "Ed25519 if needed" | HMAC only; a locally minted initData can never carry a valid Ed25519 signature [R1 §4] | K16 |
| Narrat "last release Oct 2023" | not dormant (npm 4.1.18, 2026-09) [R3 §7]; no design effect | — |

Changed by RULINGS 14 (decision section 6): the PostgreSQL row is deleted (it read "SQLite WAL behind the `db/` seam
for the prototype"). The database now matches the owner's stack doc: PostgreSQL 18 (K14).

---

## Module map

### Repository layout (the lanes create it; CLAUDE.md "Stack and layout" gets these additions — open question E4)

```text
Cargo.toml                 virtual workspace: members ["server", "server/dev", "server/pgdev"], resolver "3"
Cargo.lock  clippy.toml  .env.example
client/                    Vite root (never contains paid content)
  index.html  package.json  package-lock.json  vite.config.ts  svelte.config.js  tsconfig.json  tsconfig.node.json
  vite-plugins/tg-dev-mock.ts
  scripts/                 Node build tools (never bundled): story/, assets/, budget, scan-dist
  src/                     the app (below)
  e2e/                     Playwright (config, specs, fixtures/telegram-web-app.js)
  public/assets/           GENERATED free art/audio (gitignored)
  src/story-gen/           GENERATED free chapters + catalog (gitignored)
server/                    crate `server` (lib + bin)
  src/  migrations/0001_init.sql  catalog.json  locales/bot.{ru,en}.json  tests/it/  tests/fixtures/
  content/                 GENERATED paid chapters, paid assets, build fingerprints (gitignored)
server/dev/                crate `server-dev` (dev-only lib + binary)
server/pgdev/              crate `pgdev` (dev/test-only lib + binary: the local PostgreSQL 18 cluster per port, test DBs)
story/                     ink sources and story data
  chapters.json  cast.json  retired-ids.txt  lint-allow.json
  common/globals.ink  ch1/main.ink  ch2/main.ink
  locales/en/<ch>.json  locales/{ru,en}/story.json
assets/                    catalog.json (+ src/ for real art later)
docs/                      PROTOTYPE-PLAN.md  STAGING-DSL.md  (+ FEATURE_MAP, ARCHITECTURE, AUTHORING, runbooks)
```

Changed by STORIES-PLAN: `story/stories.json` (the story list, LS1) joins `story/`; story B's chapters are
`story/ch3/`, `story/ch4/` (flat, game-unique ids); `server/migrations/0003_stats.sql` (LS3); the generated
`server/content/stories.json` and `client/src/story-gen/covers.json`. New modules: STORIES-PLAN "Integration".

Changed by RULINGS 14 (decision section 6; as merged, LDB0 `857f7d6`): the crate `server/pgdev/` joins the workspace.
It is a dev-dependency of `server` and a dependency of `server-dev`, never linked into the production `server` binary.

Gitignore additions (L1):
```text
client/public/assets/  client/src/story-gen/  client/dist-e2e/  client/.vitest/  client/test-results/
client/playwright-report/  client/.svelte-check/  server/content/  target/
```

### `client/src` — responsibilities and boundaries

| Module | Responsibility | Boundary (enforced by `arch.test.ts`) |
|---|---|---|
| `main.ts` | entry: telegram init, mount App, start auth, `import('./app/engine')` | entry chunk ≤ 40 KB br |
| `app/boot.ts` | boot sequence; picks the "open in Telegram" / "reopen" `Notice` | |
| `app/engine.ts` | dynamic-import root; exports `createGame` | the only path to Pixi/inkjs/GSAP |
| `app/game.ts` | **GameSession**: the conductor. Owns the current chapter, the `StoryRunner`, `SceneController`, `AudioManager`, `SaveService`; routes batches; pushes view snapshots | the only module that talks to story, scene and audio together |
| `telegram/index.ts` | `TelegramClient` interface + types + `getTelegram()` | |
| `telegram/webapp.ts` | implementation over `window.Telegram.WebApp`: promise/Result wrappers, version gates | the **only** reader of `window.Telegram` outside `telegram/dev/` |
| `telegram/perf.ts` | Android `performance_class` from the UA [R1 §6] | pure |
| `telegram/viewport.ts` | derived CSS vars (insets sum), helpers | pure DOM-style writes only |
| `telegram/dev/*` | native-transport mock, fake Stars sheet, dev panel | DEV/e2e only (`__TG_MOCK__`); never imported by production code paths |
| `api/http.ts` | fetch wrapper → `Result`; bearer; single-flight re-auth on 401; `fetchAsset` (the `FetchAsset` for images, SFX and paid BGM: bearer only for `/api/` URLs, same re-auth + retry once) | the only `fetch` to `/api` |
| `api/session.ts` | token in memory, expiry, `session-expired` event | |
| `api/endpoints.ts` | typed calls per route | |
| `api/decode.ts` | runtime decoders for every DTO | |
| `api/generated/api.ts` | ts-rs output (committed) | never edited by hand |
| `story/staging.ts` | `StagingCommand`, ids, `StagingSnapshot` types | types only |
| `story/tags.ts` | `parseTags` — shared with the story lint | the **only** tag parser |
| `story/catalog.ts` | `AssetCatalog`, `ChapterCatalog`, `ChapterMeta`, `AssetManifest` types + decoders | |
| `story/runner.ts` | `StoryRunner`: owns the inkjs `Story`; emits steps | the **only** importer of `inkjs` |
| `story/chapters.ts` | chapter loader: free (static URLs), paid (`GET /api/chapters/{id}`) | |
| `story/carry.ts`, `save-codec.ts`, `resume.ts` | carry set; `SaveBodyV1` codec; exact/checkpoint/chapter-start resume | |
| `scene/controller.ts` | `SceneController`: the Pixi `Application`, layers, context loss | the **only** importer of `pixi.js` |
| `scene/executor.ts` | batch → timeline plan; skip/complete | the **only** importer of `gsap` |
| `scene/registry.ts`, `loader.ts`, `preload.ts`, `layout.ts`, `render-loop.ts` | textures (holder sets, caps), decode of `FetchAsset` blobs, hint scheduling, pure layout math, on-demand frames | `Texture`/`ImageBitmap` created only in `loader.ts`/`registry.ts`; no `fetch` |
| `audio/unlock.ts` | create + resume `AudioContext` in the gesture (entry chunk) | |
| `audio/manager.ts`, `bgm.ts`, `sfx.ts` | buses, BGM A/B streaming, SFX cache, lifecycle | the only users of `AudioContext` / `HTMLAudioElement` |
| `saves/service.ts`, `pending.ts` | server saves (rev, write id, coalescing, conflict policy); DeviceStorage pending autosave | |
| `settings/store.ts` | settings + read-set over CloudStorage | |
| `purchase/flow.ts` | purchase state machine (invoice → openInvoice → poll → unlocked) | never grants: reads the server only |
| `i18n/ru.ts`, `en.ts`, `index.ts` | UI tables (`en: Record<keyof typeof ru, string>`), `t()` | |
| `i18n/lines.ts` | line text: ru = ink text, en = table, fallback + counter | |
| `ui/*` | Svelte 5 components (presentational) + `state.svelte.ts` (view model, `$state.raw`) + `screens.ts` (overlay stack ↔ BackButton) | components never import story/scene/audio/inkjs/pixi |
| `world/*`, `explore/*`, `puzzles/*`, `geom/cover.ts`, `app/yields.ts`, `ui/explore/*`, `ui/puzzles/*` | changed by PUZZLES-PLAN: world data and decoders, the pure exploration reducer, puzzle rules / sessions / lazy UIs, the shared cover transform, the yield router ([PUZZLES-PLAN "Integration"](PUZZLES-PLAN.md#integration)) | pure modules stay DOM-free; lazy UIs only by dynamic import; only `yields.ts` calls `runner.enter` |

**Arch test rules** (`client/src/arch.test.ts`, vitest unit project; each rule seen red once). They scan non-test
source files under `client/src/`; `*.test.ts` files may use fakes and fixtures freely:
- **Import boundaries:**
  - `pixi.js` only in `src/scene/`;
  - `inkjs` only in `src/story/runner.ts`;
  - `inkjs/full` and `inkjs/compiler` never in `src/`;
  - `gsap` only in `src/scene/executor.ts`;
  - `window.Telegram` only in `src/telegram/webapp.ts` and `src/telegram/dev/`;
  - `AudioContext` and `new Audio` only in `src/audio/`;
  - `src/ui/**` imports nothing from `story/`, `scene/`, `audio/` except types;
  - `fetch(` never in `src/scene/` or `src/audio/` (assets arrive through the injected `FetchAsset`, so gated fetches
    share `api/http.ts`'s re-auth); `Authorization` only in `src/api/`.
- **Forbidden anywhere in `src/`:**
  - `vh` / `dvh` units;
  - `window.open`, `alert(`, `confirm(`, `prompt(`;
  - `innerHTML`, `outerHTML`, `{@html`;
  - `serviceWorker`;
  - `document.cookie`;
  - `<iframe`;
  - `history.pushState` / `back`;
  - `localStorage` / `sessionStorage` outside `src/telegram/dev/`;
  - `initDataUnsafe` (except the facade's type declaration).
- **Changed by PUZZLES-PLAN:**
  - `arch: pure world modules` (LW2);
  - `arch: lazy ui only by dynamic import` (LP2);
  - `arch: only yields.ts enters the runner` (LP2).
- **Changed by STORIES-PLAN (revision 1, LS1):** `import-outside-src` — a non-test module of `src/` references no
  file outside `src/`: a relative or `/`-rooted specifier of a static or dynamic import, an export-from, an
  `import.meta.glob` pattern or a `new URL(…, import.meta.url)` literal resolves under `src/` (type-only imports are
  erased and exempt), so `story/` sources and `server/content/` never enter the bundle (STORIES-PLAN ST1).
  Changed by STORIES-PLAN revision 2 (W2): every form is judged by the files Vite can pull in from it, or refused. A
  template-literal (or `+`-joined) `import()` and a template-literal `new URL(…, import.meta.url)` are judged by the
  glob Vite derives from them (each substitution becomes `*`): the static head up to its last `/` resolves under
  `src/`, and no `..` segment follows the first `*`. An `import.meta.glob` pattern resolves against its `base` option
  as Vite's `toAbsoluteGlob` does. A `#`-headed specifier or pattern is flagged (a package `imports` map could point
  it anywhere). A form the rule cannot read statically (a non-literal argument, pattern, options object or `base`;
  an empty or `/`-less head; a glob pattern not headed `./`, `../` or `/`) is flagged. Detail: lane LS1 commit 5.

### `server/src`

| Module | Responsibility |
|---|---|
| `main.rs` | CLI: `server serve` (default) and `server setup` (setWebhook, setMyCommands, menu button) |
| `lib.rs` | `AppState` and its one constructor `AppState::new(cfg)` (+ the `with_clock` / `with_gateway` seams and `StartupError`; [lane rules](#implementation-plan--the-lane-cut)), `build_router(state) -> Router` (production routes only), `pub mod`s |
| `config.rs` | `Config::from_env()`; secrets only from env |
| `error.rs` | `ApiError` (thiserror) → `IntoResponse` with `ErrorCode` JSON; 5xx logged, generic body |
| `clock.rs`, `ids.rs` | `Clock` (system / fixed for tests); newtypes `UserId`, `OrderId`, `ProductId`, `ChargeId`, `ChapterId`, `SaveSlot` |
| `auth/initdata.rs` | parse, data-check-string, HMAC, freshness; `pub fn data_check_string`, `pub fn secret_key` (used by `server-dev`) |
| `auth/token.rs`, `auth/extract.rs` | issue/verify token; `AuthUser` extractor |
| `db/*` | the repository seam: every SQL statement lives here; handlers see domain types, never `sqlx` |
| `api/*` | HTTP handlers + `dto.rs` (ts-rs DTOs) + `static_files.rs` |
| `catalog.rs` | products from `server/catalog.json` (prices are server-only); changed by PUZZLES-PLAN: hint-tier products derived from the puzzle index + `hints.priceStars`, `prereqs()`. Changed by META-PLAN (as merged by L6b under RULINGS 25: chapter products only, no `prereqs()`): LE1 adds the `economy` section, `ProductRef::Pack` and the `pack:<id>` products (M17) |
| `content.rs` | `ContentStore`: loads `CONTENT_DIR` at startup (paid chapters, paid en tables, manifests, the asset file index); changed by PUZZLES-PLAN: paid worlds and the puzzle index (`content/puzzles/<ch>.json`: solutions, hint texts); changed by META-PLAN: the meta index (`content/meta.json`, LM2) |
| `meta.rs`, `db/{economy,social,achievements}.rs`, `api/{wallet,cards,social,legal,share,gifts}.rs` | changed by META-PLAN: achievements and the card, the ledger and balances, friends and consents, the policy route, shares, gifts and referrals ([META-PLAN "Integration"](META-PLAN.md#integration)) |
| `puzzles/mod.rs` (+ `api/puzzles.rs`, `db/puzzles.rs`) | changed by PUZZLES-PLAN: answer check, attempt rate limit, puzzle status + hint texts (L6c) |
| `telegram/gateway.rs` | `BotGateway` trait + `FrankensteinGateway` (frankenstein 0.52.1, short-timeout reqwest client) |
| `telegram/webhook.rs` | the `/telegram/webhook` handler: secret check → decode → `process_update` |
| `telegram/payments.rs` | pre-checkout validation, grant, revoke |
| `telegram/commands.rs`, `texts.rs`, `setup.rs` | `/start`, `/terms`, `/support`, `/paysupport`, admin `/refund`; ru/en bot texts; the setup subcommand |

### `server/dev` (crate `server-dev`: lib target + binary `server-dev`)

| Module | Responsibility |
|---|---|
| `lib.rs` | `build_dev_app(paths: DevPaths) -> Result<Router, server::StartupError>`: `server::build_router(state)` merged with the dev router (each dev module exposes `routes()`). The state comes from `server::AppState::new(<dev Config>)` + `.with_gateway(FakeBotGateway)` (L8a), never a struct literal; the dev `Config` holds the fixed dev bot token / webhook secret, a random token key, `DATABASE_URL = paths.database_url` (connected and migrated; it creates and drops no database) and `CONTENT_DIR = paths.content`; `launch_database(&DevCluster, &DbName)` recreates a database empty (`DROP … WITH (FORCE)` + `CREATE`) and returns its URL; `pub mod`s. The lib target lets `server/dev/tests/dev.rs` drive the app through `oneshot` with no port; each of its tests runs on its own `pgdev::TestDb` (one `dev_app()` helper in `dev.rs`), so parallel test threads never share a database. Changed by RULINGS 14 (decision §3.5; as merged, `fee9da7`) |
| `main.rs` | binds `127.0.0.1:$DEV_API_PORT` first (default 8787; loopback only; a second instance exits here, before it touches the database), then `DevCluster::from_env()?.ensure_up()` and `launch_database(&cluster, &DbName::for_dev(port))`: a fresh database `tgn_dev_<port>` per launch on the slot's cluster (`DEV_PG_PORT`, `DEV_PG_ROOT`, `PG_BIN`), so two dev servers on one cluster never share one. It serves `build_dev_app(DevPaths { database_url, content: server/content })` (the generated content, resolved from the workspace root, not the cwd). Changed by RULINGS 14 (decision §3.5; as merged, `fee9da7`) |
| `launch.rs` | `GET /dev/launch` — signs initData with the dev bot token (reusing `server::auth::initdata::{data_check_string, secret_key}`) and redirects into the app |
| `fake_gateway.rs` | records invoices (slug → order), pre-checkout answers and refunds in memory |
| `simulate.rs` | `POST /dev/simulate-payment`, `POST /dev/refund`, `POST /dev/refunded-update`, `GET /dev/invoices/{slug}` — each builds a frankenstein `Update` JSON and calls the real webhook handler |

### `story/`, `assets/` and tooling (`client/scripts/`)

| Path | Responsibility |
|---|---|
| `story/chapters.json` | ordered chapters `{id, entry, paid, productId?, next}` — the single source for chapter order and free/paid |
| `story/cast.json` | speaker registry `{ "<speaker>": { "char": "<char>" \| null } }` |
| `story/common/globals.ink` | the carry set (`g_*` scalars) + pure functions |
| `story/locales/…` | en line tables per chapter; names and chapter titles per language |
| `story/retired-ids.txt`, `story/lint-allow.json` | retired IDs; unreachable-knot allowlist with reasons |
| `assets/catalog.json` | every asset id → source (`src` path or `placeholder` params), kind, canonical size |
| `client/scripts/story.ts` + `story/*.ts` | the story tool: `classify` (source lines), `lint`, `compile` (inkjs compiler, our file handler), `graph`, `fix` (`--fix-ids`, `--sync-locales`), `locales`, `playthrough`, `emit` |
| `client/scripts/assets.ts` + `assets/*.ts` | the asset tool: `placeholder` (SVG), `synth` (WAV), `encode` (sharp), `manifest` (tiers, per-chapter manifests, `fingerprints.assets.json`) |
| `client/scripts/budget.ts` | pure `evaluate()` + CLI: every budget row, printed in full, exit 1 if any fails |
| `client/scripts/scan-dist.ts` | paid / compiler / dev-mock fingerprints in `dist/`, base64 `data:` decoded, `.map` forbidden |
| `client/vite-plugins/tg-dev-mock.ts` | `transformIndexHtml` (mode ≠ production): inline classic script before the TWA tag that installs a queueing `TelegramWebviewProxy` and redirects to `/dev/launch` when no launch params exist |

---

## Data model and contracts

### TS types (client)

```ts
// story/staging.ts — branded ids; full command union in STAGING-DSL.md §6
type Brand<T, B extends string> = T & { readonly __brand: B };
export type ChapterId = Brand<string, 'ChapterId'>;  export type LineId = Brand<string, 'LineId'>;
export type KnotName = Brand<string, 'KnotName'>;    export type SpeakerId = Brand<string, 'SpeakerId'>;
export type BgId = Brand<string, 'BgId'>; export type CharId = Brand<string, 'CharId'>; export type ExprId = Brand<string, 'ExprId'>;
export type CgId = Brand<string, 'CgId'>; export type TrackId = Brand<string, 'TrackId'>; export type SfxId = Brand<string, 'SfxId'>;
export type AssetId = Brand<string, 'AssetId'>;        // 'bg/cafe' | 'char/ally/smile' | 'cg/letter' | 'bgm/calm' | 'sfx/door'
export type VarName = Brand<string, 'VarName'>;        export type StoryVersion = Brand<string, 'StoryVersion'>;
export type ProductId = Brand<string, 'ProductId'>;    export type OrderId = Brand<string, 'OrderId'>;
export type Slot = 'left' | 'center' | 'right';

export type StagingCommand =
  | { kind: 'bg'; bg: BgId; t: 'crossfade' | 'fade' | 'cut'; ms: number }
  | { kind: 'scene'; bg: BgId; t: 'fade' | 'cut'; ms: number }
  | { kind: 'show'; char: CharId; expr: ExprId; at: Slot | null; t: 'fade' | 'cut'; ms: number | null }
  | { kind: 'hide'; char: CharId | 'all'; t: 'fade' | 'cut'; ms: number }
  | { kind: 'cg'; cg: CgId | null; t: 'fade' | 'cut'; ms: number }
  | { kind: 'bgm'; track: TrackId | null; fadeMs: number; vol: number }
  | { kind: 'sfx'; sfx: SfxId; vol: number }
  | { kind: 'wait'; ms: number };

export type TagError = {
  tag: string;
  reason: 'syntax' | 'unknown-kind' | 'missing-arg' | 'bad-arg' | 'unknown-asset' | 'bad-id' | 'multiple-id' | 'conflict';
  detail: string;
};
export type ParsedTags = { lineId: LineId | null; commands: StagingCommand[]; errors: TagError[] };
export interface AssetIndex { hasBg(id: string): boolean; hasExpr(char: string, expr: string): boolean;
  hasChar(id: string): boolean; hasCg(id: string): boolean; hasTrack(id: string): boolean; hasSfx(id: string): boolean }
export function parseTags(tags: readonly string[], assets: AssetIndex): ParsedTags;   // story/tags.ts

export type StagingSnapshot = {                       // "commands in effect" per slot [R3 §1.3]
  bg: BgId | null;
  cg: CgId | null;
  chars: ReadonlyArray<{ char: CharId; expr: ExprId; at: Slot }>;   // z-order = array order
  bgm: { track: TrackId; vol: number } | null;
};
export const EMPTY_SNAPSHOT: StagingSnapshot = { bg: null, cg: null, chars: [], bgm: null };
// Changed by PUZZLES-PLAN (LW1, DSL v2):
// - StagingCommand gains { kind: 'puzzle'; puzzle; then } and { kind: 'explore'; section } (YieldCommand);
// - PropsCommand { kind: 'props'; props } is built by GameSession, never parsed;
// - StagingSnapshot gains `props: readonly PropPlacement[]` (EMPTY_SNAPSHOT.props = []);
// - PropId, Rect and PropPlacement live here too.
```

```ts
// story/catalog.ts — build outputs (decoded at load; never trusted blindly)
export type ChapterCatalog = {                        // client/src/story-gen/catalog.json (public)
  chapters: ReadonlyArray<{ id: ChapterId; paid: boolean; productId: ProductId | null; next: ChapterId | null;
                            title: { ru: string; en: string } }>;
  cast: Record<SpeakerId, { char: CharId | null; name: { ru: string; en: string } }>;
};
export type InkScalar = number | boolean | string;
export type ChapterMeta = {                           // <ch>.meta.json
  chapterId: ChapterId;
  storyVersion: StoryVersion;                         // sha256(story.json bytes) hex, first 16 chars
  firstKnot: KnotName;
  globals: readonly VarName[];                        // the carry set (all g_* vars)
  vars: readonly VarName[];                           // every VAR this story declares (for checkpoint restore)
  knots: Record<KnotName, { assets: readonly AssetId[]; next: readonly KnotName[]; ending: boolean }>;
                                                      // ending: a `-> END` divert is written in the knot (F5 trigger)
};
export type AssetRef = { url: string; bytes: number };   // '/assets/<file>' (public) or '/api/assets/<file>' (gated)
export type AssetEntry =
  | { kind: 'image'; w: number; h: number; decodedBytes: number; avif: AssetRef; webp: AssetRef }
  | { kind: 'audio'; role: 'bgm' | 'sfx'; durationMs: number; file: AssetRef; codec: 'm4a' | 'wav' };
export type AssetManifest = { chapterId: ChapterId; assets: Record<AssetId, AssetEntry> };   // <ch>.assets.json
// The one way scene/ and audio/ load asset bytes; implemented by api/http.ts (bearer + single-flight re-auth +
// retry once for '/api/' URLs, plain GET for '/assets/'); injected by GameSession.
export type AssetFetchError = { kind: 'http'; status: number } | { kind: 'network'; detail: string }
                            | { kind: 'session-expired' } | { kind: 'aborted' };
export type FetchAsset = (url: string, signal: AbortSignal) => Promise<Result<Blob, AssetFetchError>>;
export type LoadedChapter = { id: ChapterId; story: unknown /* raw ink JSON, never in $state */; meta: ChapterMeta;
  assets: AssetManifest; en: Readonly<Record<LineId, string>> | null };
// Changed by PUZZLES-PLAN (L13): LoadedChapter gains `world: WorldPublic | null`
// (free: story-gen/free/<ch>.world.json; paid: ChapterPayload.world).
// AssetCatalog gains the `prop` namespace (L5); AssetId gains 'prop/<id>'.
// Changed by STORIES-PLAN (LS1, L5): ChapterCatalog gains `stories: StoryEntry[]` (id, chapters in chain order,
// cover, title, teaser; no endings) and the exact keys become stories / chapters / cast; ChapterMeta gains
// `endings: Record<KnotName, EndingName>`; StoryId, EndingName, storyOf() live in catalog.ts; the `cover`
// namespace and CoverManifest (story-gen/covers.json) come from L5. Types: STORIES-PLAN "TS types".
```

```ts
// story/save-codec.ts — the opaque save body the server stores (format owned by the client)
export type SaveBodyV1 = {
  format: 1;
  chapterId: ChapterId;
  storyVersion: StoryVersion;
  ink: string | null;                 // story.state.toJson(); null = "chapter not started yet" (paywall pending)
  at: { lineId: LineId | null; knot: KnotName | null };
  staging: StagingSnapshot;           // stage at save time
  checkpoint: { knot: KnotName; vars: Record<VarName, InkScalar>; staging: StagingSnapshot } | null;  // last knot entry
  chapterStart: { carry: Record<VarName, InkScalar> };     // values carried INTO this chapter
  backlog: ReadonlyArray<BacklogEntry>;                    // last 50
  // Changed by PUZZLES-PLAN (X9):
  // - `at` also carries `yield: YieldCommand | null` (the yield the story is stopped at);
  // - `world: WorldState` holds the chapter's exploration and puzzle-run state (EMPTY_WORLD_STATE when there is none);
  // - `worldVersion: string | null` is the public world's `version` at save time (reconcile compares it).
};
export type BacklogEntry = { lineId: LineId; speaker: SpeakerId | null; ru: string; chosen?: LineId };
export function encodeSave(b: SaveBodyV1): string;
export function decodeSave(raw: string): Result<SaveBodyV1, { kind: 'malformed' | 'unknown-format'; detail: string }>;
```

```ts
// Result at module edges
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export type ApiError =
  | { kind: 'http'; status: number; code: ErrorCode; body: ApiErrorBody }  // ErrorCode, ApiErrorBody from generated/api.ts
  | { kind: 'network'; detail: string } | { kind: 'decode'; detail: string } | { kind: 'session-expired' };
```

### Rust types (server)

```rust
// ids.rs
pub struct UserId(pub i64);            // Telegram user id (≤ 52 significant bits) [R1 §4]
pub struct OrderId(pub String);        // "o_" + 32 hex (16 random bytes, getrandom); also the invoice payload (34 B ≤ 128)
pub struct ProductId(pub String);      // "chapter:ch2"
pub struct ChargeId(pub String);       // telegram_payment_charge_id
pub struct ChapterId(pub String);      // "ch<N>"
pub enum SaveSlot { Auto, S1, S2, S3 } // serde: "auto" | "s1" | "s2" | "s3"

// error.rs
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("bad request: {0}")] BadRequest(&'static str),
    #[error("initData invalid")] InitDataInvalid, #[error("initData expired")] InitDataExpired,
    #[error("token missing")] TokenMissing, #[error("token invalid")] TokenInvalid, #[error("token expired")] TokenExpired,
    #[error("not entitled")] NotEntitled, #[error("not found")] NotFound, #[error("unknown product")] UnknownProduct,
    #[error("already owned")] AlreadyOwned, #[error("save conflict")] SaveConflict(SaveSummary),
    #[error("payload too large")] PayloadTooLarge,
    #[error("telegram unavailable")] TelegramUnavailable,   // the GatewayError is logged where it is mapped (L8a)
    #[error(transparent)] Db(#[from] sqlx::Error),
}
// L2 writes every variant and every ErrorCode above except SaveConflict(SaveSummary) and ApiErrorBody.current,
// which L6a adds with the saves DTOs (and the TS derive).
// Changed by PUZZLES-PLAN: L6c adds RateLimited { retry_after_secs } (429 rate_limited + Retry-After) and
// HintUnavailable (409 hint_unavailable). No other lane edits error.rs.
// ids.rs: L6b adds PuzzleId ("ch1.drawer"); an addition, RULINGS 9 Q2.
#[derive(Serialize, TS)] #[serde(rename_all = "snake_case")]
pub enum ErrorCode { BadRequest, InitdataInvalid, InitdataExpired, TokenMissing, TokenInvalid, TokenExpired,
                     NotEntitled, NotFound, UnknownProduct, AlreadyOwned, SaveConflict, PayloadTooLarge,
                     TelegramUnavailable, Internal }
#[derive(Serialize, TS)] #[serde(rename_all = "camelCase")]
pub struct ApiErrorBody { pub error: ErrorCode, pub current: Option<SaveSummary> }

// auth
pub enum InitDataError { Malformed, DuplicateKey, MissingHash, MissingUser, BadHash, Expired, FromFuture }
pub struct InitData { pub user: TgUser, pub auth_date: i64 }
pub struct TgUser { pub id: UserId, pub first_name: String, pub language_code: Option<String> }
pub enum TokenError { Malformed, BadMac, Expired }

// telegram/payments.rs — money facts, built from frankenstein types or from the lenient probe (K17)
pub struct PaymentFact { pub payer: UserId, pub currency: String, pub total_amount: u32, pub invoice_payload: String,
                         pub charge: ChargeId, pub provider_charge: String /* "" when Telegram omits it */ }
pub struct RefundFact { pub payer: UserId, pub charge: ChargeId, pub total_amount: u32 }
// telegram/webhook.rs — private; decoded only when the full frankenstein Update decode failed
#[derive(Deserialize)] struct PaymentProbe { message: Option<ProbeMessage> }      // unknown fields ignored
#[derive(Deserialize)] struct ProbeMessage { from: Option<ProbeUser>,
    successful_payment: Option<serde_json::Value>, refunded_payment: Option<serde_json::Value> }  // key present ≠ readable
#[derive(Deserialize)] struct ProbeUser { id: u64 }
#[derive(Deserialize)] struct ProbeSuccessful { currency: String, total_amount: u32, invoice_payload: String,
    telegram_payment_charge_id: String, provider_payment_charge_id: Option<String> }
#[derive(Deserialize)] struct ProbeRefunded { total_amount: u32, telegram_payment_charge_id: String }
// as merged (L8b `06bae54`, cut Q11; server/src/telegram/webhook.rs:84): the probe navigates a serde_json::Value
// (`pointer("/message/successful_payment")`, `/message/from/id`) instead of PaymentProbe / ProbeMessage / ProbeUser;
// ProbeSuccessful stays as above, deserialized from the pointed-to value (webhook.rs:32, :112); no ProbeRefunded and
// no refunded_payment read until L9

pub enum PreCheckoutVerdict { Ok, Reject(RejectReason) }
pub enum RejectReason { UnknownOrder, Mismatch, AlreadyOwned, InProgress, Expired, Temporary,
                        Unavailable /* changed by PUZZLES-PLAN: a hint's tier, chapter or solved predicate */ }
pub enum GrantOutcome { Granted, Duplicate, AlreadyEntitled, OrderMismatch }
// as merged (L8b `06bae54`, cut Q6; server/src/db/payments.rs:67-79): + UnknownProduct, the M19 `None` arm (the
// order stays paid, no entitlement, recorded and logged)
pub enum RevokeOutcome { Revoked, AlreadyRefunded, UnknownCharge }

// telegram/gateway.rs — object-safe (boxed futures), so AppState holds Arc<dyn BotGateway>
pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
pub trait BotGateway: Send + Sync {
    fn create_invoice_link(&self, spec: InvoiceSpec) -> BoxFut<'_, Result<String, GatewayError>>;
    fn answer_pre_checkout(&self, query_id: String, verdict: Result<(), String>) -> BoxFut<'_, Result<(), GatewayError>>;
    fn refund_star_payment(&self, user: UserId, charge: ChargeId) -> BoxFut<'_, Result<(), GatewayError>>;
    fn send_message(&self, msg: OutMessage) -> BoxFut<'_, Result<(), GatewayError>>;
    fn setup(&self, s: SetupSpec) -> BoxFut<'_, Result<(), GatewayError>>;   // webhook + commands + menu button
}
pub struct InvoiceSpec { pub title: String /*1-32*/, pub description: String /*1-255*/,
                         pub payload: OrderId, pub label: String, pub amount: u32 }   // currency "XTR", one price, no provider_token
#[derive(Debug, thiserror::Error)] pub enum GatewayError { #[error("timeout")] Timeout,
    #[error("api: {0}")] Api(String), #[error("transport: {0}")] Transport(String) }
```

### SQL schema — `server/migrations/0001_init.sql` (whole schema, LDB1)

Changed by STORIES-PLAN: the `saves` primary key becomes `(user_id, story_id, slot)` with `saves_story_id_shape`
(LS2 rewrites the table in the PostgreSQL `0001` that LDB1 writes); the statistics log is a new migration,
`0003_stats.sql` (LS3). Both are in [STORIES-PLAN "SQL schema"](STORIES-PLAN.md#sql-schema).

Changed by RULINGS 14 (decision section 6, §4.1, DB-3; as merged, LDB1 `fee9da7`): the schema below is the merged
PostgreSQL file (`server/migrations/0001_init.sql:1-79`), which replaced the SQLite one; nothing was deployed, so
`0001` was rewritten, not migrated.

One constraint per invariant, each named (`CONSTRAINT <table>_<rule>`): tests assert `(SQLSTATE, constraint())`.
All timestamps are unix seconds in `BIGINT`; every integer is `BIGINT` (Rust `i64`).

```sql
-- PostgreSQL >= 16 (IS JSON); the gates run 18. Every integer is BIGINT (Rust i64); times are unix seconds.
-- Every constraint is named: tests assert (SQLSTATE, constraint name).
CREATE TABLE users (
  id            BIGINT NOT NULL,                -- Telegram user id (from verified initData only), <= 52 bits
  first_name    TEXT   NOT NULL,
  language_code TEXT,
  created_at    BIGINT NOT NULL,
  last_seen_at  BIGINT NOT NULL,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE payments (                         -- money facts: never rejected, never deleted
  telegram_payment_charge_id TEXT   NOT NULL,   -- THE idempotency key (principle 2)
  invoice_payload            TEXT   NOT NULL,   -- not an FK: an unknown payload is still recorded
  user_id                    BIGINT NOT NULL,   -- payer (Message.from.id); no FK: a payment row is never refused
  amount                     BIGINT NOT NULL,
  currency                   TEXT   NOT NULL,   -- recorded as received; grant requires 'XTR' (orders CHECK)
  provider_payment_charge_id TEXT   NOT NULL,   -- '' when Telegram omits it (K17 probe)
  paid_at                    BIGINT NOT NULL,
  refunded_at                BIGINT,
  CONSTRAINT payments_pkey               PRIMARY KEY (telegram_payment_charge_id),
  CONSTRAINT payments_amount_positive    CHECK (amount > 0),
  CONSTRAINT payments_refunded_after_paid CHECK (refunded_at IS NULL OR refunded_at >= paid_at)
);
CREATE INDEX payments_by_user ON payments (user_id);

CREATE TABLE orders (
  id          TEXT   NOT NULL,                  -- OrderId = invoice payload
  user_id     BIGINT NOT NULL,
  product_id  TEXT   NOT NULL,
  amount      BIGINT NOT NULL,                  -- from server/catalog.json at creation, never from the request
  currency    TEXT   NOT NULL,
  status      TEXT   NOT NULL,
  invoice_url TEXT,
  created_at  BIGINT NOT NULL,
  checkout_at BIGINT,
  paid_at     BIGINT,
  charge_id   TEXT,
  CONSTRAINT orders_pkey              PRIMARY KEY (id),
  CONSTRAINT orders_user_fk           FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT orders_charge_key        UNIQUE (charge_id),
  CONSTRAINT orders_charge_fk         FOREIGN KEY (charge_id) REFERENCES payments (telegram_payment_charge_id),
  CONSTRAINT orders_amount_positive   CHECK (amount > 0),
  CONSTRAINT orders_currency_xtr      CHECK (currency = 'XTR'),
  CONSTRAINT orders_status_known      CHECK (status IN ('created', 'checkout', 'paid', 'refunded')),
  CONSTRAINT orders_checkout_has_time CHECK (status <> 'checkout' OR checkout_at IS NOT NULL),
  CONSTRAINT orders_paid_has_charge   CHECK (status NOT IN ('paid', 'refunded')
                                             OR (charge_id IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE INDEX orders_by_user_product ON orders (user_id, product_id, status, created_at);

CREATE TABLE entitlements (                     -- the ONLY unlock fact
  user_id    BIGINT NOT NULL,
  product_id TEXT   NOT NULL,
  charge_id  TEXT   NOT NULL,
  granted_at BIGINT NOT NULL,
  CONSTRAINT entitlements_pkey       PRIMARY KEY (user_id, product_id),  -- one per product; revoke = DELETE
  CONSTRAINT entitlements_user_fk    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT entitlements_charge_key UNIQUE (charge_id),
  CONSTRAINT entitlements_charge_fk  FOREIGN KEY (charge_id) REFERENCES payments (telegram_payment_charge_id)
);

CREATE TABLE saves (
  user_id       BIGINT NOT NULL,
  slot          TEXT   NOT NULL,
  rev           BIGINT NOT NULL,
  chapter_id    TEXT   NOT NULL,
  story_version TEXT   NOT NULL,
  line_id       TEXT,
  write_id      TEXT   NOT NULL,                -- client idempotency key of the last successful write
  body          TEXT   NOT NULL,                -- opaque JSON, byte-exact: never jsonb (it rewrites the bytes)
  saved_at      BIGINT NOT NULL,
  CONSTRAINT saves_pkey         PRIMARY KEY (user_id, slot),
  CONSTRAINT saves_user_fk      FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT saves_slot_known   CHECK (slot IN ('auto', 's1', 's2', 's3')),
  CONSTRAINT saves_rev_positive CHECK (rev >= 1),
  CONSTRAINT saves_body_json    CHECK (body IS JSON),
  CONSTRAINT saves_body_size    CHECK (octet_length(body) <= 262144)
);
```

- **Every FK column is indexed** by a UNIQUE or a leading PK/index column: `orders.user_id` by
  `orders_by_user_product`, `entitlements.user_id` and `saves.user_id` by their PKs, both `charge_id` columns by their
  UNIQUEs. PostgreSQL does not index referencing columns by itself.
- **`saves.body` is `TEXT` with `IS JSON` and `octet_length(body) <= 262144`.** `jsonb` would rewrite the bytes
  (whitespace, key order, number forms), and the body is opaque (K12). `octet_length` counts the same UTF-8 bytes as
  the edge rule (`MAX_SAVE_BODY_BYTES`). A bad body is a `23514` on `saves_body_json`, not a cast error.
- **Connection** (`Repo::open`, `server/src/db/mod.rs:22-59`). Changed by RULINGS 14 (decision §4.3; as merged,
  `fee9da7`): `PgConnectOptions::from_str(url)?.application_name("tg-novel-server").options(SESSION_OPTIONS)`, pool
  `max_connections(8)`, `acquire_timeout(5s)`. Every session starts with:
  - `synchronous_commit=on`: the RULINGS 7 b erratum restated (it superseded NORMAL, then `synchronous=FULL`): a grant
    committed and answered 200 to Telegram survives an OS crash or power loss (principle 2);
  - `default_transaction_isolation=read committed`: DB-4 holds only under READ COMMITTED, and the autocommit saves
    writes re-check `rev` instead of failing with `40001`;
  - `lock_timeout=2s` (= K18's DB budget; a blocked row lock errors with `55P03`), `statement_timeout=15s`,
    `idle_in_transaction_session_timeout=30s` (a transaction leaked by a dropped future ends and frees its locks).

  A client startup option outranks `postgresql.conf`, the server command line and every `ALTER DATABASE` /
  `ALTER ROLE` default, so no provider console field can weaken a pin. `pool_session_settings` asserts all six on a
  `TestDb` whose database defaults are hostile (`synchronous_commit = off`, `repeatable read`), and reads
  `transaction_isolation` inside `pool.begin()`.
- **Changed by PUZZLES-PLAN.** `server/migrations/0002_puzzles.sql` (L6c) adds `puzzle_progress` (attempt window +
  `solved_at` per user and puzzle). `server/build.rs` (`cargo:rerun-if-changed=migrations`) makes `migrate!` pick up
  a new migration file in incremental builds. A hint unlock is an `entitlements` row: no new unlock table.
  [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "SQL".
- **Isolation: READ COMMITTED everywhere** (changed by RULINGS 14, decision DB-4; it replaces "transactions start
  with a write"). The pre-checkout takes the payer's `users` row lock first (K18); the grant and the refund rely on
  UNIQUE/PK arbiters and single-row conditions (K19, K20). No SERIALIZABLE anywhere.

### HTTP API

**Common rules:**
- **Auth.** `Authorization: Bearer <token>` on every `/api/*` route except `/api/auth` and `/api/health`.
- **Bodies.** JSON, camelCase, DTO types from `generated/api.ts`. Error body `ApiErrorBody`.
- **Caching.** `Cache-Control: no-store` on every `/api/*` response. Paid content: `private, no-store` +
  `X-Content-Type-Options: nosniff`.
- **Limits.** Default body limit 16 KB (erratum, RULINGS 7 e: L4a owns it, as `DefaultBodyLimit::max(16 * 1024)`
  on `api::router()`, with a 413 test); saves 300 KB; webhook 1 MB.
- **Routing.** axum 0.8 `/{param}` syntax.

| Method + path | Auth | Request | 200 response | Errors | Idempotency |
|---|---|---|---|---|---|
| `GET /api/health` | — | — | `"ok"` | — | — |
| `POST /api/auth` | — | `AuthRequest { initData: string }` (≤ 4 KB) | `AuthResponse { token, expiresAt: number, user: UserDto { id, firstName, languageCode: string\|null } }` | 400 `bad_request`, 401 `initdata_invalid`, 401 `initdata_expired` | naturally (same initData → new token) |
| `GET /api/entitlements` | bearer | — | `EntitlementsResponse { products: ProductDto[] }`, `ProductDto { productId, chapterId, priceStars, owned }` (chapter products only; hint tiers are listed by `GET /api/puzzles/{id}`, changed by PUZZLES-PLAN) | 401 `token_*` | read |
| `GET /api/saves` | bearer | — | `SaveListResponse { slots: SaveSummary[] }`, `SaveSummary { slot, rev, chapterId, storyVersion, lineId, savedAt, writeId }` (changed by STORIES-PLAN: `SaveSummary` gains `storyId`; every story's slots) | 401 | read |
| `GET /api/saves/{slot}` (changed by STORIES-PLAN: `/api/saves/{storyId}/{slot}`; unknown story 404, bad story id 400) | bearer | — | `SaveFull { summary: SaveSummary, body: string }` | 400 bad slot, 404 `not_found` (also for another user's slot: rows are keyed by the token's user) | read |
| `PUT /api/saves/{slot}` (changed by STORIES-PLAN: `/api/saves/{storyId}/{slot}`; a `chapterId` outside the story 400, unknown story 404; the contract below holds per (user, story, slot)) | bearer | `PutSaveRequest { expectedRev: number\|null, writeId: string, chapterId, storyVersion, lineId: string\|null, body: string }` | `PutSaveResponse { rev, savedAt }` | 400, 409 `save_conflict` + `current`, 413 `payload_too_large` | `expectedRev` (optimistic) + `writeId`. **The one statement of the retry contract:** a PUT whose `writeId` equals the stored row's `write_id` returns 200 with the stored `rev` / `savedAt` and writes nothing, whatever its `expectedRev`. Any other `expectedRev` mismatch → 409 + `current` (F3 handles an earlier write of ours in `current`) |
| `POST /api/invoices` | bearer | `CreateInvoiceRequest { productId }` (`chapter:<ch>`, or `hint:<puzzleId>:<tier>`, changed by PUZZLES-PLAN; changed by META-PLAN: `chapter:<ch>` or `pack:<id>`, no hint products) | `CreateInvoiceResponse { orderId, invoiceUrl }` | 404 `unknown_product`, 409 `already_owned` (chapters), 409 `hint_unavailable` (tier order, solved, paid chapter not owned; changed by PUZZLES-PLAN; removed by META-PLAN), 502 `telegram_unavailable` | reuses this user's `created` order for the product younger than 1 h |
| `GET /api/orders/{orderId}` | bearer | — | `OrderResponse { orderId, productId, status: 'created'\|'checkout'\|'paid'\|'refunded' }` | 404 (unknown, or not this user's) | read |
| `GET /api/chapters/{chapterId}` | bearer | — | `ChapterPayload { chapterId, storyVersion, story: unknown, meta: unknown, assets: unknown, en: unknown, world: unknown }` (raw JSON composed from `ContentStore` via `RawValue`; `world`, the paid public world or `null`, changed by PUZZLES-PLAN) | 403 `not_entitled`, 404 (unknown or free chapter: free chapters are static files) | read; `private, no-store` |
| `GET /api/assets/{file}` | bearer | — | bytes (`image/avif`, `image/webp`, `audio/mp4`, `audio/wav`) | 403, 404 (file not in the content index — a map lookup, never a path join) | read; `private, no-store` |
| `GET /api/puzzles/{puzzleId}?lang=ru\|en` (changed by PUZZLES-PLAN, L6c) | bearer | — | `PuzzleStatus { puzzleId, solved, hints: HintTier[] }`; `text` only for owned tiers (changed by META-PLAN M21: `hints: [{ tier, unlocked, text \| null }]`, `text` only for tiers unlocked from the balance) | 400, 403 `not_entitled` (paid chapter), 404 | read; `private, no-store` |
| `POST /api/puzzles/{puzzleId}/attempts` (changed by PUZZLES-PLAN, L6c) | bearer | `AttemptRequest { answer: number[] }` | `AttemptResponse { correct, solved }` | 400 shape, 403, 404, 429 `rate_limited` + `Retry-After` (20 per 600 s per user and puzzle) | the result is a function of the answer; a retry counts once more toward the window |
| `POST /api/stats/events` (changed by STORIES-PLAN, LS3) | bearer | `PostStatsRequest { events: StatEventDto[] }` (1–32) | `PostStatsResponse { recorded, duplicates, rejected }` | 400, 429 `rate_limited` + `Retry-After` (600 events per user per hour; changed by META-PLAN revision 1, W2: 600 fact events, counted apart from `choice_made`, which has its own 600 per hour with per-event `rate_limited` rejects of repeat picks and never a 429 — STORIES-PLAN Y11) | (user, `eventId`) UNIQUE: a replay is a duplicate |
| `GET /api/stats` (changed by STORIES-PLAN, LS3) | bearer | — | `StatsResponse` (endings and chapters X of Y per story and for the game; changed by META-PLAN M8: no `endingsTotal` — the endings reached and the chapter totals only) | 401 | read |
| Changed by META-PLAN | | | the routes of [META-PLAN "HTTP API"](META-PLAN.md#data-model-and-contracts): `POST /api/puzzles/{id}/hints/{tier}`, `GET /api/wallet`, `POST /api/stories/{storyId}/card`, `GET /api/social`, `GET /api/invites/{code}` and `POST /api/invites/{code}/request` (revision 1, C1), `POST /api/friends/requests/{handle}/accept`, `DELETE /api/friends/{handle}`, `POST /api/invite/rotate`, `PUT /api/consents/friends_profile`, `GET /api/privacy` (no auth), `GET /api/friends/{handle}/profile`, `POST /api/share`, `POST /api/gifts` (revision 1, W1: a handle, never a Telegram id, names another user) | | | |
| `POST /telegram/webhook` | header `X-Telegram-Bot-Api-Secret-Token` (constant-time) | Telegram `Update` (bytes) | 200 (also on undecodable input without a payment, logged; an undecodable payment goes through the K17 probe first) | 401 bad/missing secret (before parsing); 500 when a `successful_payment` / `refunded_payment` transaction failed, or when a payment-bearing update's money fields are unreadable even by the probe (Telegram redelivers; grant and revoke are idempotent) | `telegram_payment_charge_id` |

**Dev routes** (`server-dev` only; not routable on the `server` binary, test `server_has_no_dev_routes`):

| Route | Behaviour |
|---|---|
| `GET /dev/launch?uid=1001&lang=ru&name=Dev` | sign initData with the dev bot token → `302 /#tgWebAppData=<enc>&tgWebAppVersion=9.6&tgWebAppPlatform=android&tgWebAppThemeParams=<enc json>`. Changed by META-PLAN (LF1): `&startapp=<p>` signs `start_param` into the initData and appends `tgWebAppStartParam` |
| `GET /dev/prepared/{id}` (changed by META-PLAN, LF2) | the `PreparedShare` the fake gateway stored for `savePreparedInlineMessage` (text, button, url), so the e2e can assert a share's content |
| `GET /dev/invoices/{slug}` | `{ orderId, title, description, amount }` recorded by the fake gateway |
| `POST /dev/simulate-payment` | `{ slug, outcome: 'paid' \| 'paid_twice', webhookDelayMs?: number }`. Feeds a `pre_checkout_query` update, then (if answered ok) a `successful_payment` message (`provider_payment_charge_id: ""`, `telegram_payment_charge_id: "dev_<uuid>"`) through the real handler. Returns `{ precheckoutOk, chargeId? }`. As merged (L8b `06bae54`, cut Q12; `server/dev/src/simulate.rs`): the charge id is `dev_<32 hex>`; the route answers after the pre-checkout, and a `webhookDelayMs` (0..=60000) delays only the payment, fed by a spawned task; 400 for a delay out of range or a bad body, 404 for an unknown slug or order, 500 when the webhook handler answers anything but 200 |
| `POST /dev/refund` | `{ chargeId }` → the admin refund path with the fake gateway → `{ outcome }` |
| `POST /dev/refunded-update` | `{ chargeId }` → a `refunded_payment` message through the real handler |

### Token format

```text
v1.<user_id>.<exp_unix>.<hex(HMAC-SHA256(TOKEN_KEY, "v1.<user_id>.<exp_unix>"))>
```

- **Key.** `TOKEN_KEY` is 32 random bytes in hex, from env, separate from the bot token. Dev: random per start.
- **TTL.** 1800 s, configurable 900–3600.
- **Verify.** Split, parse, `Mac::verify_slice` (constant time), then `exp > now`.
- **Client.** Holds the token in memory only. `401 token_*` → one single-flight re-auth with the same raw initData →
  retry once. `401 initdata_expired` → the "reopen the app" screen.
- **Rotation.** Bump `v1` → `v2` with a second key (Later).

### Build outputs (the story and asset tools)

| Output | Free chapter | Paid chapter |
|---|---|---|
| compiled story | `client/src/story-gen/free/<ch>.story.json` | `server/content/chapters/<ch>/story.json` |
| meta (`ChapterMeta`) | `client/src/story-gen/free/<ch>.meta.json` | `server/content/chapters/<ch>/meta.json` |
| en table `{id: text}` (produced by L3c C5, as merged `523a117`) | `client/src/story-gen/free/<ch>.en.json` | `server/content/chapters/<ch>/en.json` |
| asset manifest | `client/src/story-gen/free/<ch>.assets.json` | `server/content/chapters/<ch>/assets.json` |
| encoded files | `client/public/assets/<kind>-<id>-<hash8>.<ext>` (asset used by any free chapter) | `server/content/assets/<kind>-<id>-<hash8>.<ext>` (used only by paid chapters) |

Shared outputs:
- `client/src/story-gen/catalog.json` — public: chapters, titles, cast names; **no paid content**.
- `server/content/build/usage.json` — assets per chapter and knot, and each knot's carried stage
  (`carried: AssetId[]`, K9); input to the asset tool, to `budget/knot-set` and to `scan-dist`'s paid-only asset
  check (Paid-content protection).
- Fingerprints for the dist scanner, **one producer per file**; each tool rewrites only its own file:
  - `server/content/build/fingerprints.lines.json` (story tool, `emit.ts`): `lineIds` — every paid line ID; `texts` —
    every 10th paid line text of ≥ 24 chars, and at least one per paid chapter (its longest line), so the section is
    never empty while a paid chapter has text.
  - `server/content/build/fingerprints.assets.json` (asset tool, `manifest.ts`): `files` — paid asset file names and
    their content hashes.
- `server/content/build/asset-owners.json` — paid file → products allowed to read it. Changed by RULINGS 30 (as
  merged, L5 `e21775b`; cut Q1): dropped, not produced. No code read it; L6b derives the owners from the paid
  `assets.json` manifests.

Changed by STORIES-PLAN (Y5, Y15):
- `catalog.json` gains `stories` (no endings); every meta gains `endings` (free metas public, paid metas server-only);
- `server/content/stories.json` — the server story index (titles, chapters with tier and product, endings), story
  tool, never under `client/`;
- `client/src/story-gen/covers.json` + `client/public/assets/cover-*` — the Home covers, asset tool, always public.

The client imports free outputs only by URL:
- `import.meta.glob('../story-gen/free/*.json', { query: '?url', import: 'default', eager: true })`;
- `import catalogUrl from '../story-gen/catalog.json?url'`, fetched at boot (changed by STORIES-PLAN: with
  `covers.json?url`, in parallel).

Consequences:
- `check` needs no generated files: `?url` imports type-check through `vite/client` ambient modules (verify: L3b).
- The directory is free-only by construction and by the scanner (R4 §3: a glob over a mixed directory leaks).

### Save format and resume

`SaveBodyV1` is defined above. Algorithm (`story/resume.ts`), actor: client:

1. **Load the chapter.** Free: static. Paid: `GET /api/chapters/{id}`, where `403` → paywall screen (the save stays).
2. **Pending chapter start.** If `body.ink === null`: start fresh with `chapterStart.carry` (the save was written at
   the previous chapter's end, before purchase).
3. **Exact load.** If `body.storyVersion === meta.storyVersion`:
   - `new Story(json)` with `onError` collecting messages; `state.LoadJson(body.ink)` in try/catch.
   - On a throw or any error/warning (inkjs "approximated" warning, R3 §2.4) → step 4.
   - Otherwise apply `body.staging` with duration 0, show `currentText` / `currentChoices` by line ID.
     `LoadJson` re-exposes the last line [R3 §2.3].
4. **Knot checkpoint.** If `body.checkpoint` and `meta.knots[checkpoint.knot]` exists:
   - fresh `Story`;
   - for each name in `meta.vars` present in `checkpoint.vars`: set it;
   - `ChoosePathString(knot)`;
   - apply `checkpoint.staging`;
   - continue;
   - show the toast "the story was updated; resumed at the start of the scene".
   - A throw or an `onError` message during this step → step 5.
   - This is sound because DSL v1 has no tunnels, knot/stitch parameters or `LIST` (STAGING-DSL §10, lint
     `ink/forbidden`): `ChoosePathString` resets the call stack (inkjs `Story.ts` 1677-1686), so a knot entry must
     need no call context, and every VAR is a scalar that `checkpoint.vars` can hold.
5. **Chapter start.** Otherwise: fresh `Story`, set `chapterStart.carry`, start, empty stage, toast.

- **Error floor.** `resume(body, chapter, { minLevel })` starts at `minLevel` (`'exact'` by default). GameSession
  counts ink errors in the current chapter (reset on chapter change); "Return to last save" after the n-th error
  resumes with `minLevel` one level lower per error (1st → `'checkpoint'`, 2nd and later → `'chapter-start'`, the
  floor). An ink error that a resume carries forward (for example into a later autosave of the same version)
  therefore walks down to chapter start instead of looping.
- **Version mismatch skips step 3 entirely**, because a removed line before the cursor resumes silently at the wrong
  line [R3 §2.4].
- **Checkpoint capture.** At each knot entry: the runner reports `enteredKnot` when the first path segment of
  `state.currentPathString` changes to a scene knot from `meta.knots` (verify: `currentPathString` semantics, L13).

**Autosave triggers:**
1. chapter start;
2. every choice presentation (state before choosing, so a resume shows the same choices);
3. every knot entry;
4. `deactivated`;
5. `pagehide` (best effort, `fetch(..., { keepalive: true })`, body ≤ 64 KiB — verify: the keepalive quota, L10).

**Write policy.** At most one PUT in flight; the latest pending write supersedes queued ones. Manual slots s1–s3 come
from the menu.

**Changed by PUZZLES-PLAN (F9).**
- **More autosave triggers:**
  - every `yield` step;
  - an exploration `dirty` effect (debounced 2 s);
  - a wrong puzzle attempt;
  - a hint opened.
- **Exact resume at a yield** rebuilds the yield step from `body.at.yield`.
- **Every level** passes `body.world` through `reconcile` with `body.worldVersion`. After a world change (texts
  excluded), every section is checked: the current one at this load, every other one at its next entry (changed by
  PUZZLES-PLAN revision 3). A section whose saved state the current world cannot produce from section entry restarts
  from that entry, with a toast; its start room's `onEnter` runs again (changed by PUZZLES-PLAN revision 2). The
  chapter-start level uses `EMPTY_WORLD_STATE`.
- **An open puzzle** reopens at its start: a linear puzzle at its yield; an exploration puzzle (an overlay, not a
  yield) on the next tap of its lock.

### Shared types strategy

| Seam | Source of truth | Mechanism | Staleness gate |
|---|---|---|---|
| HTTP JSON (client ↔ server) | Rust DTOs (`server/src/api/dto.rs`) | ts-rs 12.0.1 → `client/src/api/generated/api.ts` (one file, `decl()` of each DTO) | `bindings_are_fresh` (Rust); `decode.test.ts` decodes Rust-written `client/src/api/fixtures/dto-samples.json` (writer `write_dto_samples` `#[ignore]`, freshness `dto_samples_are_fresh`) |
| Telegram webhook JSON | frankenstein 0.52.1 types; for the payment subset, our own lenient `PaymentProbe` when the full decode fails (K17) | serde | webhook decode tests with recorded update shapes, incl. a payment update the pinned types reject |
| Save body | TS `SaveBodyV1` (client-owned; opaque to the server) | `save-codec.ts` | codec tests; the server checks only JSON validity + size (changed by RULINGS 14, as merged `fee9da7`: the edge parses `serde_json::Value` under serde_json's recursion limit, the DB checks `IS JSON` + `octet_length`) |
| Build outputs (catalog, meta, manifest) | TS types in `story/catalog.ts` (both producer and consumer are TS) | decoders | story/asset tool tests |
| Chapters ↔ products | `story/chapters.json` (`productId`) + `server/catalog.json` (prices) (changed by STORIES-PLAN: chapter products = the paid chapters of the generated story index; `server/catalog.json` holds a default price, overrides and templates) | — | `catalog_matches_story_chapters` (Rust reads `../story/chapters.json`); the server refuses to start if a catalog product has no content (changed by STORIES-PLAN: or if the story index is missing, a story's first chapter is paid, or a rendered chapter invoice text is out of limits) |
| Stories (changed by STORIES-PLAN) | `story/stories.json` + `story/chapters.json` | the story tool emits the public `stories`, the metas' `endings` and `server/content/stories.json` | `catalog/stories` lint; `emit: server story index matches the server fixture shape` (TS) against `server/tests/fixtures/content/stories.json`, which the L6b content tests (Rust) load |
| Staging tags | `story/tags.ts` | one parser for gate + runtime | `dsl-doc.test.ts` two-way check against STAGING-DSL.md |
| World data (changed by PUZZLES-PLAN) | `client/src/world/types.ts` (producer and consumer are TS) | `decodeWorldSource` (story tool) / `decodeWorldPublic` (runtime; refuses `solution` / `hints`) | `decode: *`, `emit: public world has no solution or hint fields` |
| Server puzzle content (changed by PUZZLES-PLAN) | the committed fixture `server/tests/fixtures/content/puzzles/ch1.json` | TS `toServer` emits it; Rust `ContentStore` loads it | `emit: server puzzle content matches the server fixture shape` (TS) + the L6b/L6c content tests (Rust) |

---

## Module API (signatures)

```ts
// telegram/index.ts
export type InvoiceStatus = 'paid' | 'cancelled' | 'failed' | 'pending';
export type TgError = { kind: 'unsupported'; method: string } | { kind: 'invalid'; method: string; detail: string }
                    | { kind: 'storage'; detail: string };
export type PerfClass = 'LOW' | 'AVERAGE' | 'HIGH';
export type Unsubscribe = () => void;
export interface TelegramClient {
  readonly inTelegram: boolean;            // initData !== ''
  readonly initData: string;               // raw; sent only to POST /api/auth
  readonly version: string; readonly platform: string; readonly perfClass: PerfClass;
  isVersionAtLeast(v: string): boolean;
  ready(): void; expand(): void; disableVerticalSwipes(): void;             // swipes gated 7.7
  setClosingConfirmation(on: boolean): void;                                 // 6.2
  setChromeColors(header: `#${string}`, background: `#${string}`): void;     // 6.1 / any colour 6.9
  onLifecycle(fn: (e: 'activated' | 'deactivated') => void): Unsubscribe;    // 8.0 events; visibilitychange fallback
  backButton: { setVisible(v: boolean): void; onPress(fn: () => void): Unsubscribe };   // 6.1
  openInvoice(url: string): Promise<Result<InvoiceStatus, TgError>>;         // 6.1; throws → TgError
  cloud: { get(k: string): Promise<Result<string | null, TgError>>; set(k: string, v: string): Promise<Result<void, TgError>> };  // 6.9; v ≤ 4096
  device: { get(k: string): Promise<Result<string | null, TgError>>; set(k: string, v: string | null): Promise<Result<void, TgError>> } | null; // 9.0
  haptic: { impact(s: 'light' | 'medium'): void; selection(): void; notify(t: 'error' | 'success' | 'warning'): void };
}
export function getTelegram(): TelegramClient;

// story/runner.ts
export type RunnerStep =
  | { kind: 'line'; lineId: LineId; speaker: SpeakerId | null; ru: string; commands: StagingCommand[]; knot: KnotName; enteredKnot: boolean }
  | { kind: 'choices'; choices: ReadonlyArray<{ index: number; lineId: LineId; ru: string }>; commands: StagingCommand[]; knot: KnotName; enteredKnot: boolean }
  | { kind: 'end'; commands: StagingCommand[] };
export type RunnerError = { kind: 'ink'; message: string } | { kind: 'tags'; errors: TagError[]; lineId: LineId | null }
                        | { kind: 'no-id'; path: string } | { kind: 'load'; message: string };
// Changed by PUZZLES-PLAN (L13):
// - RunnerStep gains { kind: 'yield'; yield: YieldCommand; commands; knot; enteredKnot };
// - StoryRunner gains enter(knot, projection): Result<void, RunnerError>, valid only at a yield; it writes the
//   declared projection VARs, then calls ChoosePathString(knot);
// - RunnerError gains 'not-at-yield' | 'unknown-knot' | 'bad-projection'.
// Full signatures: PUZZLES-PLAN "Module API".
export type StartPoint = { kind: 'fresh'; carry: Record<VarName, InkScalar> } | { kind: 'exact'; ink: string }
                       | { kind: 'checkpoint'; knot: KnotName; vars: Record<VarName, InkScalar> };
export class StoryRunner {
  static create(ch: LoadedChapter, start: StartPoint, assets: AssetIndex): Result<StoryRunner, RunnerError>;
  next(): Result<RunnerStep, RunnerError>;       // Continue() until a line, choices or end; merges tag-only steps
  choose(index: number): Result<void, RunnerError>;
  current(): RunnerStep | null;
  inkState(): string;
  readVars(names: readonly VarName[]): Record<VarName, InkScalar>;
  dispose(): void;                               // idempotent; the Story is dropped
}

// scene/controller.ts
export interface SceneController {
  mount(host: HTMLElement, o: { resolution: number; fetchAsset: FetchAsset }): Promise<Result<void, SceneError>>;
  setChapter(m: AssetManifest): void;   // releases every preload:* holder and every next:* holder except next:<m.chapterId>
                                        // (that one holds m's first knot, preloaded by F5, and is kept)
  apply(batch: readonly VisualCommand[], o: { instant: boolean }): Promise<void>;   // resolves after transitions + wait
  complete(): void;                              // tap during a transition
  restore(s: Omit<StagingSnapshot, 'bgm'>): Promise<void>;   // instant
  snapshot(): Omit<StagingSnapshot, 'bgm'>;
  preload(tag: string, ids: readonly AssetId[], from?: AssetManifest): void;  // background, cancellable; ids resolve
                                                 // in `from` (the next chapter's manifest, F5) or else the current one
  releasePreload(tag: string): void;
  ensure(ids: readonly AssetId[], signal: AbortSignal): Promise<Result<void, SceneError>>;  // blocking load of a batch's assets
                                                 // as merged (L11 `1e2f421`, RULINGS 35 Q11): holder 'ensure' (exact),
                                                 // released by apply / restore, setChapter, destroy
  onActivated(): Promise<void>;                  // context-loss check + rebuild
  pause(): void; resume(): void;
  stats(): { liveTextures: number; liveBytes: number; pendingLoads: number; activeTimelines: number; overCap: number };
  debugForceContextLoss(): void;                 // wired to __novelDebug only under __TG_MOCK__ (perf e2e)
  debugPropRects(): ReadonlyArray<{ prop: PropId; x: number; y: number; w: number; h: number }>;
                                                 // changed by PUZZLES-PLAN (X10): page CSS px of live prop sprites;
                                                 // __novelDebug only under __TG_MOCK__ (puzzles e2e)
  destroy(): void;
}
// scene/registry.ts
export interface AssetRegistry {
  acquire(id: AssetId, holder: string, o: { signal?: AbortSignal; priority: 'visible' | 'preload' }): Promise<Result<TextureHandle, AssetError>>;
  release(id: AssetId, holder: string): void;    // idempotent
  releaseHolder(prefix: string): void;           // e.g. 'preload:'
  stats(): { live: number; bytes: number };
}
// changed by RULINGS 35 (as merged, L11 `1e2f421`; cut Q3; `client/src/scene/registry.ts:31-48`):
//   acquire(id, holder, o: { entry: ImageEntry; priority: 'visible' | 'preload'; signal?: AbortSignal })
//   releaseHolder(h: string)  — a trailing ':' ('preload:') releases that family; any other name is that exact holder
//   stats(): { live: number; bytes: number; pending: number; overCap: number }

// audio/manager.ts
export interface AudioManager {
  apply(cmds: readonly AudioCommand[], o: { instant: boolean }): void;
  restore(bgm: StagingSnapshot['bgm']): void;
  currentBgm(): StagingSnapshot['bgm'];
  setChapter(m: AssetManifest): void;            // releases SFX of other chapters; keeps what was preloaded from m
  preload(ids: readonly AssetId[], from?: AssetManifest): void;   // SFX decode + BGM head; ids resolve in `from` (F5)
  setVolumes(v: { master: number; bgm: number; sfx: number }): void;
  suspend(): void; resume(): Promise<'running' | 'needs-gesture'>;
  stats(): { decodedBytes: number; state: AudioContextState };
}
// changed by RULINGS 40 (as merged, L12 `d6c07f7`; impl Q1, Q2; client/src/audio/manager.ts:21-58):
//   setChapter(m: AssetManifest | null): void;   // null: no chapter, as on Home (exitToStories)
//   onNeedsGesture(fn: (needed: boolean) => void): () => void;   // fn(true) / fn(false) on both edges; returns the unsubscribe
//   preload: SFX decode only, no BGM head. The reason is memory: a gated BGM head would be a third blob of up to
//   3 MB beside the two decks of the memory row "Audio: decoded SFX + 2 BGM files during a crossfade".
export function createAudioManager(ctx: AudioContext, deps: { fetchAsset: FetchAsset }): AudioManager;
export function unlockAudio(): AudioContext;      // audio/unlock.ts — call synchronously inside the tap handler

// app/game.ts
export interface Game {
  start(from: { kind: 'new'; chapter: ChapterId } | { kind: 'slot'; slot: SaveSlot }): Promise<Result<void, GameError>>;
  advance(): void; choose(index: number): void; setMode(m: 'normal' | 'auto' | 'skip'): void;
  save(slot: 's1' | 's2' | 's3'): Promise<Result<void, SaveError>>;
  buy(product: ProductId): void;
  dispose(): void;
}
// Changed by STORIES-PLAN (Y14): start() takes the story — { kind: 'new'; story: StoryId; chapter } |
// { kind: 'slot'; story: StoryId; slot } — and Game gains exitToStories() (the open PuzzleSession and PurchaseFlow
// disposed, autosave, ExploreController dispose, runner dispose, scene restore to EMPTY_SNAPSHOT + releasePreload,
// audio release, SaveService dispose, stats flush; the Pixi Application stays; the order: STORIES-PLAN "Module API",
// revision 1). One SaveService per session (story); the StatsReporter is injected (STORIES-PLAN "Module API").

// purchase/flow.ts
export type PurchaseState =
  | { kind: 'idle' } | { kind: 'requesting' } | { kind: 'sheet'; orderId: OrderId }
  | { kind: 'confirming'; orderId: OrderId; since: number } | { kind: 'delayed'; orderId: OrderId }
  | { kind: 'failed'; reason: 'cancelled' | 'failed' | 'network' | 'telegram' | 'unknown-product' }
  | { kind: 'unlocked'; product: ProductId };
export function createPurchaseFlow(deps: { api: Endpoints; tg: TelegramClient; clock: Clock;
  onState: (s: PurchaseState) => void }): { buy(p: ProductId): void; checkAgain(): void; onActivated(): void; dispose(): void };
```

```rust
// server lib
#[non_exhaustive]   // erratum (RULINGS 7 d): not a private `_built: ()` (clippy `manual_non_exhaustive` rejects it);
                    // a struct literal or functional update outside the `server` crate still does not compile (W19)
pub struct AppState { pub repo: Repo, pub gateway: Arc<dyn BotGateway>, pub keys: Arc<Keys>, pub cfg: Arc<Config>,
                      pub content: Arc<ContentStore>, pub catalog: Arc<Catalog>, pub clock: Arc<dyn Clock> }
impl AppState {
    pub async fn new(cfg: Config) -> Result<AppState, StartupError>;  // THE constructor: every field derived from cfg
                                                   // with the production seam (system clock, FrankensteinGateway)
    pub fn with_clock(self, c: Arc<dyn Clock>) -> AppState;           // L4a; tests
    pub fn with_gateway(self, g: Arc<dyn BotGateway>) -> AppState;    // L8a; server-dev, tests
}
#[derive(Debug, thiserror::Error)]
pub enum StartupError { /* Db, Migrate (L2); Content (L6b): a lane that adds a loaded field adds its variant here */ }
pub fn build_router(state: AppState) -> Router;
pub mod auth { pub fn validate_init_data(raw: &str, bot_token: &str, now: i64, max_age: i64) -> Result<InitData, InitDataError>;
               pub fn data_check_string(pairs: &[(String, String)]) -> String; pub fn secret_key(bot_token: &str) -> [u8; 32];
               pub fn issue_token(k: &TokenKey, u: UserId, now: i64, ttl: i64) -> (String, i64);
               pub fn verify_token(k: &TokenKey, t: &str, now: i64) -> Result<UserId, TokenError>; }
pub mod telegram::webhook { pub async fn webhook(State(st): State<AppState>, headers: HeaderMap, body: Bytes) -> StatusCode; }
pub mod telegram::payments {
  pub async fn on_pre_checkout(st: &AppState, q: &PreCheckoutQuery) -> Result<PreCheckoutVerdict, sqlx::Error>;
  pub async fn on_successful_payment(st: &AppState, fact: &PaymentFact) -> Result<GrantOutcome, sqlx::Error>;
  pub async fn notify_unapplied(st: &AppState, fact: &PaymentFact, outcome: GrantOutcome);  // after commit; payer + admins;
                                                 // gateway errors logged, never fail the webhook (L9)
  pub async fn revoke(st: &AppState, charge: &ChargeId, now: i64) -> Result<RevokeOutcome, sqlx::Error>;
  pub async fn admin_refund(st: &AppState, charge: &ChargeId) -> Result<RevokeOutcome, RefundError>; }

// server-dev lib (server/dev/src/lib.rs)
// changed by RULINGS 14 (decision §3.5; as merged, fee9da7)
pub struct DevPaths { pub database_url: String, pub content: PathBuf }
    // main.rs: tgn_dev_<port> (recreated per launch) + server/content; dev.rs: a pgdev::TestDb per test + the fixtures
pub async fn build_dev_app(paths: DevPaths) -> Result<Router, StartupError>;   // AppState::new + with_gateway (L8a);
                                                       // connects + migrates paths.database_url, creates/drops nothing
pub async fn launch_database(cluster: &DevCluster, name: &DbName) -> Result<String, PgDevError>;
                                                       // DROP … WITH (FORCE) + CREATE; returns the database URL
```

---

## Telegram integration module and the dev mock

### Production behaviour (`telegram/webapp.ts`)

**Boot:**
1. If `initData === ''` → the "Open in Telegram" screen (no mock in production).
2. `expand()`.
3. `disableVerticalSwipes()` (≥ 7.7).
4. `setChromeColors('#000000', '#000000')`.
5. `ready()` once the tap screen has rendered, so Telegram's placeholder hides onto our UI [R1 §2].

**Viewport:**
- `#app { position: fixed; inset: 0 0 auto 0; height: var(--tg-viewport-stable-height, 100%) }` [R1 §2].
- Never `viewportHeight` for bottom-pinned UI. Never `vh` (arch test).
- The overlay pads by `--app-inset-top|bottom|left|right = calc(var(--tg-safe-area-inset-X, 0px) +
  var(--tg-content-safe-area-inset-X, 0px))`, set once by `viewport.ts` in CSS.
- The stage canvas is full-bleed under the insets.
- Changed by PUZZLES-PLAN (X10): the exploration hotspot layer is positioned inside the stage host (the box Pixi's
  `resizeTo` reads), never in the padded overlay box, so its buttons and the canvas share one coordinate box.

**Portrait-first:**
- The stage is a column with `aspect-ratio: 9 / 16` max, centered.
- In landscape it is pillar-boxed (black). `lockOrientation` cannot force portrait [R1 §2], so CSS only.

**Theme:**
- Menus, settings, saves, paywall and terms use `var(--tg-theme-bg-color | text-color | hint-color | button-color |
  button-text-color | secondary-bg-color, <fallback>)`; TWA keeps these vars live on `themeChanged`.
- The dialogue box keeps its own dark translucent panel for legibility over art.

**BackButton:**
- `ui/screens.ts` holds the overlay stack (menu, backlog, settings, saves, chapters, paywall, terms; changed by
  META-PLAN: and card, friends, friend, wallet, gift, consent, invite).
- `backButton.setVisible(stack.length > 0)`; press → pop.
- The game root has no BackButton: Android back then closes the app [R1 §2], guarded by closing confirmation during
  play.
- Changed by PUZZLES-PLAN (K26, X12): while exploring with a non-empty room path, `setRootBack` makes the button walk
  one room back; with an empty path, and while an event knot runs, it stays hidden.
- Never `history`.

**Lifecycle (`activated` / `deactivated`, 8.0; `visibilitychange` as fallback):**
- `deactivated` → pause GSAP's global timeline and the render loop, suspend audio, pause typewriter/auto/polling,
  autosave.
- `activated` → resume; `scene.onActivated()` (context check); `audio.resume()` → `'needs-gesture'` shows
  "tap to resume sound"; the purchase flow re-polls; token refresh if expired.

**Wrappers:**
- `openInvoice(url, cb)` → Promise. TWA throws `WebAppInvoiceUrlInvalid` / `WebAppInvoiceOpened` /
  `WebAppMethodUnsupported` → `TgError` values [R1 §1, §2].
- CloudStorage value ≤ 4,096 chars, checked before the call.
- DeviceStorage is `null` below 9.0.
- Haptics: `impact('light')` on a choice.
- Changed by META-PLAN (M14, M16; L7):
  - `supportsShareMessage()` = `isVersionAtLeast('8.0')`;
  - `shareMessage(id)` → Promise of a `Result`: TWA's `shareMessage` posts `web_app_send_prepared_message`; the
    `shareMessageSent` / `shareMessageFailed` events (errors `UNSUPPORTED`, `MESSAGE_EXPIRED`, `MESSAGE_SEND_FAILED`,
    `USER_DECLINED`, `UNKNOWN_ERROR`) map to `ShareError` values; a 60 s guard ends a silent wait; the listeners are
    removed after the first event;
  - `openTelegramLink(url)` (only `https://t.me/` URLs) and `openLink(url)` (only `https:`; from a tap) — never
    `window.open`, which TWA's `openLink` uses below 6.1, so the facade refuses below 6.1;
  - `startParam()` reads `initDataUnsafe.start_param` for UX only (the invite prompt); the server reads the signed one.
    As merged (L7 `57e1424`, cut Q1): it parses `start_param` from the raw `initData` string
    (`client/src/telegram/webapp.ts:187`), since the arch rule `init-data-unsafe` forbids reading `initDataUnsafe`;
    it stays a UX hint only.
    Revision 1 (META-PLAN M10, C1): the client also presents the invite code it carries to `GET` / `POST
    /api/invites/{code}` — a bearer capability to ask, validated by the server; never an identity. The referral
    attribution reads only the signed `start_param`.

**Performance class:** the regex from R1 §6. LOW → render resolution 1. It is never used for security.

### Dev mock (native transport, R1 §5b) — `__TG_MOCK__` builds only (dev server and `--mode e2e`)

1. **`vite-plugins/tg-dev-mock.ts`** (`transformIndexHtml`, `mode !== 'production'`) injects an inline **classic**
   script *before* the TWA tag. It:
   - defines `window.TelegramWebviewProxy = { postEvent(type, json) }`, which queues events;
   - redirects to `/dev/launch` when neither `location.hash` has `tgWebAppData` nor
     `sessionStorage['__telegram__initParams']` exists;
   - defines the canary string `__TG_DEV_MOCK__`.
2. **`/dev/launch`** (server-dev) signs initData with the dev bot token → `302 /#tgWebAppData=…`. TWA parses the hash
   at load. **The real HMAC path runs** on `POST /api/auth` (RULINGS 5). No bypass exists in any build.
3. **`telegram/dev/mock-transport.ts`** (dynamic import guarded by `if (__TG_MOCK__)`, so production builds tree-shake
   it):
   - drains the queue and answers through `window.Telegram.WebView.receiveEvent(type, data)`:
     - `viewport_changed { height, is_expanded: true, is_state_stable: true }`;
     - `theme_changed`;
     - `safe_area_changed` / `content_safe_area_changed`;
     - `visibility_changed { is_visible }`;
     - `back_button_pressed`;
     - `custom_method_invoked` (CloudStorage, backed by `localStorage['__mock_cloud__']`);
     - `device_storage_*` (backed by `localStorage['__mock_device__']`);
     - `invoice_closed`.
   - records every `postEvent` (`window.__tgMock.events`) so tests can assert `web_app_setup_back_button`, etc.
   - exposes `window.__tgMock`: `minimize()`, `restore()`, `pressBack()`, `setSafeArea()`, `setInvoiceOutcome()`.
   - Changed by META-PLAN (L7): answers `web_app_send_prepared_message { id }` with `prepared_message_sent`, or with
     `prepared_message_failed { error }` as set by `__tgMock.setShareOutcome('sent' | <error>)`; records
     `web_app_open_tg_link` and `web_app_open_link` without navigating; `__tgMock.setVersion(v)` lets a test run a
     client below 8.0 (the link fallback). `/dev/launch?startapp=` (LF1) gives the launch a signed `start_param`;
     `GET /dev/prepared/{id}` (LF2) shows what the fake gateway prepared.
4. **Fake Stars sheet** (`telegram/dev/invoice-sheet.ts`): on `web_app_open_invoice { slug }` it fetches
   `GET /dev/invoices/{slug}` and shows title and amount. Buttons and their outcomes:

   | Button | Server action | `invoice_closed` |
   |---|---|---|
   | **Pay** | `POST /dev/simulate-payment { outcome: 'paid' }` | `paid` |
   | **Pay, webhook +3 s** | same, with `webhookDelayMs: 3000` | `paid` immediately — the race test |
   | **Pay twice** | `outcome: 'paid_twice'` | `paid` — the idempotency test |
   | **Pending** | `webhookDelayMs: 3000` | `pending` |
   | **Cancel** | — | `cancelled` |
   | **Fail** | — | `failed` |
5. **Compiled out:**
   - `vite build` (mode `production`) defines `__TG_MOCK__ = false` → dead code eliminated;
   - the plugin is inactive;
   - `scan-dist.ts` fails on `__TG_DEV_MOCK__`, `__tgMock`, `/dev/launch`, `__novelDebug`;
   - the `server` binary has no `/dev/*` routes.
6. **Playwright** routes `https://telegram.org/js/telegram-web-app.js*` to `client/e2e/fixtures/telegram-web-app.js`
   (pinned copy, so CI does not depend on the network) and clears `sessionStorage` between tests (`__telegram__*`
   keys persist) [R1 §5].

---

## Critical flows

### F1. Boot → first line

| # | Actor | Step | If it fails / repeats |
|---|---|---|---|
| 1 | Telegram | opens the Mini App with launch params in the hash (only via inline `web_app` button, menu button or Main Mini App; never a reply-keyboard button, which sends empty initData [R1 §2]) | empty initData → "Open in Telegram" |
| 2 | client | TWA loads (blocking, 16 KB br); entry chunk mounts the tap screen; `ready()` | |
| 3 | client | in parallel: `import('./app/engine')`; `POST /api/auth`; fetch catalog; `GET /api/saves`; `GET /api/entitlements`; settings from CloudStorage | auth 401 `initdata_expired` → "Reopen"; network → retry with backoff (3×), then an error screen with "Retry" |
| 4 | server | validate initData, upsert user, issue token | |
| 5 | player | taps **Start** / **Continue** | double tap: the handler is single-shot |
| 6 | client | `unlockAudio()` synchronously in the handler (creates + resumes the `AudioContext`, plays a 1-sample silent buffer) | context stays suspended (rare) → music starts on the next tap |
| 7 | client | await the engine; `game.start(new ch1 \| slot auto)` | engine chunk load error → error screen "Retry" |
| 8 | client | load chapter (free: `fetch` story/meta/assets [+ en]); create runner (fresh or resume); `scene.mount` | paid chapter 403 → paywall |
| 9 | client | `runner.next()` → first batch → `scene.ensure(first-batch assets)` → `scene.apply` → typewriter; preload `next(firstKnot)` | an asset 404 → that sprite is skipped, error logged, the story continues |

Changed by STORIES-PLAN (F1′): step 3 also fetches `covers.json`, lists every story's saves and creates the stats
reporter after auth; step 5 shows Home (Continue = the newest `auto` across stories, plus one card per story); the
tap of step 5 is a Home button (Continue, a card's Start / Continue, Chapters) and step 7 starts that story.

### F2. Play loop

- **Tap:**
  - typewriter running → complete the line;
  - transition running → `scene.complete()`;
  - otherwise `game.advance()`.
- **`advance()`.** `runner.next()`, then by step kind:
  - `line`:
    - push a backlog entry; mark read;
    - split `commands` into visual and audio;
    - `ensure` the visual assets;
    - `scene.apply` ∥ `audio.apply`;
    - overlay line;
    - `enteredKnot` (knot K) → checkpoint; then the holders, in this order; then autosave:
      1. if K is the new chapter's first knot: the F4 hand-over (`next:<id>` → `preload:<K>`);
      2. if K is not `ending` (no `-> END` in it): release every `next:*` holder, so the next chapter's first-knot art
         never stays live while the story continues in this chapter (the next `ending` knot requests it again, F5);
      3. release preloads of knots not in `{K} ∪ next(K)`;
      4. preload `next(K)` — after steps 2–3, so the bytes they freed count toward the 32 MiB cap;
      5. if K is `ending`: F5.
  - `choices` → apply the batch, show choices, autosave.
  - `end` → F4 (the chapter end; F5 fires only on entering an `ending` knot, step 5 above).
- **Single intent queue.** One intent is processed at a time. Taps during `busy` coalesce into `complete()`; a choice
  click during busy is ignored.
- **Modes:**
  - **auto:** after the text completes, wait `1200 + 40 × graphemes` ms (scaled by text speed), then advance; it
    stops at choices.
  - **skip:** advances read lines only (the read-set); `instant: true` for every transition; it stops at unread lines
    and choices; "skip unread" in settings (default off) [R3 §1.4].
- **Runtime errors:**
  - a tag error → dev: overlay banner; production: drop the bad command, log, continue.
  - an ink error → a "story error" screen with "Return to last save", which resumes one level lower per ink error in
    this chapter (the [error floor](#save-format-and-resume): exact → checkpoint → chapter start), so it cannot loop.

### F3. Save, reload, resume

1. Autosave triggers (above) → `saves/service.put('auto', body)`:
   - `PUT` with `expectedRev = lastKnownRev` and a `writeId`: a retry of an unchanged body reuses its `writeId` (the
     server answers 200 if it had landed — the [HTTP API](#http-api) contract); a new body gets a fresh one;
   - while a write is in flight, newer bodies replace the queued one;
   - the service keeps **`sentIds`**: every `writeId` sent since the last acknowledged rev (at most 16, oldest
     dropped), in memory and in the pending entry.
2. `200` → `lastKnownRev = rev`; `sentIds` cleared; clear the DeviceStorage pending entry.
3. Network failure → write `{ baseRev, sentIds, body }` to DeviceStorage (if available); retry with backoff 1, 2, 4,
   8, max 30 s, and on `activated`.
4. `409`:
   - if `current.writeId ∈ sentIds` → an earlier write of ours landed and its response was lost:
     `lastKnownRev = current.rev`, then re-PUT the newest body (its own `writeId`, `expectedRev = current.rev`). No
     prompt: one device never conflicts with itself;
   - otherwise → **autosave pauses** and a toast offers "Progress was saved on another device: Load it / Keep playing
     here". "Keep playing here" re-PUTs with `expectedRev = current.rev`: an explicit player choice, never automatic.
   - Manual slots: a 409 asks "Overwrite?".
5. Reload → boot → the tap screen shows **Continue** (the server's `auto` summary):
   - if the DeviceStorage pending entry has `baseRev === server rev`, or the server summary's `writeId ∈
     pending.sentIds` (the server holds an older write of ours), upload it first with `expectedRev = server rev` (the
     pending body is the newest local progress);
   - otherwise discard it (the server wins).
6. Continue → `GET /api/saves/auto` → `decodeSave` → [resume algorithm](#save-format-and-resume).
7. Token expiry mid-session: an in-flight PUT gets 401 → single-flight re-auth → retried once.

### F4. Chapter change

1. The ink reaches `END` → `step.kind === 'end'`. If END is the last step of a free chapter, still save the read-set.
2. `carry = runner.readVars(meta.globals)`; `runner.dispose()`.
3. Next chapter from the catalog:
   - **none** → "To be continued" screen;
   - **free or owned** → step 4;
   - **paid and not owned** → autosave `{ chapterId: next, ink: null, chapterStart: { carry } }` → paywall (F6).
4. Load the next chapter (paid → `GET /api/chapters/{id}`), or take the `LoadedChapter` F5 already loaded.
   - `scene.setChapter(newManifest)`: releases every `preload:*` holder of the old chapter and every `next:*` holder
     except `next:<new id>` (F5's preload of the new first knot survives).
   - `scene.restore(EMPTY_SNAPSHOT)` → the stage clears to black, releasing every `scene:*` holder.
   - `audio.setChapter(newManifest)`: BGM fades out, the old chapter's SFX buffers are released; SFX preloaded from
     the new manifest stay.
   - Fresh runner with the carry → autosave (chapter start) → F2.
   - On the first knot's `enteredKnot`, GameSession re-holds `assets(firstKnot)` as `preload:<firstKnot>` (resident:
     no fetch) and releases `next:<new id>`; from then on the F2 rule applies.
5. **Release check:** after step 4 the registry holds only assets of the new chapter's first knot (its first batch
   plus `next:<new id>`) plus its preloads. Asserted by the `textures released on chapter change` e2e test and the
   `chapter_change_releases` unit test.

Changed by STORIES-PLAN (F4′, revision 1): step 1 records `chapter_completed` only when the last entered knot is not
a declared story ending (`meta.endings`). Before step 3: if it is one, the story is over — no `chapter_completed` (the
knot's `ending_reached` marks it), no new autosave, the `the_end` notice, its action `exitToStories()`. Otherwise
steps 2–5 run as above; `next` is on the same story's chain by construction, and the new runner (a `fresh` start
point) records `chapter_started`, as resume steps 2 and 5 ("Save format and resume") do; exact and checkpoint resumes
(steps 3, 4) record none.

### F5. Next-chapter preload

**Trigger** (the one definition; STAGING-DSL §8 states the same): entering a knot K with `meta.knots[K].ending`, that
is, a `-> END` divert is written in K. A knot that only leads to such a knot does not trigger. If the next chapter is
free or owned:
1. load its `LoadedChapter` (paid → API) unless GameSession already keeps it; GameSession keeps it for F4 step 4 (no
   second fetch);
2. `scene.preload('next:<id>', imageIds(assets(firstKnot)), next.assets)` and
   `audio.preload(audioIds(assets(firstKnot)), next.assets)` at preload priority. The ids resolve in the **next**
   chapter's manifest, so assets only that chapter uses (a paid-only background is never in the current public
   manifest) load too.

**Release.** Entering a knot that is not `ending` releases the `next:<id>` holder (F2 step 2), so a branch that leaves
the ending keeps the chapter's own preloads within the cap. The next `ending` knot requests it again: the images are
fetched again, while the kept `LoadedChapter` is reused. It is cancelled (`releasePreload('next:<id>')`, the kept
`LoadedChapter` dropped) if the player loads another save.
Tests: `preload: next-chapter id resident after setChapter`;
`game: next-chapter holder released on non-ending branch`.

Changed by STORIES-PLAN (Y4): a knot that is a declared story ending (`meta.endings`) does not trigger F5, although
it has `ending: true`; entering it records `ending_reached`. Test: `game: ending knot reports the ending and skips
next-chapter preload`.

---

## Payment flow end to end

| # | Actor | Step | Failure model |
|---|---|---|---|
| P1 | client | paywall shows the product from `GET /api/entitlements` (price from the server, never the client); a **terms checkbox** must be ticked (payments-stars: users "must confirm that they have read and agree to your terms" [R2 §1.5]); a Terms link opens the in-app terms overlay | entitlement fetch fails → "Retry"; `owned: true` → skip to P9 |
| P2 | client | Buy → state `requesting` (button disabled) → `POST /api/invoices { productId }` | double tap: button disabled + server order reuse; network error → state `failed: network`, retry allowed |
| P3 | server | catalog lookup (404) → entitled? (409 `already_owned`) → reuse this user's `created` order < 1 h with a link, else insert order (`amount`, `XTR` from the catalog) → **commit** → `create_invoice_link` (title/description in the user's language; one `LabeledPrice`; payload = order id; empty provider token) outside any transaction → `UPDATE orders SET invoice_url` | gateway error/timeout → 502 `telegram_unavailable`, order stays `created` without a link; client shows an error, retry creates or reuses |
| P4 | client | `tg.openInvoice(url)` → state `sheet` | TWA throws (unsupported, second open of the same slug) → `failed: telegram` |
| P5 | Telegram → server | `pre_checkout_query` → webhook: secret check → decode → `on_pre_checkout` (below) → `answer_pre_checkout` → 200 | see the pre-checkout table |
| P6 | Telegram → server | `message.successful_payment` → `on_successful_payment` (one transaction, below) → commit → 200 | DB error → 500 → Telegram redelivers → idempotent; duplicate delivery → `Duplicate`, 200 |
| P7 | client | `invoiceClosed` status: `paid` / `pending` → state `confirming` → poll `GET /api/orders/{id}` at 0, 0.5, 1, 1.5, 2, 3, 3, 3… s, for up to 30 s (`paid`) or 120 s (`pending`); `cancelled` → back to the paywall (no error); `failed` → toast "Payment failed", back to the paywall | poll network errors → keep the backoff; `deactivated` pauses polling, `activated` polls immediately; window exceeded → `delayed` ("Telegram is still confirming", **Check again**, auto re-check on `activated`) |
| P8 | client | order `paid` → `GET /api/entitlements` → `owned` → state `unlocked` | order `refunded` → toast; the entitlement says no |
| P9 | client | `GET /api/chapters/ch2` → F4 step 4 with the pending autosave's carry | 403 (refunded in between) → paywall |

**Hint tiers** (changed by PUZZLES-PLAN, flow H1–H7) run the same P2–P9 steps with `productId =
hint:<puzzleId>:<tier>`. P3 refuses with 409 `hint_unavailable`; pre-checkout refuses with `Unavailable`. Ownership is
confirmed through `GET /api/puzzles/{id}` (the purchase flow's `isOwned` dependency), not through the entitlements
list.

**Hint packs** (changed by META-PLAN, M19, F23; the hint tiers paragraph above is superseded: hints are spent from a
balance, M21) run the same P2–P7 steps with `productId = pack:<id>`. P3's entitlement check is trivially false for a
pack; pre-checkout is unchanged in shape. P8 for a pack: the polled order `paid` (the grant sets it in the transaction
that credits the balance) → `GET /api/wallet` → the new balance; there is no P9. Revision 1 (W3): P3 binds the pack's
kind and amount into the order row it inserts (`orders.pack_kind`, `orders.pack_amount`, from the catalog read that
titles the invoice); the grant credits exactly those. The purchase flow's `isDelivered`
dependency (L10) reads the entitlement for a chapter and the order status for a pack.

**The client never grants.** `paid` from `invoiceClosed` only starts polling [R1 §2]. The UI unlocks only when
`GET /api/entitlements` says `owned` (principle 1). The `purchase_unlocks_only_from_server` unit test forges a
CloudStorage/DeviceStorage "owned" value and expects nothing to unlock.

**Pre-checkout (P5).** One READ COMMITTED transaction inside `tokio::time::timeout(2 s)`, then one answer
(`answerPreCheckoutQuery` outside it). Changed by RULINGS 14 (decision §4.4, DB-4): the PostgreSQL text, the payer-row
lock first; the `$6`-`$8` predicates and the PK read are the hint products' (below; PUZZLES-PLAN "SQL"). Changed by
META-PLAN (M19): hint products are gone, so the PK read and the `$6`-`$8` predicates are removed; the text below is
the two-statement RULINGS 14 form for chapters and packs alike:

```sql
SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE;   -- $1 = from.id. Serializes every pre-checkout of this payer.
                                                        -- No users row: no lock, and the UPDATE below cannot match.
UPDATE orders SET status = 'checkout', checkout_at = $3
 WHERE id = $2 AND user_id = $1 AND amount = $4 AND $5 = 'XTR'
   AND status IN ('created', 'checkout') AND created_at > $3 - 86400
   AND NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = orders.user_id AND e.product_id = orders.product_id)
                                                        -- a pack is never an entitlement: trivially true for packs
   AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.user_id = orders.user_id AND o2.product_id = orders.product_id
                     AND o2.status = 'checkout' AND o2.checkout_at > $3 - 120)
RETURNING id;                                           -- no row -> the classification read, same transaction
COMMIT;
```

The lock subquery deliberately has no `o2.id <> orders.id`: it sees this order too (the post-lock snapshot holds the
committed checkout of this same order; changed by RULINGS 14, it read "SQLite evaluates the subquery against the
pre-update row"), so a second pre-checkout of the **same** order — the same slug opened on two devices —
is refused while that order's own `checkout_at` is inside the 120 s window. After the window the same order may pass
again (a retry after a failed payment).

- **Why the lock closes both K18 races** (decision §4.4). The waiter's UPDATE takes its snapshot after the first
  transaction committed, so it sees that transaction's `checkout` row (the same order on two devices, or the other
  order) and gets no row: `InProgress`.
- **`$6`-`$8` are bound as `Option<&str>`.** sqlx declares them TEXT, so `$n IS NULL` is typed. (Removed by
  META-PLAN with the predicates.)
- **Tests (L8b).** `precheckout_concurrent_two_orders_one_passes` and `precheckout_concurrent_same_order_one_passes`,
  on the deterministic two-connection shape (`common::wait_for_lock_waiter`, merged in LDB1). Both are predicted red
  with the lock statement removed: two `ok`.

**If no row comes back**, one read classifies the reason, and the answer is `ok = false` with a localized
`error_message`:

| Reason | Condition |
|---|---|
| `UnknownOrder` | no such order |
| `Mismatch` | user / amount / currency mismatch |
| `AlreadyOwned` | already entitled |
| `InProgress` | an order for this product — this one or another — entered `checkout` less than 120 s ago |
| `Expired` | order older than 24 h |
| `Temporary` | the DB step exceeded 2 s |

**Hint products** (changed by PUZZLES-PLAN, K18):
- A PK read of the order's `product_id` comes first (after the payer-row lock; changed by RULINGS 14, decision §4.6).
- The statement above gains three nullable predicates: the previous tier owned; the paid chapter owned; the puzzle not
  solved in `puzzle_progress`.
- A failure classifies as `Unavailable`.
- For chapter products the three parameters are NULL.
- The SQL text: [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "SQL".
- Changed by META-PLAN (M19, M21): this paragraph is superseded — there are no hint products; `Unavailable` is not a
  reject reason.

**Timing.** DB ≤ 2 s (`timeout`), answer ≤ 5 s (`timeout` + reqwest 2 s connect / 5 s total) → worst case about 7.5 s
< 10 s (principle 2). No other work happens on this path. The answer gateway error is logged; we still return 200,
because Telegram cancels the transaction itself when unanswered.

**Grant (P6).** One READ COMMITTED transaction, write first. Changed by RULINGS 14 (decision §4.4, DB-4): the
PostgreSQL text; no payer lock: every step is arbitrated by a UNIQUE/PK or a single-row condition, and a lock would only
add a timeout failure mode to a path that is never refused:

```sql
INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency,
                      provider_payment_charge_id, paid_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (telegram_payment_charge_id) DO NOTHING
RETURNING telegram_payment_charge_id;                   -- no row -> Duplicate (a twin waited, then skipped): COMMIT, 200
UPDATE orders SET status = 'paid', paid_at = $7, charge_id = $1
 WHERE id = $2 AND user_id = $3 AND amount = $4 AND $5 = 'XTR' AND status IN ('created', 'checkout')
RETURNING product_id;                                   -- no row -> OrderMismatch (recorded, no grant)
INSERT INTO entitlements (user_id, product_id, charge_id, granted_at) VALUES ($3, $8, $1, $7)
ON CONFLICT (user_id, product_id) DO NOTHING
RETURNING product_id;                                   -- no row -> AlreadyEntitled
COMMIT;                                                 -- then 200; notify_unapplied after COMMIT (K19)
```

- `OrderMismatch` logs `tracing::error!`; `AlreadyEntitled` means a second paid order slipped past the checkout lock.
  Both are recorded with no grant and, after the commit, `notify_unapplied` runs (below).
- **Changed by META-PLAN (M19).** The third statement depends on the product the `UPDATE orders` returned
  (`parse_product_id`): `Chapter` → the entitlement insert above; `Pack` → instead of it, `credit_in_tx`: `INSERT INTO
  resource_ledger (…, reason 'pack', idem_key 'pay:' || $1, charge_id $1, ref the product id) ON CONFLICT ON
  CONSTRAINT resource_ledger_idem_key DO NOTHING RETURNING id`, then the balance upsert that pays debt first
  ([META-PLAN "SQL"](META-PLAN.md#sql)); an id that parses to neither → recorded, no grant (unapplied). Same
  transaction, same commit. Revision 1 (W3): the `UPDATE orders` returns `product_id, pack_kind, pack_amount`, and the
  credit is of that kind and amount — not the catalog's (a pack changed or retired by a deploy after the invoice is
  still credited as advertised).
- **Rename.** `successful_payment_duplicate_concurrent_wal` becomes `successful_payment_duplicate_concurrent`. It is
  deterministic: A's uncommitted insert, B observed waiting, A commits, B is `Duplicate`.
- **Never lose money facts (K17/K19) on PostgreSQL text.** Telegram strings bound into `payments` get U+0000 → U+FFFD
  at the `db/` boundary (`text` cannot hold U+0000). A replaced charge id replaces identically on redelivery, so
  idempotency holds.

**Unapplied charge** (`notify_unapplied`, after the commit, outside any transaction): `send_message` to the payer
(bot text `payment_unapplied`: the charge id and `/paysupport`) and to each `ADMIN_TELEGRAM_IDS` entry (charge id,
payer, outcome), each under the gateway's 5 s timeout; a gateway error is logged and the webhook still answers 200.
The durable record is the data itself: `/paysupport` flags every charge of the user that has no `entitlements` row and
`refunded_at IS NULL` as "not applied". A redelivered duplicate is `Duplicate` and sends nothing. The remedy is the
admin's `/refund`; automatic refund is the owner's call (V4). Changed by META-PLAN (M19): "not applied" also requires
no `resource_ledger` row of that charge (a pack credit is an applied charge).

**Refund.**
1. Admin `/refund <charge_id>` (from `ADMIN_TELEGRAM_IDS`) or `POST /dev/refund` → look up the payment.
2. `gateway.refund_star_payment(user, charge)`, with no transaction open.
3. On `Ok`, or on an API error that says the charge is already refunded (verify: the exact error text, L9) → revoke:

```sql
-- changed by RULINGS 14 (decision §4.4): the PostgreSQL text; a single-row conditional update, the twin waits and
-- then finds refunded_at set
UPDATE payments SET refunded_at = $2 WHERE telegram_payment_charge_id = $1 AND refunded_at IS NULL RETURNING user_id;
-- no row -> AlreadyRefunded: COMMIT, done
DELETE FROM entitlements WHERE charge_id = $1;
UPDATE orders SET status = 'refunded' WHERE charge_id = $1;
COMMIT;
```

- `refunded_payment` updates run the same revoke; repeats are no-ops (`AlreadyRefunded`).
- Gateway failure → no revoke (money not returned) and the admin is told.
- A crash between refund and revoke → the next `/refund` sees "already refunded" → revoke. That is repeat-safe.
- **Changed by META-PLAN (M20).** `UPDATE orders … RETURNING product_id`; for a pack, before the COMMIT,
  `clawback_in_tx` (ledger `refund:<charge>`, amount −n; the balance drops by min(balance, n), the rest becomes
  `debt`). The `refunded_at` guard and the ledger key make a repeat a no-op (`refund_pack_twice_claws_once`, L9).
  Revision 1 (W3): the kind and n are the charge's `pay:<charge>` ledger row's (`credited_by_charge`, LE1), never the
  catalog's; a charge without that row (an unapplied pack) claws back nothing.

**Bot commands:**
- **`/start`** — a message with an inline `web_app` button (`PUBLIC_APP_URL`).
- **`/terms`** — the terms text (placeholder, Q4).
- **`/support`** — the support contact, plus the required note that Telegram support cannot help with purchases
  [R2 §1.5].
- **`/paysupport`** — payment-support instructions and the user's own charge ids with dates, so they can quote them;
  charges not applied to a purchase are flagged "not applied" (K19).
- **`/privacy`** (changed by META-PLAN, M26; L9) — a short text with the privacy policy URL `<PUBLIC_APP_URL>api/privacy`
  (the same URL the owner sets in @BotFather).

Texts come from `server/locales/bot.{ru,en}.json` by `from.language_code`. `server setup` registers the commands with
`setMyCommands` (ru, en, default), the webhook (`secret_token`, explicit `allowed_updates`) and the menu button
[R2 §1.5–1.6].

---

## Concurrency and failure model

| Situation | Authority | Outcome |
|---|---|---|
| Webhook `successful_payment` delivered twice (sequential or concurrent) | `payments` PK | first: Granted; second: Duplicate; both 200; one payment, one entitlement — `successful_payment_duplicate_concurrent` (two connections: A's uncommitted insert, B observed waiting; changed by RULINGS 14, decision section 6) |
| Client `paid` before the webhook | DB | polling sees `checkout`, keeps polling; unlock on `paid` |
| Webhook before `invoiceClosed` | DB | first poll sees `paid` |
| Webhook never arrives (Telegram outage) | DB | `delayed` state; Check again; reload → entitlements; the payment is still recorded when Telegram redelivers |
| Double tap on Buy | client guard + order reuse + checkout lock | one sheet; a second open of the same slug throws → ignored |
| One order (one slug) opened on two devices, both press Pay | checkout lock, own order included | the second pre-checkout within 120 s of the first is refused (`InProgress`) — `precheckout_same_order_twice_refused`; concurrent: `precheckout_concurrent_same_order_one_passes` (the payer-row lock; changed by RULINGS 14) |
| Two orders for one product paid in parallel | checkout lock (120 s) + entitlement PK | second pre-checkout refused (`InProgress`); if a charge still lands unapplied (`AlreadyEntitled` / `OrderMismatch`, e.g. a payment `pending` past the 120 s lock — E8): payer + admins notified, `/paysupport` flags it, refund per V4 — `unapplied_charge_notifies_payer_and_admin`; concurrent pre-checkouts: `precheckout_concurrent_two_orders_one_passes` (the payer-row lock; changed by RULINGS 14) |
| Pre-checkout DB contention | `lock_timeout` 2 s (`55P03`) within `timeout(2 s)` (changed by RULINGS 14) | answer `ok=false` (Temporary), 200 |
| Telegram API hung during the answer | `timeout(5 s)` | logged; 200; Telegram cancels the payment itself |
| Undecodable / unknown update without a payment | — | 200 + log (no redelivery backlog) [R2 §2.3] |
| `successful_payment` / `refunded_payment` the pinned frankenstein types reject (e.g. no `provider_payment_charge_id`) | own `PaymentProbe` (K17) | the same grant / revoke transaction; 200 after commit — `webhook_payment_undecodable_by_frankenstein_still_recorded`, `webhook_refund_undecodable_by_frankenstein_still_revokes` |
| A payment-bearing update whose money fields even the probe cannot read | Telegram's redelivery | 500 + `tracing::error!`; never ACKed away — `webhook_payment_fields_unreadable_500` |
| Missing/bad secret header | — | 401 before parsing |
| Refund then `refunded_payment` | `payments.refunded_at IS NULL` | the second revoke is a no-op |
| Refunded user has ch2 in memory | server | keeps playing until reload; the next `GET /api/chapters/ch2` → 403 → paywall |
| Two devices autosaving | `rev` | the second gets 409 → autosave pauses → the player chooses; never a silent overwrite |
| Retried PUT whose first attempt landed | `write_id` | same `writeId` → 200 with the stored rev (the HTTP API contract) |
| Lost PUT response, then a newer body | `write_id` + client `sentIds` | 409 with `current.writeId ∈ sentIds` → adopt `current.rev`, re-PUT the newest body; no conflict prompt; on reload the pending entry uploads (server `writeId ∈ sentIds`) — `saves: lost response then newer body is not a conflict` |
| Reload mid-chapter | server `auto` save | resume at the last autosave (choice point, knot entry, `deactivated`, `pagehide`) |
| Story updated between sessions | `storyVersion` | knot checkpoint, then chapter start; never a throw (T5) |
| Token expired mid-session | server | 401 → one single-flight re-auth → retry once; initData > 24 h → "Reopen the app". The same path serves gated images, SFX and paid BGM: they load through `FetchAsset` (`api/http.ts`) — `loader: expired token re-auths once then loads` |
| Server clock behind Telegram's (initData `auth_date` more than 60 s in the server's future) | server clock | erratum (RULINGS 9 Q3): `FromFuture` → 401 `initdata_expired` → "Reopen the app", which cannot help while the clock is wrong. The remedy is operational: NTP time sync on the host (runbook item in D2) |
| Puzzles, exploration, hint purchases | — | changed by PUZZLES-PLAN: the rows in [PUZZLES-PLAN "Concurrency and failure model"](PUZZLES-PLAN.md#concurrency-and-failure-model-additions-to-pps-table) |
| `deactivated` during a transition | client | GSAP global timeline paused, render loop stopped, audio suspended; resume continues the same timeline |
| WebGL context lost (on `activated` or any time) | client | Pixi handles `webglcontextlost`/`restored` and re-uploads from live sources [R3 §4.4]; we keep the `ImageBitmap`s alive while textures live, so restore works. If `renderer.context.isLost` is still true 2 s after `activated`, the controller destroys the `Application`, builds a new one, re-creates textures from the registry's bitmaps, and `restore(snapshot)` instantly. Pixi ≥ 8.21 is required (the Text restore fix); we pin 8.22.0 |
| Preload vs knot exit | client | preload holders are released on the next knot entry, `next:*` holders on the next entry into a knot without `-> END` (F2); in-flight fetches aborted (`AbortController`); a load completing after abort is destroyed at once (the registry checks the holder still exists) |
| Response after unmount / chapter change | client | every async load carries the chapter generation number; stale results are dropped and released |
| Asset 404 / decode failure | client | `Result` error → skip that visual, log, continue (no crash) |
| Visible load still over the 48 MiB hard cap after evicting every `preload:*` / `next:*` | registry | refused with `over-cap` → the same skip path; `stats().overCap` + 1; the cap is never exceeded — `registry: visible load over hard cap after eviction is refused` |
| Server: blocking work | server | none on request paths: content loaded at startup; file reads via `tokio::fs`; no `std::fs` in handlers (clippy `disallowed_methods` for `std::fs::read*` in `server/src/api`) |
| DB unreachable at startup | `AppState::new` | `StartupError::Db`, exit non-zero; the process supervisor restarts |
| DB down mid-run / managed failover | pool (`test_before_acquire`, `acquire_timeout 5 s`) | 500; webhook → Telegram redelivers (idempotent); pre-checkout → `Temporary` within 2 s; reconnect on recovery |
| Row lock held > 2 s | `lock_timeout` → `55P03` | pre-checkout `Temporary` (`ok=false`); saves 500, and the client's retry with the same writeId is replay-safe |
| Leaked transaction (future dropped mid-transaction) | `idle_in_transaction_session_timeout 30 s` | the session ends and its locks are released |
| `40001` serialization failure | session pin (`Repo::open`) | impossible: every session runs READ COMMITTED whatever the server, database or role default, and no transaction asks for more — `pool_session_settings` |
| U+0000 in a client string (saves `chapterId`/`storyVersion`/`lineId`/`writeId`) | edge | 400 `bad_request` (PG `text` cannot hold U+0000; it would be a 500) — `saves_nul_in_text_field_400` |
| U+0000 in a Telegram string (initData `first_name`/`language_code`; L8b: payment fields) | `db/` boundary | replaced by U+FFFD before binding; login and money facts never fail on it — `auth_nul_in_first_name_stored_replaced` |
| Save body deeper than serde_json's recursion limit, a lone surrogate, an out-of-range number | edge | 400; the edge is stricter than `IS JSON`, so the CHECK's 500 is unreachable — `saves_body_too_deep_400` |
| Neon scale-to-zero wake | provider | "a few hundred ms" (DOC, no SLA), inside the 2 s budget; disabled on a paid plan by default (decision §2.2) |
| Lane cluster corrupt after a hard reset | pgdev | start fails with no server running, and the message names `pgdev reset` (≈ 10-60 s re-init) |
| Two consumers touch a cold slot cluster at once | pgdev `ensure_up` | the rename loser discards its own initdb copy; the start loser waits ≤ 180 s (`READY_DEADLINE`) for the peer, with `57P03` or `53300` meaning "wait" (`53300` as merged in LDB2 `a7e4a04`); both proceed — `ensure_up_concurrent_cold_start` |
| A slot cluster still starting or recovering after 180 s | pgdev | `NotReady` naming `postgres.log`; never `reset` advice while a server runs |
| Kit budget KILL of a gate that started the slot cluster | accepted (decision §3.7) | the slot's other consumers get connection-reset reds, never a wrong green; the next `ensure_up` restarts it |

Changed by RULINGS 14 (decision section 6, §4.7; as merged, LDB1 `fee9da7`, LDB2 `a7e4a04`): the rows from "DB
unreachable at startup" down are the PostgreSQL failure model; the test names are the merged ones.

---

## Paid-content protection

**Layers (principle 0):**
1. **Build routing.** The story tool writes paid chapters (story, meta, en, assets manifest) only to
   `server/content/chapters/<ch>/`. The asset tool writes an asset used only by paid chapters to
   `server/content/assets/`. Nothing paid is written under `client/`.
2. **Vite isolation:**
   - `client/` is the Vite root; `server.fs.strict` stays `true`.
   - **No repo-root `package.json` with `workspaces`**, which would widen `fs.allow` to the whole repo [R4 §3.1].
     Gated by `dev config: fs.allow stays inside client/` (below).
   - `publicDir = client/public` holds only free generated assets.
   - `build.assetsInlineLimit: 0`: no base64 inlining of anything [R4 §3.1].
   - `build.sourcemap: false`.
3. **Delivery.**
   - Paid files go out only through `GET /api/chapters/{id}` and `GET /api/assets/{file}`: bearer token → entitlement
     row → response, `Cache-Control: private, no-store`.
   - The asset route looks the file up in the `ContentStore` index (a `HashMap`), never joins user input into a path.
   - `STATIC_DIR` must not contain `CONTENT_DIR` (startup check + test).
4. **Client memory only.** Paid JSON and blobs are never written to CloudStorage, DeviceStorage or `localStorage`.
   Blob URLs are revoked on track change.
5. **Gates:**
   - **`story` → `paid/leak`.** No paid fingerprint under `client/src/story-gen/`.
   - **`scan-dist.ts`** in `build`, over every file in `client/dist/`:
     - decodes every `data:…;base64,` URI before matching [R4 §3.1 MEASURED leak path];
     - fails on any `.map` file;
     - fails on any fingerprint from `server/content/build/fingerprints.lines.json` (paid line IDs, paid text
       samples) or `fingerprints.assets.json` (paid asset file names and content hashes);
     - fails on the compiler strings `Compilation failed` / `Recursive INCLUDE detected` [R4 §2.1];
     - fails on the dev canaries.
   - **Non-vacuous, per section.** It fails:
     - if `story/chapters.json` declares a paid chapter and `fingerprints.lines.json` is missing or its `lineIds` or
       `texts` section is empty;
     - if a paid-only asset exists and `fingerprints.assets.json` is missing or its `files` section is empty. "A
       paid-only asset exists" is computed by `scan-dist` itself from story-tool outputs, never from the asset tool's
       own files (`fingerprints.assets.json`; `asset-owners.json` was dropped by RULINGS 30): an asset id in
       `server/content/build/usage.json`
       that a paid chapter of `story/chapters.json` uses and no free chapter uses. A tiering fault in the asset tool
       therefore cannot also switch the check off;
     - if a paid chapter is declared and `usage.json` is missing;
     - if `server/content/chapters/<paid>/story.json` is missing or empty [R4 §3.3].
   - **Tests:** `scan: paid chapter with empty line-ID section fails`, `scan: paid asset bytes in dist fail` (the paid
     file under its own name, and its bytes under another name, matched by content hash),
     `scan: paid-only asset with empty files section fails`.
   - **Dev server** (vitest, `client/scripts/dev-server.test.ts`; `vite preview`, which the e2e harness runs, has no
     `/@fs/` route, and its SPA html fallback rewrites a GET with `Accept: */*` to `index.html` with 200 — Vite 8.3.5
     source, per the round-1 triage — so the check cannot live in e2e):
     - `dev server refuses /@fs paid path`: `createServer()` with root `client/` and the real `vite.config.ts`,
       `server.port: 0`; it writes a probe file `server/content/.fs-probe-<rand>.json` (gitignored dir), requests it
       as `/@fs/<abs path>`, expects 403 and not the probe body, and deletes the file;
     - `dev config: fs.allow stays inside client/`: `resolveConfig()` of the same config has `server.fs.strict ===
       true` and every `server.fs.allow` entry inside `client/` — it fails on a `package.json` with `workspaces` (or a
       `pnpm-workspace.yaml` / `lerna.json`) in any ancestor of `client/`, and on any explicit widening (verify, L3b:
       the entries Vite adds itself — its client dir, the cache dir — resolve under `client/node_modules`).
   - **e2e.** `paid chapter route needs entitlement` expects 403 → buy → 200.
   - **Server tests.** `paid_chapter_403_without_entitlement`, `paid_chapter_200_with_entitlement`,
     `paid_chapter_403_after_refund`, `paid_responses_private_no_store`, `asset_path_traversal_404`,
     `free_chapter_not_served_by_api`.
   - **Changed by PUZZLES-PLAN.** Hint texts and puzzle solutions are paid content:
     - server-only build output (`server/content/puzzles/`);
     - `paid/leak` extended;
     - `scan-dist` hint fingerprints rebuilt from `story/*/world.json` + the en sources (non-vacuous when any hint
       exists);
     - `scan-dist` paid-world fingerprints from the same sources: every world line ID and world text (≥ 12 chars, ru
       and en) of a paid chapter's `world.json` (non-vacuous when a paid chapter has a world);
     - `decodeWorldPublic` refuses `solution` / `hints`;
     - `GET /api/puzzles/{id}` serves a text only to its unlock owner, `private, no-store`.

     Details: [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Paid-content protection".

---

## Scene controller and asset registry

**Layers.** One Pixi `Application` (`scene/controller.ts`):
- `bg` (≤ 2 sprites during a crossfade);
- `chars` (one container per character, ≤ 2 sprites during an expression swap);
- `cg`;
- `fx` (a black `Graphics` rect for fade-through-black).
- Changed by PUZZLES-PLAN (X11): `props` sits between `bg` and `chars`. Its sprites take the background's cover
  transform (`geom/cover.ts`), are set by a `props` command, and are cleared by any `bg` / `scene`. They are part of
  the snapshot.

`stage.eventMode = 'none'`: the DOM overlay owns input. Exploration hotspots are DOM buttons positioned with the same
`geom/cover.ts` inside the stage host element (changed by PUZZLES-PLAN, X10), so this stays.

**Init.** `{ preference: 'webgl', resolution: perfClass === 'LOW' ? 1 : Math.min(devicePixelRatio, 2), autoDensity:
true, antialias: false, background: '#000', resizeTo: host, autoStart: false }` [R3 §4.3]:
- WebGL first; Pixi falls back to its other renderers only if WebGL fails.
- Disable the 8.22 Tab-activated accessibility layer deliberately (verify: the exact 8.22 option name, L11) [R3 §4.3].

**Layout** (`scene/layout.ts`, pure):
- The stage is the host size.
- Backgrounds and CGs are cover-scaled (canonical source 1080×2048).
- Characters are anchored bottom-center at x = 0.25 / 0.5 / 0.75 of the stage width, height = 0.78 × stage height,
  never upscaled above the source's native size × resolution. Changed by RULINGS 35 (as merged, L11 `1e2f421`; cut
  Q7): device px ≤ source px, so the CSS height is `min(0.78 × stage height, source height / resolution)`
  (`client/src/scene/layout.ts:32`).

**Executor** (`scene/executor.ts`; the only GSAP user):
- Turns a batch into one timeline per the order in STAGING-DSL §7.
- Updates the logical snapshot at batch start.
- `complete()` = `progress(1)` on active timelines.
- Kills timelines on completion.
- Operates on a `StageAdapter` interface (create/destroy sprite, set props), so its logic is unit-tested with a fake
  adapter (no WebGL in happy-dom [R4 §5.1]).

**Registry and loader:**
- **Variant choice.** AVIF if a 1 px probe decodes at boot, else WebP.
- **Fetch.** Always through the injected `FetchAsset` (K4): public → `/assets/<file>`; gated → `/api/assets/<file>`,
  where `api/http.ts` adds the bearer, re-auths once on a 401 and retries once.
- **Decode and cap.**
  - `createImageBitmap(blob)` → `Texture`; `decodedBytes = w × h × 4` counted.
  - Cap (K5): a preload is refused if it would exceed 32 MiB live; a visible load may reach 48 MiB, first evicting
    every `preload:*` and `next:*` holder, and is refused with `over-cap` if it still does not fit. Changed by RULINGS
    35 (as merged, L11 `1e2f421`; cut Q2): it evicts every preload-priority holder, `room:*` included.
- **Release.** At holder-set empty: `texture.destroy(true)`, `bitmap.close()`, counters down.

**Per-chapter manifest.** `scene.setChapter(manifest)` swaps the id → `AssetEntry` table. A missing id → error value.
`preload(tag, ids, from)` resolves in `from` when given, so the next chapter's ids resolve in its own manifest (F5);
asset ids are global (one catalog), so an entry fetched under `next:<id>` is the same registry entry `ensure` finds
after `setChapter`.

**Preload.**
- **Sources.** Knot hints from GameSession (`next(K)` from `ChapterMeta`); the next chapter's first knot (holder
  `next:<chapterId>`, resolved in that chapter's manifest, kept across `setChapter` to it — F4, F5 — and released on
  entering a knot without `-> END` — F2); the blocking `ensure()` for a batch's own assets. Changed by RULINGS 35 (as
  merged, L11 `1e2f421`; cut Q11): `ensure` holds its ids under the exact holder `ensure`, released by `apply` /
  `restore` once the slot holders are taken, and by `setChapter` / `destroy` (`client/src/scene/preload.ts:15`,
  `client/src/scene/controller.ts:323,334`).
- **Concurrency.** Two in-flight fetches for preloads, unlimited for `ensure`.
- **Cancellation.** By holder release and `AbortController`.

**Release points:**
- a replaced or hidden sprite, after its transition;
- `scene` (all characters, CG);
- `restore(snapshot)`: diff, release what is not in the snapshot;
- chapter change (F4);
- entering a knot that is not `ending` (every `next:*` holder, F2 step 2);
- `releasePreload`;
- `destroy()`.

**Leak detection:**
- `stats()` feeds `window.__novelDebug` (mock builds only).
- Unit tests: `registry_returns_to_baseline`, `executor_kills_timelines`, `chapter_change_releases`,
  `abort_after_release_destroys`, `registry: visible load over hard cap after eviction is refused`,
  `preload: next-chapter id resident after setChapter`.
- e2e: `textures released on chapter change`.

**Memory estimate** (live textures, MiB; per knot the gate bounds carried stage + `assets(K) ∪ assets(next(K))` ≤ 32
MiB, `budget/knot-set`):

| Item | Estimate |
|---|---|
| Example knot on stage: 1 bg (8.4) + 2 sprites (2 × 4.5) | 17.4 MiB |
| Its preloads: one new bg + one new expression | 12.9 MiB |
| **Live textures** | 30.3 MiB, within the 32 MiB steady cap |
| Crossfade transient | + 8.4 MiB, within the 48 MiB hard cap |

The registry keeps each `ImageBitmap` while its texture lives: it is the source for the context-loss restore
(concurrency table), and paid art is `no-store`, so re-fetching it on every context loss would re-download it. The
CPU bitmaps therefore equal live texture bytes and are counted, not assumed away (verify the real CPU+GPU cost on an
iPhone and a LOW Android — Later measurement).

**Steady total at the gated limits** (one unit: MiB; principle 4's 150 MB = 143.1 MiB):

| Item | Limit that bounds it | MiB |
|---|---|---|
| Textures (GPU) | steady cap (K5) | 32 |
| Bitmaps (CPU) | = live textures | 32 |
| Framebuffers (390×844 CSS × 2² × 4 B × 2 buffers + stencil) | render resolution ≤ 2 | ≈ 12 |
| JS heap (inkjs story, Svelte, Pixi) | e2e `heap under budget` ≤ 48 MB | 45.8 |
| Audio: decoded SFX + 2 BGM files during a crossfade | `sfx_cache_cap` 8 MiB + 2 × BGM file ≤ 3 MB | 13.7 |
| **Total** | | **135.5 MiB = 142.1 MB < 150 MB** |

Transient peak (a crossfade with textures at the 48 MiB hard cap): 2 × 48 + 12 + 45.8 + 13.7 = 167.5 MiB (175.6 MB),
only while a transition runs; the gate keeps every planned working set at or below the 32 MiB steady cap.

---

## Audio

- **Unlock.** `audio/unlock.ts` runs in the entry chunk, inside the tap handler: `new AudioContext()`, `resume()`, a
  1-sample silent `AudioBuffer` (the iOS unlock idiom). The context is handed to `AudioManager` when the engine loads.
- **Graph.** `bgm` gain, `sfx` gain → `master` gain → destination. Volumes come from settings (0–100 per bus); tag
  `vol` multiplies.
- **BGM (`bgm.ts`):**
  - **Elements.** Two `HTMLAudioElement`s (A/B), each through one `MediaElementAudioSourceNode` (created once per
    element: a node cannot be re-created for the same element), `loop = true`.
  - **Crossfade.** Gain ramps over `fadeMs`.
  - **Sources.** Public tracks: `src = /assets/<file>` (progressive streaming). Paid tracks: the injected `FetchAsset`
    (`api/http.ts`: bearer, single-flight re-auth, retry once) → `URL.createObjectURL(blob)`, revoked when replaced.
  - **Memory.** The compressed size (≤ 3 MB), never decoded PCM.
  - **Same track, new `vol`.** The gain is tweened, the track is not restarted.
  - verify on iOS (L12): `MediaElementAudioSourceNode` on blob URLs; the element `volume` is ignored.
- **SFX (`sfx.ts`).** `FetchAsset` → `decodeAudioData` → `AudioBuffer`, cached per chapter (preloaded from knot hints,
  and from the next chapter's manifest for its first knot, F5), released on chapter change except those preloaded for
  the new chapter. Each is ≤ 3 s (stereo 44.1 kHz float32 = 1.06 MiB); the cache is capped at 8 MiB.
- **Lifecycle:**
  - `deactivated` / `visibilitychange: hidden` → `ctx.suspend()` + `element.pause()`.
  - `activated` → `ctx.resume()`; if not `running` after 500 ms → the "tap to resume sound" chip (one tap resumes).
  - The collapsed panel never plays audio.
- **Placeholder audio.** WAV synthesized by `client/scripts/assets/synth.ts` from catalog parameters: BGM 8 s mono
  22.05 kHz 16-bit ≈ 353 KB, SFX ≤ 1 s. Shipped as `codec: 'wav'` with `placeholder: true` (K23). Changed by
  RULINGS 30 (as merged, L5 `e21775b`; cut Q7): the manifest has no `placeholder` field; the catalog entry
  (`placeholder: { hz }`, `assets/catalog.json`) carries it, and the budget reads it from the decoded catalog.
- **Snapshot.** `bgm` (track + vol) is part of `StagingSnapshot`; SFX are never replayed on load.

---

## Localization

- **Story lines.** Format, tooling and lint rules: STAGING-DSL §4.
  - **Runtime.** `i18n/lines.ts`: `text(lineId, ru, lang)` → `lang === 'ru' ? ru : en[lineId] ?? (count++, warn, ru)`.
  - **Where ru comes from.** ru text is the ink output with the speaker prefix stripped. Choices use `choice.text` +
    the choice's `id`.
- **Names, chapter titles.** Names come from `story/locales/<lang>/story.json`, emitted into the public catalog.
  Chapter titles are public by design: marketing, not content.
- **UI strings.** `client/src/i18n/ru.ts` (`as const`, primary) and `en.ts: Record<keyof typeof ru, string>`, so a
  missing key is a compile error. Includes pricing copy templates ("Buy for {n} ⭐"); the number comes from the
  server.
- **Bot texts.** `server/locales/bot.{ru,en}.json`; a test checks both languages have every key and that invoice
  titles are ≤ 32 / descriptions ≤ 255 chars [R2 §1.1].
- **Language.** Default from `AuthResponse.user.languageCode` (K29); stored in settings (CloudStorage). Switching:
  - fetches the en table if not loaded (free: static; paid: already in the chapter payload);
  - re-renders the current line and the backlog;
  - never touches the ink state.
- **Typography.** System fonts; text is plain DOM text, never `{@html}` (arch test).
- **Typewriter.** `Intl.Segmenter` graphemes (iOS 14.1+) [R3 §5]:
  - **Reveal.** Two-span reveal (`textContent` only), rAF, time-based.
  - **Speed.** Text speed slow 25 / normal 45 / fast 80 graphemes/s / instant.
  - **Accessibility.** `prefers-reduced-motion` → instant; an `aria-live="polite"` copy of the full line.

---

## Resource lifetime

| Resource | Owner | Created | Destroyed | Leak detected by |
|---|---|---|---|---|
| inkjs `Story` | `StoryRunner` | `StoryRunner.create` | `dispose()` on chapter change, load, new game | `game_holds_one_runner` (unit, debug counter) |
| Pixi `Application` + canvas | `SceneController` | `mount()` | `destroy()`; rebuilt once on unrecoverable context loss | e2e: exactly one `<canvas>` |
| `Texture` + `ImageBitmap` | `AssetRegistry` entry | first `acquire` | holder set empty → `destroy(true)` + `close()` | `registry_returns_to_baseline`; e2e liveBytes |
| `Sprite` / containers | executor (per slot) | command start | after the replacing transition, `hide`, `scene`, `restore`, `destroy` | `executor_sprite_count_per_slot` (≤ 2 in transition, 1 after) |
| GSAP timeline | executor | `apply(batch)` | `onComplete` → `kill()`; `complete()` → `progress(1)` → `kill()`; `destroy()` kills all | `executor_kills_timelines` (active = 0) |
| GSAP ticker listener | `render-loop.ts` | first active timeline or dirty frame | when active = 0 and not dirty | `render_loop_idles` |
| `AudioContext` | `audio/unlock.ts` → `AudioManager` | tap handler | app lifetime (suspend/resume) | — |
| `HTMLAudioElement` ×2 + source nodes | `bgm.ts` | engine load | app lifetime; `src` cleared on `stop` | — |
| Blob URL (paid BGM) | `bgm.ts` | track start | replaced/stopped → `revokeObjectURL` | `bgm_revokes_blob_urls` |
| `AudioBuffer` (SFX) | `sfx.ts` | preload or first play | chapter change | `sfx_cache_released_on_chapter` |
| `AbortController` (preload, chapter fetch) | `preload.ts`, `chapters.ts` | request | holder release, chapter change | `abort_after_release_destroys` |
| Polling timer | `purchase/flow.ts` | `invoiceClosed` | terminal state or `dispose()` | `flow_clears_timers` (fake timers) |
| Telegram subscriptions | caller (gets `Unsubscribe`) | subscribe | teardown | `facade_unsubscribe_removes_handler` |
| Svelte `$effect`s | components | mount | unmount; async work inside carries an `AbortSignal` | component tests |
| Save write queue | `saves/service.ts` | first write | idle (one in flight max) | `saves_one_in_flight` |
| PG pool (≤ 8 connections; changed by RULINGS 14, decision §4.8, replacing the SQLite pool) | `AppState` (`Repo`) | `AppState::new` | `repo.close()` after serving (`server/src/main.rs:48`) | — |
| Lane / dev cluster (postmaster; changed by RULINGS 14) | `pgdev::DevCluster` | `pgdev up` at lane start, from a plain Bash call outside any kit job; otherwise on demand by `ensure_up` (the first DB test or a `server-dev` launch) | `pgdev down` at lane end (orchestrator), a reboot, or a kit KILL | `pgdev status`; the kit DONE's `left_running_at_exit` |
| Test database (changed by RULINGS 14) | `pgdev::TestDb` guard | `TestDb::create` | guard `Drop` (`DROP … WITH (FORCE)`); stale ones swept after 2 h | `test_db_created_then_dropped_on_drop`; seen-working `tgn_t_%` count = 0 |
| Dev database `tgn_dev_<port>` (changed by RULINGS 14) | `server-dev` `main` | each launch (recreate) | the next launch | — |
| Raw test connection (changed by RULINGS 14) | the test | `common::raw_db` | end of test; FORCE ends stragglers | — |
| Delayed simulate tasks | `server-dev` | `simulate-payment` with delay | task completion | — |
| Puzzle sessions, the explore controller, `room:*` / `scene:prop:*` holders, close-ups, lazy chunks | — | — | — | changed by PUZZLES-PLAN: [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Resource lifetime" |

---

## Budgets and validation

All budgets are enforced by `client/scripts/budget.ts` inside `npm run build` unless marked e2e/unit.
- **Output.** It prints every row (`name | value | limit | PASS/FAIL`) and exits 1 if any row fails (no bail).
- **Inputs.** `dist/.vite/manifest.json` (initial closure), the asset manifests, `ChapterMeta` files,
  `server/content/build/usage.json` (carried stage per knot), and whether `client/src/app/engine.ts` exists (changed
  by PUZZLES-PLAN: also whether `client/src/app/yields.ts`, the lazy chunks' importer, and each lazy family's
  sources exist).
- **States.** PASS, FAIL, or PENDING (a row whose subject does not exist yet; printed, never counted as a pass).
- **Compression.** Brotli quality 11 via `node:zlib`.

| Budget | Limit | Basis | Enforced by |
|---|---|---|---|
| Entry closure JS (entry + static imports) | ≤ 40 KB br | Svelte 11.2 KB [R4] + shell | `budget.ts` |
| Engine closure JS (`app/engine.ts` dynamic entry + imports) | ≤ 230 KB br | Pixi 145.1 + inkjs 26.6 + GSAP 24.3 = 196 KB [R4] + our scene/story/audio | `budget.ts`: PENDING while `src/app/engine.ts` does not exist (before L15); once it exists, FAIL if the manifest has no `isDynamicEntry` chunk for it (never a 0 KB PASS) — `budget: engine row fails when dynamic entry missing` |
| All JS in `dist/` | ≤ 290 KB br (changed by PUZZLES-PLAN: was 270; + about 20 KB of lazy puzzle and explore chunks that never load before the first line). Changed by META-PLAN: ≤ 305 KB br (+ the 14 KB meta-ui chunk + 1 KB slack; LMI) | R4 recommends ≤ 260 KB for one bundle; +10 for the split overhead | `budget.ts` |
| `meta-ui` lazy chunk (changed by META-PLAN) | ≤ 14 KB br; a dynamic entry imported only by `app/meta.ts`; PENDING until `app/meta.ts` exists, then FAIL without a dynamic entry or inside a static closure | [META-PLAN.md](META-PLAN.md), section "Budgets and validation" | `budget.ts` (LMI): `budget: meta ui in entry closure fails`, `budget: meta row pending until its importer exists` |
| JS before the first line (entry + engine closures) | ≤ 270 KB br (changed by PUZZLES-PLAN: the old all-JS limit, now scoped to what loads before the first line) | as above | `budget.ts` (L5) |
| Lazy chunks, world JSON, props, `budget/room-set` | changed by PUZZLES-PLAN: puzzle type ≤ 8 KB br each, puzzle host ≤ 10, explore UI ≤ 16 (dynamic entries, never in a static closure; PENDING until `src/app/yields.ts` exists, then FAIL without a dynamic entry); world ≤ 32 KB raw / 8 KB br; prop ≤ 512 px; room-set ≤ 32 MiB | [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Budgets and validation" | `budget.ts` (L5, LP2) |
| CSS total | ≤ 12 KB br | | `budget.ts` |
| `index.html` | ≤ 2 KB br | | `budget.ts` |
| Story JSON per chapter | ≤ 160 KB raw and ≤ 35 KB br | ink JSON is verbose, compresses well [R4 §4.3] | `budget.ts` (free from `story-gen`, paid from `server/content`) |
| en table per chapter | ≤ 48 KB raw | | `budget.ts` |
| First-load to first line (static estimate) | ≤ 800 KB transfer | the entry + engine closures (changed by PUZZLES-PLAN: lazy chunks excluded; was "all JS") + CSS + html + TWA 16.2 KB [R1] + ch1 story/meta/manifest + first knot's images (AVIF); audio excluded (it streams, never blocks the first line) | `budget.ts` |
| First-load per story, covers (changed by STORIES-PLAN) | the row above for every story's first chapter (a free chapter no `next` names), plus `catalog.json`, `covers.json` and the 3 largest cover AVIFs, ≤ 800 KB; cover exactly 360×640, AVIF ≤ 24 KB, WebP ≤ 36 KB | [STORIES-PLAN.md](STORIES-PLAN.md), section "Budgets and validation" | `budget.ts` (L5): `budget: first-load row per story`, `budget: cover over 24 KB fails` |
| First knot images | ≤ 450 KB | | `budget.ts` |
| Image dimensions | ≤ 2048 px each side; bg/cg exactly 1080×2048; sprites ≤ 768×1536 | principle 4 | `assets.ts` writes dims from sharp metadata; `budget.ts` checks |
| Image file | AVIF ≤ 300 KB, WebP ≤ 450 KB | | `budget.ts` |
| Image formats | every image has both AVIF and WebP | [O] | `budget.ts` |
| Knot working set | for every K: bound(`carried(K)`) + decoded `assets(K) ∪ assets(next(K))` ≤ 32 MiB. `carried(K)` (story tool, `usage.json`) = image assets a predecessor may leave on stage that K's opening tag lines do not clear and that K and next(K) do not name; propagated over the knot graph from an empty stage at the chapter's first knot. Only K's opening tag lines clear: the tag-only lines before K's first other line, as `classify.ts` classifies them (STAGING-DSL §3.3). They run in K's first batch on every entry, because `graph/entry-below-top` makes every entry a knot top. There `scene` clears all, and `bg` / `cg` / `cg: off` / `show` / `hide` replace or clear their slot; every other tag in a knot only adds. bound() = the largest bg + the largest CG + per character its largest expression, since the stage holds one of each | K5, K9 | `budget.ts` (`budget/knot-set`) — `budget: knot-set counts carried stage` |
| Per-chapter transfer (images AVIF + audio) | ≤ 6 MB | [O]: 10–15 MB practical ceiling for the whole app | `budget.ts` |
| BGM file | m4a ≤ 3 MB and ≤ 240 s; WAV only if `placeholder`, ≤ 400 KB | K23 | `budget.ts` |
| SFX | ≤ 100 KB and ≤ 3 s | decoded ≤ 1.06 MiB each | `budget.ts` |
| Live texture bytes | steady ≤ 32 MiB; hard cap 48 MiB; a visible load over the hard cap after eviction is refused | steady total above (135.5 MiB at the gated limits) | registry code + `registry_caps`, `registry: visible load over hard cap after eviction is refused` unit + e2e `textures released on chapter change` |
| Decoded audio | ≤ 8 MiB | | `sfx_cache_cap` unit |
| JS heap after ch2 start | ≤ 48 MB (CDP `Performance.getMetrics` `JSHeapUsedSize`) | | e2e `heap under budget` |
| Time to first line | ≤ 6 s from navigation (tap issued at once), CPU 4× (`Emulation.setCPUThrottlingRate`), 1.6 Mbps down / 150 ms RTT (`Network.emulateNetworkConditions`), on `dist-e2e` | about 0.4 MB at 200 KB/s ≈ 2 s + parse + auth | e2e `time to first line under throttling` |
| Render resolution | `min(DPR, 2)`, LOW → 1 | principle 4 | `layout.test.ts` |

**Red once:**
- `budget.test.ts` feeds synthetic inputs and expects FAIL rows: 300 KB entry, 4096 px image, WAV without
  `placeholder`, a 60 MiB knot set, a knot whose own set passes but whose carried stage puts it over 32 MiB, and an
  existing `app/engine.ts` with no dynamic entry in the manifest.
- The lane runs `node scripts/budget.ts --dist <tmp oversize dist>` once, expecting exit 1, and quotes it.

---

## Test strategy

### Per layer

| Layer | Runner | What | Key test names |
|---|---|---|---|
| Client unit | vitest project `unit` (node) — `src/**/*.test.ts`, `scripts/**/*.test.ts` | parser, codecs, runner, resume, registry, executor, layout, preload, API client, purchase flow, saves service, i18n, arch rules, build tools | `tags: every form from STAGING-DSL parses`, `tags: unknown kind is an error value`, `dsl-doc: headings equal parser kinds`, `runner: tag-only steps merge into next`, `resume: exact`, `resume: checkpoint after removed line`, `resume: chapter start after knot rename`, `resume: ink error after checkpoint resume falls back to chapter start`, `carry: g_ vars carried`, `registry_returns_to_baseline`, `registry_caps`, `registry: visible load over hard cap after eviction is refused`, `preload: next-chapter id resident after setChapter`, `audio: next-chapter sfx survives setChapter`, `executor_kills_timelines`, `chapter_change_releases`, `http: 401 re-auths once`, `http: concurrent 401s share one auth`, `loader: expired token re-auths once then loads`, `purchase_unlocks_only_from_server`, `flow: paid polls with backoff then unlocks`, `flow: cancelled returns to paywall`, `flow: window exceeded → delayed`, `saves: 409 pauses autosave`, `saves: retried write with same writeId is success`, `saves: lost response then newer body is not a conflict`, `saves: reload uploads pending when server writeId is ours`, `game: repeated ink error walks resume down to chapter start`, `game: next-chapter holder released on non-ending branch`, `decode: rust dto samples decode`, `budget: engine row fails when dynamic entry missing`, `budget: knot-set counts carried stage`, `scan: paid chapter with empty line-ID section fails`, `scan: paid asset bytes in dist fail`, `scan: paid-only asset with empty files section fails`, `dev server refuses /@fs paid path`, `dev config: fs.allow stays inside client/`, `arch: forbidden patterns`, `arch: import boundaries` |
| Client DOM | vitest project `dom` (happy-dom 21.0.4) — `src/**/*.svelte.test.ts` | components with behaviour | `typewriter: graphemes intact`, `typewriter: tap completes`, `typewriter: reduced motion instant`, `choices: no tap-through`, `screens: back button visible iff overlay`, `menus: paywall needs terms checkbox` |
| Story | `npm run story` (gate) + vitest on the tool with inline fixture inks | compile, lint (every rule red on a fixture), IDs, locales, graph reachability, 200 seeded playthroughs per chapter, ch2 with ch1 carries | `lint: <code> red on fixture` for every STAGING-DSL §11 code; `story: zero chapters is an error`; `play: step cap fails`; `graph: carry propagates until cleared` |
| Server | `cargo test --workspace --all-targets --no-fail-fast --locked`; unit tests in modules + one integration crate `server/tests/it/` (one binary: one link; every state from `common::test_state()` → `AppState::new`; changed by RULINGS 14: races by two connections with a lock-wait probe, `common::wait_for_lock_waiter`) + `server/dev/tests/dev.rs` (imports the `server-dev` lib target, `oneshot`, binds no port; changed by RULINGS 14: a database per test on the slot's cluster (`pgdev::TestDb`)) | initData vectors, token, schema constraints, repos, routes via `tower::ServiceExt::oneshot`, payments, webhook, refunds, content gating, bindings, catalog contract | see below |
| e2e | Playwright 1.64.1, Chromium, 375×812, `hasTouch`, against `dist-e2e` via `vite preview` + `server-dev` | smoke + purchase + perf | see below |

**Server test names:**
- **auth** — `initdata_valid_vector`, `initdata_tampered_field`, `initdata_missing_hash`, `initdata_expired`,
  `initdata_from_future`, `initdata_reordered_keys`, `initdata_url_encoded_values`, `initdata_duplicate_key`,
  `initdata_unknown_field_included`, `initdata_signature_in_dcs`.
- **token** — `token_roundtrip`, `token_expired_401`, `token_wrong_key_401`, `token_missing_401`,
  `auth_ignores_body_user_id`.
- **schema** — `schema_charge_id_unique`, `schema_order_status_check`, `schema_paid_requires_charge`,
  `schema_save_body_json_valid`, `pool_session_settings`, `no_dynamic_sql`; changed by RULINGS 14 (as merged,
  `fee9da7`): `wal_mode_on_file_db` → `pool_session_settings`, plus `test_db_isolated_per_state`,
  `state_reopens_migrated_database` and `serve_log_names_database_target_not_password` (`it/main.rs`).
- **saves** — `saves_create_then_conflict`, `saves_rev_increments`, `saves_retry_same_write_id_ok`,
  `saves_other_user_404`, `saves_body_too_large_413`, `saves_bad_slot_400`.
- **invoices** — `invoice_unknown_product_404`, `invoice_already_owned_409`, `invoice_reuses_recent_order`,
  `invoice_price_from_catalog`.
- **pre-checkout** — `precheckout_ok`, `precheckout_wrong_amount`, `precheckout_wrong_currency`,
  `precheckout_unknown_payload`, `precheckout_already_owned`, `precheckout_other_order_in_checkout`,
  `precheckout_same_order_twice_refused`, `precheckout_expired_order`, `precheckout_grants_nothing`,
  `precheckout_answer_times_out_at_5s` (paused time; as merged, L8b cut Q2: real time, 5.0 s ≤ elapsed < 7.5 s
  under a hung gateway, since tokio's `test-util` is off); changed by RULINGS 14:
  `precheckout_concurrent_two_orders_one_passes`, `precheckout_concurrent_same_order_one_passes`.
- **grant** — `successful_payment_grants_once`, `successful_payment_duplicate_concurrent` (renamed by RULINGS 14),
  `successful_payment_unknown_order_recorded_no_grant`.
- **webhook** — `webhook_missing_secret_401`, `webhook_wrong_secret_401`, `webhook_undecodable_200`,
  `webhook_payment_undecodable_by_frankenstein_still_recorded`, `webhook_payment_fields_unreadable_500`,
  `webhook_refund_undecodable_by_frankenstein_still_revokes`.
- **refunds** — `refund_revokes`, `refund_repeat_safe`, `refunded_payment_update_revokes_idempotent`,
  `refund_gateway_error_keeps_entitlement`, `refund_command_admin_only`, `unapplied_charge_notifies_payer_and_admin`,
  `paysupport_flags_unapplied_charge`.
- **content** — `paid_chapter_403_without_entitlement`, `paid_chapter_200_with_entitlement`,
  `paid_chapter_403_after_refund`, `paid_responses_private_no_store`, `asset_path_traversal_404`,
  `free_chapter_not_served_by_api`, `startup_fails_when_product_has_no_content`.
- **contracts** — `bindings_are_fresh`, `dto_samples_are_fresh`, `catalog_matches_story_chapters`,
  `bot_texts_complete_and_within_limits`.
- **routing and static** — `server_has_no_dev_routes`, `static_dir_must_not_contain_content_dir`.
- **bot** — `start_has_web_app_button`.
- **dev crate** — `dev_app_uses_given_database`, `dev_database_reset_per_launch` (changed by RULINGS 14, replacing
  `dev_app_uses_given_db_path`), `launch_signs_valid_initdata`,
  `simulate_payment_goes_through_webhook_handler`, `simulate_paid_twice_grants_once`.
- **pgdev crate** (changed by RULINGS 14; as merged, LDB0 `857f7d6`, LDB2 `a7e4a04`) — `tests/pgdev.rs`:
  `cluster_ensure_up_idempotent`, `ensure_up_concurrent_cold_start`, `test_db_created_then_dropped_on_drop`,
  `test_dbs_isolated`, `recreate_drops_open_connections`, `sweep_drops_only_stale_test_dbs`,
  `test_db_carries_hostile_defaults`; unit: `dev_cluster_env_defaults_and_errors`, `pg_version_parse`,
  `connect_error_classes`, `encoded_command_base64_vectors`, `db_name_charset_and_length`,
  `db_name_for_test_unique_and_dated`. The measurements `measure_test_db_lifecycle` (pgdev) and
  `measure_state_lifecycle` (`it/main.rs`) are `#[ignore]`d.

**e2e test names** (`client/e2e/*.spec.ts`):

| Spec | Tests |
|---|---|
| `boot.spec.ts` (L7) | `boot records ready, expand and swipe events`, `viewport vars and safe areas applied`, `no window.open or alert` (an init script patches them to record calls) |
| `smoke.spec.ts` (L15) | `tap-to-start unlocks audio only after the gesture`, `play choose save reload load resumes at same line` (asserts `data-line-id`), `autosave resume after reload`, `back button closes overlays without history` (`history.length` unchanged, `web_app_setup_back_button` events recorded), `deactivated pauses audio, activated resumes` (the dev-server `/@fs` check is a vitest test, not e2e: see Paid-content protection) |
| `purchase.spec.ts` | `purchase unlocks chapter 2` (403 before, sheet shows the server price, 200 after, ch2 first line reacts to a ch1 choice), `cancelled purchase keeps paywall`, `failed purchase keeps paywall`, `delayed webhook unlocks after polling`, `paid twice grants once` |
| `perf.spec.ts` | `time to first line under throttling`, `textures released on chapter change`, `heap under budget`, `context loss recovers` (debug hook calls Pixi's `forceContextLoss()`, then a pixel sample of the stage is not black) |
| `stories.spec.ts` (L15; changed by STORIES-PLAN) | `stories: picker lists both stories with covers`, `stories: saves are per story`, `stories: second story first chapter free then paywall`, `stories: story ending shows the end and records the ending`, `stories: back button closes chapter select to the picker`, `stories: picker unmounted during play` |
| `puzzles.spec.ts` (L15; changed by PUZZLES-PLAN) | `explore: search item puzzle buy hint solve`, `explore: gate fail branch`, `explore: reload resumes in the same room with items`, `puzzle: hint text absent until bought`, `puzzle: paid chapter puzzle needs entitlement`, `explore: back button walks rooms then hides`, `explore: live texture bytes stay under the steady cap`, `explore: hotspot buttons align with props under safe area and landscape` |

**Changed by PUZZLES-PLAN.** The unit, DOM, story and server test names of the puzzle extension (world, rules,
reduce, softlock, cover, runner yields, session, controller, yields, arch, budget, scan, emit; schema, attempts,
status, catalog, invoices, pre-checkout, refunds) are listed in [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section
"Test strategy". Each lane's commits name the ones it adds.

**Changed by STORIES-PLAN.** The story-tool, asset, server (story index, saves per story, statistics), client
(saves, reporter, game), DOM and e2e names of the stories extension are listed in [STORIES-PLAN.md](STORIES-PLAN.md),
section "Test strategy". The existing `saves_*` names are kept, on the per-story paths.

### Gates that must be seen red once (each lane quotes the failing run)

| Gate | Seeded failure | Lane |
|---|---|---|
| `check` | a type error in a `.ts` and a `.svelte` file; a Svelte warning under `--fail-on-warnings` | L1 |
| `test` | `vitest run` with no test files exits 1 (no `passWithNoTests`); arch test with a seeded `height: 100vh` | L1 |
| `build` budget | `--dist` on an oversize synthetic dist | L1 (JS rows), L5 (asset rows) |
| `build` scan | base64 data URI containing a paid ID; a `.map` file; the compiler string; the dev canary; a paid chapter with no fingerprints; a paid chapter whose `lineIds` section is empty while `fingerprints.assets.json` is not (L1, L3b). A synthetic dist holding a paid-only asset under its own file name, and its bytes under another name; `files` empty while `usage.json` + `chapters.json` show a paid-only asset (L5) | L1, L3b, L5 |
| dev-server isolation | `server.fs.allow` widened to the repo root in a scratch config → `dev server refuses /@fs paid path` gets 200 with the probe body | L3b |
| `story` | every §11 rule on a fixture; zero chapters; a step-cap loop | L3a, L3b, L3c |
| clippy | a seeded `unwrap()` on a request path (`unwrap_used = deny`) | L2 |
| `no_dynamic_sql` | a seeded `AssertSqlSafe` | L2 |
| `bindings_are_fresh` | a DTO field added without regenerating | L6a |
| idempotency | mutation: the PK on `payments` removed / check-then-insert → `successful_payment_duplicate_concurrent` red (renamed by RULINGS 14); as merged (L8b `06bae54`, cut Q4): the check-then-insert mutation only, since removing the PK fails the migration (`42830`, the charge-id foreign keys); its red: B waits on `payments_pkey`, then fails `23505` | L8b (tester mutation) |
| e2e | L7: `main.ts` not calling the facade → `boot records ready, expand and swipe events` red; `$DEV_API_PORT` already bound by another process → the webServer "is already used" error (`reuseExistingServer: false`), never a run against the foreign server. L15: mock invoice forced to `failed` → `purchase unlocks chapter 2` red; BackButton binding removed → `back button closes overlays without history` red | L7, L15 |
| puzzle extension | changed by PUZZLES-PLAN: yield lint and the `dsl-doc` heading (LW1); the soft-lock stub, the `successors` stub without `closed`, the checker capped at 200,000 instead of `RESUME_STATE_CAP`, the path-only reconcile step 4, the `resetSection` that keeps `section`, the current-section-only reconcile with no `unproved` (revision 3), and the pure-module arch rule (LW2); every `world/*` / `puzzle/*` / `explore/*` code (the cross-section-unlock world for `world/cross-section-effect`, revision 4; the multi-lock puzzle world for `world/puzzle-multi-lock`, revision 5; the cross-section arch world for `world/cross-section-exit`, revision 6), `paid/leak` for hints, the scan of hint text and of paid world text in dist, the whole-body world version (LW3); room-set and prop budget rows (L5); puzzle UI in the engine closure, the lazy rows without their importer, and the lazy-import arch rule (LP2); the controller that enters a section through `reduce` instead of `admitSection` (LX, revision 3); `0002` absent and the never-limiting stub (L6c); the pre-checkout without hint predicates (L8b); the wrong gate order, the failed mock invoice and the hotspot layer in the padded overlay in `puzzles.spec.ts` (L15) | [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Gates that must be seen red once" |
| stories extension | changed by STORIES-PLAN: the `catalog/stories` code without its §11 row and every `catalog/stories` rule on a fixture, a missing `stories.json`, a paid ending name planted in the public catalog (LS1); a 30 KB cover and an oversize first-load row of one story (L5); a paid first chapter and a missing story index at startup (L6b); the dropped story-id CHECK (LS2); the dropped event key, the missing entitlement check, a read counting rows (LS3); regenerated event ids (LS4); saves keyed without the story (L15) | [STORIES-PLAN.md](STORIES-PLAN.md), section "Gates that must be seen red once" |

---

## Dependencies (exact versions)

Pinned exactly in `client/package.json` (no ranges) and by `Cargo.lock` under `--locked`. Versions are from
R2 §5.2, R4 §1.1 and the inventory, plus three verified on the registries on 2026-10-30 (marked †).

**Client** — `"type": "module"`, `"engines": { "node": ">=22.12.0" }` (the vitest 5 floor; local 24.21.0):

| Package | Version | Kind | Brotli in bundle | Wrapped by |
|---|---|---|---|---|
| svelte | 5.57.3 | dep (compiled) | 11.2 KB | `ui/` |
| pixi.js | 8.22.0 | dep | 145.1 KB | `scene/controller.ts` |
| gsap | 3.15.0 | dep | 24.3 KB | `scene/executor.ts` |
| inkjs | 2.4.0 | dep (runtime in app; compiler only in `scripts/`) | 26.6 KB | `story/runner.ts`; `scripts/story/compile.ts` |
| vite | 8.3.5 | dev | — | |
| @sveltejs/vite-plugin-svelte | 7.3.1 | dev | — | |
| typescript | 6.0.3 | dev (K2) | — | |
| svelte-check | 4.7.7 | dev | — | |
| vitest | 5.0.5 | dev | — | |
| happy-dom | 21.0.4 | dev | — | |
| @testing-library/svelte | 5.4.2 | dev | — | |
| @playwright/test | 1.64.1 | dev | — | |
| sharp † | 0.35.5 (engines node ≥ 20.9; prebuilt `@img/sharp-win32-x64`) | dev, build-only | — | `scripts/assets/encode.ts` |
| @types/node | latest 24.x matching Node 24 (verify: `npm view @types/node@24 version` in L1; `latest` is 26.6.6 †, which describes a newer Node) | dev | — | |

**Server** — edition 2024, `rust-version = "1.94"` (the sqlx 0.9 MSRV), `resolver = "3"`, `default-features = false`
set on the `[workspace.dependencies]` entries [R4 §6.1]:

| Crate | Version | Features / notes |
|---|---|---|
| axum | 0.8.9 | default (json, query, tokio, http1, tracing…) |
| tokio | 1.54.1 (1.54.0 is yanked) | rt-multi-thread, macros, net, signal, time, fs |
| tower / tower-http | 0.5.3 / 0.7.1 | tower-http: fs, trace, timeout, set-header |
| frankenstein | =0.52.1 | `default-features = false, features = ["client-reqwest"]` (Bot API 10.3) |
| sqlx | 0.9.0 | `default-features = false, features = ["runtime-tokio", "tls-rustls-aws-lc-rs", "postgres", "migrate", "macros"]` (macros only for `migrate!`; changed by RULINGS 14, as merged in the root `Cargo.toml`: `postgres` replaces `sqlite-bundled`, `tls-rustls-aws-lc-rs` shares the rustls stack reqwest already pulls) |
| serde / serde_json | 1.0.229 / 1.0.154 | derive / raw_value |
| thiserror | 2.0.21 | |
| tracing / tracing-subscriber | 0.1.44 / 0.3.23 | fmt, env-filter |
| hmac / sha2 | 0.13.0 / 0.11.1 | (sqlx pulls sha2 0.10 too; harmless duplicate [R2]) |
| subtle | 2.6.1 | webhook secret compare |
| hex | 0.4.3 | hash/MAC encoding (no base64 dependency) |
| form_urlencoded † | 1.2.2 | initData parsing (already in axum's tree via serde_urlencoded) |
| getrandom † | 0.4.3 (MSRV 1.85) | order ids, token keys in dev (verify: the 0.4 fill API, L2) |
| ts-rs † | 12.0.1 (MSRV 1.78) | default (`serde-compat`) + `no-serde-warnings` |
| dev: pgdev / http-body-util † / tower | path crate `server/pgdev` / 0.1.5 / 0.5.3 (util) | changed by RULINGS 14 (as merged, `fee9da7`): `pgdev` replaces `tempfile` (the local cluster and a `TestDb` per test; a dev-dependency of `server`, a dependency of `server-dev`, never linked into the production `server`); body collection in oneshot tests |

**Workspace lints:**
- `[workspace.lints.rust] unsafe_code = "forbid"`.
- `[workspace.lints.clippy] unwrap_used = "deny"`, `disallowed_methods = "deny"`.
- `clippy.toml` (`allow-unwrap-in-tests = true`; `disallowed-methods` = `std::fs::read`, `std::fs::read_to_string`,
  `std::thread::sleep`). Integration tests carry `#![allow(clippy::unwrap_used)]`.

**Profiles** [R4 §6.1]:
- `[profile.dev] debug = "line-tables-only"`;
- `[profile.dev.package."*"] opt-level = 2`;
- `[profile.release] lto = "thin", codegen-units = 1, strip = "debuginfo"`.

---

## Gate commands mapping

| CLAUDE.md gate | Concrete command | Runs |
|---|---|---|
| `npm --prefix client ci` | `npm ci` | install from the lockfile (plus, once per machine: `npx playwright install chromium` — open question E3) |
| `npm --prefix client run check` | `svelte-check --tsconfig ./tsconfig.json --fail-on-warnings && tsc -p tsconfig.node.json --noEmit` | the app (`src/`) and scripts/configs/e2e (`erasableSyntaxOnly`, `types: ["node"]`) |
| `npm --prefix client run test` | `vitest run` (never `--bail`, never `passWithNoTests`) | projects `unit` + `dom` |
| `npm --prefix client run story` | `node scripts/story.ts` (Node 24 type stripping [R4]); flags `--fix-ids`, `--sync-locales`, `--strict` | the story gate |
| `npm --prefix client run build` | `npm run story && npm run assets && vite build && node scripts/budget.ts && node scripts/scan-dist.ts` (`assets` = `node scripts/assets.ts`) | production build + budgets + leak scan |
| `cargo fmt --all --check` | as is | |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | as is | `server` (lib, bin, `tests/it`), `server-dev` (lib, bin, tests), `pgdev` (lib, bin, tests; changed by RULINGS 14) |
| `cargo test --workspace --all-targets --no-fail-fast --locked` | as is | `server` lib unit tests, `server` bin, `server/tests/it` (one binary), `server-dev` lib + bin + `tests/dev.rs`, `pgdev` lib + bin + `tests/pgdev.rs`. Changed by RULINGS 14 (decision section 6): needs `PG_BIN` + the slot's `DEV_PG_PORT`/`DEV_PG_ROOT`; the cluster self-starts |
| *(new, proposed)* `npm --prefix client run e2e` | `npm run story && npm run assets && vite build --mode e2e --outDir dist-e2e && cargo build --manifest-path ../Cargo.toml -p server-dev --locked && playwright test -c e2e/playwright.config.ts`; as merged (L7 `57e1424`, cut Q2): no `cargo build` step (`client/package.json:17`) | e2e; as merged: the `server-dev` webServer runs `process.env.SERVER_DEV_CMD ?? 'cargo run -p server-dev --locked'` with a 600 s start timeout (`client/e2e/playwright.config.ts:48,54`); the config starts `server-dev` (fresh DB) on `127.0.0.1:$DEV_API_PORT` and `vite preview --mode e2e --outDir dist-e2e --port $DEV_WEB_PORT --strictPort`, both webServers with `reuseExistingServer: false` set explicitly; `preview.proxy` targets `$DEV_API_PORT`. Defaults 8787 / 4173; each parallel lane gets its own pair from per-lane env (E2), and every `server-dev` launch of a lane (e2e, seen working) uses it. Exceeds 2 min → the gate kit (open questions E1, E2). Changed by RULINGS 14 (decision section 6): needs `PG_BIN` + the slot's `DEV_PG_PORT`/`DEV_PG_ROOT`; the cluster self-starts, and `server-dev` recreates `tgn_dev_<port>` per launch |

**Vacuous-green guards:**
- vitest exits 1 on no files [R4 §5.1];
- `story` errors on zero chapters and prints the chapter list by name;
- `budget.ts` fails if `dist/.vite/manifest.json` is missing or older than `dist/index.html`;
- the engine row is PENDING (never PASS) while `src/app/engine.ts` does not exist, and FAILs if the file exists but
  the manifest has no dynamic entry for it;
- (changed by PUZZLES-PLAN) the lazy chunk rows follow the same rule, keyed on their importer
  `src/app/yields.ts`: PENDING while it does not exist; once it exists, FAIL for a family whose sources exist with no
  dynamic entry;
- `scan-dist.ts` fails on a missing or empty fingerprint section (`lineIds`, `texts`, `files`) when a paid chapter or a
  paid-only asset exists (paid-only computed from `usage.json` + `story/chapters.json`, never from the asset tool's
  outputs);
- Playwright: `forbidOnly: true`, `retries: 0`, and the suite fails if any test is skipped (`--fail-on-flaky-tests`
  off; a custom check on `skipped == 0`; as merged, L7 `57e1424`, cut Q3: the check is a reporter, the default
  export `SkipGuard` of `client/e2e/helpers.ts`);
- cargo targets are counted by name against the lists above.

---

## Integration

### New files per lane

See the lane cut.

### Updates outside the lanes' code

- **CLAUDE.md "Stack and layout".** Add `server/dev/` (crate `server-dev`, dev-only), `assets/catalog.json`, the
  generated dirs (`client/src/story-gen/`, `client/public/assets/`, `server/content/`) and the e2e gate.
  Orchestrator's call (E4).
- **Changed by STORIES-PLAN.** CLAUDE.md "Stack and layout" gains `story/stories.json` (the story list: one story =
  a chain of chapters) and the statistics foundation; `docs/OPEN-QUESTIONS.md` gains Q23–Q25 (STORIES-PLAN "Open
  questions"). Orchestrator's call, at the design merge.

### docs/FEATURE_MAP.md entries

Created by D1, completed by D2. Each implementation lane lists its rows in `impl.md`. The doc lanes own the file:
parallel lanes would collide on it. Changed by STORIES-PLAN: the rows Stories, Saves per story and Player statistics
are in [STORIES-PLAN.md](STORIES-PLAN.md), section "Integration".

| Feature | Rows |
|---|---|
| Boot and tap-to-start | `main.ts`, `app/boot.ts`, `ui/TapToStart.svelte`, `audio/unlock.ts`; boot e2e |
| Telegram module + dev mock | `telegram/*`, `vite-plugins/tg-dev-mock.ts`; `server/dev/src/launch.rs` |
| Auth | `api/http.ts`, `api/session.ts`; `server/src/auth/*`, `api/auth.rs`; auth tests |
| Story pipeline | `scripts/story*`, `story/**`; the story gate |
| Staging DSL | `story/tags.ts`, `story/staging.ts`; STAGING-DSL.md |
| Story runtime | `story/runner.ts`, `chapters.ts`, `carry.ts`, `resume.ts`, `save-codec.ts` |
| Scene + assets | `scene/*`, `scripts/assets*`, `assets/catalog.json` |
| Audio | `audio/*` |
| Overlay UI | `ui/*`, `i18n/*`, `settings/*` |
| Saves | `saves/*`; `server/src/db/saves.rs`, `api/saves.rs` |
| Payments | `purchase/flow.ts`; `server/src/telegram/{gateway,webhook,payments}.rs`, `api/orders.rs`, `db/{orders,payments}.rs`; `server/dev/src/{fake_gateway,simulate}.rs` |
| Refunds + bot | `server/src/telegram/{commands,setup,texts}.rs` |
| Paid delivery | `server/src/content.rs`, `api/content.rs`; `scripts/scan-dist.ts` |
| Budgets | `scripts/budget*.ts`; perf e2e |
| Puzzles, Exploration, Hints, World tooling | changed by PUZZLES-PLAN: [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "docs/FEATURE_MAP.md entries" |

---

## Implementation plan — THE LANE CUT

**Rules:**
- Each lane is ≤ ~10 commits and ≤ ~15 files, one subsystem.
- **At most 2 lanes in parallel**, always one client lane ∥ one server lane, or two client lanes with disjoint lock
  sets. Changed by RULINGS 18 (recorded by STORIES-PLAN, SQ8): at most **3** lanes — one server lane and two client
  / doc / narrative lanes whose locks are disjoint.
- Lock sets are paths. A file outside a lane's set is a STOP (lane.js).
- **Parent files.** Every lane's lock holds the parent module file (`mod.rs` / `lib.rs`) of each `.rs` file it
  creates. Shared files no later lane needs to touch are pre-declared by L2 in full: `server/src/config.rs` and
  `.env.example` (every variable of the plan, L2 commit 1) and `server/src/error.rs` (every variant except what L6a
  adds and, changed by PUZZLES-PLAN, what L6c adds). Acceptance check for each cut: every new `.rs` file's parent is
  in that lane's lock. Changed by META-PLAN revision 1 (W4): LPO adds `PRIVACY_OPERATOR_FILE`, the one later change to
  `config.rs` and `.env.example`; its lock also holds the two other `Config` constructors (`server/dev/src/lib.rs`,
  `server/tests/it/common.rs`).
- **AppState construction.** `AppState` is built only by `AppState::new(cfg)` in `server/src/lib.rs` (Module API).
  `#[non_exhaustive]` makes a struct literal or functional update outside the `server` crate a compile error (erratum,
  RULINGS 7 d: not a private `_built` field). A field-adding lane writes `AppState { repo, cfg, … }` inside
  `AppState::new`.
  - **Callers.** Each passes a complete `Config` (every field pre-declared by L2):
    - `server/src/main.rs` with `Config::from_env()`;
    - `build_dev_app` in `server/dev/src/lib.rs` with a dev `Config` from `DevPaths`;
    - `test_state()` in `server/tests/it/common.rs` with `test_config()`; a test that needs other values calls
      `AppState::new(Config { …, ..test_config(&dir) })` in its own file.
  - **Content paths.** Every such `Config` names a `CONTENT_DIR`: the dev binary the generated `server/content/`;
    every test (`it`, `dev.rs`) the committed fixture `server/tests/fixtures/content/`, which L6b fills.
  - **What a field-adding lane edits.** L4a (`keys`, `clock`), L6b (`content`, `catalog`) and L8a (`gateway`) edit
    `lib.rs` only: the struct, `new`, a `StartupError` variant, their `with_*` seam. Fixtures go in their own files.
    No caller is edited, except that L8a adds `.with_gateway(FakeBotGateway)` at the dev call site, which its lock
    holds.
  - **Acceptance check for each cut.** For every lane that adds an `AppState` field, every file that constructs
    `AppState` is in that lane's lock, or constructs it only through `AppState::new`.

**Collision locks** (WORKFLOW.md) are serialized by the order below (changed by PUZZLES-PLAN: the puzzle lanes
are in):
- `client/package.json` + lock: L1, L3b, L5, L7. The puzzle lanes add no dependency (changed by STORIES-PLAN: nor
  do the stories lanes).
- `Cargo.toml` + `Cargo.lock`: L2, L4b.
- `server/migrations/`: L2 (`0001`), then L6c (`0002`, plus `server/build.rs`). Changed by STORIES-PLAN: `0001`
  L2 → LDB1 → LS2 (the `saves` rewrite); `0003_stats.sql` LS3.
- `server/src/{lib.rs, main.rs, api/mod.rs, api/dto.rs, db/mod.rs, telegram/mod.rs, error.rs}` and
  `client/src/api/generated/api.ts`: L4a → L6a → L6b → L6c → L8a → L8b → L9, sequential. Changed by STORIES-PLAN:
  L4a → L6a → LDB1 → L6b → LS2 → L6c → L8a → L8b → LS3 → L9.
- `server/dev/src/lib.rs`: L4b → L8a → L8b.
- `server/src/ids.rs`: L4a → L6b (adds `PuzzleId`; changed by STORIES-PLAN: and `StoryId`).
- `server/src/{catalog.rs,content.rs}` and `server/catalog.json`: L6b only (later lanes consume their API).
- `server/src/{db/saves.rs, api/saves.rs}`, `server/tests/it/saves.rs` (changed by STORIES-PLAN): L6a → LDB1 → LS2.
- `server/tests/it/dto_samples.rs`, `client/src/api/fixtures/dto-samples.json` (changed by STORIES-PLAN): L8b → LS3.
- One server lane runs at a time, so none of the server files is held by two live lanes.
- `server/tests/it/main.rs`: server lanes only, sequential.
- `client/src/story/{staging.ts,tags.ts,tags.test.ts,dsl-doc.test.ts}`, `client/scripts/story/{lint.ts,lint.test.ts}`:
  L3a → LW1, then frozen. Changed by STORIES-PLAN (SQ2): `lint.ts` (one `LINT_CODES` line) and `dsl-doc.test.ts`
  (the row count) reopen for LS1 only, then frozen again. Changed by STORIES-PLAN revision 2 (W1, SQ2): `tags.test.ts`
  (the cast assertion of `catalog: demo catalog and cast decode`) and `lint.test.ts` (the clean control of
  `lint: catalog/assets red on fixture (cast char missing)`) reopen for LS1 commit 8 only, one hunk each, then frozen
  again. Changed by STORIES-PLAN revision 3 (W2, SQ9): `tags.test.ts` also reopens for L5, one hunk, before LS1's:
  the catalog-key pins of `catalog: demo catalog and cast decode` (:450-458 at main `a7e4a04`) become subset pins
  (L5 entry), then frozen again. LS1 commit 8's cast hunk (:459-462) stays disjoint from it, and the line both read,
  `const catalog = committedCatalog()` (:448), is touched by neither.
- `client/src/story/catalog.ts`: L3a → L3b → L5 → L13. Changed by STORIES-PLAN: L5 → LS1 → L13.
- `client/scripts/story.ts`: L3b → L3c → LW3. Changed by STORIES-PLAN: L3c → LS1 → LW3.
- `client/scripts/story/{emit.ts,build.test.ts}`: L3b → LW3; `graph.ts`: L3b → LW1 → LW3 (RULINGS 16 Q1). Changed by
  STORIES-PLAN: `emit.ts`, `build.test.ts` L3b → LS1 → LW3. Changed by RULINGS 19 Q1, Q2 (as merged, L3c `91e35cd`):
  `emit.ts`, `build.test.ts` L3b → L3c → LS1 → LW3.
- `client/scripts/story/{fix.ts,locales.ts,playthrough.ts,play.test.ts,locales.test.ts}`: L3c → LW3. Changed by
  STORIES-PLAN: `locales.ts` L3c → LS1 → LW3; revision 2 (W1): `locales.test.ts` L3c → LS1 → LW3.
- `story/stories.json`, `story/locales/{ru,en}/story.json` (changed by STORIES-PLAN): LS1 → N1 → N2; as merged
  (L3c `91e35cd` created the two tables): `story/locales/{ru,en}/story.json` L3c → LS1 → N1 → N2;
  `story/chapters.json`, `story/cast.json`: N2 (after L3b).
- `client/src/api/{endpoints.ts,decode.ts,decode.test.ts}` (changed by STORIES-PLAN): L10 → LS4.
- `client/scripts/scan-dist.ts`: L1 → L3b → L5 → LW3. `client/scripts/scan-dist.test.ts`: L1 → L5 → LW3.
- `client/scripts/{budget.ts,budget.test.ts}`: L1 → L5 → LP2.
- `client/src/arch.test.ts`: L1 → LW2 → LP2. Changed by STORIES-PLAN (revision 1): L1 → LW2 → LS1 → LP2.
- `client/src/i18n/{ru.ts,en.ts}`: L14a → L14b (which pre-declares the puzzle and explore keys), then frozen.
- `client/src/ui/screens.ts`: L14a only.
- `client/src/main.ts`: L1 → L7 → L15. `client/src/ui/App.svelte`: L1 → L15.
- `docs/FEATURE_MAP.md`, `docs/ARCHITECTURE.md`: D1, D2 only.
- `docs/STAGING-DSL.md`: L3a (doc-test fixes only), then LW1 (DSL v2), then frozen. Changed by STORIES-PLAN (Y18,
  SQ2): reopened for LS1 (§4 wording, §8, §9, one §11 row; no tag change), then frozen again.
- **Changed by META-PLAN** (the nine new lanes and, revision 1, LPO; every chain below is serialized by the dependency
  order):
  - `server/migrations/`: `0002` L6c (+ `hint_unlocks`); `0003` LS3 (+ the choice constraints); `0004_economy.sql`
    LE1; `0005_social.sql` LF1; `0006_achievements.sql` LM2.
  - `server/src/{lib.rs, api/mod.rs, api/dto.rs, db/mod.rs, error.rs}`, `client/src/api/generated/api.ts`,
    `server/tests/it/main.rs`: … → LS3 → LE1 → LF1 → LM2 → LF2 → LE2 → LPO → L9 (`error.rs`: L6c pre-declares
    `InsufficientBalance` and `LimitReached`, so no meta lane touches it; LPO holds only `lib.rs` and `it/main.rs`
    of this set).
  - Revision 1: `server/src/config.rs`, `.env.example`: L2 → LPO (W4). `server/dev/src/lib.rs`: L4b → L8a → L8b →
    LPO. `server/tests/it/common.rs`: … → LPO. `server/src/api/legal.rs`: LF1 → LPO. `server/src/db/orders.rs`: L8a →
    LE1 (W3: the pack binding).
  - `server/src/{catalog.rs}`, `server/catalog.json`: L6b → LE1 (the `economy` section, `ProductRef::Pack`).
  - `server/src/content.rs`: L6b → LM2 (the meta loader).
  - `server/src/db/payments.rs`: L8b → LE1 (the grant's pack branch) → L9. `server/src/telegram/payments.rs`: L8b → LE1
    → L9.
  - `server/src/api/puzzles.rs`: L6c → LE1 (the hint use route).
  - `server/src/api/stats.rs`: LS3 → LM2 (the vocabulary check) → LE2 (the referral hook).
  - `server/src/db/economy.rs`: LE1 → LE2. `server/src/{db,api}/social.rs`, `server/tests/it/social.rs`: LF1 → LF2.
  - `server/src/{auth/initdata.rs, api/auth.rs, db/users.rs}`: L4a → LF1. `server/dev/src/launch.rs`: L4b → LF1.
  - `server/src/telegram/gateway.rs`, `server/dev/src/fake_gateway.rs`: L8a → LF2.
  - `server/dev/tests/dev.rs`: L8b → LF1 → LF2.
  - `server/tests/it/dto_samples.rs`, `client/src/api/fixtures/dto-samples.json`: L8b → LS3 → LF2 → LE2.
  - `client/scripts/story/{lint.ts}`, `client/src/story/dsl-doc.test.ts`, `docs/STAGING-DSL.md`: … → LS1 → **LM1** (one
    `LINT_CODES` line, the row count 85 → 86, §9 + one §11 row), then frozen again.
  - `client/scripts/story/{emit.ts,build.test.ts}`, `client/scripts/story.ts`: … → LW3 → LM1.
    `client/scripts/{scan-dist.ts,scan-dist.test.ts}`: … → LW3 → LM1. `server/tests/fixtures/content/meta.json`: LM1
    only (LM2 and later server lanes read it). `story/meta.json`: LM1 → N1 → N2.
  - `client/src/stats/{reporter.ts,reporter.test.ts}`: LS4 only (re-cut). `client/src/api/{endpoints.ts,decode.ts,
    decode.test.ts}`: L10 → LS4 → LMD → LMI.
  - `client/src/telegram/**`: L7 only (re-cut: the share and link methods, the mock). As merged (RULINGS 44; L14a
    `e5ce724`, cut Q3): L7 → L14a (`webapp.ts`, `telegram.test.ts`).
  - `client/src/ui/screens.ts`: L14a only (re-cut: the meta overlay kinds). `client/src/i18n/{ru.ts,en.ts}`: L14a →
    L14b, then frozen (the meta strings live in `client/src/i18n/meta.ts`, LU1 only).
  - As merged (L14a `e5ce724`, cut Q4): `client/src/ui/state.svelte.ts`: L14a → L15 → LMI.
  - `client/src/ui/meta/**`: LU1 only. `client/src/meta/**`: LMD only. `client/src/app/meta.ts` (+ test): LMI only.
  - `client/src/app/{boot.ts,game.ts,game.test.ts,yields.ts}`, `client/src/ui/App.svelte`, `client/e2e/helpers.ts`:
    L15 → LMI. `client/scripts/{budget.ts,budget.test.ts}`: L1 → L5 → LP2 → LMI.

**Dependencies:**
- All client dependencies are installed by L1 (one lockfile change); later client lanes change only `scripts`.
- All server dependencies are added by L2; L4b adds only the `server-dev` package entry.

### Dependency order (RULINGS 8: no wave barriers; changed by PUZZLES-PLAN)

A lane starts as soon as every lane in its "Gate to start" is merged and a slot is free. The slots are one client
slot and one server slot, or two client / doc / narrative lanes with disjoint locks once the server chain has ended;
never more than 2 lanes. "Re-cut" marks a lane whose scope this revision changes (its entry below says how).
Changed by PUZZLES-PLAN revision 4b (RULINGS 14): the database port lanes LDB0 → LDB1 run in the server slot after
L6a and before L6b, so the puzzle server lanes write their SQL once, in the PostgreSQL dialect. Their cut is
`D:/tmp/novel-orch/design/db/decision.md` §5, not this file.

Changed by STORIES-PLAN (revision 11): the table below is the state at main `38bc717` (SHAs as `RESUME.md` lists
them) with the stories lanes LS1–LS4 and N2 and the tuning lane LDB2 (RULINGS 17) added; up to 3 lanes run (RULINGS
18). "Re-cut" names the revision that last changed a lane's scope or gate.

Changed by RULINGS 22, 23 (as merged; docs lane `docs-errata`): the State column is the state at main `d9ca9f1`. LDB1
merged `fee9da7`; LDB2 merged `a7e4a04` (it ran early in an idle server slot, SQ4); STORIES-PLAN merged `66c92c4`;
L3c resumed (trunk-synced `f1a46ea`, re-cut v3 per its STORIES-PLAN bullet); L6b runs in the server slot.

Changed by META-PLAN: the State column is the state at main `698993e` (L6b merged; L3c running then, merged since as `91e35cd`); the nine META-PLAN
lanes LE1, LF1, LM2, LF2, LE2 (server) and LM1, LU1, LMD, LMI (client) are added; L9 moves to the end of the server
chain (gate LE2) and L15 no longer waits for it; the "Re-cut" column names META-PLAN where it changes a lane.
Changed by META-PLAN revision 1 (W4): LPO privacy-operator (server) is added after LE2; L9 follows it.

Changed by RULINGS 54 (as merged; docs lane `docs-errata-2`): the State column is the state as of `6043941`, with each
SHA from `git log --first-parent main` (the seven lanes merged before the RULINGS 11 rewrite name their old SHA too).
Merged: every lane up to LU1 `2a7b50c`. Running: L10 client-data (base `e5ce724`) and LE1 economy-core (base
`00d7c10`). "To go": the rest, in the planned order below.

| Lane | Slot | State | Gate to start (merged) | Re-cut |
|---|---|---|---|---|
| L1 client-shell | client | merged `ea8a6a2` (`f6e2624` before the rewrite) | — | — |
| L2 server-skeleton | server | merged `f48afe1` (`e005dc6` before the rewrite) | — | — |
| L4a server-auth | server | merged `d17a0a7` (`0aef72e` before the rewrite) | L2 | — (errata below) |
| L3a staging-dsl | client | merged `38f8635` (`2856495` before the rewrite) | L1 | — |
| L3b story-compile | client | merged `fed8295` (`c8d6e24` before the rewrite) | L3a | — |
| **LW1 puzzle-dsl** | client | merged `86d0a90` | L3a | — |
| L4b server-dev | server | merged `ac1bf27` (`2610e23` before the rewrite) | L4a | — |
| L6a server-saves | server | merged `63ab7a1` (`a6beebe` before the rewrite) | L4a | — |
| **LDB0 pg-dev-cluster** | server | merged `857f7d6` | L6a | — |
| **LW2 world-model** | client | merged `38bc717` | L3a, LW1 | — (errata after this design, RULINGS 21) |
| **LDB1 db-port** | server | merged `fee9da7` | LDB0 | — (no mid-flight change; LS2 follows) |
| L3c story-locales | client | merged `91e35cd` (resumed on `f1a46ea`; C1 `87ee7cf`, C2 `5d12aa3` kept) | L3b | STORIES-PLAN: C4 tags carries (re-cut v3, RULINGS 23) |
| L5 asset-pipeline | client | merged `e21775b` | L3c | PUZZLES-PLAN, STORIES-PLAN (covers, story B assets, first-load per story; revision 3: the `tags.test.ts` catalog-key pins) |
| L6b server-content | server | merged `698993e` (changed by META-PLAN; scope cut by RULINGS 25: no hint-tier products) | L6a, LDB1 | PUZZLES-PLAN, STORIES-PLAN (story index, chapter prices from it) |
| **LS2 server-story-saves** | server | merged `a358ec3` (new, STORIES-PLAN) | L6b | new |
| **L6c server-puzzles** | server | merged `039a2f3` | LS2 (serialized server files; needs L6b) | STORIES-PLAN: gate only; META-PLAN: `hint_unlocks`, the status shape, two error variants |
| **LS1 story-catalog** | client | merged `64fd798` (new, STORIES-PLAN) | L3c, L5, L6b | new |
| L11 scene | client | merged `1e2f421` | L3a, L5, LW1 | PUZZLES-PLAN |
| L12 audio | client | merged `d6c07f7` | L5 | — |
| L7 telegram-client | client | merged `57e1424` | L1, L4b, L5, LS1 | STORIES-PLAN: gate + LS1 (its e2e starts `server-dev`, which needs the story index, SQ1); META-PLAN: the share and link methods, the mock |
| **LW3 story-world** | client | merged `be8ba8b` | L3c, L5, L6b, LW1, LW2, LS1 | STORIES-PLAN: gate + LS1 (serialized story-tool files) |
| **LM1 meta-catalog** | client | merged `4d8a9ec` (new, META-PLAN) | LW3 (serialized story-tool files; ∥ D1: disjoint locks) | new |
| L8a invoices | server | merged `9e55ef6` | L4b, L6c | PUZZLES-PLAN; META-PLAN: no hint products |
| L8b webhook-grant | server | merged `06bae54` | L8a | PUZZLES-PLAN; META-PLAN: pre-checkout back to two statements, the grant's product branch |
| **LS3 server-stats** | server | merged `00d7c10` (new, STORIES-PLAN) | L8b (after L6c's `build.rs`; serialized server files) | new; META-PLAN: `choice_made`, no `endingsTotal` |
| **LE1 economy-core** | server | running (base `00d7c10`; new, META-PLAN) | LS3 (serialized server files) | new |
| **LF1 friends-server** | server | to go (new, META-PLAN) | LE1 (serialized server files) | new |
| **LM2 meta-server** | server | to go (new, META-PLAN) | LF1 (serialized server files), LM1 (`server/content/meta.json` and its fixture) | new |
| **LF2 share-profile** | server | to go (new, META-PLAN) | LM2 (the profile reads the meta and the unlocks) | new |
| **LE2 gifts-referrals** | server | to go (new, META-PLAN) | LF2 (serialized server files; needs LE1, LF1) | new |
| **LPO privacy-operator** | server | to go (new, META-PLAN revision 1) | LE2 (serialized server files; LF1's `api/legal.rs`) | new |
| L9 refunds-bot | server | to go | LS3 (serialized server files; needs L8b). Changed by META-PLAN: LE2 (the pack clawback needs LE1's ledger; the gifted-pack test needs LE2); revision 1: LPO (serialized server files) | STORIES-PLAN: gate only; META-PLAN: the pack clawback, unapplied, `/privacy`; moved to the end of the server chain |
| **LDB2 pgdev-tune** | server | merged `a7e4a04` (ran early, SQ4) | LDB1; launched after L9 unless the server slot idles earlier (SQ4) | cut in RULINGS 17 / `design/db/decision.md` |
| L10 client-data | client | running (base `e5ce724`) | L7, L8b, LS2 | PUZZLES-PLAN, STORIES-PLAN (saves per story); META-PLAN: `isDelivered`, the hint status decoder |
| L13 story-runtime | client | to go | L3c, L5, L10, LW2, LS1 | STORIES-PLAN: gate + LS1 (`catalog.ts`) |
| L14a overlay-core | client | merged `e5ce724` | L7, L11 | PUZZLES-PLAN, STORIES-PLAN (Home); META-PLAN: the meta overlay kinds |
| **LU1 meta-ui** | client | merged `2a7b50c` (new, META-PLAN) | L14a (`screens.ts` kinds, `Toast`) | new |
| D1 docs-authoring | doc | merged `dbcd170` | L3c, L5, LW3, LS1 | PUZZLES-PLAN, STORIES-PLAN (stories authoring); META-PLAN: the meta authoring part if LM1 merged first |
| L14b overlay-menus | client | to go | L10, L14a | PUZZLES-PLAN, STORIES-PLAN (picker, the end); META-PLAN: the card button, the end's second action, the hint keys |
| **LS4 stats-client** | client | to go (new, STORIES-PLAN) | L10, LS3 | new; META-PLAN: `choice_made`, `settle` |
| **LMD meta-data** | client | to go (new, META-PLAN) | LS4 (serialized `api/` files), LF2 (the meta DTOs and their samples) | new |
| N1 demo-story | narrative | to go | D1, LW3, LS1. Changed by META-PLAN: + LM1 (`story/meta.json` and `catalog/meta`) | PUZZLES-PLAN, STORIES-PLAN (story `manor`, two endings); META-PLAN: ending titles, achievements |
| **N2 story-tide** | narrative | to go (new, STORIES-PLAN) | N1 (shared story files), LS1, L5 | new; META-PLAN: ending titles, achievements |
| **LP2 puzzle-ui** | client | to go | L10, L14b, LW2 | PUZZLES-PLAN; META-PLAN: `HintPort \| null` |
| **LX explore-ui** | client | to go | L11, L14b, LW2 | PUZZLES-PLAN (∥ LP2: disjoint locks) |
| L15 integration | client | to go | every lane above (N1 and N2 included: the e2e plays both stories). Changed by META-PLAN: every lane above except L9 and the META-PLAN lanes (LE1, LF1, LM2, LF2, LE2, LU1, LMD; LM1 is in through N1) | PUZZLES-PLAN, STORIES-PLAN (stories wiring, `stories.spec.ts`); META-PLAN: `choice_made`, `hints: null` |
| **LMI meta-integration** | client | to go (new, META-PLAN) | L15, LMD, LU1, LE2 | new |
| D2 docs-final | doc | to go | L15. Changed by META-PLAN: LMI, L9; revision 1: LPO | PUZZLES-PLAN, STORIES-PLAN; META-PLAN: the meta rows and runbooks |

There are 38 lanes: 12 merged, 2 running, 24 to go (changed by RULINGS 22, 23; it read "10 merged, 1 running, 1
paused, 26 to go"); 6 are new from PUZZLES-PLAN, 3 (LDB0, LDB1, LDB2) from RULINGS 14/17 and 5 (LS1–LS4, N2) from
STORIES-PLAN. Changed by META-PLAN: there are 47 lanes — 14 merged (L6b `698993e`, L3c `91e35cd`), none running, 33 to go; 9
(LE1, LF1, LM2, LF2, LE2, LM1, LU1, LMD, LMI) are new from META-PLAN. Changed by META-PLAN revision 1 (W4): 48 lanes,
34 to go; LPO is the tenth new lane. Changed by RULINGS 54 (as of `6043941`): 48 lanes — 29 merged, 2 running (L10, LE1),
17 to go.

**Launch preference** when several lanes are ready (critical path first; changed by STORIES-PLAN):
- client (two slots): L3c (running), L5, L11, LS1, L7, L12, LW3, L14a, L10, L13, L14b, LP2 ∥ LX, LS4, D1, N1, N2, L15,
  D2;
- server: L6b (running), LS2, L6c, L8a, L8b, LS3, L9 (changed by RULINGS 22, 23: LDB1 and LDB2 merged).
- Changed by META-PLAN: client: L3c (merged `91e35cd`), L5, L11, LS1, L7, L12, LW3, L14a, LM1 ∥ D1, LU1, L10, L13, L14b, LP2 ∥
  LX, LS4, N1, N2, L15, LMD, LMI, D2; server: LS2, L6c, L8a, L8b, LS3, LE1, LF1, LM2, LF2, LE2, LPO (revision 1), L9. If LM1 has not
  merged when LF1 ends, the server slot idles or takes a disjoint doc / client lane until it does (LM2 needs its
  fixture).
- Changed by RULINGS 54 (as of `6043941`; merged lanes dropped): client: L10 (running), L13, L14b, LP2 ∥ LX, LS4, N1,
  N2, L15, LMD, LMI, D2; server: LE1 (running), LF1, LM2, LF2, LE2, LPO, L9. LM1 has merged, so LM2 waits only for LF1.

After L9 the server slot takes doc / narrative / client lanes with disjoint locks.

**Critical path** (changed by STORIES-PLAN):
- The server chain L6b (running) → **LS2** → L6c → L8a → L8b, then L10 → L14b → LP2 → L15 → D2 (changed by RULINGS
  22, 23: LDB1 merged, so the chain starts at L6b). LS2 adds one lane.
- The client chain L3c → L5 → L11 ∥ (LS1 → L7) → L14a reaches L14b long before L10 does, so L14b waits for the server
  chain.
- LS4 (← LS3 ← L8b, and ← L10) runs beside L14b → LP2: LS3 sits before L9 so that LS4 needs two lanes after L8b
  against the three of L10 → L14b → LP2 (SQ4).
- The narrative chain L6b → LS1 → LW3 → D1 → N1 → N2 → L15 is six lanes against the eight of the server chain from
  L6b, if LS1 and LW3 start as soon as their gates merge.
- LW3 also waits for L6b (its commit 3 red reads L6b's `server/tests/fixtures/content/puzzles/ch1.json`), and LS1 for
  the same reason (`server/tests/fixtures/content/stories.json`). L6b is the first server lane after LDB1.

The puzzle work adds one lane to the critical path (LP2), the stories work one more (LS2); everything else runs
beside them.

**Changed by META-PLAN — the critical path.**
- The prototype milestone is unchanged: L15 is reached by LS2 → L6c → L8a → L8b → L10 → L14b → LP2 → L15 (L15 no
  longer waits for L9 or any META-PLAN lane).
- The whole plan's critical path is now the server chain: LS2 → L6c → L8a → L8b → LS3 → **LE1 → LF1 → LM2 → LF2 →
  LE2** → LMI → D2 (twelve lanes). During L10 → L14b → LP2 → L15 (four client lanes after L8b) the server slot runs
  LS3, LE1, LF1, LM2; LF2 and LE2 follow, then LMI: the meta work adds about three lane-times after L15. L9 runs
  beside LMI; D2 waits for both. Revision 1 (W4): LPO (2 commits) runs before L9 in the same slot, beside LMI; D2
  waits for all three, so the path grows only if LPO + L9 outlast LMI.
- LMD (← LS4, LF2) runs beside LE2; LU1 (← L14a) and LM1 (← LW3, beside D1) are off the critical path unless LM1 is
  late for LM2.

**Changed by RULINGS 54 — the critical path as of `6043941`.**
- The prototype milestone: L10 (running) → L14b → LP2 → L15.
- The whole plan: the server chain LE1 (running) → LF1 → LM2 → LF2 → LE2, then LMI → D2; LPO → L9 run in the server
  slot beside LMI, and D2 waits for them. LMD (← LS4, LF2) runs beside LE2. LM1 and LU1 have merged.

### Lanes

Notation:
- **Lock** — the lane's paths.
- **Commits** — in order, with the red-first per commit, or "red-first impossible: <why>".
- **Gates** — the acceptance gates, beyond the CLAUDE.md gates that exist on the tree.
- **Seen working** — how the result is observed.

#### L1 client-shell (client)
- **Goal:** the client package with every pinned dependency; `ci`/`check`/`test`/`build` work and were seen red; a
  placeholder tap screen renders.
- **Lock:** `client/package.json`, `client/package-lock.json`, `client/tsconfig.json`, `client/tsconfig.node.json`,
  `client/svelte.config.js`, `client/vite.config.ts`, `client/index.html`, `client/src/main.ts`,
  `client/src/ui/App.svelte`, `client/src/arch.test.ts`, `client/scripts/budget.ts`, `client/scripts/budget.test.ts`,
  `client/scripts/scan-dist.ts`, `client/scripts/scan-dist.test.ts`, `.gitignore` (15).
- **Commits:**
  1. Package (all deps of the table), tsconfigs, svelte/vite config (`assetsInlineLimit: 0`, `sourcemap: false`,
     `manifest: true`), `index.html` with the TWA tag first, `main.ts`, `App.svelte` placeholder.
     - Red-first impossible: no runner yet.
     - Gates `ci`, `check` — seen red on a seeded type error and a seeded Svelte warning.
  2. vitest config (projects `unit`/`dom`) + `arch.test.ts`.
     - Before adding the file: `vitest run` exits 1 "No test files found" (quoted).
     - Red-first: seeded `height: 100vh` in `App.svelte` → `arch: forbidden patterns` fails naming the file.
  3. `budget.ts` pure `evaluate(inputs, limits) -> Row[]` + tests. Red: synthetic 300 KB entry → FAIL row. The engine
     row's PENDING / FAIL rule (Budgets) is here from the start. Red: `budget: engine row fails when dynamic entry
     missing` (inputs: `engineSourceExists: true`, a manifest with no dynamic entry) — predicted red: a PASS row at
     0 KB.
  4. `budget.ts` CLI (`--dist`). Red: a synthetic oversize dist → exit 1.
  5. `scan-dist.ts` + tests. Red: base64 data URI with a fingerprint; `.map`; `Compilation failed`; `__TG_DEV_MOCK__`.
  6. `build` = `vite build && budget && scan`; `.gitignore` with all generated paths.
- **Gates:** `ci`, `check`, `test` (names: `arch: *`, `budget: *`, `scan: *`), `build`.
- **Seen working:** `npm --prefix client run dev` → http://localhost:5173 shows the placeholder; `build` prints the
  budget table (the engine row PENDING).

#### L2 server-skeleton (server)
- **Superseded by LDB1 (RULINGS 12; changed by RULINGS 14, decision section 6).** The SQLite text below is this
  merged lane's history; the PostgreSQL port is LDB1 (`fee9da7`), its cut `D:/tmp/novel-orch/design/db/decision.md` §5.2.
- **Goal:** the cargo workspace; the server boots, migrates SQLite in WAL, serves `/api/health`; fmt/clippy/test
  seen red.
- **Lock:** `Cargo.toml`, `Cargo.lock`, `clippy.toml`, `.env.example`, `server/Cargo.toml`,
  `server/src/{main.rs,lib.rs,config.rs,error.rs}`, `server/src/db/mod.rs`, `server/src/api/mod.rs`,
  `server/migrations/0001_init.sql`, `server/tests/it/{main.rs,common.rs,schema.rs}` (15).
- **Commits:**
  1. Workspace (`resolver = "3"`, lints, profiles, every server dep), crate, config, error, `/api/health`.
     - `config.rs` and `.env.example` are complete here, so no later lane edits them: `BOT_TOKEN`, `WEBHOOK_SECRET`,
       `TOKEN_KEY`, `TOKEN_TTL_SECS` (1800, 900–3600), `INITDATA_MAX_AGE_SECS` (86400), `PUBLIC_APP_URL`,
       `ADMIN_TELEGRAM_IDS`, `STATIC_DIR` (optional), `CONTENT_DIR`, `DATABASE_PATH`, `TELEGRAM_ENV` (`prod` |
       `test`: the Bot API base, L8a), `LISTEN_ADDR` (default `127.0.0.1:8787`).
     - `error.rs` holds every `ApiError` variant, `ErrorCode` and the `IntoResponse` mapping, except
       `SaveConflict(SaveSummary)`, `ApiErrorBody.current` and the `TS` derives, which L6a adds.
     - Red-first impossible: no tests yet.
     - Clippy seen red on a seeded `unwrap()`.
  2. DB pool (WAL, `busy_timeout`, FKs), `0001_init.sql`, `it/common.rs` (temp-file DB helper), `schema.rs`.
     - `AppState::new(cfg)` (the one constructor, lane rules; L2's fields `repo` and `cfg`, the private field,
       `StartupError` `Db` / `Migrate`) opens the pool and migrates; `main.rs` serves through it.
     - `it/common.rs`: `test_config(&TempDir)` sets every config field (`DATABASE_PATH` a temp file; `CONTENT_DIR` =
       `server/tests/fixtures/content/`, resolved from `CARGO_MANIFEST_DIR`, absent until L6b fills it), and
       `test_state()` returns `AppState::new(test_config(..))`. No later lane edits these two.
     - Red-first: `schema_charge_id_unique` before the migration → "no such table: payments".
  3. `no_dynamic_sql` (scans `server/src` for `AssertSqlSafe` / `format!` next to `query`). Red: seeded
     `AssertSqlSafe`.
  4. `wal_mode_on_file_db` (`PRAGMA journal_mode` = `wal`).
- **Gates:** fmt, clippy, test (names: `schema_*`, `wal_mode_on_file_db`, `no_dynamic_sql`).
- **Seen working:** `cargo run -p server` with `.env.example` values → `curl http://127.0.0.1:8787/api/health` → `ok`.

#### L3a staging-dsl (client)
- **Goal:** `parseTags` and the typed commands; the asset catalog and cast; the source classifier and the source-level
  lint rules; the doc two-way test.
- **Lock:** `client/src/story/{staging.ts,tags.ts,tags.test.ts,catalog.ts,dsl-doc.test.ts}`,
  `client/scripts/story/{classify.ts,classify.test.ts,lint.ts,lint.test.ts}`, `assets/catalog.json`,
  `story/cast.json`, `docs/STAGING-DSL.md` (fixes only) (12).
- **Demo catalog (fixed here; N1 writes within it):**

  | Kind | Assets |
  |---|---|
  | bg | `room`, `street`, `cafe` (ch1); `archive` (ch2 only → paid tier) |
  | chars | `ally` {neutral, smile, worried, angry}, `stranger` {neutral, smile, serious} |
  | cg | `letter` (ch1); `reveal` (ch2 only) |
  | bgm | `calm`, `tension` (ch1); `mystery` (ch2 only) |
  | sfx | `door`, `phone`, `steps` |
  | cast | `ally`, `stranger`, `voice` (no sprite) |
- **Commits:**
  1. Types + grammar. Red: tests against a stub `parseTags` returning `[]` → assertion failures, not module errors.
  2. Catalog + `AssetIndex`. Red: `unknown-asset` test.
  3. `dsl-doc.test.ts`. Red: a seeded missing heading.
  4. `classify.ts`. Red: fixture lines classified wrongly by a stub.
  5. `lint.ts` — the source rules of §11 (`tag/*`, `id/*` except `duplicate`-across-chapters, `speaker/*`, `choice/*`,
     `text/*`, `ink/forbidden|name|include|entry`, `vars/global-prefix`). Each code red on an inline fixture;
     `ink/forbidden` has one fixture per construct, including a tunnel (`-> k ->`, `->->`), a knot parameter
     (`=== k(x) ===`) and a `LIST`.
- **Gates:** `check`, `test` (every `lint: <code> red on fixture` name present).
- **Seen working:** `npx vitest run src/story scripts/story --reporter=verbose` lists every rule by name.

#### L4a server-auth (server)
- **Superseded by LDB1 (RULINGS 12; changed by RULINGS 14, decision section 6).** The SQLite text below is this
  merged lane's history; the PostgreSQL port is LDB1 (`fee9da7`), its cut `D:/tmp/novel-orch/design/db/decision.md` §5.2.
- **Goal:** `POST /api/auth`; the token and the `AuthUser` extractor.
- **Lock:** `server/src/{ids.rs,clock.rs,lib.rs}`, `server/src/auth/{mod.rs,initdata.rs,token.rs,extract.rs}`,
  `server/src/db/{mod.rs,users.rs}`, `server/src/api/{mod.rs,auth.rs,dto.rs}`, `server/tests/it/{main.rs,auth.rs}`,
  `server/tests/fixtures/{sign_initdata.mjs,initdata_vectors.json}` (16; two are fixtures). Erratum (RULINGS 9 Q5):
  `db/mod.rs` is not a one-liner — it gains `pub mod users;` and the RULINGS 7 b `synchronous=FULL` change (with the
  `wal_mode_on_file_db` expectation in `it/schema.rs`). Per RULINGS 7 c, `it/common.rs` joins the lock for the
  `CARGO_TARGET_TMPDIR` change. Config fields and error variants come pre-declared from L2. `keys` and `clock` are added inside
  `AppState::new` in `lib.rs` (lane rules), so `main.rs` and `it/common.rs` stay untouched.
- **Commits:**
  1. Fixtures from an independent Node `crypto` signer (`sign_initdata.mjs`, run once and committed): valid, with
     `signature`, tampered, missing hash, expired, future, reordered, encoded values, duplicate key, unknown field.
  2. `initdata.rs`. Red: every vector test fails against a stub returning `Err(Malformed)`.
  3. `token.rs`. Red: `token_roundtrip` on a stub.
  4. Extractor + `/api/auth` + users upsert + `dto.rs` (serde DTOs; the `TS` derive arrives in L6a); `AppState`
     gains `keys` (from `TOKEN_KEY`) and `clock` (the system clock) inside `AppState::new`, plus `with_clock`, which
     the token-expiry tests call in `it/auth.rs`. Erratum (RULINGS 9 Q1/Q5): L4a has no bearer-protected production
     route, so the extractor's red runs on a **test-only router** in `it/auth.rs`, against an accept-all stub
     extractor. "404 before the route" applies only to `POST /api/auth`. The 16 KB default body limit
     (`DefaultBodyLimit::max(16 * 1024)` on `api::router()`, with a 413 test) is L4a's (RULINGS 7 e).
- **Gates:** fmt, clippy, test.
- **Seen working:** `curl -X POST /api/auth` with a vector from the fixtures → a token; a tampered one → 401
  `initdata_invalid`.

#### L4b server-dev (server)
- **Superseded by LDB1 (RULINGS 12; changed by RULINGS 14, decision section 6).** The SQLite text below is this
  merged lane's history; the PostgreSQL port is LDB1 (`fee9da7`), its cut `D:/tmp/novel-orch/design/db/decision.md` §5.2.
- **Goal:** the `server-dev` crate with `/dev/launch` (dev-signed initData, the real validator).
- **Lock:** `Cargo.toml` (members), `Cargo.lock`, `server/dev/Cargo.toml`, `server/dev/src/{lib.rs,main.rs,launch.rs}`,
  `server/dev/tests/dev.rs` (7).
- **Commits:**
  1. Crate (lib + bin targets: `lib.rs` = `build_dev_app(DevPaths)` + `pub mod`s; `main.rs` deletes and passes
     `target/e2e/dev.db`, binds `127.0.0.1:$DEV_API_PORT`, default 8787; `tempfile` as a dev-dependency) + router
     merge; `tests/dev.rs` builds every app through one `dev_app()` helper on its own `tempfile` DB.
     - The state comes from `server::AppState::new` with a dev `Config` built from `DevPaths`. `main.rs` passes
       `server/content/` as `content`; `dev_app()` passes the test fixture `server/tests/fixtures/content/` (lane
       rules), so L6b's content loading needs no edit here.
     - Red-first: `launch_signs_valid_initdata` (in `tests/dev.rs`, through the lib target and `oneshot`, no port)
       fails with 404 before the route.
     - Red-first: `dev_app_uses_given_db_path` (build with a temp path; the DB file must exist there) — predicted red:
       the file is absent, because the app opened `target/e2e/dev.db`. Quoted on a stub `build_dev_app` that ignores
       its argument (without the parameter the test does not compile).
  2. `/dev/launch` redirect format (R1 §5b hash keys).
  3. The complementary `server_has_no_dev_routes` (the `server` router answers 404 on `/dev/launch`) lives in L6b,
     whose lock holds `server/tests/it/`; this lane asserts only that the dev app has the route.
- **Gates:** fmt, clippy, test.
- **Seen working:** `cargo run -p server-dev` (with the lane's `DEV_API_PORT`), open
  `http://127.0.0.1:$DEV_API_PORT/dev/launch` → a 302 whose hash holds `tgWebAppData`.

#### L3b story-compile (client)
- **Goal:** `npm run story` compiles every chapter of `story/chapters.json`, lints, builds the knot graph (with the
  carried stage per knot), emits free and paid outputs, and writes `fingerprints.lines.json`; skeleton ch1 (free) and
  ch2 (paid) pass; the dev server's `/@fs` isolation is gated.
- **Lock:** `client/scripts/story.ts`, `client/scripts/story/{compile.ts,graph.ts,emit.ts,build.test.ts}`,
  `client/src/story/catalog.ts`, `client/scripts/{scan-dist.ts,dev-server.test.ts}`, `client/package.json` (scripts),
  `story/{chapters.json,common/globals.ink,ch1/main.ink,ch2/main.ink}` (13).
- **Commits:**
  1. `compile.ts` (inkjs `Compiler` from `inkjs/full` in scripts only; own file handler resolving INCLUDEs relative
     to the entry dir [R4 §2.1]; warnings are errors). Red: a fixture with a broken divert → `ink/compile`.
  2. `graph.ts` (successors, reachability, `graph/*` including `graph/entry-below-top`, `ink/forbidden` variable
     diverts; the carried stage per knot — the `budget/knot-set` definition in Budgets, clears read from the opening
     tag lines that `classify.ts` reports). Reds:
     - an unreachable-knot fixture;
     - `graph: carry propagates until cleared` (knot A shows bg + 2 characters + a CG, B only swaps an expression, C
       opens with `scene`, D has its `scene` on a tag line after its first text line) — predicted red: an empty
       `carried` set for B (and for D);
     - `lint: graph/entry-below-top red on fixture` (knot J shows a bg and a sprite and diverts `-> k.s` past k's
       opening `# scene:`; stitch s has no staging; a second case diverts to a labelled gather `-> k.g`; an
       intra-knot `-> k.s` written inside k is not flagged) — predicted red: no finding, with `carried(k)` = ∅,
       which `budget/knot-set` would pass.
  3. `emit.ts`:
     - routing free → `client/src/story-gen/free/`, paid → `server/content/chapters/`;
     - `catalog.json`, `meta.json` (`storyVersion` = sha256[0..16]), `usage.json` (with `carried`),
       `fingerprints.lines.json` (`lineIds`, `texts` with at least one sample per paid chapter); never
       `fingerprints.assets.json` (L5's);
     - the `paid/leak` check.
     - Red: a fixture paid chapter routed into story-gen → `paid/leak`.
  4. `story.ts` CLI + `package.json` `story` and the `build` chain; the skeleton story (a few lines per chapter with
     IDs, `g_` carry, `-> END`).
     - Red: `story` with an empty `chapters.json` → `catalog/chapters` "0 chapters".
  5. `scan-dist.ts` reads `fingerprints.lines.json`; per-section non-vacuous checks. Red: paid chapter declared,
     fingerprints missing; `scan: paid chapter with empty line-ID section fails` (a non-empty
     `fingerprints.assets.json`, an empty `lineIds`) — predicted red: PASS.
  6. `dev-server.test.ts`: `dev server refuses /@fs paid path` and `dev config: fs.allow stays inside client/`
     (Paid-content protection). Red: in a scratch copy, `server.fs.allow: ['..']` → 200 with the probe body
     (quoted), then reverted.
- **Gates:** `check`, `test`, `story` (prints `ch1 free … ch2 paid …`), `build`.
- **Seen working:** `npm --prefix client run story` lists both chapters; `server/content/chapters/ch2/story.json`
  exists; `rg ch2\. client/dist` finds nothing.

#### L3c story-locales (client)
- **Goal:** `--fix-ids`, `--sync-locales`, the locale checks, the global duplicate-ID check, the seeded playthroughs;
  skeleton en tables.
- **Lock:** `client/scripts/story/{fix.ts,locales.ts,playthrough.ts,play.test.ts,locales.test.ts}`,
  `client/scripts/story.ts`, `story/locales/en/{ch1.json,ch2.json}`, `story/locales/{ru,en}/story.json`,
  `story/retired-ids.txt`, `story/lint-allow.json` (12). Changed by RULINGS 19 Q1, Q2 (as merged, `91e35cd`): the lock
  gains `client/scripts/story/{build.test.ts,emit.ts}` (14).
- **Commits:**
  1. `fix.ts` `--fix-ids`. Red: a fixture without IDs → the IDs written, the existing ones untouched.
  2. `locales.ts` (`loc/*`, `id/duplicate` across chapters, `id/retired`). Red: one fixture per code.
  3. `playthrough.ts` (200 seeds, mulberry32, step cap, `onError` fails, ch2 with ch1 carries, `play/*`). Red: a loop
     fixture → `play/step-cap`; an unvisited-ending fixture.
  4. Skeleton en tables + story.json (names, titles).
- **Gates:** `test`, `story` (the coverage report lists seeds and endings per chapter).
- **Seen working:** `npm --prefix client run story` reports `ch1: 200 runs, knots 3/3, endings 1/1`.
- **Changed by STORIES-PLAN (re-cut; paused at `5d12aa3`, RULINGS 20).** The lane's own cut
  (`D:/tmp/novel-orch/l3c-story-locales/cut.md`, v2, 14 files, C1–C5) stays the plan, with one change:
  - **C1** (`fix.ts`) and **C2** (`locales.ts`) are committed and survive verbatim: chapter ids stay `ch<N>` and
    game-unique (STORIES-PLAN Y1), so the owner rule, the ID shape and the per-chapter tables are unchanged.
  - **C3** (skeleton tables, stage 5, names, `--sync-locales`) and **C5** (the en-table emission): as cut. The
    `stories` / `teasers` sections of `story.json` arrive with LS1.
  - **C4** (`playthrough.ts`): `ChapterPlay.carries` holds one `{ knot, vars }` per ended run, where `knot` is the
    knot whose `-> END` ended the run, so LS1 can drop runs that ended in a declared story ending from the next
    chapter's carry. `story.ts` reads `.vars`. Red (with the C4 tests, against the C4 stub that returns bare
    snapshots): `play: carries name the knot each run ended in` — predicted red: the carry entry has no `knot`.
  - Seen working unchanged (RULINGS 19): `ch1: 200 runs, knots 2/2, endings 1/1`.
- **As merged (`91e35cd`, RULINGS 19 Q3, RULINGS 27; the cut `D:/tmp/novel-orch/l3c-story-locales/cut.md` Q8):** the
  commits ran in the order pure modules, then tables + wiring, then playthrough, then the en emission: C1 `fix.ts`
  `--fix-ids` (`87ee7cf`); C2 `locales.ts` + `syncLocales`, pure, not wired (`5d12aa3`); C3 the skeleton tables,
  stage 5, names from the tables and `--sync-locales` (`e71d069`); C4 `playthrough.ts`, stage 6, the play gate and
  `lint-allow.json` (`80888e5`); C5 the en-table emission through `emit.ts` (`523a117`); then the review fix
  `afb9e2f` (the CLI test asserts the emitted en tables). The numbered list above is the pre-cut plan.

#### LW1 puzzle-dsl (client; new, PUZZLES-PLAN)
- **Goal:** DSL v2 — the `puzzle` and `explore` yield tags in the one parser, the yield-block lint, the narrowed
  `-> DONE` ban, `props` in the staging snapshot; STAGING-DSL.md updated and two-way checked. PUZZLES-PLAN X1, "Staging
  DSL additions".
- **Gate to start:** L3a merged. It may run beside L3b (disjoint locks).
- **Lock:** `client/src/story/{staging.ts,tags.ts,tags.test.ts,dsl-doc.test.ts}`,
  `client/scripts/story/{lint.ts,lint.test.ts,graph.ts}`, `docs/STAGING-DSL.md` (8; `graph.ts` for the two
  `assetOf` case labels its exhaustive switch needs, RULINGS 16 Q1).
- **As merged (`86d0a90`, RULINGS 16):** the commits ran in the order lint → parser + doc → the LW3 code registry
  (the order below would leave red commits); every red-first below was still observed. The LW3 codes are registered in
  `LINT_CODES` without an emitter.
- **Commits:**
  1. `staging.ts`: `PuzzleLocalId`, `SectionId`, `PropId`, `Rect`, `PropPlacement`, the two command kinds,
     `YieldCommand`, `PropsCommand`, `StagingSnapshot.props` and the frozen `EMPTY_SNAPSHOT.props = []`. `tags.ts`
     parses `puzzle:<id> then=<knot>` (`then` required) and `explore:<section>`, with the §7 conflicts (one yield per
     batch).
     - Red: `tags: puzzle and explore parse`, `tags: puzzle without then is missing-arg`,
       `tags: two yields in one batch conflict` — against the L3a parser, predicted red: `unknown-kind` errors.
  2. STAGING-DSL.md: the version line → DSL v2; §6 headings `puzzle` and `explore` (syntax, placement, validation,
     typed result, an example yield block); §7 conflicts; §8 knot index (yield edges; section knots excluded from the
     preload `next`); §10 (`-> DONE` only after a yield line); §11 codes (`yield/shape`, plus the LW3 codes listed as
     "enforced from LW3").
     - Red: `dsl-doc: headings equal parser kinds` with the parser kinds added and the doc not yet edited — predicted
       red: "doc lacks: puzzle, explore".
  3. `lint.ts`: `yield/shape` — the tag alone on a tag-only line, next source line `-> DONE`; `-> DONE` elsewhere stays
     `ink/forbidden`.
     - Red: `lint: yield/shape red on fixture` — fixtures: a yield tag on a text line; a yield line followed by text; a
       `-> DONE` with no yield above. Plus the control: a valid yield block passes, where the L3a lint reports
       `ink/forbidden`.
- **Gates:** `check`, `test` (names above, plus every L3a `lint: *` still green).
- **Seen working:** `npx vitest run src/story scripts/story --reporter=verbose` lists the new names; STAGING-DSL §6
  renders both headings.

#### LW2 world-model (client; new, PUZZLES-PLAN)
- **Goal:** the pure world layer that the runtime and the story tool share (X3, X4):
  - world types and decoders;
  - the two puzzle rules modules;
  - `WorldState` + `reduce` / `actions` + `project` + `reconcile`;
  - the soft-lock model checker;
  - the pure-module arch rule.
- **Gate to start:** L3a, LW1 merged (it uses `PropId`, `Rect` and the branded ids in `staging.ts`).
- **Lock:** `client/src/world/{types.ts,decode.ts,decode.test.ts}`,
  `client/src/puzzles/rules/{code.ts,order.ts,index.ts,rules.test.ts}`,
  `client/src/explore/{state.ts,reduce.ts,project.ts,reconcile.ts,explore.test.ts}`,
  `client/scripts/story/{softlock.ts,softlock.test.ts}`, `client/src/arch.test.ts` (15).
- **As merged (`38bc717`, RULINGS 21; the cut `D:/tmp/novel-orch/lw2-world-model/cut.md` §6 Q1-Q8 and its addendum):**
  - **Commit order (Q1).** The commits ran rules before decode: C1 `world/types.ts` + `puzzles/rules/*` (`bb40e12`),
    C2 `decode.ts` (`ef8e943`), then state/reduce (`fcde8a7`), one refactor (`e85392e`: `sectionKey` as one joined
    string, same semantics), project/reconcile with the rules golden (`ddbb270`), softlock (`5d3fa73`) and arch
    (`0305000`). `decodeWorldSource` decodes `params` through `PUZZLE_RULES[type].decodeParams` and `toServer`
    needs `answerShape`, so the order below would leave a red commit; every red-first below was still observed.
  - **PE7 (Q2).** `RULES_VERSION = 1` in `explore/reduce.ts`; the golden `reduce: rules golden pinned to
    RULES_VERSION` (edge digest over a demo-shaped fixture, an append-only table keyed by version). LW3 hashes
    `{ rules: RULES_VERSION, body }` (PUZZLES-PLAN, Open questions PE7).
  - **Signatures (Q3).** Every pure function takes `WorldPublicBody`; only `reconcile` takes `WorldPublic`.
  - **The arch rule `pure-world` (Q4)** is transitive: the pure files P plus their pure dependencies
    D = `story/{staging,catalog,tags}.ts`; it bans DOM, network, storage, clock and random globals, `svelte`
    imports, and any value import outside P ∪ D. It binds L5 (which appends to `catalog.ts`) and any later editor of
    `tags.ts`. Names: `arch: pure world modules`, `arch: pure-world red on fixture`, `arch: pure-world allows
    fixtures`.
  - **Fill-ins (Q5) and the addendum (C1, W1, developer decisions):** PUZZLES-PLAN "World data" (schema
    strictness), "World state and the reducer contract" (`sectionKey` sets; "The points the rules leave open") and
    "TS types — changes to existing modules" (`WorldIssue`). C1 added `reduce: an action that changes no state keeps
    its effects`.
  - **`world/linear-requires` (Q6)** holds by construction (no item field on puzzles); LW3 keeps it registered
    without an emitter.
  - **Timing (Q7)** is provisional (50-58 ms quiet-like, 130-158 ms beside LDB1's cargo; budget 75 ms):
    `RESUME_STATE_CAP` stays 5,000; re-measure on a quiet machine before LX / L13 rely on it (PUZZLES-PLAN X9 "The
    cost").
  - **Names (Q8).** 50 new names (client 202 → 252) joined `baseline.tsv`.
- **Commits:**
  1. `world/types.ts` + `decode.ts`: `decodeWorldSource`, `decodeWorldPublic` (which refuses `solution` / `hints`
     and requires `version`), `toPublic` (returns the body without `version`; LW3's emit stamps it), `toServer`. The
     types carry `take.then` and `lock.onOpen` (optional, default `[]`) (changed by PUZZLES-PLAN revision 1: W2, W5).
     - Red: `decode: every schema issue reported` — a fixture with 4 faults expects 4 issues; predicted red against a
       first-error stub: 1 issue.
     - Red: `decode: public refuses solution and hints`.
  2. `puzzles/rules/*` (`PUZZLE_RULES.code`, `.order`).
     - Red: `rules: code validateSolution rejects out-of-range`, `rules: order solution must be a permutation`,
       `rules: solution equal to initial rejected`.
  3. `explore/state.ts` + `reduce.ts` (`reduce`, `actions`, `successors`, `sectionKey`, `RESUME_STATE_CAP` = 5,000).
     Changed by PUZZLES-PLAN revision 1: the tap rule (a fully slotted lock with no outcome reopens its puzzle, W1),
     `take.then` and `onOpen` once (W2), a `tap` refused while `pendingStory` is non-empty (W4), and the successor
     relation (a `puzzle` effect expands to `closed` plus its outcomes, W1). Changed by PUZZLES-PLAN revision 2:
     `sectionKey` (the one dedup key of both searches; abstracts `examined` / `visited` / attempts / hints, ignores
     `section` / `lastRoom` and other sections) replaces `reachesLeave`, and `RESUME_STATE_CAP` is the one section
     cap of the build and the runtime (W1). Changed by PUZZLES-PLAN revision 3 (W1): `WorldState.unproved` (a set of
     section ids, `[]` in `EMPTY_WORLD_STATE`); no reducer rule reads or writes it, and `sectionKey` ignores it.
     - Red, the reducer-rule names of PUZZLES-PLAN "Test strategy" (`reduce: take moves item to held once` …
       `reduce: tap on a filled unsolved lock reopens its puzzle`, `reduce: take runs its then once`,
       `reduce: lock opening runs onOpen once`, `reduce: tap while an event is pending is refused`,
       `actions: enumerates enabled taps and inserts`) — against a reducer stub that returns the state unchanged.
     - Red: `successors: puzzle effect expands to closed and outcomes` — predicted red on a `successors` stub that
       expands a `puzzle` effect into its outcomes only: no `closed` successor. A different red (a missing outcome)
       means the stub is not the seeded one.
  4. `project.ts` + `reconcile.ts` (`reconcile(w, s, knots, savedVersion)` → `{ state, dropped, reset }`, with
     `resetSection`, `sectionEntry`, `inSectionReach`, and `admitSection` (changed by PUZZLES-PLAN revision 3, W1);
     PUZZLES-PLAN X9).
     - Red: `project: writes only declared vars`, `project: puzzle outcome codes`, `reconcile: unknown ids dropped`,
       `reconcile: missing room falls back to section start`, `reconcile: missing pending knot dropped`.
     - Red (changed by PUZZLES-PLAN revision 1, W5): `reconcile: same world version returns the state unchanged`,
       `reconcile: changed slot shape returns the items to held`, `reconcile: unprovable state restarts the section`,
       and `reconcile: renamed held item keeps the section exitable` — predicted red against a drop-only reconcile
       (step 1 alone): the returned state is not in the section's entry-reachable set (`inSectionReach` → `'no'`)
       and `reset` is null.
     - Red (changed by PUZZLES-PLAN revision 2, W2): step 4 is membership, `inSectionReach` from `sectionEntry`;
       `resetSection` sets `section` = null, `room` = null, removes `lastRoom[S]`.
       - `reconcile: a dead end reachable from the reconciled state restarts the section` — the lever / altar /
         shrine fixture, a v1 save reconciled against v2. Predicted red against a step 4 that asks only for a path to
         a `leave` from the reconciled state: `reset` is null. A different red (the section restarts, but the kept
         fields are wrong) means steps 1–3 are off, not step 4.
       - `reconcile: reset section fires the start room's onEnter on resume` — a start room whose `onEnter` gives
         the item its only exit needs; a reconcile that resets; then `reduce(enter-section S)`. Predicted red against
         a `resetSection` that keeps `section` = S: no `got` effect, and the item is not held. A different red (no
         `room` effect) means the `enter-section` entry branch is broken.
     - Red (changed by PUZZLES-PLAN revision 3, W1): step 5 and `admitSection(w, s, S)`. After a version change
       every section other than the current one joins `unproved`; `admitSection` enters it with `reduce`, runs
       `inSectionReach` on the entered state, and on `'no'` / `'cap'` emits a `reset` effect and returns
       `sectionEntry`. `resetSection` also removes S from `unproved`. The fixture world is the round-3 triage's: one
       section `house` with rooms `hall` (start) and `vault`; `hall.to_vault` a zero-slot lock with no puzzle;
       `hall.to_garden` a `leave` into knot `garden`, which yields `# explore: house` again. In v1 the object
       `hall.lever` has `then: [unlock hall.to_vault]`, `hall.k` takes `K`, and `vault.to_hall` has no lock. In v2
       the lever is gone, `hall.k`'s `then` is `[unlock hall.to_vault]`, and `vault.to_hall` has a one-slot lock
       that accepts `K`. Both versions pass `world/softlock`.
       - `reconcile: a section left through a leave restarts on re-entry after a version change` — the v1 state
         after the lever and the `leave` (`section` = null, K untaken), reconciled to v2, then
         `admitSection(v2, …, house)`. Expected: a `reset` effect and the `sectionEntry` state (`hall.to_vault`
         not open). Predicted red against the current-section-only reconcile (no step 5, so the entry is plain
         `reduce`): no `reset` effect; the entered state keeps `hall.to_vault` in `open` with K untaken, so
         `inSectionReach(v2, …, house)` answers `'no'`, and a BFS from it reaches the vault dead end. A different
         red (the reset happens but `hall.to_vault` stays open) means `resetSection` does not clear S's keys.
       - `reconcile: a version change marks every other section unproved and keeps the current section and room` —
         the same house progress saved from inside a second section `yard` (current, in its room), reconciled to
         v2. Expected: `reset` null, `section` = `yard` and `room` unchanged, `unproved` = [`house`]. Predicted red
         against the current-section-only reconcile: `unproved` empty. Against a load-time loop over every section
         with the current `resetSection` (the rejected alternative): `section` and `room` null.
  5. `scripts/story/softlock.ts`: BFS over `successors` (closed puzzles included) from `sectionEntry(w,
     EMPTY_WORLD_STATE, S)`, deduplicated by `sectionKey`; the property is "every reachable state reaches a `leave`
     effect"; the counterexample path is printed; capped at the imported `RESUME_STATE_CAP` (changed by
     PUZZLES-PLAN revision 2, W1: the same start, key and cap as the resume search; the 200,000 cap is gone).
     - Red: `softlock: lock needing an unreachable item fails` — predicted red on a stub with no findings: PASS.
     - Also red: `softlock: fail branch without unlock fails`, `softlock: state cap is an error`.
     - Red (changed by PUZZLES-PLAN revision 2, W1): `softlock: section above RESUME_STATE_CAP fails the build` — a
       fixture section whose state count lies above 5,000 and below 200,000 (the triage's hub: a hall with exits to
       5 rooms, 8 `take` items, one 8-slot gate as the only `leave`; 83,200 states in the triage model). Predicted
       red on a checker capped at 200,000: PASS (no `world/state-cap`). A different red (a `world/softlock`
       finding) means the fixture is not solvable, not that the cap is wrong.
     - Control: `softlock: solvable section passes`.
  6. `arch.test.ts`: `arch: pure world modules` (no `document`, `window`, `fetch(`, `localStorage` or `svelte`
     imports in `src/world/`, `src/explore/{state,reduce,project,reconcile}.ts`, `src/puzzles/rules/`).
     - Red: a seeded `document.title` in `reduce.ts` in a scratch tree; the failing file is quoted.
- **Gates:** `check`, `test` (every name above).
- **Seen working:** `npx vitest run src/world src/explore src/puzzles scripts/story/softlock --reporter=verbose`.
  Plus (changed by PUZZLES-PLAN revision 2, W1) the time of one full `inSectionReach` enumeration of a fixture
  section with about 5,000 states, recorded on a quiet machine (X9 cost estimate: ≈ 75 ms unthrottled, so
  ≤ 300 ms at CPU 4×). Over that → lower `RESUME_STATE_CAP` in this lane.

#### L6a server-saves (server)
- **Goal:** saves with `rev` and `writeId`; ts-rs bindings with the staleness test (auth + saves DTOs).
- **Lock:** `server/src/db/{mod.rs,saves.rs}`, `server/src/api/{mod.rs,dto.rs,saves.rs}`,
  `server/src/{lib.rs,error.rs}`, `server/tests/it/{main.rs,saves.rs,bindings.rs}`,
  `client/src/api/generated/api.ts` (11). `error.rs`: `SaveConflict(SaveSummary)`, `ApiErrorBody.current`, the `TS`
  derives.
- **Commits:**
  1. Saves repository + routes. Red: `saves_create_then_conflict` gets 404 first.
  2. Write-id idempotency: the one retry contract of the HTTP API table (same `writeId` as the stored row → 200 with
     the stored rev, no write). Red: `saves_retry_same_write_id_ok` gets 409.
  3. `saves_other_user_404`, `saves_body_too_large_413`, `saves_bad_slot_400`.
  4. `#[derive(TS)]` on every DTO + `ts_bindings()` (`decl()` per type; verify the 12.0.1 API) + `api.ts` +
     `bindings_are_fresh` / `write_bindings` (`#[ignore]`). Red: add a DTO field without regenerating.
- **Gates:** fmt, clippy, test; client `check` passes with the generated file.
- **Seen working:** `cargo test -p server --test it saves_` lists the saves tests by name.

#### L6b server-content (server)
- **Goal:** entitlements with catalog prices; `ContentStore`; the paid chapter and asset routes; the catalog
  contract; proof that the production router has no dev routes.
- **Lock:** `server/src/db/{mod.rs,entitlements.rs}`, `server/src/api/{mod.rs,dto.rs,entitlements.rs,content.rs}`,
  `server/src/{lib.rs,catalog.rs,content.rs}`, `server/catalog.json`,
  `server/tests/it/{main.rs,content.rs,catalog.rs}`, `client/src/api/generated/api.ts`, plus the test fixture
  directory `server/tests/fixtures/content/**` (14 + the fixtures). `content` and `catalog` are added inside
  `AppState::new` in `lib.rs` (lane rules), so `server/src/main.rs`, `server/dev/src/lib.rs`, `it/common.rs` and
  `server/dev/tests/dev.rs` stay untouched.
- **Commits:**
  1. Catalog + entitlements route. Red: `entitlements_lists_catalog_prices` (404 before the route).
  2. `ContentStore` (startup load into memory, asset file index; loaded inside `AppState::new`, a failure is
     `StartupError::Content`) + chapters/assets routes + the fixture content under `server/tests/fixtures/content/`
     (the paid chapter of every `server/catalog.json` product, laid out like `server/content/`), which every test
     `Config` already names. Red:
     `paid_chapter_403_without_entitlement` (404 before the route); `asset_path_traversal_404`;
     `paid_responses_private_no_store`.
  3. `paid_chapter_200_with_entitlement` (entitlement row inserted by the test through `db/`; changed by RULINGS 26
     (as merged, `698993e`; cut Q1 b): a raw row inserted by SQL in the test, never through `db/`, since a `db/`
     insert would be a grant path outside the `charge_id` insert),
     `free_chapter_not_served_by_api`, `server_has_no_dev_routes`.
  4. `catalog_matches_story_chapters`; `startup_fails_when_product_has_no_content`. Red: a fixture catalog with an
     extra product.
  5. Regenerate `api.ts`.
- **Changed by PUZZLES-PLAN (re-cut).** The lock gains `server/src/ids.rs` (adds `PuzzleId` only, PE1) → 15 files +
  fixtures. The scope gains:
  - the `server/catalog.json` format of PUZZLES-PLAN "Server formats": `chapters[]` + `hints.priceStars` / title /
    description templates, PLACEHOLDER prices;
  - `ContentStore` loads `content/puzzles/<ch>.json` (`PuzzleDef`) and paid worlds
    (`content/chapters/<ch>/world.json`);
  - `ChapterPayload.world`;
  - `Catalog::{product, chapters, prereqs}` with hint-tier products derived from the puzzle index;
  - `/api/entitlements` lists chapter products only;
  - the fixtures `server/tests/fixtures/content/puzzles/{ch1,ch2}.json` (ch1 free, ch2 paid; 3 tiers each) and a ch2
    `world.json`.

  Commit 1's red adds `entitlements_lists_chapters_only` (a fixture with hint tiers; predicted red: hint products
  listed). A new commit, between 4 and 5:

  4a. Puzzle index + hint products + startup checks.
     - Red: `catalog_prices_every_hint_tier` (fixture `priceStars: [1, 1]` against a 3-tier puzzle) — predicted red:
       startup succeeds.
     - Red: `hint_invoice_titles_within_limits` (a 30-char puzzle title) — predicted red: no `StartupError::Content`.
- **Gates:** fmt, clippy, test; client `check`.
- **Seen working:** `cargo test -p server --test it content_ catalog_` by name; `curl` with a dev token → 403 for
  `GET /api/chapters/ch2`.
- **Changed by STORIES-PLAN (re-cut; same lock, 15 files + fixtures).** STORIES-PLAN Y6:
  - `ids.rs` adds `StoryId` beside `PuzzleId` (same derives as `ChapterId`, plus `TS`; `parse` checks
    `^[a-z][a-z0-9_]{0,23}$`).
  - `ContentStore` loads `content/stories.json` (`ServerStoryIndex`, STORIES-PLAN "Server formats") into `stories()`,
    `story(id)`, `story_of(chapter)`; a missing or invalid index is `StartupError::Content`.
  - `server/catalog.json` `chapters` becomes `{ defaultPriceStars, priceStars, title, description }` (templates
    `{chapter}`, `{story}`; PLACEHOLDER price 1, Q3); chapter products = every paid chapter of the index with its
    `productId`; `/api/entitlements` lists them (`ProductDto` unchanged). This replaces the PZ per-chapter entries.
  - Fixtures: `server/tests/fixtures/content/stories.json` (two stories: `manor` ch1 free / ch2 paid with endings
    `truth`, `ashes`; `tide` ch3 free / ch4 paid with `drowned`, `dawn`), paid content for ch2 and ch4, puzzle
    indexes for ch1–ch4 (ch3, ch4 empty). LS1's emit test reads `stories.json`, so its shape is the contract.
  - **Commit 1's red** adds `entitlements_lists_every_paid_chapter_of_every_story` (predicted red: only `chapter:ch2`
    listed, from the per-chapter catalog entry).
  - **New commit 4b** (after 4a): the story index and its startup checks.
    - Red: `startup_fails_without_story_index` (fixture dir copy without `stories.json`) — predicted red: startup
      succeeds.
    - Red: `startup_fails_when_first_chapter_paid` (the index with ch3 paid) — predicted red: startup succeeds.
    - Red: `chapter_invoice_titles_within_limits` (a 33-character chapter title) — predicted red: no
      `StartupError::Content`.
    - Also: `story_index_loaded` (`story_of(ch4)` = `tide`), `catalog_default_price_applies_to_every_paid_chapter`,
      `catalog_price_override_must_be_paid_chapter` (an override for `ch3` → `StartupError::Content`).
  - **Seen working** (SQ1): by test names only. Until LS1 merges no tool emits `server/content/stories.json`, so
    `server-dev` does not start on generated content; the live 403 check moves to L7's e2e (and L15).
- **As merged (`698993e`, RULINGS 26; the cut `D:/tmp/novel-orch/l6b-server-content/cut.md` Q1, Q3):**
  - **Commit order (Q1 a).** Chapter products derive from the story index (Y6), so the index precedes the catalog:
    C1 the id grammars in `ids.rs` (`e8f15de`); C2 `ContentStore` (commit 2's loader + 4b's story index + 4a's puzzle
    index, `501750e`); C3 the catalog and `GET /api/entitlements` (commits 1, 4, 4b's price checks, `7ef5b60`); C4
    the paid chapter and asset routes (commits 2's routes + 3, `b4bdbce`); C5 the bindings (commit 5, `5eeaaf4`). The
    predicted reds above that assume a per-chapter catalog ("only `chapter:ch2` listed", "hint products listed")
    describe states this tree never had; they were observed as C3 mutations, plus the 404 parent red.
  - **The catalog (Q1 c)** is compiled in (`include_str!`, `server/src/catalog.rs:15`), with the test-only
    `AppState::with_catalog` (`server/src/lib.rs:88`): `Config` has no catalog path.
  - **`AppState::new` order (Q1 d).** The content loads before the database opens (`server/src/lib.rs:62-65`).
  - **Asset owners (Q3)** come from the paid `assets.json` manifests (an `/api/assets/<file>` URL → that chapter's
    product), not from `asset-owners.json`, which no server code reads (L5 dropped it, RULINGS 30).

#### LS2 server-story-saves (server; new, STORIES-PLAN)
- **Goal:** saves keyed by story (STORIES-PLAN Y7): the `saves` table of `0001` rewritten with `story_id`, the routes
  `/api/saves/{storyId}/{slot}`, the story checked against the `ContentStore` index, `SaveSummary.storyId`.
- **Gate to start:** L6b merged (the story index, `StoryId`). LDB1 is merged before L6b, so the `0001` this lane
  rewrites is LDB1's PostgreSQL file (collision lock `0001`: L2 → LDB1 → LS2).
- **Lock:** `server/migrations/0001_init.sql`, `server/src/db/{mod.rs,saves.rs}`,
  `server/src/api/{mod.rs,dto.rs,saves.rs}`, `server/tests/it/{main.rs,saves.rs,schema.rs}`,
  `client/src/api/generated/api.ts` (10). Changed by RULINGS 28 (as merged, `a358ec3`): the lock gains
  `server/src/error.rs` (11) for `SaveConflict(Option<Box<SaveSummary>>)` and the one `into_response` line that
  unboxes it, since `SaveSummary.storyId` makes the unboxed error trip `clippy::result_large_err`; the wire form and
  `api.ts` do not change. `server/dev` has no saves code (no dev file in the lock); no new `.rs` file.
  The edit to an existing migration rebuilds the crate through `migrate!`'s `include_str!`; `server/build.rs` is not
  needed yet (L6c adds it for the new `0002`).
- **Commits:**
  1. `0001` saves rewrite (`story_id`, `saves_pkey (user_id, story_id, slot)`, `saves_story_id_shape`) + every
     `db/saves.rs` function keyed by story + the routes `/saves/{storyId}/{slot}` (the 300 KB body limit moves with
     them) + every existing `it/saves.rs` test on the new paths (names kept).
     - Red: `schema_saves_story_id_shape` (an insert with `story_id = 'Manor'` expects `("23514",
       "saves_story_id_shape")`) and `schema_saves_pk_per_story` (two stories, one slot → both rows; the same story
       twice → `("23505", "saves_pkey")`) — predicted red before the rewrite: `42703 undefined_column` (quoted).
     - Red: `saves_story_slots_independent` (`PUT /api/saves/manor/auto` then `PUT /api/saves/tide/auto`, both
       `expectedRev: null` → both 200, rev 1) — predicted red: 404 (no such route).
  2. Story validation through `ContentStore`.
     - Red: `saves_unknown_story_404` (`/api/saves/nope/auto`) — predicted red: 200 (stored under a shape-valid
       unknown story).
     - Red: `saves_chapter_outside_story_400` (`chapterId: ch3` under `manor`) — predicted red: 200.
     - Red: `saves_bad_story_id_400` (`/api/saves/Manor/auto`) — predicted red: 500 `internal` (the CHECK fires in
       the database instead of a 400 at the edge).
  3. `GET /api/saves` lists every story; `SaveSummary.story_id`.
     - Red: `saves_list_spans_stories` (rows of `manor` and `tide` → two summaries with `storyId`) — predicted red:
       the `storyId` key missing.
  4. `#[derive(TS)]` + regenerated `api.ts`. Red: `bindings_are_fresh` before regenerating.
  - Changed by RULINGS 29 (as merged, `a358ec3`; cut Q1): 3 commits. Commits 3 and 4 are one commit (C3 `eed33c0`),
    because every DTO already derives `TS` and the `SaveSummary` field turns `bindings_are_fresh` red at once; C1
    `be39e8d`, C2 `ed901be`.
- **Gates:** fmt, clippy, test (the names above plus every `saves_*` / `schema_save*` name of L6a and LDB1, counted);
  client `check` (no client code consumes `SaveSummary` yet: L10 is later).
- **Tester mutations:** the PK without `story_id`; the story check skipped; `chapterId` accepted from any story.
- **Seen working:** `cargo test -p server --test it saves_ schema_saves` lists every name (as merged, cut Q6: cargo
  takes one TESTNAME, so the second filter goes after `--`: `cargo test -p server --test it --locked -- saves_
  schema_saves`). Live `server-dev` + `curl
  PUT /api/saves/manor/auto` only if LS1 has merged (SQ1); a local `tgn_local` that applied the old `0001` is reset
  with `pgdev reset`, and the lane quotes sqlx's refusal first (verify: the 0.9 message for a modified applied
  migration).

#### L6c server-puzzles (server; new, PUZZLES-PLAN)
- **Goal:** server-checked puzzle attempts with a per-(user, puzzle) rate limit; puzzle status with hint tiers and
  owner-only hint texts; migration `0002`; the two new error codes (X5, X6, X7).
- **Gate to start:** L6b merged (ContentStore puzzle index, catalog hint products, `PuzzleId`; as merged `039a2f3`,
  RULINGS 36 Q11: "catalog hint products" reads "the `ContentStore` puzzle index", since RULINGS 25 removed the hint
  products). L6b itself waits for
  LDB1, so `0002` and every L6c statement are PostgreSQL (changed by PUZZLES-PLAN revision 4b, RULINGS 14). Changed by
  STORIES-PLAN: LS2 merged too (the serialized server files `api/mod.rs`, `api/dto.rs`, `db/mod.rs`, `api.ts`,
  `it/main.rs`); the scope is unchanged (STORIES-PLAN Y17).
- **Lock:** `server/migrations/0002_puzzles.sql`, `server/build.rs`, `server/src/{lib.rs,error.rs}`,
  `server/src/puzzles/mod.rs`, `server/src/db/{mod.rs,puzzles.rs}`, `server/src/api/{mod.rs,dto.rs,puzzles.rs}`,
  `server/tests/it/{main.rs,puzzles.rs}`, `client/src/api/generated/api.ts` (13). `AppState` gains no field.
  `error.rs` is a lock addition (PE2).
- **Commits:**
  1. `0002_puzzles.sql` + `server/build.rs` (`cargo:rerun-if-changed=migrations`).
     - Red: `schema_puzzle_progress_pk` before the file → `relation "puzzle_progress" does not exist` (SQLSTATE
       `42P01`, quoted; changed by PUZZLES-PLAN revision 4b).
     - Also: `schema_puzzle_window_check` (`window_attempts > attempts` refused with
       `("23514", "puzzle_progress_window_bounded")`); `schema_puzzle_id_shape` (`ch1.drawer`, `ch12.medal_sun`
       accepted; `ch0.a`, `ch1x.a`, `ch1.a.b`, `ch1.a-b`, `ch1.Drawer`, `ch1.1a`, `ch1.`, `ch1.é` refused with
       `("23514", "puzzle_progress_id_shape")`; changed by PUZZLES-PLAN revision 4b).
  2. `error.rs`: `RateLimited { retry_after_secs }` → 429 `rate_limited` + `Retry-After`; `HintUnavailable` → 409
     `hint_unavailable`. `api_error_maps_status_and_code` and `error_codes_serialize_snake_case` are extended.
     - Red: the new cases against a temporary mapping to 500 `internal` — predicted red:
       "expected (429 Too Many Requests, {"error":"rate_limited"}), got (500 …)".
  3. `db/puzzles.rs` (`record_attempt`: the write-first upsert + the guarded `solved_at`, one transaction; `is_solved`;
     `owned_products`).
     - Red: `attempt_rate_limited_after_20_in_window` on a stub that never limits — predicted red: the 21st call is not
       limited.
     - Also: `attempt_window_resets_after_600s` (fixed clock).
  4. `puzzles/mod.rs` (`check_answer`, `attempt`) + `POST /api/puzzles/{puzzleId}/attempts`.
     - Red: `attempt_correct_marks_solved` (404 before the route), `attempt_wrong_shape_400`,
       `attempt_paid_chapter_403_without_entitlement`, `attempt_unknown_puzzle_404`, `attempt_wrong_returns_false`.
  5. `GET /api/puzzles/{puzzleId}?lang`.
     - Red: `puzzle_hint_text_only_when_owned` (an entitlement row for tier 1 inserted through `db/`; tiers 2–3 must
       have `text: null`) — predicted red: 404 before the route, then texts for every tier on a stub that ignores
       ownership.
     - Also: `puzzle_status_private_no_store`, `hint_text_403_for_unowned_paid_chapter`.
  6. `#[derive(TS)]` on the DTOs + regenerated `api.ts`. Red: `bindings_are_fresh` before regenerating.
- **Gates:** fmt, clippy, test (names above); client `check`. Tester mutations: drop the `solved_at IS NULL` guard;
  check the answer before the window; serve `text` for unowned tiers; the old GLOB's translation
  `^ch[1-9].*[.][a-z]` as the id CHECK (predicted red: `schema_puzzle_id_shape` accepts `ch1x.a`, `ch1.a.b`,
  `ch1.a-b`; changed by PUZZLES-PLAN revision 4b).
- **Seen working:** `cargo test -p server --test it puzzle attempt schema_puzzle` lists every name above. Generated
  `server/content/puzzles/` exists only from LW3 on, so the live `curl` check (`POST /api/puzzles/ch1.drawer/attempts`
  → `{"correct":false,…}`; 21 quick calls → 429 + `Retry-After`) moves to L15's seen-working.
- **Changed by META-PLAN (re-cut; same lock, 13 files).** M21: hint tiers are unlocked from a balance, not bought.
  - **Commit 1:** `0002` also creates `hint_unlocks` (META-PLAN "SQL"). Reds: `schema_hint_unlocks_pk` (a second row for
    the same (user, puzzle, tier) → `("23505", "hint_unlocks_pkey")`; before the table: `42P01`, quoted),
    `schema_hint_unlocks_tier_range` (tier 0 and 4 → `("23514", "hint_unlocks_tier_range")`).
  - **Commit 2:** `error.rs` also declares `InsufficientBalance` → 409 `insufficient_balance` and `LimitReached` → 409
    `limit_reached` (used from LE1 and LF1 on; pre-declared here so the meta lanes need no `error.rs`); the two
    wire tests gain both cases (same predicted red: 500 `internal` on the temporary mapping).
  - **Commit 3:** `owned_products` is replaced by `unlocked_tiers(u, p) -> Vec<u8>` (`SELECT tier FROM hint_unlocks
    WHERE user_id = $1 AND puzzle_id = $2`).
  - **Commit 5:** `PuzzleStatus.hints` is `Vec<HintView { tier, unlocked, text }>` (`HintTier` with `productId` and
    `priceStars` is gone); `puzzle_hint_text_only_when_owned` becomes `puzzle_hint_text_only_when_unlocked` (a raw
    `hint_unlocks` row for tier 1 inserted by SQL in the test, never through `db/`: the only writer is LE1's spend;
    tiers 2–3 `text: null`) — same predicted reds.
  - **Tester mutation:** "serve `text` for unowned tiers" reads "for tiers without an unlock row".
- **As merged (`039a2f3`, RULINGS 36; the cut `D:/tmp/novel-orch/l6c-server-puzzles/cut.md` Q1-Q5, Q11):**
  - **Commits (Q1, Q2).** 7 commits, with `api.ts` regenerated in C2, C6 and C7: C1 `0002` + `build.rs` (`e1105c5`);
    C2 the error codes (`4bf4307`); C3 `db/puzzles.rs` (`e0510b9`); C4 the attempts route (`c1fb75b`); C5 the status
    route (`7cb58dc`); C6 the TS bindings (`a14ddb8`); C7 the `SaveListResponse` doc fix (LS2 review M2, `74ccaaa`).
  - **Names.** The schema tests live in `server/tests/it/puzzles.rs` as `puzzles::schema_*`. The lane added 17 names,
    all `puzzles::`: the five `schema_*` names above, the attempt and status names above (with
    `puzzle_hint_text_only_when_unlocked`), plus `attempt_concurrent_window_exact` and
    `attempt_limited_correct_answer_429_not_solved` (Q3).
  - **Seen working.** libtest takes several filters only after `--`:
    `cargo test -p server --test it -- puzzles:: bindings::`.
  - **`state_reopens_migrated_database`** (`server/tests/it/main.rs:187`) pins the applied migrations as a version
    list, not a count, so each migration lane moves it on purpose (`[1, 2, 3]` at `6043941`).
  - **Gate and outcome (Q4).** One gate, `puzzles::entitled_puzzle` (404 unknown, 403 not entitled), serves both routes
    and LE1's hint route; `attempt` and `status` take the gated `&PuzzleDef`; `AttemptOutcome` is
    `Answered { correct, solved } | RateLimited { retry_after_secs }` (`server/src/puzzles/mod.rs:76-145`).
  - **Solve time (Q5).** `SET solved_at = GREATEST($3, first_at)` (`server/src/db/puzzles.rs:68`), and `Retry-After`
    is clamped to `1..=600`. PUZZLES-PLAN "Rust types" and "SQL" carry both errata.

#### L5 asset-pipeline (client)
- **Goal:** `npm run assets` renders the placeholders, encodes AVIF + WebP with sharp, synthesizes WAV, writes the
  per-chapter manifests and tiers; the asset budget rows, seen red.
- **Lock:** `client/scripts/assets.ts`,
  `client/scripts/assets/{placeholder.ts,synth.ts,encode.ts,manifest.ts,assets.test.ts}`,
  `client/scripts/{budget.ts,budget.test.ts,scan-dist.ts,scan-dist.test.ts}`, `client/src/story/catalog.ts`,
  `client/package.json` (scripts), `assets/catalog.json` (13; `scan-dist.test.ts` is L1's file, serialized after L1).
  Changed by STORIES-PLAN revision 3 (W2, SQ9): + `client/src/story/tags.test.ts` → 14, a frozen file reopened for
  one hunk (the catalog-key pins; the last bullet of this entry), then frozen again.
- **Erratum (RULINGS 21 Q4; LW2 merged `38bc717`):** `client/src/story/catalog.ts` is a pure dependency of LW2's
  `pure-world` arch rule: L5's appends stay pure (no DOM, network, storage, clock or random global, no `svelte`
  import, no value import outside the pure set), or `arch: pure world modules` goes red.
- **Commits:**
  1. `placeholder.ts` (deterministic SVG: label, hue, silhouette for characters, canonical sizes). Red: snapshot of
     dimensions.
  2. `encode.ts` (sharp: resize clamp ≤ 2048, AVIF q50 effort 4, WebP q80, metadata dims). Red: a 4096 px input →
     clamp test.
  3. `synth.ts` (WAV header + PCM). Red: a header-bytes test.
  4. `manifest.ts`:
     - tiering (free if any free chapter uses the asset) → `client/public/assets/` or `server/content/assets/`;
     - `asset-owners.json` (changed by RULINGS 30, as merged `e21775b`: dropped, not produced);
     - `fingerprints.assets.json` (paid file names + content hashes; the asset tool's own file, never
       `fingerprints.lines.json`); `scan-dist.ts` reads it (file names and content hashes over every `dist/` file)
       with the per-section non-vacuity check, its paid-only trigger computed from `usage.json` +
       `story/chapters.json` (Paid-content protection);
     - `story/catalog.ts` gains `FetchAsset` / `AssetFetchError` next to `AssetRef` (used by L10, L11, L12).
       Changed by RULINGS 30 (as merged, `e21775b`; cut Q8): `AssetRef` did not exist, so L5 adds the manifest types
       of "Data model" (`AssetRef`, `AssetEntry`, `AssetManifest`, `decodeAssetManifest`) as well.
     - Reds:
       - a paid-only asset routed public → test failure;
       - `scan: paid asset bytes in dist fail` (in `scan-dist.test.ts`: a synthetic dist holding the paid AVIF under
         its own name, and a second one holding its bytes renamed) — predicted red: exit 0 on both dists before the
         reader exists; a name-only reader would still exit 0 on the renamed copy;
       - `scan: paid-only asset with empty files section fails` (`usage.json` + `chapters.json` show a paid-only
         asset; `files` and `asset-owners.json` empty, the single tiering fault; as merged, RULINGS 30: `files`
         empty) — predicted red: exit 0.
  5. Budget rows for assets + the knot working set (carried stage from `usage.json`, ≤ 32 MiB); `build` chain
     `story && assets && vite build && budget && scan`. Red: 4096 px; WAV without `placeholder`; a 60 MiB knot set
     (synthetic); `budget: knot-set counts carried stage` (knot B: `assets(B) ∪ assets(next(B))` = 17.4 MiB, under the
     cap alone; carried bg + CG + 2 sprites = 25.9 MiB → 43.3 MiB) — predicted red: a PASS row for B.
- **Gates:** `test` (names: `scan: paid asset bytes in dist fail`, `scan: paid-only asset with empty files section
  fails`), `build` (prints the asset rows).
- **Seen working:** `npm --prefix client run build`; open `client/public/assets/bg-cafe-*.avif`;
  `server/content/assets/bg-archive-*.avif` exists, absent from `dist/`.
- **Changed by PUZZLES-PLAN (re-cut; same lock, 13 files):**
  - **Catalog.**
    - The `prop` namespace in `decodeAssetCatalog` (`catalog.ts`), with an `AssetId` `prop/<id>`, ≤ 512×512.
    - Placeholder props: label + hue disc on transparent, 512×512.
    - The demo catalog additions of PUZZLES-PLAN "Demo content outline":
      - bg `hall`, `study`, `cellar`;
      - props `medal_sun`, `medal_star`, `note`;
      - cg `drawer` and `cabinet`, the latter used only by ch2 → paid tier.
  - **Tiering.**
    - `manifest.ts` tiers by `usage.json` ink assets ∪ `worldAssets` (the `worldAssets` section arrives with LW3).
    - A catalog asset that no chapter uses is skipped with a printed `asset unused: <id>`. It is never routed public,
      so the room art waits for N1's world.
  - **Budget rows (commit 5):**
    - "JS before the first line" ≤ 270 KB br (entry + engine closures), with "all JS" raised to ≤ 290 KB br.
    - The first-load row counts the two closures, not all JS.
    - World JSON per chapter ≤ 32 KB raw / 8 KB br.
    - Prop image ≤ 512 px, AVIF ≤ 60 KB, WebP ≤ 90 KB.
    - `budget/room-set`: per room, bg + props + max(largest neighbour bg, largest close-up) ≤ 32 MiB, from
      `usage.json` `rooms`. It FAILs when a chapter's `story/<ch>/world.json` has sections and `usage.json` has no
      `rooms` for it.
  - **Reds** (commit 5): `budget: room-set counts props and close-up` (bg 8.4 + close-up 8.4 + 16 props of 1 MiB =
    32.9 MiB; predicted red: a PASS row); a 1024 px prop; a world with sections and no `rooms` in usage.
- **Changed by STORIES-PLAN (re-cut; same lock, 13 files; revision 3 adds `tags.test.ts`, 14).** STORIES-PLAN Y15 and "Demo content outline":
  - **Catalog.** The `cover` namespace in `ASSET_ID_RE` and `decodeAssetCatalog` (`cover/<id>`, exactly 360×640);
    `CoverManifest` + `decodeCoverManifest` in `catalog.ts`; placeholder covers (label + hue, 9:16). Additions: covers
    `manor`, `tide`; story B's bg `shore`, `lighthouse`, `lamp_room`; char `keeper` (`neutral`, `worried`, `smile`);
    bgm `waves`, `storm`.
  - **Tiering.** Every `cover/*` asset is public whatever `usage.json` says (it is never "unused": Home shows it
    before any purchase), written to `client/public/assets/` with `client/src/story-gen/covers.json`. Story B's art
    follows the usual rule (unused until N2; `lamp_room`, `storm` paid-only then).
  - **Commit 1's red** adds `catalog: cover namespace decodes` (predicted red: `cover/manor` refused as an unknown
    namespace). **Commit 4's red** adds `assets: covers always public` (a cover no chapter uses; predicted red:
    `asset unused: cover/manor`, not emitted).
  - **Budget rows (commit 5):** cover exactly 360×640, AVIF ≤ 24 KB, WebP ≤ 36 KB; the first-load row becomes one
    row per story's first chapter — every free chapter that no `next` names, read from `story/chapters.json` (LS1's
    rule 3 makes these exactly the stories' first chapters) — each adding `catalog.json`, `covers.json` and the 3
    largest cover AVIFs. Reds: `budget: cover over 24 KB fails` (predicted red: no cover row); `budget: first-load row
    per story` (two chain heads, the second one's first knot over the limit; predicted red: one PASS row for ch1
    only).
- **Changed by STORIES-PLAN revision 3 (W2, SQ9): the catalog-key pins of `tags.test.ts`.**
  - **Why.** `catalog: demo catalog and cast decode` (`tags.test.ts:447-463` at main `a7e4a04`) decodes the committed
    `assets/catalog.json` (`?raw`, :3) and pins its keys exactly with `toEqual` on sorted keys (:450-458): bg
    `archive, cafe, room, street`; chars `ally, stranger` and their exprs; cg `letter, reveal`; bgm
    `calm, mystery, tension`; sfx `door, phone, steps`. Both re-cuts above add keys to that file (PZ: bg `hall`,
    `study`, `cellar`, cg `drawer`, `cabinet`; STORIES: bg `shore`, `lighthouse`, `lamp_room`, char `keeper`, bgm
    `waves`, `storm`), so the first L5 commit that adds a key turns `test` red. The file is frozen after LW1, and L5
    runs before LS1, so only L5 can take it.
  - **The hunk** (:450-458 only; in the L5 commit that first adds a key to `assets/catalog.json`, so that commit is
    green). Each of the six pins becomes a subset pin: the decoded keys, restricted to the pinned L3a list, `toEqual`
    that list. bg, chars, cg, bgm and sfx are restricted to their L3a keys; the exprs pin is restricted to `ally` and
    `stranger`, and each one's exprs to its L3a exprs. The expected values stay the L3a lists verbatim, and `toEqual`
    stays the matcher. No catalog addition, in L5 or in a later lane (N1, N2), can reopen the file. A removed or
    renamed L3a demo id still fails by name. Line 448 (`committedCatalog()`) and the cast assertion (:459-462, LS1
    commit 8's hunk) are not touched.
  - **Rejected:** an inline catalog fixture. It would change the `catalog` const of :448, which is also the input of
    LS1's cast hunk, so the two hunks would overlap. It would also drop the check that the committed catalog still
    holds the demo ids. **Trade-off:** an unintended extra key no longer fails this test. Each added key is still
    judged by L5's asset rows, and an asset no chapter uses prints `asset unused: <id>`.
  - **Red-first:** that catalog commit on the unchanged `tags.test.ts`. Predicted red: `catalog: demo catalog and
    cast decode` at :450, `expected [ 'archive', 'cafe', 'cellar', 'hall', 'lamp_room', 'lighthouse', 'room', 'shore',
    'street', 'study' ] to deeply equal [ 'archive', 'cafe', 'room', 'street' ]` (the received list is that commit's
    sorted bg keys; this one has both re-cuts' bg additions). The first failing `expect` ends the test, so the chars,
    exprs, cg and bgm pins fail only after the bg pin passes. Green after the hunk. A decode error from
    `committedCatalog()` instead means the catalog edit is malformed.
  - **The subset pin seen failing:** on a scratch copy of the hunk's tree, delete `bg.room` from
    `assets/catalog.json`. Predicted red: `expected [ 'archive', 'cafe', 'street' ] to deeply equal [ 'archive',
    'cafe', 'room', 'street' ]`. A green there means the restriction is vacuous.
  - **Gates:** `check`, `test` (`catalog: demo catalog and cast decode` green, by name).
- **As merged (`e21775b`, RULINGS 30; the cut `D:/tmp/novel-orch/l5-asset-pipeline/cut.md` Q3):** 8 commits, catalog
  first, the manifest types and the scan reader each in their own commit; every red-first above was kept. C1 the
  catalog (`prop` and `cover` namespaces, placeholder entries, the demo additions; `cc1e238`); C2 `placeholder.ts`
  (`d35568b`); C3 `encode.ts` (`211062f`); C4 `synth.ts` (`09f17f8`); C5 the manifest types, decoders and
  `FetchAsset` in `catalog.ts` (`9bc20f6`); C6 tiering, manifests, covers, fingerprints, the CLI and the build chain
  (`467cf1b`); C7 the `scan-dist` reader of paid asset files by name and content hash (`b3dab3a`); C8 the budget rows
  (`b819afd`).

#### LS1 story-catalog (client; new, STORIES-PLAN)
- **Goal:** the story list and its outputs (STORIES-PLAN Y2, Y4, Y5, Y18): `story/stories.json` and the
  `catalog/stories` lint; endings checked against the compiled graphs; `stories` in the public catalog, `endings` in
  every meta, the server story index; story titles and teasers in the locale tables; story-ending runs kept out of the
  next chapter's carry; the STAGING-DSL contract (no tag change).
- **Gate to start:** L3c (`story.ts`, `locales.ts`), L5 (`catalog.ts`, the `cover` namespace), L6b
  (`server/tests/fixtures/content/stories.json`, which commit 7's red reads) merged.
- **Lock:** `story/stories.json` (new), `client/scripts/story/{stories.ts,stories.test.ts}` (new),
  `client/scripts/story.ts`, `client/scripts/story/{emit.ts,build.test.ts,locales.ts,lint.ts}`,
  `client/src/story/{catalog.ts,dsl-doc.test.ts}`, `client/src/arch.test.ts` (STORIES-PLAN revision 1),
  `docs/STAGING-DSL.md`, `story/locales/{ru,en}/story.json` (14).
  `lint.ts` changes by one `LINT_CODES` line and `dsl-doc.test.ts` by its row count (SQ2: reopened for this lane,
  then frozen again). Fixtures are inline in the tests; `story/ch*/` is untouched.
  Changed by STORIES-PLAN revision 2 (W1): + `client/src/story/tags.test.ts`,
  `client/scripts/story/{lint.test.ts,locales.test.ts}` → 17. `tags.test.ts` and `lint.test.ts` are touched by
  commit 8 only: frozen files reopened for one hunk each (SQ2), then frozen again; `locales.test.ts` (L3c's) passes
  L3c → LS1 → LW3. Changed by STORIES-PLAN revision 3 (W1): `locales.test.ts` is touched by commits 4, 6, 7 and 8,
  one hunk each, except commit 7 (two hunks; changed by STORIES-PLAN revision 4, W1):
  - commit 4: the `stories` argument of the `locales()` helper's `checkLocales` call;
  - commit 6: the inline `story/stories.json`, plus the story's title and teaser, in its own `repoFiles()` temp repo;
  - commit 7: the story input and the story names of C5 test 35's `planEmit` call; and the moved pin
    `locales: matching tables raise nothing` (:291-298 at `5d12aa3`), whose `names` gains the two story sections;
  - commit 8: the inline cast.

  Commits 4 and 7 touch it because both new inputs are required fields. Every `LocaleInput` and `EmitInput` field
  is required today (`locales.ts:25-34`, `emit.ts:66-72` at L3c `5d12aa3`; `chapters` is required and nullable), and
  L3c C5 adds its `en` input the same way (L3c cut.md:545-559). An optional field would be the only one on either
  seam, and a caller that left it out would drop the story-title check or the story index with no compile error. The
  lock does not grow, because `story.ts` and `locales.test.ts` are already in it.

  The count is 2 over the ~15 guideline: the three files are fixture-input edits with no new behaviour, and a
  lane of their own would still serialize behind LS1 on `build.test.ts` and pay a full lane cycle for four hunks.
  LW3 (13 files, holding `build.test.ts` and `locales.test.ts`) would reach 15, but both plans state its scope as
  unchanged by stories, and the scratch proof would then wait for a puzzles lane.
- **Commits** (changed by STORIES-PLAN revision 1: reordered so that every commit is green on the real tree; each
  commit quotes `check`, `test`, `story` and `build` exit 0 on its own tree):
  1. `catalog/stories` registered + STAGING-DSL (header note, §4, §8, §9 "Chapters and stories", the §11 row;
     STORIES-PLAN "Staging DSL change").
     - Red: `LINT_CODES` and the count (85) changed first, the doc not yet — `dsl-doc: lint table equals lint codes`
       predicted red: `notInDoc: ['catalog/stories']` and "expected length 85, received 84" (quoted).
  2. `stories.ts` `decodeStories` (rules 1–7 of STORIES-PLAN "Source file").
     - Red, against a stub that returns `ok` with no findings: `stories: chapter in two stories fails`,
       `stories: chapter in no story fails`, `stories: paid first chapter fails`, `stories: next cycle fails`,
       `stories: first named by a next fails`, `stories: unknown cover fails`, `stories: bad story id fails`,
       `stories: unknown key fails` — predicted red: no finding for each.
  3. `checkEndings` (rule 8) and `checkInvoiceTitles` (rule 9). Changed by RULINGS 33 (as merged, `64fd798`; W1):
     rule 8 also requires that a chapter with a `next` keeps a `-> END` knot that is no story ending.
     - Red: `stories: ending knot must end the chapter`, `stories: ending knot with successors fails`,
       `stories: ending knot with a yield fails`, `stories: ending chapter outside the story fails`,
       `stories: two endings on one knot fail`, `stories: paid chapter title over 32 characters fails` — predicted
       red: no finding.
  4. `locales.ts`: `NAME_SECTIONS` + `stories`, `teasers`; the committed `story.json` tables gain both sections empty
     (`{}`, ru and en): the real tree lists no story until commit 6, so no key is required yet.
     - Red: `loc: story title and teaser required` (a story without a `stories` entry) — predicted red: no
       `loc/missing-name`. Changed by STORIES-PLAN revision 4 (W1): the test lives in `stories.test.ts` and builds
       its own `LocaleInput` (no chapters, an empty cast, `stories: ['manor']`, name tables whose `stories` /
       `teasers` sections lack `manor`). Green is four `loc/missing-name` (title and teaser, ru and en) and `names`
       null. `locales.test.ts` gains no test here, so its commit-4 hunk stays the one helper argument.
     - Changed by STORIES-PLAN revision 3 (W1): `LocaleInput` gains the story ids as a required field
       (`stories: readonly StoryId[]`, the ids whose title and teaser are required; see the lock note). In this
       commit its two callers on the post-L3c tree pass `[]`:
       - `story.ts`'s locale stage, because no story is listed until commit 6, which passes the decoded ids;
       - the `locales()` helper of `locales.test.ts` (:212 at `5d12aa3`).

       With no story id, no story key is required, so no `locales()` case moves. The cut greps for any other
       `checkLocales(` caller.

       Changed by STORIES-PLAN revision 4 (W1): this commit only requires the titles and teasers. The output of
       `nameChecks` keeps its two keys (`chapters`, `speakers`) here; the story sections enter `StoryNames` in
       commit 7, where `emit.ts` first reads them.
  5. `arch.test.ts`: the rule `import-outside-src` (group `boundary`; "Arch test rules"; STORIES-PLAN ST1). Every
     relative or `/`-rooted specifier of a non-test `src/` module — a static or dynamic import, an export-from, an
     `import.meta.glob` pattern, a `new URL(…, import.meta.url)` literal — resolved as `ui-imports` resolves it
     (`new URL(spec, 'file:///src/<file>')`) must stay under `/src/`; `import type` and `import('x').T` type queries
     are exempt (erased). Bare package specifiers are out of scope (they resolve into `node_modules`).
     - Changed by STORIES-PLAN revision 2 (W2): the rule judges every form by the files Vite 8.3.5 can pull in from
       it, or refuses it. Its reader is its own (`moduleReference`, :540-543 at main `a7e4a04`, keeps a dynamic
       `import()` argument only when `ts.isStringLiteralLike`, and stays as it is for the other rules):
       `importOrigins(node): readonly Origin[]`, with `Origin = { form: 'path'; spec: string } | { form: 'glob';
       pattern: string; base: string | null } | { form: 'opaque' }`.
       - `path` (a string literal or a substitution-free template): resolved as above; a `#`-headed spec is flagged.
       - `glob` from an `import()` whose argument is a template literal or a `+` join: the pattern Vite's
         `vite:dynamic-import-vars` derives (`templateLiteralToGlob` / `expressionToGlob`, `node.js:32847-32872`:
         quasis kept, each substitution `*`); from a template-literal `new URL(…, import.meta.url)`: the pattern of
         `vite:asset-import-meta-url` (`buildGlobPattern`, :27479; the rewrite to an eager `import.meta.glob`,
         :27423-27437); from `import.meta.glob(p, o)`: each element of `p` (a string or an array of strings; a
         `!`-headed pattern only excludes, so it is skipped) with `o.base`.
       - A glob resolves as `toAbsoluteGlob` (:28041-28060) resolves it: a `/`-headed pattern from the project root,
         ignoring `base`; a `./` or `../` pattern from `base` (a `/`-rooted base from the project root, a relative
         one from the importer's directory) or, without `base`, from the importer's directory. Its static head (the
         text before the first `*`, `?`, `[` or `{`) up to its last `/` must resolve under `/src/`, and no `..`
         segment may follow the first wildcard. A pattern headed otherwise (`**`, `#`, a bare name, which Vite hands
         to `resolveId`) is flagged, and so is an empty or `/`-less head.
       - `opaque`, always flagged: an `import()` argument that is neither a string, a template nor a `+` join; a
         `new URL` first argument that is neither a string nor a template; a non-literal `import.meta.glob` pattern;
         an options object that is not an object literal, has a spread or has a non-string `base`.
       - Out of scope, as before: bare package specifiers. `client/` has no `resolve.alias`, tsconfig `paths` or
         package `imports` today (triage r2 W2); an `imports` map is covered by the `#` refusal, an alias would be a
         `vite.config.ts` change outside this rule.
     - Red fixtures: `story/catalog.ts` importing `../../../story/stories.json`; an `app/` dynamic `import()` and an
       export-from of `../../../server/content/chapters/ch2/meta.json`; a `ui/` `.svelte` script importing
       `/story/stories.json?raw`; `import.meta.glob('../../../story/*/main.ink')`; `new
       URL('../../../server/content/stories.json', import.meta.url)`. Allow fixtures: `../story-gen/catalog.json`; an
       `import type` from `../../scripts/story/stories.ts`; a glob of `../story-gen/free/*.story.json`; `new
       URL('./x.ts', import.meta.url)`.
     - Red fixtures added by revision 2 (W2), each in an `app/` module:
       `` import(`../../../server/content/chapters/${id}/meta.json`) ``;
       `` new URL(`../../../server/content/${f}.json`, import.meta.url) ``;
       `import.meta.glob('./*.json', { base: '../../../server/content' })`; `import s from '#content/stories.json'`;
       `import(spec)` with a non-literal `spec`; `` import(`../story-gen/${x}/../../../server/a.json`) ``.
       Allow fixtures added, each in `story/catalog.ts`: `` import(`../story-gen/free/${id}.story.json`) ``;
       `import.meta.glob('./*.json', { base: '../story-gen/free' })`.
     - Red: the id in `RULE_IDS` / `GROUP` with its fixtures and no detector → `arch: import-outside-src red on
       fixture` — predicted red: "expected [] to include 'import-outside-src'" for the `story/catalog.ts` fixture. A
       compile error instead means a fixture table (`GROUP`, `RED`) was not extended.
     - Red (revision 2, W2): the detector reading string literals only (`moduleReference`'s reading) → `arch:
       import-outside-src red on fixture` — predicted red: "expected [] to include 'import-outside-src'" for each of
       the six revision-2 red fixtures, while the revision-1 red fixtures pass. An allow fixture flagged instead
       (`arch: import-outside-src allows fixtures` red) means the head or `base` resolution is wrong.
     - Real tree: `arch: import boundaries` stays green (at main `b6458c1` only `*.test.ts` files reference
       `../../../`, and the scan excludes them). Changed by STORIES-PLAN revision 2 (W2): at main `a7e4a04` no
       non-test `client/src` module contains `import(`, `new URL(` or `import.meta.glob` (only `arch.test.ts` does), so
       refusing the forms the rule cannot judge moves nothing; the cut repeats that search on its tree.
  6. `story.ts` and the skeleton, in the commit that makes `story/stories.json` mandatory: `stories.json` read after
     the catalog stage; endings checked after the graph; the story ids passed to the locale check; the report line
     `stories: manor (ch1 → ch2), endings 1`; the carry of chapter p into `p.next` drops the runs whose ended knot
     (L3c C4's `knot`) is a declared ending of p. The same commit adds the skeleton `story/stories.json` (one story
     `manor`: first `ch1`, cover `cover/manor`, ending `end` on ch2's knot `archive`), `manor`'s title and teaser in
     both committed `story.json` tables, and, in `repoFiles()` (build.test.ts:649-656), an inline `story/stories.json`
     (one story `manor`: first `ch1`, cover `cover/manor`, ending `q7_sealed_vault` on the fixture ch2's knot
     `drawer`; changed by STORIES-PLAN revision 2, W3: a name no free output can contain, see commit 7) with the
     fixture's title and teaser. Changed by STORIES-PLAN revision 2 (W1): only the stories fixture is inline here; the
     asset catalog is still read from the tree, and the cast is read from the tree until commit 8 makes it inline.
     Changed by STORIES-PLAN revision 3 (W1): `locales.test.ts` has its own temp-repo helper, `repoFiles()`
     (:378-391 at L3c `5d12aa3`), where L3c's CLI cases live (L3c cut D5). It gets an inline `story/stories.json` too:
     one story `manor`, first `ch1`, cover `cover/manor`, `endings: {}`.
     - The cover check passes because the helper copies the committed `assets/catalog.json` (:381), which holds
       `cover/manor` from L5 on.
     - The empty endings name no knot of L3c's `CH2_INK`.
     - `manor`'s title and teaser join the `stories` / `teasers` sections of the ru and en name tables in that
       helper's temp repo. They do not go into the `NAMES_RU` / `NAMES_EN` constants (:181-182), which the
       `locales()` unit helper also reads with `stories: []`.
     - Red: `story: missing stories.json fails the gate` — predicted red: exit 0.
     - Red (revision 3, W1; the proof for the `locales.test.ts` hunk): this commit without that hunk.
       - Predicted red: `story: catalog names come from the locale tables` (L3c C3 test 19, cut.md:366-367) fails
         reading the temp repo's `client/src/story-gen/catalog.json` (ENOENT).
       - The cause: the CLI run exits 1 on the missing-`stories.json` E, and emission runs only when there is no E
         (`story.ts:182` at main). No other CLI case of that file needs an emitting run.
       - Green with the hunk. If the CLI run's stdout also shows a `loc/missing-name` for `manor`, the stories file
         was added without the title and teaser.
     - Red: `story: a story-ending run does not carry into the next chapter` (fixture: ch1 has a declared ending knot
       `bad` that sets `g_x = 9` and a plain END; ch2 branches on `g_x`) — predicted red: ch2's playthrough reports
       runs carried from `bad` (`carriedFrom` counts them; the `g_x == 9` branch visited).
     - Real tree: `story` exit 0, printing the stories line. Every CLI case of both temp-repo helpers keeps its
       expectation: `repoFiles()` in `build.test.ts` (:649-656) and `repoFiles()` in `locales.test.ts` (:378-391 at
       `5d12aa3`; changed by STORIES-PLAN revision 3, W1).
  7. `emit.ts` + `catalog.ts`: meta `endings`; catalog `stories` (exact keys `stories`, `chapters`, `cast`);
     `server/content/stories.json`; `storyOf`; `story.ts` passes the story plans of commit 6 to `planEmit`.
     - Changed by STORIES-PLAN revision 3 (W1): the story-plans input of `EmitInput` is a required field, like every
       `EmitInput` field (see the lock note). It has three callers:
       - `story.ts` (above);
       - `emitFixture()`, which takes the one-story fixture of commit 6 (the moved pins below);
       - C5 test 35 `emit: en tables routed with their chapters` in `locales.test.ts` (L3c cut.md:565-569). Its call
         passes the one-story plan of its two chapters (`manor`, `ch1 → ch2`, `endings: {}`), with the title and
         teaser in its names.

       Test 35 asserts the en paths with `toContain`, the en keys as a subset and the en shape (cut.md:566-568).
       None of these reads the catalog or the story index, so no value of test 35 moves. Changed by STORIES-PLAN
       revision 4 (W1): one `locales.test.ts` pin does move, by the names input below.
     - Changed by STORIES-PLAN revision 4 (W1): the names input. `StoryNames` (`emit.ts:26-29` at L3c `5d12aa3`)
       gains `stories` and `teasers`, each `Record<StoryId, { ru: string; en: string }>` (STORIES-PLAN "TS types"),
       in this commit, where `emit.ts` first reads them: the catalog's `StoryEntry.title` / `teaser` and the server
       index's story `title`. A story without either throws `invariant: story <id> has a title` (or `… a teaser`),
       as `catalog()` does for a chapter title (`emit.ts:88-93`).
       - `nameChecks` (`locales.ts:188-208`) fills both sections for the `LocaleInput.stories` ids with the `pair()`
         lookups commit 4 added for the check. `checkLocales` stays the one reader of the name tables, and
         `story.ts` passes its `names` to `planEmit` unchanged.
       - Inputs that gain the keys (no assertion): `NAMES` in `build.test.ts` (:431-434) gets `manor`'s title and
         teaser. It is an `as StoryNames` cast, so a missing key is no compile error. Test 35's names input gets
         `manor`'s entries in `stories` / `teasers`, whatever C5 builds it from; the `locales()` helper itself keeps
         `stories: []`. Every `StoryNames` literal in `stories.test.ts` (commit 3's rule-9 cases) gains
         `stories: {}` and `teasers: {}`, and `check` names a missed typed literal.
       - Moved on purpose (`locales.test.ts`, L3c C2): `locales: matching tables raise nothing` (:291-298).
         - Old: `expect(r.names).toEqual({ chapters: …, speakers: … })`.
         - New: the same `chapters` and `speakers` values plus `stories: {}` and `teasers: {}` (the helper passes
           `stories: []`). `expect(r.findings).toEqual([])` stays.
       - Red-first: this commit without the pin's hunk. Predicted red: `locales: matching tables raise nothing`
         fails at :294 with the diff lines `+   "stories": {},` and `+   "teasers": {},`. vitest truncates the
         message line, so the prediction is keyed on the diff lines.
         - A diff line inside `chapters` or `speakers` instead means `nameChecks` changed the existing sections.
         - A `nameChecks` that does not fill the titles makes the emitting CLI cases of both `repoFiles()` helpers,
           and the real-tree `story` gate, fail on `invariant: story manor has a title`.
         - A `NAMES` without `manor` makes every `emitFixture()` caller fail on the same invariant.
       - Rejected: a separate `checkLocales` result field for the titles, merged into `EmitInput.names` in
         `story.ts`. It would hold one fact in two values with a second null rule, and `story.ts` would assemble an
         emit input from two halves. Also rejected: filling the sections in commit 4, because `StoryNames` would
         carry two sections that no reader uses for three commits, and commit 4's "no `locales()` case moves" would
         become false.
       - The cut greps for other exact pins on `checkLocales(…).names` (at `5d12aa3` only :294) and for other
         `StoryNames` literals.
     - Red: `emit: server story index matches the server fixture shape` (reads L6b's fixture) — predicted red: no
       `server/content/stories.json` planned.
     - Red: `emit: public catalog lists stories without endings`, `emit: meta carries endings`,
       `emit: paid endings only in server outputs` (a paid chapter's ending name must occur in no `story-gen` file)
       — predicted red: no `stories` key / no `endings` key.
     - Changed by STORIES-PLAN revision 2 (W3): the fixture's paid ending is `q7_sealed_vault`, because `end` already
       occurs in every free output (the meta key `"ending"`, from this commit `"endings"`, and ink's `"end"` control
       string in `ch1.story.json`, the fixture knot `cafe` ending `-> END`). `q7_sealed_vault` is valid under
       `EndingName`, holds a digit and `_`, so it is no ink control string, meta or catalog key, `storyVersion` hex
       or fixture word, and it occurs in no fixture source but `stories.json`. `emit: paid endings only in server
       outputs` asserts that the name is a substring of no planned `client/src/story-gen/` text and, as its control,
       that it occurs in the planned `server/content/chapters/ch2/meta.json`; the tester checks the test against the
       declared name.
     - Red: `catalog: meta without endings is malformed` (predicted red: accepted) and `catalog: catalog with stories
       decodes` (predicted red: `stories` reported as an unknown key).
     - Moved on purpose (build.test.ts at main `b6458c1`; the cut re-locates them by name on the post-L3c tree; the
       sixth, changed by STORIES-PLAN revision 4, W1, is in L3c's `locales.test.ts`). No assertion is dropped; the
       tester diffs these six against this list:
       - `emit: free and paid outputs are routed apart` (:491-501): the sorted plan keys gain
         `server/content/stories.json` (8 paths, last);
       - `emit: meta holds the knot index and the story version` (:513-535): the ch1 meta gains `endings: {}`, the ch2
         meta `endings: { drawer: 'q7_sealed_vault' }` (`emitFixture()` takes the one-story fixture of commit 6;
         the name changed by STORIES-PLAN revision 2, W3);
       - `catalog: emitted chapter catalog and meta decode` (:591-606): the decoded value gains `stories: [{ id:
         'manor', chapters: ['ch1', 'ch2'], cover: 'cover/manor', title, teaser }]` (the fixture's title and teaser);
       - `catalog: malformed meta is an error value` (:613-615): `good` gains `endings: {}` and still decodes; every
         malformed case keeps its path;
       - `story: cli builds a free and a paid chapter` (:746-760): the exact `server/` list gains
         `server/content/stories.json` (5 files, last); `CLIENT_OUTPUTS` stays the 3 files;
       - `locales: matching tables raise nothing` (`locales.test.ts:291-298` at L3c `5d12aa3`): `r.names` gains
         `stories: {}` and `teasers: {}` (the revision-4 names bullet above).
  8. Changed by STORIES-PLAN revision 2 (W1): the tool tests stop reading the committed cast, so N2's speakers move
     no test. Each file gets one inline raw cast, `{ ally: { char: 'ally' }, stranger: { char: 'stranger' }, voice:
     { char: null } }` (the cast the fixtures were written against), decoded against the committed asset catalog,
     which is still read from the tree. No assertion value moves; only inputs change. Lines are at main `a7e4a04` /
     L3c `5d12aa3` and re-located by name at the cut:
     - `build.test.ts`: `committed()` (:29-41) keeps the catalog, and every `COMMITTED.cast` use (:198, :237, :441,
       the `planEmit` of `emitFixture()` :453) takes the inline cast. `NAMES` (:431-434) already names exactly these
       three speakers, so `catalog: emitted chapter catalog and meta decode` keeps its cast pin (:600-604), now
       derived from the inline cast. `repoFiles()` (:649-656) writes the inline cast as `story/cast.json` instead of
       copying the committed file; L3c's `localeFiles()` names the same three speakers (L3c cut, "`build.test.ts`,
       fixture only"), so no CLI case gains a `loc/missing-name`.
     - `locales.test.ts` (L3c's; not traced by the triage, same defect): its `committed()` (:30-42), used by the
       `locales()` helper's `checkLocales` (:212) against the inline `NAMES_RU` / `NAMES_EN` (:181-182), and its
       `repoFiles()` (:379-391) take the inline cast in the same way.
     - `tags.test.ts` (frozen; reopened for this hunk, SQ2): the cast assertion of `catalog: demo catalog and cast
       decode` (:459-462) decodes the inline raw cast against the committed catalog, with the same expected value.
       The positive control `catalog: cast char must exist in the catalog` (:507, `.ok`) keeps the committed cast:
       it holds for any cast whose chars the catalog has. The catalog-key pins (:450-458) are not touched: L5 made
       them subset pins (changed by STORIES-PLAN revision 3, W2).
     - `lint.test.ts` (frozen; reopened for this hunk, SQ2): the clean control of `lint: catalog/assets red on fixture
       (cast char missing)` (:532-534) lints the committed catalog with the inline raw cast, with the same expected
       `clean.cast`. The other committed-cast reads (:516, :518, :524) are `some` / `toBeNull` checks that hold for
       any valid cast.
     - Red (the triage's proof): on a scratch copy of commit 7's tree, add `"keeper": { "char": "keeper" }` to
       `story/cast.json` and `keeper`'s names to both committed `story/locales/{ru,en}/story.json` (L5 has added the
       char `keeper` to the catalog), then run `npm --prefix client run test`. Predicted red: every `emitFixture()`
       caller fails with `invariant: speaker keeper has a name` (`emit.ts:95-100`); the `locales()` cases of
       `locales.test.ts` gain one `loc/missing-name` per name table for `keeper` (e.g. the exact location list of
       `lint: loc/missing-name red on fixture` gains two entries); the `build.test.ts` `repoFiles()` CLI cases that
       expect exit 0 exit 1 on `loc/missing-name` for `keeper`; the two exact cast pins (`tags.test.ts`,
       `lint.test.ts`) show `keeper` in the received value. The same probe on commit 8's
       tree: `test` exit 0 (quoted). A `catalog/assets` finding on `keeper.char` instead means the probe ran without
       L5's catalog: the probe is malformed, not the fix.
- **Gates:** `check`, `test` (every name above, plus every L3a/L3b/L3c `lint:` / `emit:` / `story:` name and every
  `arch:` name still green; the six pins of commit 7 moved exactly as listed), `story` (prints the stories line),
  `build`. Changed by STORIES-PLAN revision 2 (W1): `test` also exits 0 on commit 8's scratch probe (quoted).
  Changed by STORIES-PLAN revision 4 (W1): the sixth pin is `locales.test.ts`'s; the other five are in
  `build.test.ts`.
- **Seen working:** `npm --prefix client run story` prints `stories: manor (ch1 → ch2), endings 1`;
  `client/src/story-gen/catalog.json` has `stories` and no `endings` key (`rg '"endings"'
  client/src/story-gen/catalog.json` finds nothing); `server/content/chapters/ch2/meta.json` holds
  `"endings": { "archive": "end" }`; `server/content/stories.json` exists.
- **As merged (`64fd798`, RULINGS 31, 33; the cut `D:/tmp/novel-orch/ls1-story-catalog/cut.md` §1b-§1d and Q1-Q7,
  `impl.md`):**
  - **Line refs.** The line numbers above are at the trees they name; the cut's §1b re-locates each on `e21775b`.
  - **Lock (Q1).** 18 files: the 17 above plus `client/scripts/budget.test.ts`, for the two input-only `endings: {}`
    hunks in C7 (the `assetInputs()` literal and `REPO_META`; without them 14 baseline `budget:` names fail).
  - **Commits:** C1 `d157433`, C2 `3180ebb`, C3 `1f57b48`, C4 `5921785`, C5 `f6c3d3d`, C6 `8c20ccb`, C7 `3668a09`,
    C8 `6ccab4a`, in the order above.
  - **C1's red** takes two runs: `toHaveLength` fails before the `notInDoc` diff, so one run shows
    `notInDoc: [ 'catalog/stories' ]` and the other "a length of 85 but got 84" (F5).
  - **C2 (Q4).** `stories: ending chapter outside the story fails` (rule 7) moves from C3 to C2, which also adds
    `stories: bad ending name fails` (the `EndingName` grammar).
  - **C3 (W1).** Rule 8 gains a clause: a chapter with a `next` keeps a `-> END` knot that is no story ending, or no
    run could reach its successor. Its red is the sixth C3 name, `stories: chapter with a next and only story endings
    fails`. `checkEndings` takes a third input, `sources` (Q3; `client/scripts/story/stories.ts:219`), and
    `graph.ts` is untouched.
  - **C5's red** for the `story/catalog.ts` fixture reads `expected [ 'pure-world' ] to include
    'import-outside-src'`, because `story/catalog.ts` is a pure-world dependency (F6). The allow fixture
    `../story-gen/catalog.json` sits in a non-pure, non-`ui/` file such as `app/boot.ts` (F7).
  - **C6.** The stories stage runs only on a decoded, play-ordered chapter list (Q2). The carry red is the coverage
    line (`play: ch2: … knots 3/3 …` without the filter), since `carriedFrom` is `ChapterId | null` and counts
    nothing. The revision-3 red is not ENOENT: four `locales.test.ts` names fail on status or error counts (F9). The
    `lint: paid/leak red on fixture (story cli)` red of the `build.test.ts` proof is "no paid/leak line" (W2).
  - **C7.** The moved-pin counts are 10 / 6 / 4: `routed apart` has 10 sorted keys and `cli builds` 6 server files,
    `server/content/stories.json` last in both, and `CLIENT_OUTPUTS` stays 4 (L3c C5 added the en tables). Two
    input-only hunks: `emit: line fingerprints cover every paid line` passes a one-chapter story input (F10), and
    test 35 spreads `manor`'s title and teaser into its names (F12). The STORIES-PLAN seeded leak is seen red here.
  - **C8.** On the `keeper` probe, the `lint: loc/missing-name red on fixture` location list has 4 entries against 2
    expected (`impl.md`), as "gains two entries" above says.
  - **STAGING-DSL (Q5).** The single reopening (C1) also fixed the §4 table bullet and the §11 `loc/missing-name`
    text, and the §11 `catalog/chapters` row reads "names a later listed chapter or `null`".

#### LW3 story-world (client; new, PUZZLES-PLAN)
- **Changed by STORIES-PLAN:** gate to start + LS1 (`story.ts`, `emit.ts`, `build.test.ts`, `locales.ts` and, from
  revision 2, `locales.test.ts` are serialized L3c → LS1 → LW3); the scope is unchanged (worlds stay per chapter,
  STORIES-PLAN Y17). LW3's world texts join the same `locales.ts` checks LS1 extended.
- **Erratum (RULINGS 21 Q4, Q6; LW2 merged `38bc717`):** LW2's `pure-world` arch rule binds the pure modules LW3
  imports or extends (`world/**`, `puzzles/rules/**`, `explore/{state,reduce,project,reconcile}.ts`,
  `story/{staging,catalog,tags}.ts`): no clock, random, DOM or storage reads. `world/linear-requires` holds by
  construction (the decoder refuses a `requires` key), so LW3 keeps the code registered without an emitter.
- **Goal:** the story gate understands worlds:
  - the yield edges in the graph;
  - the world lint (`world/*`, `puzzle/*`, `explore/*`) and the soft-lock check;
  - the public/server split of `world.json` (`server/content/puzzles/<ch>.json`; hint text server-only);
  - world texts in IDs and locales;
  - seeded playthroughs through yields;
  - `scan-dist` hint and paid-world fingerprints from the sources (X4, X7, T7, T9).
- **Gate to start:** L3c, L5, L6b, LW1, LW2 merged (L5 for the `scan-dist.ts` serialization; L6b for
  `server/tests/fixtures/content/puzzles/ch1.json`, which commit 3's red reads — changed by PUZZLES-PLAN revision 1,
  W9). As merged (`be8ba8b`, RULINGS 42; cut Q14): met at the launch on `f81193b`.
- **Lock:** `client/scripts/story.ts`,
  `client/scripts/story/{graph.ts,emit.ts,locales.ts,fix.ts,playthrough.ts,world.ts,build.test.ts,play.test.ts,locales.test.ts,world.test.ts}`,
  `client/scripts/{scan-dist.ts,scan-dist.test.ts}` (13). Fixtures are inline in the tests; `story/` is untouched
  (N1 writes the real worlds). Changed by RULINGS 42 (as merged, `be8ba8b`; cut Q14, L5 cut Q2): the lock gains
  `client/scripts/assets/manifest.ts` for one hunk (`assetUsage()` maps `worldAssets` / `rooms`) → 14.
- **Commits:**
  1. `world.ts`: loads `story/<ch>/world.json` (`decodeWorldSource` → `world/schema`) and runs every `world/*` code of
     PUZZLES-PLAN "Lint codes" that needs no compiled story (catalog refs, frame, one-way exits, solution, title,
     cross-section, var types against the chapter's declared VARs). The soft-lock check runs per section
     (`world/softlock`, `world/unreachable`, `world/state-cap`).
     - Red: `lint: <code> red on fixture` per code — one inline fixture world each; the soft-lock fixture is a lock
       whose third medallion sits behind that same lock.
     - Red (changed by PUZZLES-PLAN revision 4, W1): `lint: world/cross-section-effect red on fixture`. Two fixture
       cases, each must be reported:
       - an unlock: the round-4 triage's world. Section `courtyard` has `yard.lever` (object, `then: [unlock
         hall.gate]`) and `yard.to_tower` (a `leave` into a knot that yields `explore: tower`). Section `tower` has
         `hall.gate` → `vault` (a zero-slot lock with no puzzle), `hall.out` (a `leave` back to courtyard),
         `vault.to_hall` and `vault.exit` (a `leave` into `ending`). Predicted red against the lint set without the
         code: exit 0, with only a `world/unreachable` warning on `vault`;
       - a give: one doc given by `take` hotspots in two sections. Predicted red: exit 0, no finding.

       A different red (`world/softlock` or `world/unknown-ref` on the unlock world) means the fixture is malformed,
       not that the code is missing.
     - Control (changed by PUZZLES-PLAN revision 4): `lint: world/cross-section-effect allows a cross-room unlock
       inside a section` — the same lever and gate in two rooms of one section: no `world/cross-section-effect`
       finding. It guards against a lint keyed by room instead of section.
     - Red (changed by PUZZLES-PLAN revision 5, W1): `lint: world/puzzle-multi-lock red on fixture`. Two fixture
       cases, each must be reported:
       - across sections: the round-5 triage's world. `keypad` (a `code` puzzle, `maxAttempts` null) is the
         `puzzle` of zero-slot `yard.shed` (object) in section `courtyard` and of zero-slot `hall.gate` → `vault`
         in section `tower`; the rest is the round-4 shape (`yard.to_tower`, `hall.out`, `vault.to_hall`,
         `vault.exit`). Predicted red against the revision-4 `world.ts`: no error-level finding (per-section
         `world/softlock` green, `world/cross-section-item` and `world/cross-section-effect` silent);
       - within one section: `keypad` on two zero-slot object locks of one section that also has a lock-free
         `leave`. Predicted red: no error-level finding.

       A different red: the same world run through the seeded playthroughs would likely fail `play/step-cap`
       (the courtyard solve leaves the tower gate on its lock panel). That is the random walk, not the code; the
       prediction is stated at the `world.ts` level.
     - Control (changed by PUZZLES-PLAN revision 5): `lint: world/puzzle-multi-lock allows one puzzle on one lock`
       — the demo shape (`drawer` on `study.drawer`, `gate` on `hall.gate`): no `world/puzzle-multi-lock` finding.
       It guards against a lint that counts puzzle references (the `puzzles` map entry plus one lock) instead of
       locks. The lock is unchanged: `world.ts` and `world.test.ts` are already in it.
     - Red (changed by PUZZLES-PLAN revision 6, W1): `lint: world/cross-section-exit red on fixture`. The round-6
       triage's arch world:
       - section `courtyard`: start `yard`; `yard.arch` → `{room: hall}`, lock-free; `yard.leave` → a knot;
       - section `tower`: start `foyer` with a lock-free `foyer.out` leave; rooms `hall` and `pit`. In `hall`:
         `hall.to_yard` (the arch's reverse), `hall.coil` (take, gives `rope`), `hall.lever` (object,
         `then: [{unlock: hall.down}]`), `hall.down` → `{room: pit}` (a zero-slot lock with no puzzle). In `pit`:
         `pit.up` → `{room: hall}` with one slot that accepts `rope`.

       The test asserts two findings, `yard.arch` and `hall.to_yard`, and that `world.ts` returns them as values
       without throwing (the move's room lookup is chapter-wide, so the soft-lock check stays defined on this
       world). Predicted red against the revision-5 `world.ts`, at the `world.ts` level and without `--strict`: no
       error-level finding; per-section `world/softlock` green; the only output a `world/unreachable` W on `pit`.
       A different red: a seeded-playthrough `play/step-cap` is the random walk, not the code; a
       `world/unknown-ref` means the fixture is malformed.
     - Control (changed by PUZZLES-PLAN revision 6): `lint: world/cross-section-exit allows a room→room exit inside
       one section` — two rooms of one section joined by an exit pair, in a chapter that also holds a second
       section: no `world/cross-section-exit` finding. It guards against a rule keyed by room existence instead of
       by section. The lock is unchanged: `world.ts` and `world.test.ts` are already in it.
  2. `graph.ts`:
     - edges: `then=` knots; section knots as reachability edges, excluded from the preload `next`;
     - the codes `puzzle/unknown`, `puzzle/then-unknown`, `puzzle/in-section`, `explore/unknown-section`,
       `explore/event-return`, `explore/event-escape`;
     - event knots' carried stage seeded with their rooms' bg + props.
     - Reds: each code on a fixture; `graph: event knot carries the room stage` — predicted red: an empty `carried`.
  3. `emit.ts`:
     - `toPublic` → `story-gen/free/<ch>.world.json` (or the paid chapter dir), stamped with `version` =
       `worldVersion(body)`: sha256 of the emitted public world JSON without that field and with every world text
       `{ id, ru }` replaced by `1`, first 16 hex (changed by PUZZLES-PLAN revision 2, W1: a text or line-ID edit
       keeps the version; PUZZLES-PLAN X9);
     - `toServer` → `server/content/puzzles/<ch>.json` for every chapter;
     - `usage.json` `worldAssets` + `rooms`;
     - en tables without hint IDs;
     - `paid/leak` extended to hint IDs and texts.
     - Red: `emit: public world has no solution or hint fields`; `emit: server puzzle content matches the server
       fixture shape` (reads `server/tests/fixtures/content/puzzles/ch1.json`; predicted red: a missing `answerLen`);
       a fixture with the hint text written into story-gen → `paid/leak`.
     - Red (changed by PUZZLES-PLAN revision 2, W1): `emit: world version ignores texts` — two fixture worlds that
       differ in one `ru` string (and a second pair that differs in one text `id`). Predicted red against the
       whole-body hash: two different versions. Control: `emit: world version changes on a rules edit` — two worlds
       that differ in one slot's `accepts`; it must stay green on both hashes (a red means texts were not the only
       thing removed).
     - Erratum (RULINGS 21 Q2): `worldVersion` hashes `{ rules: RULES_VERSION, body: <textless body> }`
       (`RULES_VERSION` from `explore/reduce.ts`, LW2). Red: `emit: world version changes on a RULES_VERSION bump`,
       beside the rules-edit control. Once N1's `story/ch1/world.json` exists, LW3 may add a second rules-golden
       row over the real demo.
  4. `locales.ts` + `fix.ts`: world texts join `id/*` (global uniqueness across ink and world) and `loc/*`;
     `--sync-locales` adds world IDs; `--fix-ids` fills missing world IDs (two-space JSON, key order kept).
     - Red: `lint: id/duplicate red on fixture` with one ID in ink and in a world doc; `fix: world ids written once`.
  5. `playthrough.ts`: yields per PUZZLES-PLAN "Seeded playthroughs" (random outcomes, the explore random walk through
     `reduce`, events run until their yield).
     - Red: `play: event knot without return fails` (`play/event-no-return`);
       `play: puzzle then-knot outcomes covered` (the coverage report lists `pz_*` values seen).
  6. `scan-dist.ts`: hint fingerprints from `story/*/world.json` + `story/locales/en/*.json` (every hint line ID; every
     hint text ≥ 12 chars, ru and en), non-vacuous.
     - Red: `scan: hint text in dist fails` (the text, and the line ID in a base64 `data:` URI) — predicted red: exit 0;
       `scan: hint sources present but no fingerprints fails`.
     - Paid-world fingerprints (changed by PUZZLES-PLAN revision 1, W6): for every paid chapter of
       `story/chapters.json` with a `story/<ch>/world.json`, every world line ID and every world text ≥ 12 chars (ru,
       and en from `story/locales/en/<ch>.json`); non-vacuous.
     - Red: `scan: paid world text in dist fails` (a synthetic dist holding a ch2 world text, and one holding its line
       ID in a base64 `data:` URI) — predicted red on the hint-only scan: exit 0;
       `scan: paid world sources present but no fingerprints fails`.
  7. `story.ts`: wiring and the report (`ch1: world 1 section, 3 rooms, 2 puzzles, softlock OK (n states)`).
     - Red: `story: world softlock fails the gate` (a fixture chapter through the CLI exits 1 and prints the
       counterexample path).
- **Gates:** `check`, `test`, `story` (the current skeleton has no world, so the gate stays green and prints
  `world: none` per chapter), `build`.
- **Seen working:** `npx vitest run scripts/story scripts/scan-dist --reporter=verbose` lists every LW3 name;
  `npm --prefix client run story` prints the world line per chapter.
- **As merged (`be8ba8b`, RULINGS 42; the cut `D:/tmp/novel-orch/lw3-story-world/cut.md` Q1-Q14, `impl.md`):**
  - **Commits (Q1).** 8: C1 `world.ts` and the soft-lock check (`c246d3d`); C2 the yield edges (`1372989`); C3 the
    public and server worlds, the world version and the world usage (`495ae17`); C4 world texts in IDs and locales
    (`82327fa`); C5 the playthroughs through yields (`ec51873`); C6 the `scan-dist` fingerprints (`383c80d`); C7 the
    wiring (`e3e7fa8`); C8 `vars/write-only` (`89db368`).
  - **C2's tests** live in `world.test.ts`, not `build.test.ts`.
  - **C3's red** against the parent is the `planned()` invariant of `build.test.ts` (`invariant: … is planned`);
    "a missing `answerLen`" is a scratch mutation. `server/content/puzzles/<ch>.json` is written for every listed
    chapter, `puzzles: {}` without a world (Q3).
  - **C4's rename (S14).** The red is `lint: id/duplicate red on fixture (ink and world)`, since L3a already owns the
    plain name.
  - **C7's report line (Q11, D16)** keeps the `<stage>: <ch>:` shape of the `play:` lines: `world: <ch>: none`, or
    `world: <ch>: <S> section(s), <R> rooms, <P> puzzles, softlock OK (<n> states)` with each count pluralised (`1
    section`, `2 rooms`), or `… softlock FAIL (<k> of <S> sections)`, or `world: <ch>: not checked (world/schema)` (or
    `(catalog/assets)`; `client/scripts/story.ts:383-398`). The C7 fixture world has 2 rooms: the pinned line is `1 section, 2 rooms, 2 puzzles`. The gate on the skeleton
    prints `world: <ch>: none` per chapter.
  - **C8 (Q2, D15).** `vars/write-only` (W) lives in `graph.ts` (`writeOnly`) and `story.ts`; `lint.ts` stays frozen.
    A chapter's own VAR is judged against that chapter's reads, a `g_` global against every listed chapter, and the
    rule runs only when every listed chapter compiled.
  - **PUZZLES-PLAN and STAGING-DSL** carry Q4 (leave knots' carried stage), Q5 (the event closure), Q10
    (`worldVersion`'s `rules`) and Q12 (`usage.json` world sections).

#### LM1 meta-catalog (client; new, META-PLAN)
- **Goal:** the story meta source `story/meta.json` and its lint `catalog/meta`; choice points from the compiled
  chapters; the emitted `server/content/meta.json` and its committed server fixture; the meta fingerprints in
  `scan-dist`; the STAGING-DSL reopen (META-PLAN M1–M5, "Source file", "Server formats", "Staging DSL change").
- **Gate to start:** LW3 merged (the serialized story-tool files: `emit.ts`, `build.test.ts`, `story.ts`,
  `scan-dist.ts`) and LS1 (`story/stories.json` with the skeleton ending `manor.end`). Runs beside D1 (disjoint locks).
- **Lock:** `story/meta.json` (new), `client/scripts/story/{meta.ts,meta.test.ts}` (new),
  `client/scripts/story/{lint.ts,emit.ts,build.test.ts}`, `client/scripts/story.ts`,
  `client/scripts/{scan-dist.ts,scan-dist.test.ts}`, `client/src/story/dsl-doc.test.ts`, `docs/STAGING-DSL.md`,
  `server/tests/fixtures/content/meta.json` (new) (12).
- **Commits:**
  1. `meta.ts` decode + `catalog/meta` (the five rules of META-PLAN "Source file"); `story/meta.json` with the title of
     `manor.end` (ru and en, ≥ 12 code points in one language, so the scan set is non-empty) and no achievement.
     - Red: `meta: catalog/meta red on fixture` (one fixture per rule, each finding printed, none stops the run) —
       predicted red on a decoder-only stub: every fixture passes.
     - Also: `meta: every declared ending has a title`, `meta: conditions name existing endings, choices, chapters and
       puzzles` (a `puzzle` of a chapter outside the story's chain is refused).
  2. Choice points from the compiled ink JSON (option → point; a point = the options offered together). As merged
     (`4d8a9ec`, cut Q3): from the classified sources of each compiled chapter, not the compiled ink JSON.
     - Red: `meta: choice points split by gathers and knots` (a fixture with two choice blocks separated by a gather,
       and one per knot) — predicted red on a per-knot grouping: one point for both blocks.
     - Also: `meta: deeper weave is transparent` (a nested choice inside an option's content is its own point),
       `meta: fallback choices are not options` (an invisible default `* ->` is not in the vocabulary).
  3. `emit.ts` writes `server/content/meta.json` (META-PLAN "Server formats"); `story.ts` wires it and prints the meta
     line (`meta: manor endings 1, achievements 0; choices ch1 n/m`; as merged, cut Q10: `n/m` is
     `<options>/<points>` per chapter, `<ch> -` for a chapter not checked, and the whole line reads
     `meta: not checked (catalog/stories)` or `meta: invalid (catalog/meta)` when those fail;
     `client/scripts/story.ts:350-371`); the committed fixture
     `server/tests/fixtures/content/meta.json` (the four fixture chapters, both fixture stories, one achievement of
     every condition kind).
     - Red: `emit: meta texts only in server outputs` (every meta text absent from `client/src/story-gen/**` and the
       public tables) — predicted red on an emitter that writes into `story-gen`: the text found.
     - Also: `emit: server meta matches the server fixture shape` (the emitted keys and nesting equal the fixture's),
       `story: cli writes server meta`.
  4. `scan-dist.ts`: the meta fingerprints from `story/meta.json` (every text of ≥ 12 code points, ru and en).
     - Red: `scan: meta text in dist fails` (a synthetic dist with an achievement description, and one with it in a
       base64 `data:` URI) — predicted red: exit 0.
     - Red: `scan: empty meta fingerprint set fails` (`story/meta.json` missing while a story declares an ending) —
       predicted red: exit 0 with an empty set.
  5. The DSL reopen: `lint.ts` `LINT_CODES` gains `catalog/meta`; `dsl-doc.test.ts` count 85 → 86; STAGING-DSL
     header sentence, §9 "Story meta", one §11 row (META-PLAN "Staging DSL change"); then frozen again.
     - Red: `dsl-doc` with the code added and the doc not yet edited — predicted red: 86 codes vs 85 rows (quoted).
- **Gates:** `check`, `test` (every name above, counted), `story` (prints the meta line), `build` (the scan line with
  the meta set).
- **Seen red once:** each `catalog/meta` rule's fixture; a scratch module importing a meta text → `build` exit 1.
- **Tester mutations:** drop rule 5's chain check; group choice points per knot; emit the meta into `story-gen`; skip
  texts shorter than 20 code points in the scan.
- **Seen working:** `npx vitest run scripts/story scripts/scan-dist src/story/dsl-doc --reporter=verbose` lists every
  LM1 name; `npm --prefix client run story` writes `server/content/meta.json` and prints the meta line; `rg` finds no
  meta text under `client/src/story-gen` or `client/dist`.
- **As merged (`4d8a9ec`, RULINGS 45; the cut `D:/tmp/novel-orch/lm1-meta-catalog/cut.md` Q1-Q5, Q10):** the DSL
  reopen is C1, since `catalog/meta` must be a `LintCode` before `meta.ts` compiles, and `story/meta.json` lands in
  C4, where the CLI first reads it. C1 the `catalog/meta` registration and the STAGING-DSL reopen (`5efb16e`); C2
  `meta.ts` and rules 1-5 (`fa1b727`); C3 choice points from the classified sources (`e665f57`); C4 the emit of
  `server/content/meta.json`, the CLI wiring and `story/meta.json` (`4f67cda`); C5 the `scan-dist` meta fingerprints
  (`01edcb8`); C6 the public text count from the shipped free en values only (`ed0b4b3`); C7 the old-hash public copy
  of a paid-only asset (L5 review M1, `88556c0`).

#### L8a invoices (server)
- **Goal:** the `BotGateway` trait + the frankenstein implementation; orders; `POST /api/invoices`,
  `GET /api/orders/{id}`; the fake gateway and `/dev/invoices/{slug}`.
- **Lock:** `server/src/telegram/{mod.rs,gateway.rs}`, `server/src/db/{mod.rs,orders.rs}`,
  `server/src/api/{mod.rs,dto.rs,orders.rs}`, `server/src/{lib.rs,main.rs}`,
  `server/dev/src/{lib.rs,fake_gateway.rs,simulate.rs}`, `server/tests/it/{main.rs,payments.rs}`,
  `client/src/api/generated/api.ts` (16; `db/mod.rs` is the one-line `pub mod orders;`). Each dev module exposes
  `routes()`, merged once in the dev `lib.rs`.
- **Commits:**
  1. Gateway trait + `FrankensteinGateway` (2 s connect / 5 s total client; Bot API base from `TELEGRAM_ENV`, prod or
     `/test` [R2 §2.1]). A `GatewayError` maps to `ApiError::TelegramUnavailable` and is logged at the mapping.
     `AppState` gains `gateway` inside `AppState::new` (`FrankensteinGateway` from `Config`) plus `with_gateway`
     (lane rules). Red: the serialized invoice shape test (R2 §2.3 MEASURED shape).
  2. Orders repo + invoices route (price from the catalog; reuse < 1 h; commit before the gateway call). Red:
     `invoice_price_from_catalog`, `invoice_reuses_recent_order`.
  3. Orders route (user-scoped). Red: another user's order → 404.
  4. Fake gateway + `/dev/invoices/{slug}` (`build_dev_app` adds `.with_gateway(FakeBotGateway)` to its
     `AppState::new` call); `api.ts`.
- **Changed by PUZZLES-PLAN (re-cut; same lock).**
  - **Gate to start:** + L6c.
  - **Commit 2** handles hint products through `Catalog::{product, prereqs}`:
    - 409 `already_owned`;
    - 409 `hint_unavailable` when the previous tier is not owned, the puzzle is solved (`Repo::is_solved`), or a paid
      chapter's hint is asked without the chapter;
    - price and invoice title/description from the catalog (the hint templates rendered with the puzzle title).
  - **Reds:** `invoice_hint_tier_order_409` (tier 2 first; predicted red: 200 with a link),
    `invoice_hint_after_solve_409`, `invoice_hint_paid_chapter_needs_entitlement_409`,
    `invoice_hint_price_from_catalog`.
- **Changed by META-PLAN (re-cut; same lock).** M19, M21: the PUZZLES-PLAN commit-2 block above is superseded — no
  hint products exist (L6b merged without them, RULINGS 25). Commit 2 handles chapter products only, through
  `Catalog::product` (409 `already_owned` for an owned chapter); pack products (`pack:<id>`, LE1) pass through the same
  code unchanged, because their entitlement check is trivially false and their price and texts come from the same
  `Product`. The reds `invoice_hint_tier_order_409`, `invoice_hint_after_solve_409`,
  `invoice_hint_paid_chapter_needs_entitlement_409` and `invoice_hint_price_from_catalog` are dropped; LE1 adds
  `invoice_pack_price_from_catalog`.
- **Gates:** fmt, clippy, test; client `check`.
- **Seen working:** `server-dev` on the lane's `DEV_API_PORT` + `curl POST /api/invoices` → `https://t.me/$dev-o_…`.
  As merged (`9e55ef6`, L8a impl Q3): the content comes from `npm --prefix client run story` and then
  `npm --prefix client run assets`, since `ContentStore` refuses to start without `chapters/<paid>/assets.json`.

#### L7 telegram-client (client)
- **Goal:** the Telegram facade; viewport/safe areas; BackButton; lifecycle; the native-transport mock + the fake Stars
  sheet; the Playwright infrastructure + the boot e2e.
- **Lock:** `client/src/telegram/{index.ts,webapp.ts,perf.ts,viewport.ts,telegram.test.ts}`,
  `client/src/telegram/dev/{mock-transport.ts,invoice-sheet.ts}`, `client/vite-plugins/tg-dev-mock.ts`,
  `client/vite.config.ts`, `client/src/main.ts`,
  `client/e2e/{playwright.config.ts,helpers.ts,boot.spec.ts,fixtures/telegram-web-app.js}`, `client/package.json`
  (15). `index.html` is not touched: the TWA tag comes from L1, and the mock bootstrap is injected by the plugin.
- **Commits:**
  1. Facade types + `webapp.ts` over a fake `WebApp` in unit tests. Red: `openInvoice` throw → `TgError` value test
     on a stub.
  2. `perf.ts`. Red: UA vectors (model with spaces) [R1 §6].
  3. `viewport.ts` + CSS vars.
  4. Mock transport + plugin + `define __TG_MOCK__` + proxy (`server.proxy` / `preview.proxy` target
     `http://127.0.0.1:${DEV_API_PORT ?? 8787}`); the `scan-dist` canary run proves production has no mock.
  5. Invoice sheet (calls the dev routes from L8a/L8b by contract).
  6. Playwright config (webServers: `server-dev` on `$DEV_API_PORT`, `vite preview --port $DEV_WEB_PORT
     --strictPort`, both `reuseExistingServer: false`), the TWA fixture route, `boot.spec.ts`, the `e2e` script.
     - Tests: `boot records ready, expand and swipe events`, `viewport vars and safe areas applied`,
       `no window.open or alert`.
     - Red-first: with `main.ts` not yet calling the facade, the first test fails with "web_app_ready not recorded".
     - Seen red once: the harness run while `$DEV_API_PORT` is already bound fails with the webServer "is already
       used" error (quoted), not a run against the foreign server.
     - Overlays and BackButton are e2e-tested in L15, once overlays exist.
- **Gates:** `check`, `test`, `build` (scan proves the mock absent), `e2e` (`boot.spec.ts`).
- **Seen working:** `npm run dev` + `cargo run -p server-dev` (both on the lane's `DEV_API_PORT`) →
  http://localhost:5173 redirects through `/dev/launch`; the devtools console shows TWA events.
- **Changed by STORIES-PLAN (gate only).** Gate to start + LS1: from L6b on, `server-dev` refuses to start without
  the generated `server/content/stories.json`, which the story tool emits from LS1 on (SQ1). The e2e's `npm run
  build` step regenerates it. L7 also runs the live checks the server lanes before LS1 deferred: `GET
  /api/chapters/ch2` → 403 with a dev token (L6b) and, if those lanes have merged, `PUT /api/saves/manor/auto` → 200
  (LS2).
- **Changed by META-PLAN (re-cut; same lock, 15 files).** M14, M16:
  - **Commit 1:** the facade gains `supportsShareMessage()`, `shareMessage(id)`, `openTelegramLink(url)`,
    `openLink(url)` and `startParam()` (PP "Wrappers"). Reds (`telegram.test.ts`, fake `WebApp`): `share: failed event
    maps to a typed error` (a `shareMessageFailed { error: 'MESSAGE_EXPIRED' }` → `{ kind: 'expired' }`; predicted red:
    the method is missing → a type error, then a stub resolving `Ok`), `share: below 8.0 is unsupported` (version 7.10
    → `unsupported` without calling TWA), `share: listeners removed after the event`, `links: open link refuses
    non-https` (and a non-`t.me` URL for `openTelegramLink`).
  - **Commit 4:** the mock transport answers `web_app_send_prepared_message` with `prepared_message_sent` (or the
    failure set by `__tgMock.setShareOutcome`), records `web_app_open_tg_link` / `web_app_open_link`, and gains
    `__tgMock.setVersion(v)`. Red: `mock: prepared message sent event` (unit, on the transport with a fake
    `receiveEvent`; predicted red: no event answered).
  - The e2e of these paths is LMI's `social.spec.ts`; `boot.spec.ts` is unchanged.

#### L8b webhook-grant (server)
- **Goal:** the webhook route; pre-checkout; the idempotent grant; the simulate routes; the DTO samples for the client
  round trip.
- **Lock:** `server/src/telegram/{mod.rs,webhook.rs,payments.rs}`, `server/src/db/{mod.rs,payments.rs}`,
  `server/src/{lib.rs}`, `server/src/api/mod.rs`, `server/dev/src/{lib.rs,simulate.rs}`,
  `server/tests/it/{main.rs,webhook.rs,payments.rs,dto_samples.rs}`, `server/dev/tests/dev.rs`,
  `client/src/api/fixtures/dto-samples.json` (15).
- **Commits:**
  1. Webhook handler (secret, `Bytes` → serde_json, ACK on a decode error without a payment). Red:
     `webhook_missing_secret_401` (404 first).
  2. Pre-checkout statement + classification + timeouts. Red: each `precheckout_*` against a stub `Ok`;
     `precheckout_same_order_twice_refused` — predicted red: a second `on_pre_checkout` for an order that entered
     `checkout` 5 s earlier returns `Ok`.
  3. Grant transaction (`on_successful_payment(&PaymentFact)`). Red: `successful_payment_duplicate_concurrent`
     (renamed by RULINGS 14; two connections, B observed waiting) against a check-then-insert stub → 2 entitlements.
  4. Payment probe (K17): a full-decode failure of a payment-bearing update → `PaymentProbe` → the same grant.
     Red: `webhook_payment_undecodable_by_frankenstein_still_recorded` (a `successful_payment` without
     `provider_payment_charge_id`) — predicted red: 200 with 0 rows in `payments`; `webhook_payment_fields_unreadable_500`
     (`total_amount` as a string) — predicted red: 200.
  5. Simulate routes (`paid`, `paid_twice`, delay). Red: `simulate_payment_goes_through_webhook_handler`.
  6. `dto_samples.rs` (writer + freshness) + `dto-samples.json`.
- **Changed by PUZZLES-PLAN (re-cut; same lock).**
  - **Commit 2** becomes a PK read of the order's `product_id`, then the conditional UPDATE with the three nullable
    hint predicates (prerequisite tier, chapter, unsolved). The classification gains `RejectReason::Unavailable`; its
    ru/en `error_message` sits with the other reasons' texts as a `match` in `telegram/payments.rs` (PE4; L9 moves
    them to `bot.*.json`).
  - **Reds:** `precheckout_hint_prereq_refused` (predicted red: `Ok` from the chapter-only statement),
    `precheckout_hint_solved_refused`, `precheckout_hint_chapter_not_owned_refused`.
  - **Commit 3** adds `hint_purchase_duplicate_concurrent_grants_once` (the two-connection race on a hint order,
    changed by RULINGS 14: one payment, one `hint:` entitlement).
  - **Tester mutation:** drop the `$6` previous-tier predicate (changed by RULINGS 14; it read "the `?prev`
    predicate").
- **Changed by RULINGS 14 (decision section 6, §4.4; no lock change).** Commit 2's statement is the PostgreSQL
  transaction of "Payment flow": the payer-row lock first, then the PK read and the conditional UPDATE. Its reds gain
  `precheckout_concurrent_two_orders_one_passes` and `precheckout_concurrent_same_order_one_passes` (predicted red
  with the lock statement removed: two `ok`), on `common::wait_for_lock_waiter` (merged in LDB1). Every statement
  binds `$n`; Telegram strings get U+0000 → U+FFFD at the `db/` boundary.
- **Gates:** fmt, clippy, test. The tester mutations from the catalogue: no PK, grant in pre-checkout, non-XTR
  accepted (as merged, L8b cut Q4: check-then-insert instead of no PK, see the catalogue's idempotency row).
- **Seen working:** `curl POST /dev/simulate-payment` → `GET /api/entitlements` shows `owned: true`. As in L8a (impl
  Q3): `npm --prefix client run assets` runs after `story`, or `server-dev` does not start.
- **Changed by STORIES-PLAN:** no scope change. If LS1 has not merged, the live `server-dev` checks of L8a and L8b
  move to L7 / L15 and these lanes prove seen-working by test names (SQ1).
- **Changed by META-PLAN (re-cut; same lock).** M19: the PUZZLES-PLAN commit-2 and commit-3 additions above are
  superseded (no hint products, RULINGS 25).
  - **Commit 2** is the RULINGS 14 statement pair of "Payment flow": the payer-row lock, then the conditional UPDATE;
    no PK read, no `$6`–`$8`, no `RejectReason::Unavailable`. The RULINGS 14 reds stay
    (`precheckout_concurrent_two_orders_one_passes`, `precheckout_concurrent_same_order_one_passes`); the reds
    `precheckout_hint_prereq_refused`, `precheckout_hint_solved_refused`, `precheckout_hint_chapter_not_owned_refused`
    are dropped.
  - **Commit 3:** the grant's third step matches on `parse_product_id(product_id)` with the one arm this lane can
    build, `Some(Chapter)` → the entitlement insert, and `None` → "unapplied" (recorded, no grant). No wildcard arm:
    LE1's new `ProductRef::Pack` variant does not compile until the grant handles it.
    `hint_purchase_duplicate_concurrent_grants_once` is dropped. Red unchanged
    (`successful_payment_duplicate_concurrent`).
  - **Tester mutation:** "drop the `$6` previous-tier predicate" is replaced by "drop the payer-row lock" (predicted
    red: the two `precheckout_concurrent_*` tests answer two `ok`).
- **As merged (`06bae54`, RULINGS 46; the cut `D:/tmp/novel-orch/l8b-webhook-grant/cut.md` Q11):**
  - **Commits.** C0-C6 plus two fix commits: C0 the K29 case-insensitivity pin (`dc43c1d`); C1 the webhook route
    (`ab3bc8b`); C2 pre-checkout (`eaa8041`); C3 the grant (`c3105e7`); C4 the K17 probe (`7095baa`); C5 the dev
    simulate route (`e44e5bf`); C6 the DTO samples (`d6c63ac`); the fixes `8fc5118` (a failed database step
    redelivers a payment and refuses a pre-checkout) and `d86f87f` (a pre-checkout from anyone but the order's owner
    is refused `Mismatch`).
  - **Names.** 33 new (baseline rows `L8b`): 19 `payments::`, 7 `webhook::`, 2 `dto_samples::` (one ignored), 3
    `server-dev` `simulate_*`, 2 `telegram::payments::tests::` unit names. The two fix names are
    `webhook::webhook_database_error_retries_payment_and_refuses_precheckout` and `payments::precheckout_wrong_payer`.
  - **Errata** in "Rust types" (`PaymentProbe`, `GrantOutcome`), the dev routes table (`/dev/simulate-payment`), the
    test strategy (`precheckout_answer_times_out_at_5s` in real time) and the seen-red table (the idempotency mutation).

#### LS3 server-stats (server; new, STORIES-PLAN)
- **Goal:** the statistics foundation on the server (STORIES-PLAN Y8–Y12): `0003_stats.sql`, `POST
  /api/stats/events` (validated against the story and puzzle indexes and the entitlements, idempotent, capped) and
  `GET /api/stats` (X of Y per story and for the game); the DTOs, their bindings and samples.
- **Gate to start:** L8b merged (`dto_samples.rs` + `dto-samples.json` exist; L6c's `server/build.rs`, so cargo sees
  a new migration file; L6c's `RateLimited`). Runs before L9 (SQ4).
- **Lock:** `server/migrations/0003_stats.sql` (new), `server/src/db/{mod.rs,stats.rs}`,
  `server/src/api/{mod.rs,dto.rs,stats.rs}`, `server/tests/it/{main.rs,stats.rs,dto_samples.rs}`,
  `client/src/api/fixtures/dto-samples.json`, `client/src/api/generated/api.ts` (11; `db/stats.rs`, `api/stats.rs`,
  `it/stats.rs` are new, their parents `db/mod.rs`, `api/mod.rs`, `it/main.rs` are in the lock). `error.rs` is
  untouched (`RateLimited` from L6c; no new `ErrorCode`). Schema tests live in `it/stats.rs` (the L6c precedent).
- **Commits:**
  1. `0003_stats.sql` (STORIES-PLAN "SQL schema").
     - Red: `schema_stat_events_event_key` before the file → `42P01` `relation "stat_events" does not exist`
       (quoted); after: a second row with the same (user, event id) → `("23505", "stat_events_event_key")`.
     - Also: `schema_stat_events_subject_by_kind` (an `ending_reached` without a subject, a `chapter_started` with
       one, a `puzzle_ended` without an outcome → `("23514", "stat_events_subject_by_kind")`),
       `schema_stat_events_event_id_shape` (an upper-case UUID and a v1 UUID refused),
       `schema_stat_events_story_id_shape`.
  2. `db/stats.rs`: `record_events` (the rolling-hour count, then one `INSERT … SELECT … FROM UNNEST(…) ON CONFLICT
     ON CONSTRAINT stat_events_event_key DO NOTHING RETURNING event_id`), `stat_facts`.
     - Red: `stats_event_replay_counts_once` at the repository level, against a stub that inserts without `ON
       CONFLICT` — predicted red: the second call fails with `("23505", "stat_events_event_key")` instead of
       returning 0 inserted.
     - Red: `stats_rate_limited_after_600_per_hour` (fixed clock; 600 accepted, the next batch refused) — predicted
       red on a stub without the count: `Recorded`. The test also proves the array binding with NULLs (SQ7).
  3. `api/stats.rs` `POST /api/stats/events` (decode, structural checks, `classify`, the cap → 429 + `Retry-After:
     600`).
     - Red: `stats_unknown_ending_rejected` (`dawn` reported for ch3) — predicted red: 404 before the route.
     - Red: `stats_paid_ending_needs_entitlement` (`dawn` for ch4 without, then with, an entitlement row inserted
       through `db/`; as merged, LS3 `00d7c10`, cut D11: a raw row through `it/catalog.rs::own`, never through
       `db/`) — predicted red on a `classify` that skips the entitlement: `recorded: 1` without it.
     - Red: `stats_not_entitled_hides_ending_check` (an unknown ending name in unowned ch4 → `not_entitled`, never
       `unknown_ending`) — predicted red on the subject-first order: `unknown_ending`.
     - Also: `stats_story_derived_by_server` (the stored `story_id` is `tide` for ch3; a request with a `storyId`
       field → 400), `stats_batch_over_32_400`, `stats_puzzle_of_other_chapter_rejected`.
  4. `GET /api/stats`.
     - Red: `stats_endings_x_of_y` (`drowned` reported twice under two event ids, `dawn` never → `tide`
       `endingsReached: ["drowned"]`, `endingsTotal: 2`; game totals 1 of 4) — predicted red: 404 before the route,
       then on a stub that counts rows: 2 reached.
     - Red (changed by STORIES-PLAN revision 1, F12): `stats_ending_completes_its_chapter` (an `ending_reached`
       `drowned` for ch3 and no `chapter_completed` → `tide` `chaptersCompleted: ["ch3"]`) — predicted red on a read
       that counts only `chapter_completed` facts: `chaptersCompleted: []`.
     - Also: `stats_retired_ending_not_counted` (a row with an ending absent from the index, inserted through `db/`),
       `stats_do_not_unlock_paid_chapter` (stat rows for ch4 → `GET /api/chapters/ch4` still 403),
       `stats_private_no_store`.
  5. `#[derive(TS)]` + regenerated `api.ts`; the stats DTO samples in `dto_samples.rs` + `dto-samples.json`. Red:
     `bindings_are_fresh` and `dto_samples_are_fresh` before regenerating.
- **Gates:** fmt, clippy, test (the names above, counted); client `check`.
- **Tester mutations:** drop `ON CONFLICT`; count rows instead of distinct facts; skip the entitlement; read the
  story from the request; drop `stat_events_subject_by_kind`.
- **Seen working:** `cargo test -p server --test it stats_ schema_stat` lists every name (as merged, cut Q12: cargo
  takes one TESTNAME, so the second filter goes after `--`: `cargo test -p server --test it --locked -- stats_
  schema_stat`). Live (LS1 is merged by
  then): `server-dev`, a token from `/dev/launch` + `POST /api/auth`, the same `POST /api/stats/events` twice →
  `{"recorded":1,"duplicates":0,…}` then `{"recorded":0,"duplicates":1,…}`; `GET /api/stats` shows the ending.
- **Changed by META-PLAN (re-cut; same lock, 11 files).** M1, M8:
  - **Commit 1:** `0003` admits `choice_made` (`stat_events_kind_known`, the new `stat_events_subject_by_kind` branch)
    and adds `stat_events_choice_in_chapter` (META-PLAN "SQL"). Red: `schema_stat_events_choice_in_chapter` (a
    `choice_made` for ch3 with subject `ch1.hall.a1b2` → `("23514", "stat_events_choice_in_chapter")`; a well-formed
    one accepted; predicted red before the constraint: the row is accepted). `schema_stat_events_subject_by_kind`
    gains a `choice_made` with an outcome and one with a malformed subject.
  - **Commit 3:** `StatKind::ChoiceMade`, `StatRejectReason::UnknownChoice` (as merged, cut D4: `StatKind` and
    `StatOutcome` live in `db/stats.rs`, the `OrderStatus` precedent, and `ChoiceMade` lands with the enum in C2,
    since `NewStatEvent` needs it); `classify` checks a choice's shape and
    that its chapter part equals `chapterId` → else `unknown_choice` (LM2 adds the vocabulary). Order:
    `unknown_chapter` → `not_entitled` → `unknown_choice`. Red: `stats_choice_shape_checked` (an option of ch1 reported
    for ch3 → rejected `unknown_choice`; predicted red on a `classify` without the branch: 400 on the unknown kind).
  - **Commit 4:** `StoryStatsDto` and `GameStatsDto` lose `endingsTotal` (Q25). `stats_endings_x_of_y` becomes
    `stats_endings_reached_distinct` (`drowned` reported twice → `endingsReached: ["drowned"]`, game `endingsReached:
    1`); new red `stats_response_has_no_endings_total` (the raw JSON has no `endingsTotal` key at any depth; predicted
    red on the SP DTO: the key present).
  - **Tester mutations** add: drop `stat_events_choice_in_chapter`; check the subject before the entitlement for
    `choice_made`.
  - **Revision 1 (W2; STORIES-PLAN Y11 changed; same lock).** Commit 2's `record_events` counts facts and choices apart
    in its one count statement (`count(*) FILTER (WHERE kind = 'choice_made')` and the rest): over 600 fact rows →
    `RateLimited` (429) as before; over the choice budget (`STATS_CHOICE_HOURLY_CAP` 600) a repeat pick is rejected
    `rate_limited` and a first pick of an option is recorded (one read on `stat_events_by_user_story`, only when the
    batch exceeds the budget). Commit 3 declares `StatRejectReason::RateLimited`.
    - Red: `stats_cap_does_not_refuse_facts` (fixed clock; 600 `choice_made` rows in the hour; a batch with one
      `ending_reached` → recorded) — predicted red on the SP shared cap: 429.
    - Red: `stats_choice_over_budget_keeps_first_picks` (600 choice rows in the hour; a batch with a repeat pick and a
      never-picked option of the same chapter → the repeat `rejected: rate_limited`, the new option recorded) —
      predicted red on a plain per-kind cap: the new option rejected too.
    - `stats_rate_limited_after_600_per_hour` counts fact rows (600 accepted, the next fact batch refused).
    - **Tester mutations** add: count choice rows toward the facts' cap; reject a first pick over the budget.
- **As merged (`00d7c10`, RULINGS 52; the cut `D:/tmp/novel-orch/ls3-server-stats/cut.md` D1-D11, O1):** C1
  `0003_stats.sql` (`5913e6e`); C2 `db/stats.rs`, `record_events` with the fact and choice budgets (`972c41e`); C3
  `POST /api/stats/events` (`d04108f`); C4 `GET /api/stats` (`99ec1dc`); C5 the bindings and samples (`d353c95`).
  STORIES-PLAN and META-PLAN carry the schema guards (D1), the cache header (D7), the choice prefix (D3), the
  `record_events` contract (D5, O1) and the soft-budget overshoot (review M2).

#### LE1 economy-core (server; new, META-PLAN)
- **Goal:** the resource foundation (META-PLAN M17–M19, M21): `0004_economy.sql`, the ledger and balance primitives,
  pack products from the catalog's `economy` section, the pack credit inside the grant, `GET /api/wallet`, and the hint
  use route `POST /api/puzzles/{puzzleId}/hints/{tier}`.
- **Gate to start:** LS3 merged (the serialized server files; L8b's grant; L6c's `hint_unlocks` and
  `InsufficientBalance`).
- **Lock:** `server/migrations/0004_economy.sql` (new), `server/src/db/{mod.rs,economy.rs,payments.rs,orders.rs}`,
  `server/src/telegram/payments.rs`, `server/src/catalog.rs`, `server/catalog.json`,
  `server/src/api/{mod.rs,dto.rs,wallet.rs,puzzles.rs}`, `server/tests/it/{main.rs,economy.rs}`,
  `client/src/api/generated/api.ts` (15; `db/economy.rs`, `api/wallet.rs`, `it/economy.rs` are new, their parents are
  in the lock; `db/orders.rs` added by revision 1, W3: P3's pack binding). `AppState` gains no field (`catalog`
  exists); `error.rs` is untouched (L6c pre-declared the variants).
- **Commits:**
  1. `0004_economy.sql` (META-PLAN "SQL", including revision 1's `ALTER TABLE orders`: `pack_kind`, `pack_amount`,
     `orders_pack_binding`).
     - Red: `schema_balance_never_negative` before the file → `42P01` `relation "resource_balances" does not exist`
       (quoted); after: a balance of −1 → `("23514", "resource_balances_balance_nonneg")`.
     - Also: `schema_balance_or_debt` (balance 1 and debt 1 → `…_balance_or_debt`), `schema_ledger_idem_key` (a second
       row with one key → `("23505", "resource_ledger_idem_key")`), `schema_ledger_sign_by_reason` (a `pack` row of −3
       and a `hint_spend` of +1 refused), `schema_orders_pack_binding` (revision 1: a `pack:` order without its binding,
       and a `chapter:` order with one → `("23514", "orders_pack_binding")`).
  2. `db/economy.rs`: `credit_in_tx`, `debit_in_tx`, `clawback_in_tx`, `credited_by_charge` (revision 1: the
     `pay:<charge>` row's kind and amount, L9's clawback source), `balances` (the ledger insert first, then the
     balance statement; M18).
     - Red: `ledger_reconciles_with_balances` (credits, debits, a clawback and a duplicate key; Σ amount = balance −
       debt) — predicted red on a stub that changes the balance before the ledger's `ON CONFLICT`: the duplicate counted
       twice.
     - Red: `credit_pays_debt_first` (debt 2, credit 5 → balance 3, debt 0) — predicted red on a plain `balance + n`
       upsert: `("23514", "resource_balances_balance_or_debt")`.
     - Also: `clawback_takes_balance_then_debt` (balance 1, clawback 3 → 0 and debt 2);
       `balance_never_negative_concurrent_spends` (two connections, balance 1, two debits; B observed waiting on A's row
       through `common::wait_for_lock_waiter`; one applied, one `None`) — predicted red on a read-then-write stub: B's
       commit fails with `("23514", "resource_balances_balance_nonneg")`.
  3. `catalog.rs` + `catalog.json`: the `economy` section (M17, PLACEHOLDER amounts), `ProductRef::Pack`, the
     `pack:<id>` products and their startup checks; P3's binding (`db/orders.rs`: the order INSERT sets `pack_kind` /
     `pack_amount` from the catalog for a pack, NULL for a chapter; revision 1, W3); the grant's `Pack` arm
     (`db/payments.rs`, `telegram/payments.rs`: `UPDATE orders … RETURNING product_id, pack_kind, pack_amount`, then
     `credit_in_tx` of exactly that kind and amount with `pay:<charge>` before the commit; the grant reads no catalog).
     - Red (revision 1): `pack_credit_uses_amount_bound_at_order` (a `pack:hint_s` order created with amount 3, its
       binding raised to 7 by raw SQL — an order invoiced by an earlier build — then paid → balance 7; a second order
       whose product id is set to the retired `pack:gone` by raw SQL → credited its bound amount) — predicted red on a
       grant that resolves the pack in the catalog: balance 3, then no credit (unapplied) for `pack:gone`.
     - Red: `catalog::tests::pack_product_id_grammar` (`pack:hint_s` ok; `pack:`, `pack:Hint`, `pack:hint s`, `hint:x`
       None) — predicted red: `None` for `pack:hint_s`.
     - Red: `pack_credit_once_on_duplicate_payment` (two connections deliver one pack charge; one ledger row, balance 3)
       — predicted red before the arm: the build fails on the non-exhaustive match (quoted), then on a credit taken
       outside the payments-insert result: two ledger attempts, the second `Duplicate`, so the test also asserts the
       `Duplicate` outcome of the twin.
     - Red: `pack_grant_credits_in_the_grant_transaction` (the user's balance row held `FOR UPDATE` by a second
       connection; while the grant waits on it, a third connection sees no `payments` row; after the release all three
       facts appear together) — predicted red on a two-transaction stub: the `payments` row visible while the credit
       waits.
     - Also: `catalog_packs_from_economy`, `catalog_pack_titles_within_limits` (a 33-character title →
       `StartupError::Content`), `invoice_pack_price_from_catalog` (`POST /api/invoices { pack:hint_s }` → the fake
       gateway's amount 1).
  4. `GET /api/wallet` (`balances`, `packs`, `hintTierCost` = `economy.spend.hintTier`).
     - Red: `wallet_lists_balances_and_packs` — predicted red: 404 before the route.
     - Also: `wallet_private_no_store`.
  5. `POST /api/puzzles/{puzzleId}/hints/{tier}?lang` (`Repo::spend_hint`, M21's transaction).
     - Red: `hint_spend_needs_previous_tier` (tier 2 first → 409 `hint_unavailable`) — predicted red: 404 before the
       route.
     - Red: `hint_spend_insufficient_409_unlocks_nothing` (balance 0 → 409 `insufficient_balance`, no `hint_unlocks`
       row) — predicted red on a stub that commits the unlock before the debit: the row stays.
     - Red: `hint_spend_concurrent_debits_once` (two connections, the same tier, balance 5 → one debit, balance 4; B
       observed waiting on A's PK insert) — predicted red on a check-then-insert stub: balance 3.
     - Also: `hint_spend_after_solve_409`, `hint_spend_replay_no_debit`, `hint_spend_paid_chapter_403`; L6c's
       `puzzle_hint_text_only_when_unlocked` stays green.
  6. `#[derive(TS)]` on the new DTOs + regenerated `api.ts`. Red: `bindings_are_fresh` before regenerating.
- **Gates:** fmt, clippy, test (the names above, counted); client `check`.
- **Tester mutations:** change the balance before the ledger insert; drop `AND balance >= $3`; debit before the unlock
  insert; credit after the grant's commit; drop `GREATEST(… debt)` from the credit; (revision 1) credit the catalog's
  amount instead of the order's binding; drop `orders_pack_binding`.
- **Seen working:** `cargo test -p server --test it schema_balance schema_ledger schema_orders ledger_ credit_ clawback_
  balance_ pack_ catalog_pack invoice_pack wallet_ hint_spend` lists every name. Live: `server-dev`, a dev token →
  `POST /api/invoices { productId: "pack:hint_s" }` → `/dev/simulate-payment` → `GET /api/wallet` shows `hint` 3; with
  LW3's generated puzzles, `POST /api/puzzles/ch1.drawer/hints/1?lang=ru` → `{ balance: 2, text }`.

#### LF1 friends-server (server; new, META-PLAN)
- **Goal:** the verified `start_param`; attribution at `POST /api/auth` (a referral row for a newcomer; revision 1,
  C1: no friend request at auth); invites — `GET /api/invites/{code}` and `POST /api/invites/{code}/request`, a
  holder asks the code's owner (revision 1, C1); friends, incoming requests (accept; a decline or removal writes a
  durable `friend_blocks` row), invite codes and rotation, user handles (revision 1, W1: the only user id another user
  receives); the profile-visibility consent log; `GET /api/privacy`; the dev `startapp` (META-PLAN M10–M12, M15, M26).
- **Gate to start:** LE1 merged (the serialized server files). `server/legal/privacy-policy.html` exists on `main` (the
  META-PLAN campaign's policy step); if it does not, STOP.
- **Lock:** `server/migrations/0005_social.sql` (new), `server/src/auth/initdata.rs`,
  `server/src/api/{mod.rs,dto.rs,auth.rs,social.rs,legal.rs}`, `server/src/db/{mod.rs,users.rs,social.rs}`,
  `server/dev/src/launch.rs`, `server/tests/it/{main.rs,social.rs}`, `server/dev/tests/dev.rs`,
  `client/src/api/generated/api.ts` (15; `api/social.rs`, `api/legal.rs`, `db/social.rs`, `it/social.rs` are new, their
  parents are in the lock). The policy file is read (`include_str!`), never edited. Limits are constants in
  `api/social.rs` (200 friends, 50 pending incoming requests per user, 10 rotations per day; owner values MV15).
- **Commits** (revision 1: eight; the invite routes are commit 4):
  1. `0005_social.sql` (META-PLAN "SQL", with revision 1's `friend_blocks` and `user_handles`).
     - Red: `schema_friendships_ordered` before the file → `42P01` (quoted); after: (5, 3) →
       `("23514", "friendships_ordered")`.
     - Also: `schema_invite_code_shape`, `schema_one_active_code` (a second active code →
       `("23505", "invite_codes_one_active")`), `schema_consent_purpose_known`, `schema_referral_outcome_known`,
       `schema_friend_blocks_not_self`, `schema_user_handle_shape` (an upper-case or 32-character handle →
       `("23514", "user_handles_shape")`; a second user with the same handle → `("23505", "user_handles_handle")`).
  2. `initdata.rs` exposes `start_param` from the signed pairs; `db/users.rs` returns `inserted` (`RETURNING old.id IS
     NULL`).
     - Red: `initdata::tests::start_param_from_signed_string` (a Node-signed vector with `start_param=f…` → `Some`; the
       same vector with the value edited → `InitDataInvalid`) — predicted red: the field missing (a compile error), then
       `None` from a parser that drops the key.
     - Red: `users_upsert_reports_inserted` (true, then false) — predicted red on `created_at = now` within one second:
       true twice.
  3. `api/auth.rs` + `db/social.rs`: the attribution transaction (M11: the referral only, revision 1).
     - Red: `referral_attributed_on_first_login_only` (the code on an existing user's launch → no referral; on a
       newcomer's → one) — predicted red on a stub without the inserted flag: a referral for the existing user.
  4. `api/social.rs` + `db/social.rs`: the invite routes (`GET /api/invites/{code}`, `POST /api/invites/{code}/request`;
     META-PLAN F19 step 4: both `users` rows locked ascending; the caller's handle ensured) — revision 1, C1.
     - Red: `invite_view_reveals_nothing_about_owner` (both answers' raw JSON has exactly the key `state` — no first
       name, handle or id of the owner at any depth) — predicted red: 404 before the routes.
     - Red: `pending_requests_capped` (the 51st requester → `requested` and no row; two connections at 49 → exactly 50
       rows, the second observed waiting on the owner's `users` row through `common::wait_for_lock_waiter`) — predicted
       red on a stub without the owner-row lock: 51 rows.
     - Also: `invite_launch_creates_no_request` (a launch with a live code leaves `friend_requests` empty; the state is
       `open`), `self_invite_creates_nothing` (one's own code: no referral at a first launch; the routes answer `own`,
       no row), `revoked_code_creates_nothing` (404, no row; no referral at a first launch),
       `invite_request_repeat_creates_one` (two sends → one row, `requested`).
  5. `GET /api/social`, accept, remove / decline with the block (`api/social.rs`, the locks of F20).
     - Red: `friendship_needs_inviter_accept` (B sends through A's code: B's `friends: []`, A's `requests: [B]`; only
       A's accept fills both lists) — predicted red: 404 before the routes.
     - Red: `unfriend_is_durable_against_old_code` (A and B friends through A's code; A removes B; B sends through the
       same code → `requested`, A's `requests: []`, no friendship) — predicted red on a remove without the block: one
       request of B in A's `requests`.
     - Red: `social_dto_has_no_telegram_id` (W1: A's and B's `SocialResponse`, with each other as friend and as
       request, contain no value equal to the other's `users.id`, as a number or a string, at any depth) — predicted
       red on the revision-0 DTO: `userId` equals it.
     - Red: `accept_both_directions_one_friendship` (two connections, A accepts B's request while B accepts A's) —
       predicted red with the locks in request order: `40P01` deadlock detected, or two rows refused by the PK.
     - Also: `decline_is_durable_against_old_code` (A declines B; B sends again → `requested`, no row),
       `blocker_request_lifts_own_block` (A removed B; A sends through B's code → A's block is gone and B sees A's
       request), `friend_cap_409`, `remove_friend_ends_both_sides`, `social_private_no_store`.
  6. `POST /api/invite/rotate`, `PUT /api/consents/friends_profile`.
     - Red: `consent_records_policy_version` (the row's `policy_version` equals the compiled policy's meta) — predicted
       red: 404 before the route.
     - Also: `rotate_invite_code_limited` (the 11th in a day → 429 + `Retry-After`; the old code revoked),
       `consent_latest_row_wins`.
  7. `GET /api/privacy` (`api/legal.rs`): public, `text/html; charset=utf-8`, `public, max-age=300`, the CSP; the
     compiled template served as is. Revision 1 (W4): no startup warning here — LPO substitutes the operator facts from
     `PRIVACY_OPERATOR_FILE` and refuses a production start while a placeholder remains.
     - Red: `privacy_page_served_with_version` — predicted red: 404.
     - Also: `privacy_page_needs_no_token`.
  8. Dev `/dev/launch?startapp=` (`launch.rs`) + `#[derive(TS)]` + `api.ts`.
     - Red: `dev_launch_signs_start_param` (the redirect's initData verifies and carries `start_param`) — predicted red:
       the parameter ignored.
     - Red: `bindings_are_fresh` before regenerating.
- **Gates:** fmt, clippy, test (counted); client `check`.
- **Tester mutations:** read `start_param` outside the verified pairs; accept without deleting the request; lock the
  two `users` rows in request order; a referral for a non-newcomer; serve the policy with `no-store`; (revision 1)
  create a friend request at auth; remove or decline without writing the block; answer a blocked request differently
  from a pending one; put `users.id` into a social DTO.
- **Seen working:** `cargo test -p server --test it social schema_friend schema_invite schema_consent schema_user_handle
  invite_ privacy referral_ users_upsert unfriend_ decline_ blocker_` and `cargo test -p server-dev dev_launch` list
  every name. Live: two dev users; `/dev/launch?uid=2002&startapp=f<2001's code>` → `POST /api/auth` →
  `GET /api/invites/<code>` as 2002 → `open` → `POST /api/invites/<code>/request` → `GET /api/social` as 2001 shows
  2002's request (a handle, no Telegram id) → accept → both lists; 2001 removes 2002 → 2002 sends again → `requested`,
  nothing new; `curl /api/privacy` without a token → the policy.

#### LM2 meta-server (server; new, META-PLAN)
- **Goal:** the meta index (`server/content/meta.json`) loaded at startup; the choice vocabulary check; achievement
  evaluation and persistence; `POST /api/stories/{storyId}/card` (META-PLAN M2, M5–M9).
- **Gate to start:** LF1 merged (the serialized server files) and LM1 merged (`server/tests/fixtures/content/meta.json`
  and the emitter of `server/content/meta.json`).
- **Lock:** `server/migrations/0006_achievements.sql` (new), `server/src/{lib.rs,content.rs,meta.rs}`,
  `server/src/db/{mod.rs,achievements.rs}`, `server/src/api/{mod.rs,dto.rs,cards.rs,stats.rs}`,
  `server/tests/it/{main.rs,cards.rs,content.rs,stats.rs}`, `client/src/api/generated/api.ts` (15; `meta.rs`,
  `db/achievements.rs`, `api/cards.rs`, `it/cards.rs` are new; `lib.rs` holds `pub mod meta`). `ContentStore` gains
  the meta index; `AppState` gains no field. `db/achievements.rs` also exposes `endings_by_story(u)` and
  `unlocks_by_story(u)` (one grouped read each) for LF2's friend profile.
- **Commits:**
  1. `0006_achievements.sql`. Red: `schema_achievement_unlocks_pk` before the file → `42P01` (quoted); after: a
     second row → `("23505", "achievement_unlocks_pkey")`.
  2. `meta.rs`: `Condition`, `met`, `gate`, `visible` (pure; lib tests).
     - Red: `meta::tests::conditions_evaluate` (a table: each of the seven kinds against facts that meet and miss it) —
       predicted red on a stub returning `false`: every "meets" row fails.
     - Also: `meta::tests::gates_name_paid_chapters` (`ending dawn` → {ch4}; `endings: 1` → {}; `all` → the union).
  3. `content.rs` loads `meta.json` with the startup checks (META-PLAN "Server formats").
     - Red: `meta_index_loaded` (the fixture's stories, endings, achievements, choices) — predicted red: the meta field
       missing.
     - Also: `startup_fails_when_meta_names_unknown_ending`, `startup_fails_when_meta_too_large` (`it/content.rs`;
       predicted red: `Ok(state)`).
  4. `api/stats.rs`: the vocabulary check after the entitlement.
     - Red: `stats_unknown_choice_rejected` (a well-formed ch1 option absent from `choices.ch1`) — predicted red on
       LS3's shape-only check: `recorded: 1`.
     - Also: `stats_paid_choice_needs_entitlement_first` (an unknown option of unowned ch4 → `not_entitled`).
  5. `db/achievements.rs` + `api/cards.rs` (M6, M9).
     - Red: `card_lists_only_found_endings` — predicted red: 404 before the route.
     - Red: `card_paid_titles_need_entitlement` (raw stat rows for `dawn` in ch4; without the entitlement `dawn` and
       `dawn_seen` are absent, with it present) — predicted red on a stub without `visible`: present without it.
     - Red: `card_concurrent_posts_new_once` (two connections) — predicted red on a stub that marks every met
       achievement `new`: `new: true` twice.
     - Also: `card_has_no_endings_total`, `card_unlock_persists_and_new_once`, `card_puzzle_no_hints_condition` (a raw
       `hint_unlocks` row → `drawer_no_hints` not met), `card_retired_achievement_hidden`, `card_response_bounded`,
       `card_unknown_story_404`, `card_private_no_store`.
  6. `#[derive(TS)]` + `api.ts`. Red: `bindings_are_fresh`.
- **Gates:** fmt, clippy, test (counted); client `check`.
- **Tester mutations:** skip `visible`; mark every met achievement `new`; count ending rows instead of distinct
  endings; check the vocabulary before the entitlement; evaluate a condition on a retired ending.
- **Seen working:** `cargo test -p server --test it card_ meta_ stats_ schema_achievement startup_fails_when_meta` and
  `cargo test -p server --lib meta::` list every name. Live: a dev token, a `tide` `ending_reached` `drowned` (curl) →
  `POST /api/stories/tide/card` → the ending `drowned` and `first_ending` `new: true`; again → `new: false`.

#### LF2 share-profile (server; new, META-PLAN)
- **Goal:** the two gateway methods (`savePreparedInlineMessage`, `getMe`), `POST /api/share` with its in-memory rate
  window, the friend profile, `/dev/prepared/{id}`, and the DTO samples of every meta DTO so far (META-PLAN M13, M14,
  M16).
- **Gate to start:** LM2 merged (the profile reads the meta, the unlocks and LF1's friendships and consents).
- **Lock:** `server/src/api/{mod.rs,dto.rs,share.rs,social.rs}`, `server/src/telegram/gateway.rs`, `server/src/lib.rs`,
  `server/locales/meta.json` (new), `server/dev/src/fake_gateway.rs`, `server/dev/tests/dev.rs`,
  `server/tests/it/{main.rs,share.rs,social.rs,dto_samples.rs}`, `client/src/api/fixtures/dto-samples.json`,
  `client/src/api/generated/api.ts` (15; `api/share.rs`, `it/share.rs` are new). `AppState` gains `share_limit`
  inside `AppState::new` (lane rules: no caller changes). The new dev route sits in `fake_gateway.rs`'s `routes()`, so
  the dev `lib.rs` is not touched.
- **Commits:**
  1. `gateway.rs`: `save_prepared_inline_message` (an `InlineQueryResultArticle` with a text content and one url
     button; `allow_user_chats` and `allow_group_chats` true) and `bot_username` (`getMe`, cached in the
     implementation); the fake gateway stores prepared shares, answers `novel_dev_bot`, serves `GET /dev/prepared/{id}`.
     - Red: `gateway_prepared_share_shape` (the serialized request, the L8a invoice-shape precedent; the frankenstein
       0.52.1 type names verified on docs.rs) — predicted red: the method missing (a compile error), then a wrong
       shape.
     - Also: `dev_prepared_message_readable` (`dev.rs`).
  2. `server/locales/meta.json` + `api/share.rs` + `lib.rs` (`share_limit`).
     - Red: `share_text_has_no_titles` (a user who reached `dawn` with ch4 owned and unlocked `dawn_seen`: the text has
       the counts and the story title and none of the fixture's ending or achievement titles in either language) —
       predicted red: 404 before the route, then on a template listing the found endings: the title of `dawn`.
     - Also: `share_link_carries_invite_code`, `share_prepares_inline_message_for_native`,
       `share_without_native_returns_link_only`, `share_prepare_failure_falls_back_to_link`,
       `share_rate_limited_after_20_per_hour` (a fixed clock; the 21st → 429 + `Retry-After`).
  3. `GET /api/friends/{handle}/profile` (`api/social.rs`, ≤ 7 statements; revision 1, W1: the handle's user and the
     friendship in one read through LF1's `user_handles`; `FriendProfile.handle`, never a Telegram id).
     - Red: `friend_profile_paid_titles_need_viewer_entitlement` (both found `dawn`; the viewer's ch4 refunded by raw
       SQL → `dawn` not shared, the count stays) — predicted red: 404 before the route, then on a stub without the
       viewer's gate: `dawn` shared.
     - Also: `friend_profile_404_for_non_friend`, `friend_profile_private_by_default`,
       `consent_withdrawal_hides_profile`, `friend_profile_shared_titles_only`.
  4. `#[derive(TS)]` + `api.ts`. Red: `bindings_are_fresh`.
  5. The DTO samples of `WalletResponse`, `HintUseResponse`, `CardResponse`, `SocialResponse`, `FriendProfile`,
     `InviteView` (revision 1) and `ShareResponse` in `dto_samples.rs` + `dto-samples.json` (handles, no Telegram id).
     Red: `dto_samples_are_fresh` before regenerating.
- **Gates:** fmt, clippy, test (counted); client `check`.
- **Tester mutations:** an ending title in the share template; the profile without the viewer's gate; `visible: true`
  without a consent row; the limiter removed; `allow_channel_chats` true.
- **Seen working:** `cargo test -p server --test it share_ friend_profile consent_withdrawal gateway_prepared
  dto_samples` and `cargo test -p server-dev dev_prepared` list every name. Live: `POST /api/share { storyId: "tide",
  lang: "ru", native: true }` → `{ link: "https://t.me/novel_dev_bot?startapp=f…", preparedMessageId }`;
  `GET /dev/prepared/{id}` shows the text and the button.

#### LE2 gifts-referrals (server; new, META-PLAN)
- **Goal:** gifts between friends (META-PLAN M22) and the referral qualification and grant (M23); the gift DTO
  sample.
- **Gate to start:** LF2 merged (the serialized server files; LE1's ledger; LF1's friendships and referrals).
- **Lock:** `server/src/api/{mod.rs,dto.rs,gifts.rs,stats.rs}`, `server/src/db/{economy.rs,social.rs}`,
  `server/tests/it/{main.rs,gifts.rs,referrals.rs,dto_samples.rs}`, `client/src/api/fixtures/dto-samples.json`,
  `client/src/api/generated/api.ts` (12; `api/gifts.rs`, `it/gifts.rs`, `it/referrals.rs` are new).
- **Commits:**
  1. `db/economy.rs` `transfer` (M22's transaction).
     - Red: `gift_moves_once_and_reconciles` — predicted red: the method missing (a compile error), then on a stub that
       credits before the debit with an insufficient sender: the recipient credited.
     - Red: `gift_opposite_directions_no_deadlock` (two connections, A→B and B→A) — predicted red with the locks in
       request order: `40P01` deadlock detected (quoted).
     - Also: `gift_replay_moves_once`, `gift_concurrent_same_sender_respects_cap` (B observed waiting on the sender's
       `users` row).
  2. `POST /api/gifts` (`api/gifts.rs`; revision 1, W1: `to` is a friend handle, resolved by LF1's
     `user_by_handle` before the transaction; an unknown handle → 404).
     - Red: `gift_requires_friendship` — predicted red: 404 before the route for every case, then 200 for a non-friend
       on a stub without the friendship read.
     - Also: `gift_daily_send_cap_429`, `gift_daily_receive_cap_429`, `gift_insufficient_409`,
       `gift_replay_with_other_body_400`.
  3. `db/social.rs` `qualify_referral` (M23's transaction).
     - Red: `referral_grants_both_once` — predicted red: missing.
     - Also: `referral_cap_per_inviter_day`, `referral_cap_total`, `referral_concurrent_batches_grant_once`.
  4. The hook in `api/stats.rs` (after the insert, on **every** batch — revision 1, W5: one statement reads the
     unqualified referral by PK with the evidence, re-read from the table, never taken from what the batch recorded;
     the hook never fails the response: an error is logged, its transaction rolled back, the answer is the batch's).
     - Red: `referral_needs_min_play_gap` (a fixed clock: the start received at t, the completion at t + 119 → nothing;
       a batch at t + 120 → granted) — predicted red on a hook without the gap: granted at t + 119.
     - Red: `referral_qualifies_after_hook_failure` (the completion recorded with the gap met while a second
       connection holds the inviter's `users` row `FOR UPDATE`, so the hook hits the pool's `lock_timeout`: the answer
       is 200 with the events recorded and no grant; the lock released, the same batch replayed — all duplicates →
       granted) — predicted red on the revision-0 hook (only for a newly recorded completion): no grant after the
       replay.
     - Also: `referral_needs_first_chapter` (a ch2 completion → nothing), `referral_fast_reader_qualifies_on_a_later_batch`
       (the completion at t + 100 → nothing; a ch4 `chapter_started` at t + 130 → granted).
  5. `#[derive(TS)]` + `api.ts` + the `GiftResponse` sample. Red: `bindings_are_fresh`, `dto_samples_are_fresh`.
- **Gates:** fmt, clippy, test (counted); client `check`.
- **Tester mutations:** count the caps before the locks; credit the inviter when capped; use the client's `ageMs`
  instead of the server receipt time; drop the friendship read; accept a replay with another body; (revision 1) run
  the hook only for newly recorded completions; let a hook error fail the stats response.
- **Seen working:** `cargo test -p server --test it gift_ referral_` lists every name. Live: two dev friends (LF1), a
  pack for one (LE1) → `POST /api/gifts` → both `GET /api/wallet` answers changed.

#### LPO privacy-operator (server; new, META-PLAN revision 1)
- **Goal:** the privacy policy's operator facts from outside the repository and the production refusal (META-PLAN M26,
  triage W4): `PRIVACY_OPERATOR_FILE` in `Config` (required under `TELEGRAM_ENV=prod`), `legal::Policy::load` in
  `AppState::new` (the HTML-escaped substitution of every `{KEY}` placeholder of the compiled template), and
  `StartupError::Privacy` for an unreadable file, a non-string value, an unknown key or — under prod — a placeholder
  left. `GET /api/privacy` (LF1) serves the substituted page. Changed by META-PLAN revision 2 (W1): the host file
  carries only the ten identity keys (`IDENTITY_KEYS`), and a content key (`CONTENT_KEYS`) or `POLICY_VERSION` in it
  is `PolicyError::ContentKey`; `{POLICY_VERSION}` is filled from the template's meta; `POLICY_PINS` pins each policy
  version to one template hash. Changed by META-PLAN revision 3 (W1): the pin's three conditions live in one pure
  `#[cfg(test)]` checker `check_pins`, and each condition is seen red on a crafted history.
- **Gate to start:** LE2 merged (the serialized server files; LF1's `api/legal.rs`). Runs beside LMI; L9 follows.
- **Lock:** `server/src/{config.rs,lib.rs}`, `server/src/api/legal.rs`, `.env.example`, `server/dev/src/lib.rs`,
  `server/tests/it/{main.rs,common.rs,legal.rs}` (8; `it/legal.rs` is new, its parent `it/main.rs` is in the lock).
  This is the one `Config` variable added after L2 (lane rules: the three `Config` constructors are in the lock).
  `AppState` gains `policy` inside `AppState::new` (lane rules: no caller changes).
- **Commits:**
  1. `config.rs` + `.env.example` (a commented `PRIVACY_OPERATOR_FILE=` line: "a JSON file outside the repository
     with the policy's operator identity facts; required with TELEGRAM_ENV=prod"; revision 2) +
     `privacy_operator_file: None` in `dev/src/lib.rs` and `it/common.rs`.
     - Red: `config::tests::privacy_operator_file_required_in_prod` (a prod lookup without the variable → a
       `ConfigError` naming `PRIVACY_OPERATOR_FILE`; the same lookup under `test` → `Ok`) — predicted red: the field
       is missing (a compile error, quoted), then `Ok` under prod on a scan that reads the variable as optional.
  2. `api/legal.rs` `Policy::load` + `lib.rs` (`AppState.policy`, `StartupError::Privacy`); the route serves
     `st.policy.html()`.
     - Red: `privacy_placeholder_refuses_prod_start` (a `Config { telegram_env: Prod, privacy_operator_file: Some(f),
       ..test_config(&db) }` whose file fills every identity key but `OPERATOR_NAME` (revision 2) → `AppState::new` is
       `Err(StartupError::Privacy)` naming `{OPERATOR_NAME}`) — predicted red on LF1's route before `Policy::load`:
       `Ok(state)`.
     - Red (revision 2, W1): `privacy_operator_content_key_refused` (test env; a host file with every identity key plus
       `RETENTION_PERIOD` → `Err(StartupError::Privacy)` from `PolicyError::ContentKey("RETENTION_PERIOD")`; the same
       with `POLICY_VERSION`) — predicted red on a `Policy::load` that admits every template placeholder (the
       revision-1 rule): `Ok(state)`.
     - Red (revision 3, W1): the pin checker. `check_pins(pins, meta, template)` sits in `api/legal.rs` with
       `POLICY_PINS` and `PinError`, all three `#[cfg(test)]` (META-PLAN M26, Rust types). It checks in this order:
       the versions strictly increase (`NotIncreasing { at }`), the last equals the meta (`LastNotMeta`), and the last
       row's hash equals the hex SHA-256 of the template (`HashMismatch`). The valid history V is
       `[("2026-10-31", H(T1)), ("2026-12-01", H(T2))]` with meta `2026-12-01` and template T2. Each crafted case breaks
       exactly one of V's conditions, and each test compares the whole `Result` (`assert_eq!`):
       - `api::legal::tests::pin_check_rejects_non_increasing_versions`: the rows `("2026-10-31", H(T1))`,
         `("2026-10-31", H(T2))` with meta `2026-10-31`, and the rows `("2026-12-01", H(T1))`, `("2026-10-31", H(T2))`
         with meta `2026-10-31` → `NotIncreasing { at: 1 }` for both;
       - `api::legal::tests::pin_check_rejects_last_not_meta`: V's rows with meta `2026-10-31` →
         `LastNotMeta { last: Some("2026-12-01"), meta: "2026-10-31" }`; an empty list →
         `LastNotMeta { last: None, .. }`;
       - `api::legal::tests::pin_check_rejects_hash_mismatch`: V with the two rows' hashes swapped →
         `HashMismatch { version: "2026-12-01" }`;
       - `api::legal::tests::pin_check_accepts_a_valid_history`: V → `Ok(())`.
       Predicted red against a `check_pins` stub that returns `Ok(())`: each of the three `rejects` tests fails with
       `left: Ok(())` (quoted; META-PLAN "Gates that must be seen red once"). A red that names a different variant
       means the checker's order or a crafted case is wrong.
     - Red (revision 2, W1; revision 3): `api::legal::tests::policy_template_pinned_per_version` runs `check_pins` on
       the real data: `POLICY_PINS`, `policy_version()` (the value consents record) and the compiled template bytes —
       predicted red: `POLICY_PINS` not found (a compile error, quoted). Seen red once: a scratch edit of one template
       word with no new row fails on the hash (`HashMismatch`, quoted), then reverted (META-PLAN "Gates that must be
       seen red once").
     - Also: `privacy_operator_file_fills_placeholders` (test env, every identity key given (revision 2), one value with
       `<` and `&`: the page holds the escaped values, no identity placeholder is left, and section 0 shows the meta
       version), `privacy_operator_unknown_key_refused` (a key the template does not use → `StartupError::Privacy`),
       `privacy_draft_served_without_file_in_test` (test env, no file → the template with its placeholders visible,
       `{POLICY_VERSION}` filled; revision 2),
       `api::legal::tests::policy_placeholders_classified` (revision 2: every `{UPPER_SNAKE}` of the template is in
       `IDENTITY_KEYS`, in `CONTENT_KEYS` or is `POLICY_VERSION`); LF1's `privacy_page_served_with_version` and
       `privacy_page_needs_no_token` stay green.
- **Gates:** fmt, clippy, test (the names above, counted).
- **Tester mutations:** drop the prod placeholder check; substitute without HTML escaping; accept unknown keys; read the
  variable outside `Config`; serve the unsubstituted template when a file is given; (revision 2) accept a content key
  from the host file; fill `{POLICY_VERSION}` from the host file; drop the pin's "last version equals the meta" check
  (revision 3: drop that comparison from `check_pins`, or make it compare the first row;
  `pin_check_rejects_last_not_meta` kills both).
- **Seen working:** `cargo test -p server --test it privacy_` and `cargo test -p server --lib config::` (revision 2:
  and `api::legal::`; revision 3: with the four `pin_check_` names) list every name. Live: `server-dev` (test env, no
  file) → `curl /api/privacy` shows the placeholders; the prod refusal is observed through
  `privacy_placeholder_refuses_prod_start` (a live prod start needs real secrets).

#### L10 client-data (client)
- **Goal:** the API client with single-flight re-auth; the saves service (rev, writeId, pending cache, conflict
  policy); the purchase state machine.
- **Lock:** `client/src/api/{http.ts,session.ts,endpoints.ts,decode.ts,http.test.ts,decode.test.ts}`,
  `client/src/saves/{service.ts,pending.ts,saves.test.ts}`, `client/src/purchase/{flow.ts,flow.test.ts}` (11).
- **Commits:**
  1. `http.ts` + `session.ts`, including `fetchAsset` (the `FetchAsset` of `story/catalog.ts`). Red: `http: 401
     re-auths once` on a stub without retry; `loader: expired token re-auths once then loads` (a gated
     `/api/assets/…` URL, first response 401) — predicted red: a Result error after one 401, with zero auth calls.
  2. `decode.ts` + Rust samples. Red: a seeded field rename in the samples.
  3. Saves service (`sentIds`, F3). Red: `saves: 409 pauses autosave`, `saves: retried write with same writeId is
     success`, `saves: lost response then newer body is not a conflict` — predicted red: autosave pauses and the
     conflict prompt fires after a 409 with `current.writeId = w1`.
  4. Pending cache (DeviceStorage via the facade, `{ baseRev, sentIds, body }`, server wins unless its `writeId` is
     ours). Red: `saves: reload uploads pending when server writeId is ours` — predicted red: the pending body is
     discarded against server rev 4.
  5. Purchase flow (fake timers): paid → poll backoff → unlocked; pending window; cancelled; failed; delayed; activated
     re-poll; `purchase_unlocks_only_from_server`.
- **Changed by PUZZLES-PLAN (re-cut; same lock).**
  - **Commit 1:** a 429 becomes an `ApiError` carrying `retryAfter` from the `Retry-After` header. Red:
    `http: 429 carries retryAfter`.
  - **Commit 2:** decoders + endpoints for `PuzzleStatus`, `HintTier`, `AttemptResponse` (`getPuzzle(id, lang)`,
    `postAttempt(id, answer)`), and the `world` field of `ChapterPayload`.
  - **Commit 5:** `createPurchaseFlow` takes `isOwned: (p) => Promise<Result<boolean, ApiError>>` (chapters:
    entitlements; hints: `getPuzzle` tier owned). Red: `flow: hint product confirms through puzzle status` (predicted
    red: the flow polls entitlements and never reaches `unlocked` for a `hint:` product).
- **Changed by STORIES-PLAN (re-cut; same lock, 11 files).** STORIES-PLAN Y7:
  - **Gate to start:** + LS2 (`SaveSummary.storyId` and the per-story routes in `api.ts`).
  - **Commit 2:** `listSaves()` (every story), `getSave(story, slot)`, `putSave(story, slot, req)`; the
    `SaveSummary` decoder with `storyId`.
  - **Commit 3:** `createSaveService({ …, story })`, one per game session.
  - **Commit 4:** the pending entry is `pending_<storyId>`; F3 step 5 runs per story against that story's `auto`
    summary. Red: `saves: pending entry is per story` (a `manor` pending body and a `tide` server summary of the same
    rev) — predicted red on one global key: the `manor` body uploaded into `tide`'s slot. Also `saves: list spans
    stories`.
- **Gates:** `check`, `test`.
- **Seen working:** `npx vitest run src/api src/saves src/purchase --reporter=verbose`.
- **Changed by META-PLAN (re-cut; same lock, 11 files).** META-PLAN M19, M21:
  - **Commit 2:** the `PuzzleStatus` decoder reads `hints: HintView[]` (`{ tier, unlocked, text }`; `HintTier` and
    `owned` are gone). Red: `decode: puzzle status with unlocked hints` (a sample with tier 1 unlocked and its text,
    tier 2 locked with `text: null`) — predicted red on the PZ decoder: `Err` on the missing `owned` field.
  - **Commit 5:** `createPurchaseFlow` takes `isDelivered: (p) => Promise<Result<boolean, ApiError>>` instead of
    `isOwned` (chapters: entitlements; packs: the polled order's `status: paid`, which the grant sets in the credit's
    transaction). Red: `flow: pack product confirms through order status` (an order that turns `paid` while the
    entitlements stay empty) — predicted red on `isOwned`: the flow never reaches `unlocked` for a `pack:` product.
    It replaces `flow: hint product confirms through puzzle status`; no `hint:` product exists (M21). The wallet is
    read by LMI after `unlocked`, not by the flow.

#### L9 refunds-bot (server)
- **Goal:** the admin refund + revoke; `refunded_payment`; `/start`, `/terms`, `/support`, `/paysupport`; the `setup`
  subcommand; the optional static dir.
- **Lock:** `server/src/telegram/{mod.rs,commands.rs,setup.rs,texts.rs,payments.rs,webhook.rs}`,
  `server/src/db/payments.rs`, `server/src/main.rs`, `server/src/api/{mod.rs,static_files.rs}`,
  `server/locales/{bot.ru.json,bot.en.json}`, `server/dev/src/simulate.rs`,
  `server/tests/it/{main.rs,refunds.rs,bot.rs}` (16; `telegram/mod.rs` is the `pub mod` lines). The new dev refund
  routes go into `simulate.rs`'s `routes()`, so the dev `lib.rs` is not touched.
- **Commits:**
  1. Revoke transaction. Red: `refund_revokes` against a stub.
  2. Admin refund via the gateway. Red: `refund_gateway_error_keeps_entitlement`.
  3. `refunded_payment` handling, including the K17 probe branch. Red: `refunded_payment_update_revokes_idempotent`;
     `webhook_refund_undecodable_by_frankenstein_still_revokes` — predicted red: 200 with the entitlement still
     present.
  4. Commands + texts. Red: `start_has_web_app_button`, `refund_command_admin_only`,
     `bot_texts_complete_and_within_limits`.
  5. Unapplied charges (K19): `notify_unapplied` after an `OrderMismatch` / `AlreadyEntitled` commit (bot text
     `payment_unapplied`); `/paysupport` flags them. Red: `unapplied_charge_notifies_payer_and_admin` — predicted red:
     the fake gateway records 0 messages; `paysupport_flags_unapplied_charge`.
  6. `setup` subcommand (fake gateway records the calls).
  7. `STATIC_DIR` + `static_dir_must_not_contain_content_dir` + `paid_chapter_403_after_refund`.
- **Changed by PUZZLES-PLAN (re-cut; same lock).**
  - **Commit 1** adds `refund_revokes_hint` (after the revoke, `GET /api/puzzles/{id}` shows `owned: false`,
    `text: null`; predicted red against a revoke stub: the text still served).
  - **Commit 4** moves the pre-checkout reject texts (incl. `Unavailable`) from L8b's `match` into `bot.*.json`
    under `bot_texts_complete_and_within_limits`.
  - `/paysupport` lists hint charges like any other (no code change; covered by `paysupport_flags_unapplied_charge`
    on a hint order).
- **Changed by STORIES-PLAN (gate only).** Gate to start: LS3 merged (the serialized server files; LS3 runs before
  L9, SQ4). Refunds revoke entitlements only; statistics rows of a refunded chapter stay as history and grant
  nothing (STORIES-PLAN ST4).
- **Gates:** fmt, clippy, test.
- **Seen working:** `curl POST /dev/refund` → `GET /api/chapters/ch2` → 403.
- **Changed by META-PLAN (re-cut; same lock, 16 files).** META-PLAN M19, M20, M26:
  - **Gate to start:** LE2 merged (the serialized server files; LE1's `clawback_in_tx` and ledger; L9 runs last in
    the server chain).
  - **Commit 1:** `refund_revokes_hint` is dropped (no hint entitlements exist, M21). The revoke transaction branches on
    the order's product like the grant: `Chapter` → the entitlement delete; `Pack` → `clawback_in_tx` with key
    `refund:<charge>` before the commit. Revision 1 (W3): the clawback's kind and amount are the charge's
    `pay:<charge>` ledger row's (`credited_by_charge`, LE1), never the catalog's; no such row → no clawback.
    - Red (revision 1): `refund_claws_back_the_credited_amount` (a `pack:hint_s` order whose binding was raised to 7
      by raw SQL before the payment, so 7 were credited while the catalog's `hint_s` holds 3; refunded → one `refund`
      ledger row of −7) — predicted red on a clawback that reads the catalog: −3.
    - Red: `refund_pack_claws_back_unspent` (a pack of 3, nothing spent → balance 0, one `refund` ledger row of −3) —
      predicted red on the chapter-only revoke: balance 3.
    - Red: `refund_spent_pack_records_debt` (3 credited, 2 spent → balance 0, debt 2) — predicted red on a stub with
      `balance - n`: `("23514", "resource_balances_balance_nonneg")`.
    - Also: `refund_pack_twice_claws_once` (the admin refund, then `refunded_payment` → one clawback, the `refunded_at`
      guard and the ledger key), `refund_gifted_pack_keeps_friend_balance` (a gift moved before the refund: the
      friend's balance unchanged, the sender's debt grows).
  - **Commit 4:** + the `/privacy` command (bot text `privacy` in `bot.*.json` with `<PUBLIC_APP_URL>api/privacy`;
    `setMyCommands` lists it). Red: `privacy_command_links_policy` — predicted red: the unknown-command reply.
  - **Commit 5:** "unapplied" = no `entitlements` row **and** no ledger row of the charge, and `refunded_at IS NULL`
    (META-PLAN M19). Red: `paysupport_pack_credit_is_applied` (a paid pack with its `pay:<charge>` ledger row is not
    flagged) — predicted red on the entitlement-only query: flagged. The PUZZLES-PLAN line on hint charges in
    `/paysupport` is superseded (no hint products).
  - The pre-checkout reject texts moved into `bot.*.json` lose `Unavailable` (L8b re-cut: it existed only for hint
    tiers).
  - **Tester mutations** add: claw back from the gift recipient; skip the clawback when the balance is 0; flag a pack
    charge with a ledger row as unapplied; (revision 1) take the clawback amount from the catalog.
  - **Gate to start (revision 1):** LPO merged (the serialized server files; LPO runs between LE2 and L9).
  - **Seen working** adds: a dev pack bought and refunded (`/dev/refund`) → `GET /api/wallet` shows balance 0 and the
    debt of the spent part.

#### L11 scene (client)
- **Goal:** the scene controller (Pixi), the registry, the loader, the executor, layout, the render loop, preload,
  context loss.
- **Lock:** `client/src/scene/{controller.ts,registry.ts,loader.ts,executor.ts,layout.ts,render-loop.ts,preload.ts}`,
  `client/src/scene/{registry.test.ts,executor.test.ts,layout.test.ts,preload.test.ts}` (11).
- **Commits:**
  1. `layout.ts` (resolution clamp, slots, cover). Red: `layout: resolution capped at 2` on a stub.
  2. Registry (holders, caps 32 / 48 MiB, over-cap refusal, abort, idempotent release). Red:
     `registry_returns_to_baseline`, `registry_caps`, `registry: visible load over hard cap after eviction is refused`
     — predicted red: the load succeeds and live bytes exceed 48 MiB.
  3. Executor over a `StageAdapter` (batch order of STAGING-DSL §7, skip, complete, snapshot at batch start). Red:
     `executor_kills_timelines`, `executor_sprite_count_per_slot`.
  4. Render loop (idle when nothing is active). Red: `render_loop_idles`.
  5. Preload scheduler (`preload(tag, ids, from?)`, the `next:<chapterId>` holder kept by `setChapter` to that
     chapter). Red: `abort_after_release_destroys`; `preload: next-chapter id resident after setChapter` (an id only
     in the next manifest) — predicted red: a "missing id" error value, or a second fetch of the id.
  6. Pixi controller + loader over the injected `FetchAsset` (a fake in tests; no `fetch` in `scene/`) (verify:
     `Texture` from `ImageBitmap`, the 8.22 accessibility option) + context-loss rebuild.
- **Changed by PUZZLES-PLAN (re-cut).**
  - **Gate to start:** + LW1 (props types in `staging.ts`).
  - **Lock:** + `client/src/geom/{cover.ts,cover.test.ts}` → 13.
  - **Commit 1:** `layout.ts` uses `geom/cover.ts` (`cover`, `toStage`, `minTarget`, `ROOM_SOURCE`,
    `HOTSPOT_SAFE_FRAME`). Red: `cover: hotspot rect follows the bg cover transform` (an identity stub fails at a
    390×844 stage) and `cover: small target expanded to 44 px`.
  - **Commit 3:** the executor gets the `props` layer and the `props` command; any `bg` / `scene` clears props;
    `snapshot()` / `restore()` carry `props`; holders `scene:prop:<id>`. Red: `executor: scene clears props`,
    `executor: props survive restore`.
  - **Commit 5:** `room:<id>` preload holders need no new API (`preload(tag, ids)` / `releasePreload(tag)` serve
    them); `registry_caps` gains a case of three neighbour backgrounds where the third is refused.
  - **Commit 6** (changed by PUZZLES-PLAN revision 1, W3): `debugPropRects()` — the page CSS px rects of the live
    prop sprites, next to `debugForceContextLoss()` and wired to `__novelDebug` only under `__TG_MOCK__` (by L15).
    Red-first impossible in this lane: the rects need a real canvas layout, which happy-dom has not; the accessor is
    proved by the L15 e2e `explore: hotspot buttons align with props under safe area and landscape`.
- **Gates:** `check`, `test`; `build` stays green with the engine row PENDING (this lane creates no `app/engine.ts`).
- **Seen working:** a dev-only scene harness is not added. In this lane: the unit tests by name (`npx vitest run
  src/scene --reporter=verbose`). The engine closure is first measured in L15, when `app/engine.ts` lands and the
  engine row turns from PENDING to a measured row.
- **As merged (`1e2f421`, RULINGS 35; the cut `D:/tmp/novel-orch/l11-scene/cut.md` Q4):** 7 commits, not 6. Commit
  6 is split, and PUZZLES-PLAN's commit-5 `registry_caps` room case moves into C2, since a case added after its logic
  exists can never be red. C1 layout (`9aff99b`); C2 the registry, with the room case (`ef2a463`); C3 the executor
  (`d83917e`); C4 the render loop (`2dfbce2`); C5 the preload scheduler (`5f03cfa`); C6 the Pixi controller + loader,
  red-first impossible (`b5f8352`); C7 context-loss rebuild, relayout and `debugPropRects`, with two real reds
  (`1cb2688`). Then six test-only commits from the review rounds (`c24eef3`, `60b48a6`, `da1042c`, `4553613`,
  `3364f2d`, `962ddea`).

#### L12 audio (client)
- **Goal:** the gesture unlock, buses, BGM A/B streaming (blob for paid), the SFX cache, lifecycle.
- **Lock:** `client/src/audio/{unlock.ts,manager.ts,bgm.ts,sfx.ts,audio.test.ts}` (5).
- **Commits:**
  1. `unlock.ts`.
  2. Manager + buses (fake `AudioContext`; `createAudioManager(ctx, { fetchAsset })`, no `fetch` in `audio/`). Red:
     `bgm_crossfade_ramps_gains`.
  3. BGM (A/B, same-track vol tween, paid track via `fetchAsset` → blob URL, revoke). Red: `bgm_revokes_blob_urls`.
  4. SFX cache cap + chapter release; `preload(ids, from?)` resolves in the next manifest and survives `setChapter`
     to it. Red: `sfx_cache_cap`, `sfx_cache_released_on_chapter`, `audio: next-chapter sfx survives setChapter`.
  5. Suspend/resume + `needs-gesture`.
- **Gates:** `check`, `test`.
- **Seen working:** unit tests by name; on device in L15.

#### L13 story-runtime (client)
- **Goal:** the runner; the chapter loader; carry; the save codec; resume (exact/checkpoint/chapter start); line text.
- **Lock:** `client/src/story/{runner.ts,chapters.ts,carry.ts,save-codec.ts,resume.ts}`, `client/src/i18n/lines.ts`,
  `client/src/story/{runner.test.ts,resume.test.ts,save-codec.test.ts}` (9).
- **Commits:**
  1. Runner over fixture chapters compiled in-test with `scripts/story/compile.ts`. Red:
     `runner: tag-only steps merge into next`; `runner: speaker prefix stripped`.
  2. `enteredKnot` detection (verify: `currentPathString`).
  3. Save codec. Red: unknown format → error value.
  4. Resume (`minLevel`, the error floor). Red: `resume: checkpoint after removed line` (the R3 probe case),
     `resume: chapter start after knot rename`; `resume: ink error after checkpoint resume falls back to chapter
     start` (a tunnel fixture compiled in-test without the lint, the one way to provoke a real post-checkpoint ink
     error: the first resume lands at the checkpoint and the runner hits "Found tunnel onwards statement"; the next
     resume with the lowered `minLevel` must start the chapter) — predicted red: the second resume returns the same
     checkpoint and the same `RunnerError { kind: 'ink' }`.
  5. Carry + chapter loader (paid via `endpoints`, generation numbers). Red: `carry: g_ vars carried`.
  6. `lines.ts`. Red: `en missing falls back to ru and counts`.
- **Changed by PUZZLES-PLAN (re-cut).**
  - **Gate to start:** + LW2.
  - **Lock:** + `client/src/story/catalog.ts` (`LoadedChapter.world`) → 10.
  - **Commit 1** adds the `yield` step: the story stops (`!canContinue`, no choices) with a yield command in the last
    batch. Red: `runner: puzzle yield stops at DONE` — this verifies `canContinue === false` after `-> DONE` (PE6; a
    different red, e.g. a `ran out of content` error, is a STOP).
  - **New commit 1a:** `enter(knot, projection)`.
    - Red: `runner: then-knot choices see the outcome`. Fixture: the then-knot starts with `* {pz_x == 1} [Open …]`
      followed by the fallback `* [Leave …]`, and the projection sets `pz_x = 1`. The stub calls
      `ChoosePathString(then)`, then the first `Continue()`, and writes the projection only after it. Predicted red:
      the choices are `[Leave …]` only (no `Open` choice). Why this stub (changed by PUZZLES-PLAN revision 1, W8):
      inkjs 2.4.0 evaluates a choice condition in `ProcessChoice` during `Continue()`, while `ChoosePathString` only
      moves the pointer (PUZZLES-PLAN "Platform facts"), so a stub that writes between `ChoosePathString` and
      `Continue()` is already correct and cannot be red. A different red (no choices at all, or an ink error) means
      the fixture is wrong: STOP.
    - Red: `runner: enter rejects undeclared projection var`, `runner: enter outside a yield is an error`.
  - **Commit 3:** `SaveBodyV1` with `at.yield`, `world` (`EMPTY_WORLD_STATE` default) and `worldVersion` (`null`
    default; changed by PUZZLES-PLAN revision 1, W5). Red: `save-codec: world round trip` (the version included).
  - **Commit 4:** the exact level rebuilds a stored yield, and every level passes `world` through
    `reconcile(world, state, knots, body.worldVersion)` (chapter start → `EMPTY_WORLD_STATE`); a non-null `reset`
    is returned to the caller, which shows the toast `explore.area_reset` (L15). An exploration puzzle is not
    reopened by resume: the room resumes with the puzzle closed and a tap on the lock reopens it (PUZZLES-PLAN X8,
    F9). Red: `resume: exact at a yield re-yields` (predicted red: the resumed runner reports `end`).
  - **Commit 5:** the chapter loader reads `<ch>.world.json` (free, by URL) or `ChapterPayload.world`, through
    `decodeWorldPublic`.
- **Changed by STORIES-PLAN (gate only; same lock).** Gate to start + LS1 (`catalog.ts` is serialized L5 → LS1 →
  L13). `LoadedChapter.meta.endings` arrives through LS1's `decodeChapterMeta`; the runner is unchanged (ending
  detection is GameSession's, from `enteredKnot`, L15). `carry.ts` needs no story check: `next` stays on the story's
  chain by `catalog/stories`.
- **Gates:** `check`, `test`.
- **Seen working:** unit tests by name.

#### D1 docs-authoring (doc-writer)
- **Goal:** AUTHORING.md for writers; FEATURE_MAP.md and ARCHITECTURE.md first versions from the merged tree.
- **Lock:** `docs/AUTHORING.md`, `docs/FEATURE_MAP.md`, `docs/ARCHITECTURE.md` (3).
- **Changed by PUZZLES-PLAN (re-cut; same lock).**
  - **Gate to start:** + LW3.
  - **AUTHORING.md** gains a world-authoring part:
    - the `world.json` format with the source example;
    - hotspot kinds;
    - locks and slots;
    - effects and the once rule;
    - the safe frame and target sizes;
    - the yield block (`# puzzle: … then=…` / `# explore: …` + `-> DONE`);
    - event knots ending in their section's yield;
    - projection VARs (`pz_*`, `it_*`, `dc_*`) and declaring them;
    - writing a hint ladder (nudge → direction → solution; titles ≤ 18 graphemes);
    - the `world/*` lint codes and reading a soft-lock counterexample.
  - **FEATURE_MAP / ARCHITECTURE** get the PUZZLES-PLAN rows for whatever has merged.
- **Changed by STORIES-PLAN (re-cut; same lock).**
  - **Gate to start:** + LS1.
  - **AUTHORING.md** gains a stories part: `story/stories.json` (the format; the Home order); a story = the `next`
    chain from `first`; the first chapter is free; chapter ids are game-unique (story B starts at the next free
    `ch<N>`); declaring an ending (a knot with `-> END`, no successors, no yield; the name in `stories.json`; the
    ending knot and the gate's findings); "The End" vs "To be continued"; shared cast and globals, `g_<story>_<name>`;
    titles and teasers in `story.json`; a paid chapter's title is the invoice title (≤ 32 characters); never move a
    shipped chapter to another story; cover requests go to the asset catalog.
  - **FEATURE_MAP / ARCHITECTURE** get the STORIES-PLAN rows (Stories, Saves per story, Player statistics) for
    whatever has merged.
- **Changed by META-PLAN (re-cut; same lock, 3 files).** No new gate (LM1 runs beside D1, M28). If LM1 has merged
  when D1 starts:
  - **AUTHORING.md** gains a story-meta part: `story/meta.json` (ending titles, achievements, their `when` conditions
    and the seven kinds, the text limits, the `hidden` flag, retiring an achievement id); "every declared ending needs
    a title"; "meta texts are server-only: never in ink or a locale table"; "a choice's line ID is its statistics
    identity: keep it when you edit the text, retire it when you remove the option"; the `catalog/meta` codes.
  - **FEATURE_MAP / ARCHITECTURE** get META-PLAN's rows ("docs/FEATURE_MAP.md entries") for whatever has merged.
  - Otherwise D2 writes both (its re-cut). Either way N1 writes `story/meta.json` from AUTHORING.md or, before it
    exists, from STAGING-DSL §9 "Story meta" (LM1).

#### L14a overlay-core (client)
- **Goal:** the view model, the screen stack ↔ BackButton, TapToStart, Stage host, DialogueBox + typewriter, Choices,
  QuickBar, Toast (transient or sticky, ≤ 2 actions: it carries the resume notice, the save-conflict prompt "Load it /
  Keep playing here", the "tap to resume sound" chip and the purchase toasts; a sticky `dev` variant is the tag-error
  banner, rendered only under `__TG_MOCK__`), UI tables (keys for all of these). The full screen map is under L14b.
- **Lock:** `client/src/ui/{state.svelte.ts,screens.ts,TapToStart.svelte,Stage.svelte,DialogueBox.svelte,typewriter.ts,Choices.svelte,QuickBar.svelte,Toast.svelte}`,
  `client/src/i18n/{ru.ts,en.ts,index.ts}`,
  `client/src/ui/{typewriter.svelte.test.ts,screens.svelte.test.ts,choices.svelte.test.ts}` (15).
- **Commits:** red-first per component behaviour test. `screens: back button visible iff overlay`, `typewriter: *`,
  `choices: no tap-through`.
- **Changed by PUZZLES-PLAN (re-cut; same lock).**
  - `screens.ts`: the `Screen` union includes `inventory | document | lock | puzzle | hints`, plus
    `setRootBack(fn | null)`; visible = stack non-empty or a root-back set; a press pops the overlay first.
  - Red: `screens: back walks the room path when no overlay` (predicted red: the button hidden with a root-back set).
  - `Stage.svelte` (changed by PUZZLES-PLAN revision 1, W3) renders an optional `children` snippet inside the stage
    host element, the box Pixi's `resizeTo` reads; L15 mounts the hotspot layer there (PUZZLES-PLAN X10 "The box").
    It also exposes the host element to its parent (L15 passes it to `createExploreController` as `deps.stageHost`).
    Red-first impossible in this lane: the misplacement it prevents is an offset by the overlay inset, which only a
    real layout shows; the gate is the L15 e2e `explore: hotspot buttons align with props under safe area and
    landscape`.
- **Changed by STORIES-PLAN (re-cut; same lock, 15 files).** STORIES-PLAN Y14:
  - `TapToStart.svelte` becomes Home's frame: an optional Continue (`continueLabel: string | null`, rendered with
    `tap.continue_story` "{story}") and a `children` snippet where L15 mounts L14b's `StoryPicker`. Every button's
    handler is synchronous up to the caller's `unlockAudio()` (the gesture; no `await` before it).
  - `screens.ts`: Home is a root view, not an overlay — no BackButton (unchanged rule: visible iff an overlay or a
    root-back); the `chapters` overlay carries its story (`{ kind: 'chapters'; story: StoryId }`).
  - `ru.ts` / `en.ts`: `tap.continue_story`.
  - Red (dom, in `screens.svelte.test.ts`): `tap: continue names the story` — predicted red: the label renders without
    the story title. `screens: back button visible iff overlay` gains the case "Home shown, no overlay → hidden".
- **Gates:** `check`, `test` (the `dom` project names present).
- **Seen working:** inside the lock (`ui/App.svelte` is L1's and L15's): `npx vitest run --project dom src/ui
  --reporter=verbose` lists `screens: *`, `typewriter: *`, `choices: *` by name; the components render in happy-dom.
- **Changed by META-PLAN (re-cut; same lock, 15 files).** META-PLAN M27:
  - `screens.ts`: the `Screen` union gains `{ kind: 'card'; story: StoryId } | { kind: 'friends' } | { kind: 'friend';
    handle: string } | { kind: 'wallet' } | { kind: 'gift'; to: string } | { kind: 'consent' } | { kind: 'invite';
    code: string }` (revision 1, C1 / W1: a friend handle and the presented invite code, never a Telegram id); each is
    an overlay (BackButton visible; a press pops it, K26). The components are LU1's; App mounts them (LMI).
  - Red (dom, in `screens.svelte.test.ts`): `screens: meta overlays close with back` (each of the seven kinds pushed
    over `the_end` and over Home; one press returns to the view below) — predicted red: the union rejects the kinds
    (a `check` error, quoted), then the button hidden for a kind missing from the overlay set.
- **As merged (`e5ce724`, RULINGS 44, 49; the cut `D:/tmp/novel-orch/l14a-overlay-core/cut.md`):**
  - **Lock 17:** the 15 above plus `client/src/telegram/{webapp.ts,telegram.test.ts}` (one registration per event and a
    dispatch over a snapshot, L7 review M1).
  - **Commits (C1-C8):** C1 the Telegram facade's event registration (`e2bcadc`); C2 the UI tables and `t()`
    (`1818daf`); C3 the screens stack and the BackButton (`0a63781`); C4 the view model and Toast (`6eacaa1`); C5 the
    Home frame and the stage host (`412f561`); C6 the typewriter and DialogueBox (`09845a2`); C7 Choices and QuickBar
    (`af0e6fa`); C8 no literal text in the components (`bec77c3`).
  - **Names:** 34 new (baseline rows `L14a`).
  - **The META red (cut Q5).** `RootView` is `home | game | notice` without the notice identity
    (`client/src/ui/screens.ts:35`), so "pushed over `the_end`" is a push over `{ kind: 'notice' }`. Every `Screen` is
    an overlay by type, so "the button hidden for a kind missing from the overlay set" has no runtime form: it is the
    `check` error (TS2322) of the first red.

#### LU1 meta-ui (client; new, META-PLAN)
- **Goal:** the presentational meta overlays and their locale table, one lazy chunk (META-PLAN M9, M12, M13, M22,
  M27): the completion card, friends, a friend's profile, the wallet, the gift dialog, the consent dialog, the invite
  prompt. No endpoint, no service, no Telegram call: props in, callbacks out.
- **Gate to start:** L14a merged (the seven `Screen` kinds; `Toast`).
- **Lock:** `client/src/ui/meta/{index.ts,CompletionCard.svelte,Friends.svelte,FriendProfile.svelte,Wallet.svelte,
  GiftDialog.svelte,ConsentDialog.svelte,InvitePrompt.svelte,meta.svelte.test.ts}`, `client/src/i18n/meta.ts` (10;
  all new).
- **Contract:** `index.ts` is the chunk's only entry (`loadUi` in LMI imports it dynamically); it exports the
  components and their prop types (`CardProps`, `FriendsProps`, … — structural mirrors of META-PLAN's views, so LU1
  needs no LMD file; LMI's `check` proves the views assignable). Texts arrive as props in the UI language (the card's
  titles are server data); the components never store them.
- **Commits:**
  1. `i18n/meta.ts` (ru first, en second; the `meta.*` keys of every overlay). Red: `i18n: meta keys complete in ru
     and en` — predicted red: the test lists a key the table lacks.
  2. `CompletionCard.svelte` (runs, completed chapters, found endings by title, achievements with "new" marks, Share).
     - Red (dom): `card: lists endings and achievements, new ones marked` — predicted red: the component missing (an
       import error), then no mark on a stub.
     - Red (dom): `card: no total or empty slots` (the rendered text has no "of", no count of all endings, no locked
       placeholder) — predicted red on a template copying SP's "X of Y": the total rendered.
     - Also: `card: data dropped on close` (after unmount the props object is not retained by a module-level store).
  3. `Friends.svelte`, `FriendProfile.svelte`, `InvitePrompt.svelte` (revision 1, C1: the prompt has no name prop — it
     names nobody — and its text says that the person who shared the link will see the player's first name and that a
     friendship forms only if that person accepts; Send / Not now callbacks. Friends lists incoming requests with
     Accept / Decline, the decline text saying the person cannot ask again; rows are keyed by handle, W1).
     - Red (dom): `friends: requests show accept and decline`; `invite: prompt names nobody and says who sees the name`
       (was `invite: prompt names the inviter`) — predicted red: the components missing.
  4. `ConsentDialog.svelte` (its own text, the policy link through a callback, off by default) and `Wallet.svelte`
     (balances, debt, packs with server prices). Revision 1 (C1): the consent text `meta.consent_body`
     (`friends_profile.v1`) names the circle — the player's friends, the people whose request the player accepted and
     the people who accepted the player's request.
     - Red (dom): `consent: off by default and one tap withdraws` — predicted red on a stub with `checked` from props
       defaulting to true: on.
     - Also (revision 1): `consent: text names the friend circle` (the rendered ru and en texts carry the circle
       sentence).
     - Also: `wallet: packs show server prices and debt`.
  5. `GiftDialog.svelte` + `index.ts`. Red (dom): `gift: amount bounded by balance and caps` (the stepper stops at
     the balance; an `error: 'limit'` prop shows `meta.gift_capped` — the daily caps are the server's, LE2) —
     predicted red: the stepper passes the balance.
- **Gates:** `check`, `test` (the `dom` names counted).
- **Tester mutations:** render the ending total; default the consent to on; store the card props in a module `$state`.
- **Seen working:** `npx vitest run --project dom src/ui/meta --reporter=verbose` lists every LU1 name; the chunk is
  measured in LMI.

#### N1 demo-story (narrative-designer)
- **Goal:** ch1 (5–10 min, meaningful choices, `g_` state, cliffhanger ending) and ch2 (short, reacts to ch1), ru +
  en, within the L3a catalog. The genre stays a placeholder (Q1).
- **Lock:** `story/ch1/**`, `story/ch2/**`, `story/common/globals.ink`, `story/locales/**`, `story/retired-ids.txt`,
  `story/lint-allow.json`.
- **Changed by PUZZLES-PLAN (re-cut; same globs).**
  - **Gate to start:** + LW3 (and L5's catalog additions).
  - **Content** per PUZZLES-PLAN "Demo content outline":
    - `story/ch1/world.json`: the `manor` section — rooms `hall`, `study`, `cellar`; the 3-slot gate with the `gate`
      order puzzle and its fail branch; the `drawer` code lock with 3 hint tiers; documents `letter`, `diary`;
    - the ch1 ink yields and event knots (`manor_arrive`, `manor_cellar_voice`, `manor_gate_forced`, `manor_out`);
    - `story/ch2/world.json`: the `cabinet` linear puzzle, `giveUp`, `maxAttempts: 3`, 3 tiers;
    - `globals.ink` `g_gate_forced`;
    - every world text and hint with an ID and an en entry.
  - **Hint prices** are not written here: they are server values (Q14). Hint texts follow the ladder convention.
- **Changed by STORIES-PLAN (re-cut).**
  - **Gate to start:** + LS1 (`story/stories.json` exists).
  - **Lock:** + `story/stories.json` (the globs already hold `story/locales/**`).
  - **Content:** ch1–ch2 are story `manor`. ch2's `archive_after` diverts on `pz_cabinet` to `archive_truth` (solved)
    or `archive_ashes` (failed or abandoned), each `-> END`; `stories.json` declares them as the endings `truth` and
    `ashes` (replacing LS1's skeleton ending `end`); `manor`'s title and teaser in `story.json` (STORIES-PLAN "Demo
    content outline").
- **Gates:** `story` green, naming both chapters, with the world line `softlock OK` for ch1; `build` green (budgets
  incl. `budget/room-set`, scan incl. hint fingerprints).
- **Seen working:** the story gate's coverage report (incl. `pz_*` outcomes seen); the L15 e2e plays it.
- **Changed by META-PLAN (re-cut).** META-PLAN M4, "Demo content outline":
  - **Gate to start:** + LM1 (`story/meta.json`, the `catalog/meta` lint and LS1's skeleton ending title).
  - **Lock:** + `story/meta.json`.
  - **Content:** `story/meta.json` `manor`: the titles of `truth` and `ashes` (ru, en) replacing LM1's title of the
    skeleton ending `end`; the achievements `drawer_no_hints`, `cabinet_no_hints`, `both_endings`, `sharp_mind`
    (hidden), with names and descriptions (ru, en; within the limits). Every ch1/ch2 choice keeps its line ID as its
    statistics identity (M1). Titles and descriptions never appear in ink or a locale table.
  - **Gates** add: `story` green with `catalog/meta` (every declared ending has a title; conditions name existing
    endings, choices, chapters and puzzles); `build` green with the scan's meta fingerprints.

#### N2 story-tide (narrative-designer; new, STORIES-PLAN)
- **Goal:** story B, `tide` (STORIES-PLAN "Demo content outline"): a different cast (`keeper`, `radio`), ch3 free
  with a mid-story bad end (`drowned`) and a chapter end into the paywall, ch4 paid with the ending `dawn`; ru + en;
  no world. The premise stays a placeholder (Q1).
- **Gate to start:** N1 merged (they share `stories.json`, `story/locales/**`, `globals.ink`), LS1, L5 (story B's
  catalog additions).
- **Lock:** `story/ch3/**`, `story/ch4/**`, `story/chapters.json`, `story/stories.json`, `story/cast.json`,
  `story/common/globals.ink`, `story/locales/en/{ch3.json,ch4.json}`, `story/locales/{ru,en}/story.json`.
- **Commits** (narrative lanes have no red-first; the story gate is the check). Changed by STORIES-PLAN revision 1:
  each commit carries the cast, names and titles its chapters and story need, because `speaker/unknown` (E,
  `lint.ts`), L3c's `loc/missing-name` (E) and `catalog/stories` rule 9 fail a commit that lists a chapter or a story
  before them; each commit quotes `npm --prefix client run story`, `build` and (changed by STORIES-PLAN revision 2,
  W1: `build` runs no vitest, so only `test` shows a tool test that a new speaker moves) `test` exit 0 on its own
  tree.
  1. Story B up to the end of ch3: cast `keeper` (sprite) and its names (`story.json` `names`, ru and en);
     `chapters.json` + ch3 (`shore`, `shore_drowned`, `lighthouse`, `lighthouse_stairs`; free, `next: null` until
     commit 2) and its title (`chapters`, ru and en); `g_tide_trust_keeper`; the `tide` entry in `stories.json` (first
     `ch3`, cover `cover/tide`, ending `drowned`) with its title and teaser (`stories`, `teasers`, ru and en); IDs; the
     en table `ch3.json`. The stories line reads `…; tide (ch3), endings 1`.
  2. ch4: cast `radio` (no sprite) and its names; ch3's `next: ch4` and ch4 (`lamp`, `lamp_dawn`; paid, `productId:
     chapter:ch4`) with its title (ru and en, ≤ 32 characters: rule 9); ending `dawn`; IDs; the en table `ch4.json`.
     The stories line reads `…; tide (ch3 → ch4), endings 2`.
- **Gates:** `story` green (prints both stories; `ch3: 200 runs, … endings 2/2`; `ch4` carried from the ch3 runs
  that did not end in `drowned`); `build` green (two first-load rows, scan with ch4's fingerprints and its paid-only
  assets `bg/lamp_room`, `bgm/storm`); `test`.
- **Seen working:** `npm --prefix client run story` prints `stories: manor (ch1 → ch2), endings 2; tide (ch3 → ch4),
  endings 2`; the L15 e2e `stories.spec.ts` plays it.
- **Changed by META-PLAN (re-cut).** META-PLAN "Demo content outline":
  - **Gate to start:** unchanged (N1 merged implies LM1).
  - **Lock:** + `story/meta.json`.
  - **Commit 1** adds the `tide` meta: the title of `drowned` (ru, en); `first_ending` (`{ "endings": 1 }`) and
    `trusted_keeper` (`{ "choice": "<the ch3 option that trusts the keeper>" }`, the option's line ID read from the
    compiled ch3) with names and descriptions. **Commit 2** adds the title of `dawn`, `dawn_seen` and `all_tide`
    (their gates are derived: ch4, and ch3 + ch4).
  - Each commit's `story` exit 0 includes `catalog/meta`; the LMI e2e relies on `tide.drowned` + `first_ending`.

#### L14b overlay-menus (client)
- **Goal:** Menu, Backlog, Settings (text speed, per-bus volume, language), Save/Load, ChapterSelect, Paywall (terms
  checkbox; price from the server), Terms, Notice (the full-screen notices); the settings store over CloudStorage (+
  the read-set).
- **Lock:** `client/src/ui/{Menu.svelte,Backlog.svelte,Settings.svelte,SaveLoad.svelte,ChapterSelect.svelte,Paywall.svelte,Terms.svelte,Notice.svelte,menus.svelte.test.ts}`,
  `client/src/settings/{store.ts,store.test.ts}`, `client/src/i18n/{ru.ts,en.ts}` (13).
- **Commits:** red-first per behaviour: `menus: paywall needs terms checkbox`, `settings: cloud value over 4096 chunks`,
  `settings: forged owned flag ignored`, `menus: notice kinds show their actions` (every `Notice` kind renders its
  title and its action from i18n keys).
- **Screen map** — every screen of F1–F5, P1–P9 and the overlay stack has a component and i18n keys in a lane's lock
  (L15 only wires them in `App.svelte`):

  | Screen | Component | i18n keys | Lane |
  |---|---|---|---|
  | Tap to start / Continue | `TapToStart` | `tap.*` | L14a |
  | Dialogue, choices, quick bar | `DialogueBox`, `Choices`, `QuickBar` | `quick.*` | L14a |
  | Resume notice, save-conflict prompt, "tap to resume sound" chip, purchase toasts (failed, refunded) | `Toast` | `toast.*` | L14a |
  | Dev tag-error banner (`__TG_MOCK__` only, not player-facing) | `Toast` `dev` variant | — | L14a |
  | Open in Telegram, Reopen the app, error + Retry, story error + Return to last save, To be continued | `Notice` (one full-screen component, kind-driven) | `notice.*` | L14b |
  | Menu overlay | `Menu` | `menu.*` | L14b |
  | Backlog, Settings, Save/Load (+ "Overwrite?"), Chapter select, Paywall (+ `delayed` / Check again), Terms | as named | `backlog.*`, `settings.*`, `saves.*`, `chapters.*`, `paywall.*`, `terms.*` | L14b |
  | Explore bar, hotspot layer, inventory (items / files), document reader, lock panel (changed by PUZZLES-PLAN) | `ExploreView`, `Inventory`, `DocumentReader`, `LockPanel` | `explore.*`, `inv.*`, `doc.*`, `lock.*` (keys in L14b) | LX |
  | Puzzle frame, code lock, order puzzle, hint ladder, give-up confirmation (changed by PUZZLES-PLAN) | `PuzzleHost`, `CodeLock`, `OrderPuzzle`, `HintLadder` | `puzzle.*`, `hint.*` (keys in L14b) | LP2 |
- **Changed by PUZZLES-PLAN (re-cut; same lock).** L14b pre-declares in `ru.ts` / `en.ts` every key the puzzle and
  explore UIs use, so LP2 and LX never touch the tables:

  | Group | Keys |
  |---|---|
  | `explore` | `bar_inventory`, `bar_reveal`, `room_back`, `area_reset` (changed by PUZZLES-PLAN revision 1: the toast after a section restart, X9) |
  | `inv` | `items`, `files`, `empty`, `got_item` ("{name}"), `got_doc` ("{title}") |
  | `doc` | `close` |
  | `lock` | `slot_empty`, `no_fit`, `examine`, `locked` |
  | `puzzle` | `try`, `checking`, `wrong`, `solved`, `failed`, `attempts_left` ("{n}"), `give_up`, `give_up_confirm`, `give_up_yes`, `hint`, `offline`, `rate_limited` ("{s}"), `load_failed`, `retry`, `dial_up`, `dial_down`, `swap` |
  | `hint` | `title`, `tier` ("{n}"), `buy` ("{n} ⭐"), `locked` ("{n}"), `owned`, `unavailable`, `terms`, `confirming`, `failed` |

  Red: `i18n: puzzle and explore keys declared` (it reads the key list above from a constant in the test; predicted
  red: the keys are missing from `ru`).
- **Changed by STORIES-PLAN (re-cut).** STORIES-PLAN Y14, Y15:
  - **Lock:** + `client/src/ui/StoryPicker.svelte` → 14.
  - `StoryPicker.svelte` (presentational): `cards: StoryCardView[]` (`{ id, title, teaser, cover: { avif, webp } |
    null, continue: boolean, eager: boolean }`), callbacks `onStart(id)`, `onContinue(id)`, `onChapters(id)`; covers
    as `<picture>` with `width` / `height`, `decoding="async"`, `loading="lazy"` unless `eager`.
  - `ChapterSelect.svelte` lists one story's chapters (props carry the story's chapters only); `Notice` gains the
    kind `the_end` (action "Back to stories"); `Menu` gains "Back to stories".
  - Keys: `stories.start`, `stories.continue`, `stories.chapters`, `notice.the_end_title`, `notice.the_end_action`,
    `menu.back_to_stories`.
  - Reds (dom, in `menus.svelte.test.ts`): `menus: story picker shows start or continue per story` (predicted red:
    the component is missing → import error, then Continue shown for a story without a save on a stub);
    `menus: chapter select lists only its story`; `menus: notice kinds show their actions` extended with `the_end`
    (predicted red: no `the_end` kind); `menus: menu has back to stories`.
  - Screen map rows: "Home (Continue + story cards)" → `TapToStart` + `StoryPicker`, `tap.*` + `stories.*`, L14a +
    L14b; "The End" → `Notice`, `notice.*`, L14b.
- **Changed by META-PLAN (re-cut; same lock, 14 files).** META-PLAN M9, M21, M27:
  - `StoryPicker.svelte`: `StoryCardView` gains `card: boolean` and the callback `onCard(id)`; the "Прохождение"
    button renders iff `card` (the caller computes it: `MetaController.hasCard`, LMI; L15 passes `false`).
  - `Notice` `the_end` takes an optional second action `onCard` ("Прохождение"); without it only "Back to stories"
    renders (L15), with it both (LMI).
  - The meta entry points: `Menu` and `StoryPicker` (a footer row) gain optional `onFriends` and `onWallet` items,
    rendered iff given (L15 passes none; LMI passes the controller's `openFriends` / `openWallet`).
  - Keys (entry tables, so they work before the `meta-ui` chunk loads): `stories.card`, `stories.friends`,
    `stories.wallet`, `menu.friends`, `menu.wallet`, `notice.the_end_card`, `meta.card_later` (the toast). The `hint` group becomes `title`, `tier` ("{n}"), `use` ("{n}"), `unlocked`, `balance`
    ("{n}"), `get_more`, `unavailable`, `failed` (`buy`, `owned`, `terms`, `confirming` removed: no hint purchase,
    M21); the meta overlays' own keys live in LU1's `i18n/meta.ts`.
  - Reds (dom, in `menus.svelte.test.ts`): `menus: story picker shows the card button only after an ending` —
    predicted red: no button for `card: true`; `menus: the end offers the card when it exists` — predicted red: one
    action with `onCard` given; `menus: friends and wallet entries only when given` — predicted red: no item with the
    callbacks given. `i18n: puzzle and explore keys declared` reads the new `hint` list (predicted red on
    the PZ tables: `use` missing from `ru`).
  - Screen map rows added: "Completion card, friends, friend profile, wallet, gift, consent, invite prompt" →
    `ui/meta/*` (LU1), `meta.*` in `i18n/meta.ts`, mounted by LMI.

#### LP2 puzzle-ui (client; new, PUZZLES-PLAN)
- **Goal:** the puzzle sessions (attempts against the server, attempt limits, hint ladder, hint purchase), the lazy
  type UIs (`code`, `order`), the puzzle host and the hint ladder; the lazy-chunk budget rows; the lazy-import and
  runner-entry arch rules (X5, X6, X8, X14, X17, X18).
- **Gate to start:** L10, L14b, LW2 merged.
- **Lock:** `client/src/puzzles/{registry.ts,session.ts,session.test.ts}`,
  `client/src/puzzles/ui/{CodeLock.svelte,OrderPuzzle.svelte,puzzle-types.svelte.test.ts}`,
  `client/src/ui/puzzles/{PuzzleHost.svelte,HintLadder.svelte,puzzle-host.svelte.test.ts}`,
  `client/src/ui/puzzle-view.svelte.ts`, `client/scripts/{budget.ts,budget.test.ts}`, `client/src/arch.test.ts` (13).
- **Commits:**
  1. `registry.ts` (`loadPuzzleUi(type)` → a `Result`; one dynamic `import()` per type) + `arch.test.ts`:
     `arch: lazy ui only by dynamic import` and `arch: only yields.ts enters the runner`.
     - Red: a static `import` of `CodeLock.svelte` from `src/app/` in a scratch tree, and a `.enter(` in a scratch
       file — both fail naming the file (quoted).
  2. `session.ts` (single-flight attempt; a wrong answer dispatches `attempt-failed`; `maxAttempts` → `failed`;
     generation + `AbortController`; deferred close; hints via `getPuzzle`, texts in memory only; `openHint`;
     `buyHint` through `createPurchaseFlow` with `isOwned`; `giveUp` for linear puzzles).
     - Red: `session: double try sends one attempt`, `session: max attempts yields failed`,
       `session: stale attempt response after dispose is dropped`, `session: dispose aborts the attempt`,
       `hints: texts never written to storage` (the facade's cloud / device fakes record zero writes),
       `hints: next tier buyable only after previous owned`.
  3. `CodeLock.svelte` (presentational: `params`, `answer`, `busy`, `onChange`; ▲/▼ ≥ 48 CSS px; the digits wrap).
     - Red (dom): `code: dials wrap and emit answer`.
  4. `OrderPuzzle.svelte` (tap-to-select, tap-to-swap; a border + check glyph, not colour alone).
     - Red (dom): `order: tap two slots swaps`.
  5. `PuzzleHost.svelte` + `HintLadder.svelte` + `puzzle-view.svelte.ts` (a plain `$state.raw` store that GameSession
     writes).
     - Red (dom): `puzzle host: linear has give up and no back`, `puzzle host: unmount on end`,
       `hint ladder: locked tiers not buyable`.
  6. `budget.ts`: the puzzle type, puzzle-host and explore-ui chunk rows, keyed on their importer like the engine row
     on `app/engine.ts` (changed by PUZZLES-PLAN revision 1, W7): PENDING while `src/app/yields.ts` (L15) does not
     exist; once it exists, a family whose sources exist FAILs with no dynamic entry, or inside a static closure.
     Until L15 nothing reachable from `index.html` imports the lazy families, so Vite emits no chunk for them.
     - Red: `budget: puzzle ui in engine closure fails` (a synthetic manifest with `CodeLock.svelte` statically
       imported by `app/engine.ts`; predicted red: a PASS row).
     - Red: `budget: lazy row pending until its importer exists` (lazy sources present, no `app/yields.ts`, a manifest
       without dynamic entries) — predicted red on a sources-keyed row: FAIL instead of PENDING.
     - Red: `budget: lazy row fails without dynamic entry once its importer exists` (the same with `app/yields.ts`
       present) — predicted red on an importer-blind stub that always reports PENDING: PENDING instead of FAIL.
     - Also red: a 9 KB br type chunk.
- **Gates:** `check`, `test` (every name above); `build` green with the three lazy rows PENDING (`app/yields.ts` is
  L15's), quoted.
- **Seen working:** `npx vitest run src/puzzles src/ui/puzzles scripts/budget --reporter=verbose`; `build` prints the
  three chunk rows as PENDING (measured from L15 on).
- **Changed by META-PLAN (re-cut; same lock, 13 files).** META-PLAN M21, M27 (the hint purchase is gone):
  - **Commit 2:** `createPuzzleSession(deps: { …; hints: HintPort | null })`; `buyHint` and the purchase flow are
    removed; `useHint(tier)` is single-flight, calls `port.use(puzzle, tier, lang)`, keeps the returned text in memory
    only, and on `insufficient` calls `port.getMore()`; tier N is usable only after N − 1 is unlocked and while the
    puzzle is unsolved. Unlocked tiers' texts still come from `getPuzzle` (L10's `HintView`), port or not.
    - Red: `hints: next tier usable only after previous unlocked` (replaces `hints: next tier buyable only after
      previous owned`) — predicted red on a stub that offers every locked tier: tier 2 usable with tier 1 locked.
    - Red: `hints: use without balance offers get more` (a fake port answering `insufficient`) — predicted red: the
      error shown and `getMore` never called.
    - `hints: texts never written to storage` stays (now also over `useHint`).
  - **Commit 5:** `HintLadder.svelte` shows unlocked texts, the next usable tier's "use" button with its cost
    (`port.tierCost()`) and the port's balance (`hint.balance`), and "get more" while the balance is below the cost;
    with `hints: null` no use button renders (L15).
    - Red (dom): `hint ladder: no port shows no use button` (replaces `hint ladder: locked tiers not buyable`) —
      predicted red: the button rendered with a null port.
  - **Tester mutations** add: call `port.use` twice on a double tap; persist a hint text to DeviceStorage.

#### LX explore-ui (client; new, PUZZLES-PLAN)
- **Goal:** the runtime explore controller (hotspot views through `geom/cover`, min targets, the room path for
  BackButton, the neighbour preload policy, effects out) and the explore UI (hotspot layer + bar, inventory, document
  reader, lock panel) as one lazy chunk (X10, X12, X13, X16).
- **Gate to start:** L11, L14b, LW2 merged. It may run beside LP2: the locks are disjoint.
- **Lock:** `client/src/explore/{controller.ts,controller.test.ts}`,
  `client/src/ui/explore/{ExploreView.svelte,Inventory.svelte,DocumentReader.svelte,LockPanel.svelte,explore.svelte.test.ts}`,
  `client/src/ui/explore-view.svelte.ts` (8).
- **Commits:**
  1. `controller.ts`: `enter` / `dispatch` through `reduce`; hotspot views (`toStage` + `minTarget(44)`); `resize`.
     Changed by PUZZLES-PLAN revision 1 (W3): `createExploreController` takes `deps.stageHost` (the `Stage.svelte`
     host element, L14a); its `ResizeObserver` observes that element and feeds `resize()` its content box, and
     `dispose()` disconnects it. Changed by PUZZLES-PLAN revision 3 (W1): `enter` dispatches `enter-section` only
     through `admitSection` (LW2), never straight to `reduce`; a `reset` effect from it goes out with the room batch.
     - Red: `controller: hotspot rect follows cover on resize` (390×844, then 844×390; predicted red on a stub using
       source px), `controller: small hotspot expanded to 44 px`.
     - Red: `controller: enter admits an unproved section` (the revision-3 hall/vault/garden fixture of LW2 commit
       4, with `house` in `unproved`) — predicted red on a controller that dispatches `enter-section` straight to
       `reduce`: no `reset` effect, and `hall.to_vault` is still open.
  2. The room path + `back()` + `onPath` (changed by PUZZLES-PLAN revision 1, W4, X12): `back()` dispatches a `tap`
     on the first open exit of the current room that leads to the previous path room; a move whose reverse exit is
     locked clears the path instead of pushing; `onPath` reports the empty ↔ non-empty edges (once on subscribe).
     - Red: `controller: back walks the path, cycles truncate` (hall → study → hall → cellar: back → hall → empty).
     - Red: `controller: path state reported on change` — predicted red on a stub that reports only on subscribe: no
       `true` after the first move.
     - Red: `controller: locked reverse exit clears the path` (a world whose return exit from the new room is
       locked) — predicted red on a push-always path: the path stays non-empty (`onPath` reports `true`, `back()`
       does not return false).
  3. Preload policy:
     - `room:<N>` holders in exit order;
     - release of non-neighbours on a move;
     - release of every `room:*` before a puzzle with a close-up;
     - `dispose()` releases all.
     - Red: `controller: neighbours preloaded in exit order`, `controller: puzzle open releases neighbour preloads`,
       `controller: dispose releases room holders` (a fake scene records the holder calls).
  4. `explore-view.svelte.ts` + `ExploreView.svelte`: `<button>`s with localized `aria-label`; exits marked with an
     arrow glyph; reveal for 2 s; examined / taken state; `-webkit-user-select: none`, `touch-action: manipulation`.
     - Red (dom): `explore view: reveal shows outlines`, `explore view: hotspot buttons have labels`.
  5. `Inventory.svelte` + `DocumentReader.svelte` + `LockPanel.svelte`.
     - Red (dom): `inventory: documents re-readable`, `lock panel: wrong item refused right item inserts`.
- **Gates:** `check`, `test` (every name above).
- **Seen working:** `npx vitest run src/explore src/ui/explore --reporter=verbose`; the components render in
  happy-dom.

#### LS4 stats-client (client; new, STORIES-PLAN)
- **Goal:** the client half of the statistics foundation (STORIES-PLAN Y13): the stats endpoints and decoders, and
  the reporter (ids, queue, DeviceStorage mirror, flush policy). No UI.
- **Gate to start:** L10 (`http.ts`, `endpoints.ts`, `decode.ts`), LS3 (the stats DTOs in `api.ts` and their
  samples) merged.
- **Lock:** `client/src/stats/{reporter.ts,reporter.test.ts}` (new), `client/src/api/{endpoints.ts,decode.ts,
  decode.test.ts}` (5).
- **Commits:**
  1. `postStatEvents(events, { keepalive })` and `getStats()` + decoders for `PostStatsResponse` and `StatsResponse`.
     - Red: `decode: stats samples decode` (LS3's samples) — predicted red: the decoders are missing (the test
       names them; a type error before the code exists).
  2. `reporter.ts` queue, ids, single-flight flush, retry policy (fake clock, fake endpoints).
     - Red: `reporter: retried batch keeps event ids` (a network failure, then a retry) — predicted red on a stub that
       builds the batch per attempt with fresh ids: different ids.
     - Also: `reporter: ending flushes at once`, `reporter: 429 waits retry-after`, `reporter: 400 drops the batch`,
       `reporter: rejected events are dropped`, `reporter: failure never throws`, `reporter: dispose clears timers`.
  3. DeviceStorage mirror (`stats_queue`, ≤ 64, oldest dropped; none below 9.0), the age limit, keepalive flushes.
     - Red: `reporter: queue survives reload through device storage` (a second reporter on the same fake storage
       sends the first one's events) — predicted red: nothing sent.
     - Also: `reporter: queue capped at 64 drops oldest`, `reporter: events older than 30 days are dropped`.
- **Gates:** `check`, `test` (every name above).
- **Tester mutation:** fresh ids per attempt; flush without single-flight (two concurrent POSTs of one batch).
- **Seen working:** `npx vitest run src/stats src/api --reporter=verbose`; live in L15 (`stories: story ending shows
  the end and records the ending`).
- **Changed by META-PLAN (re-cut; same lock, 5 files).** META-PLAN M1, M8, M9:
  - **Commit 1:** the `StatsResponse` decoder has no `endingsTotal` (LS3 re-cut removed it before any client decoded
    it); `decode: stats samples decode` runs on LS3's regenerated samples.
  - **Commit 2:** `StatEvent` gains `{ kind: 'choice_made'; chapterId; storyVersion; option: LineId }` (subject = the
    option). Red: `reporter: choice event carries the option line id` — predicted red: the variant missing (a `check`
    error, quoted), then a subject of the chapter id on a copy of the `chapter_started` mapping.
  - **Commit 3:** `settle({ timeoutMs })`: flush now; resolve `'drained'` when the queue is empty, `'timeout'` when
    the time is up; never rejects; one in-flight flush shared with the timer.
    - Red: `reporter: settle resolves after the queue drains` (fake clock; the fake endpoint answers after 1 s) —
      predicted red on a `settle` that resolves on the POST's start: `'drained'` while the batch is unanswered.
    - Red: `reporter: settle times out without throwing` (the endpoint never answers) — predicted red on an awaited
      flush: the test times out.
  - **Tester mutations** add: `settle` resolving before the response; a second POST of the same batch from `settle`.
  - **Revision 1 (W2; STORIES-PLAN Y13 changed; same lock).** Commit 3's cap of 64 evicts the oldest `choice_made`
    first and a fact only when no choice is queued; a batch takes the queued facts first, then choices, each oldest
    first; a `rate_limited` rejection is dropped like the others. `reporter: queue capped at 64 drops oldest` keeps its
    name (an all-choice queue drops its oldest).
    - Red: `reporter: queue full of choices keeps ending_reached` (offline: one `ending_reached`, then 64 `choice_made`
      → 65 records; the queue holds the ending and the 63 newest choices) — predicted red on drop-oldest: the ending
      evicted (it is the oldest). (The triage's sequence "64 choices, an ending, one choice" would not be red: under
      drop-oldest the ending is evicted only once it is the oldest.)
    - Red: `reporter: batch sends facts first` (40 choices queued, then an ending → the first POST's batch starts with
      the ending) — predicted red on oldest-first batching: the ending in the second batch.
    - **Tester mutations** add: drop the oldest event whatever its kind; batch oldest-first.

#### LMD meta-data (client; new, META-PLAN)
- **Goal:** the meta endpoints and decoders, and the card, social and wallet services with the hint port (META-PLAN
  "Module API"). Plain TS; no UI, no Telegram call.
- **Gate to start:** LS4 merged (the serialized `api/` files) and LF2 merged (the meta DTOs in `api.ts` and their
  samples). Runs beside LE2.
- **Lock:** `client/src/meta/{card.ts,social.ts,wallet.ts,meta.test.ts}` (new), `client/src/api/{endpoints.ts,decode.ts,
  decode.test.ts}` (7).
- **Commits:**
  1. Endpoints + decoders: `getWallet`, `useHint`, `postCard`, `getSocial`, `getInvite`, `askInvite` (revision 1, C1),
     `acceptFriend`, `removeFriend`, `rotateInvite`, `putConsent`, `getFriendProfile`, `postShare` (friends addressed
     by handle, W1); errors mapped to `MetaError` (`409 insufficient_balance` → `insufficient`, `429` → `rate-limited`
     with `retryAfter`, …).
     - Red: `decode: meta samples decode` (LF2's samples of six DTOs) — predicted red: the decoders missing (the test
       names them; a `check` error, quoted), then a seeded field rename in a sample.
  2. `meta/card.ts`. Red: `card: loads once per open and keeps no copy` (two `load` calls → two requests; the
     service holds no reference after the promise resolves) — predicted red on a caching stub: one request.
  3. `meta/social.ts`. Red: `social: accept refreshes friends` (the accept's `SocialResponse` replaces the state) —
     predicted red on a stub that keeps the old state: the friend absent. Also (revision 1): `social: ask returns the
     invite state` (`invite(code)` and `ask(code)` return the server's `InviteView`; `FriendHandle` is branded).
  4. `meta/wallet.ts` + `hintPort(open)`. Red: `wallet: hint port reads the balance from the server only`
     (`balance()` is `null` before the first `GET /api/wallet`, then the server value; a `use` answer's `balance`
     replaces it; DeviceStorage and CloudStorage fakes record zero reads and writes) — predicted red on a stub that
     decrements locally: 4 after a failed use.
- **Gates:** `check`, `test` (counted).
- **Tester mutations:** decrement the balance locally; cache the card; map 409 `insufficient_balance` to `network`.
- **Seen working:** `npx vitest run src/meta src/api --reporter=verbose` lists every LMD name.

#### L15 integration (client)
- **Goal:** GameSession wiring, boot, the full e2e (smoke, purchase, perf).
- **Lock:** `client/src/app/{boot.ts,engine.ts,game.ts,game.test.ts}`, `client/src/main.ts`, `client/src/ui/App.svelte`,
  `client/e2e/{helpers.ts,smoke.spec.ts,purchase.spec.ts,perf.spec.ts}` (10).
- **Commits:**
  1. `engine.ts` + `game.ts` (batch split, intent queue, modes, autosave triggers, chapter change with the
     `next:<id>` hand-over of F4/F5, the ink-error counter of the error floor, `http.fetchAsset` injected into scene
     and audio). Red: `game_holds_one_runner`, `chapter_change_releases` (fakes), `game: repeated ink error walks
     resume down to chapter start`; `game: next-chapter holder released on non-ending branch` (fixture: knot A with
     `ending: true` and next = [B], B with `ending: false`, the next chapter owned; enter A, then B; the fake scene must
     hold nothing under `next:`, released before B's `next(B)` preload request) — predicted red: the `next:ch2` holder
     is still live after B's `enteredKnot`.
  2. `boot.ts` + `main.ts` (two-stage boot, parallel auth/catalog/saves/entitlements, audio unlock in the gesture).
  3. `App.svelte` wiring.
  4. `smoke.spec.ts`. Red: before the wiring, `play choose save reload load resumes at same line` fails at "first
     line visible".
  5. `purchase.spec.ts`. Red: mock outcome forced `failed`.
  6. `perf.spec.ts` (TTFL, heap, textures after chapter change, context loss). The `__novelDebug` hook (stats, the
     current `lineId`, `forceContextLoss`) is installed by `game.ts` only under `__TG_MOCK__`; `scan-dist` proves it
     absent from `dist/`.
- **Changed by PUZZLES-PLAN (re-cut).**
  - **Gate to start:** + LW3, LP2, LX, N1.
  - **Lock:** + `client/src/app/{yields.ts,yields.test.ts}`, `client/e2e/puzzles.spec.ts` → 13.
  - **Commit 1 → 1a:** `yields.ts` — the only caller of `runner.enter`:
    - `yield` steps → `PuzzleSession` (linear) or `ExploreController` (`enter-section` / `event-returned`);
    - effects → room batches (scene fade + `props` + section bgm + exit sfx; skipped if the stage already matches),
      `story` / `leave` → `project` + `runner.enter`, the lock panel, the puzzle overlay;
    - `dirty` → the 2 s debounced autosave;
    - the close-up shown on puzzle open and cleared on puzzle end;
    - lazy chunks prefetched when a chapter's world has sections or `next(K)` holds a puzzle yield;
    - (changed by PUZZLES-PLAN revision 1) every `import()` of the lazy families lives here (the puzzle types through
      `puzzles/registry.ts`), so the lazy budget rows turn from PENDING to measured with this file (W7);
    - the root-back: set and cleared from `ExploreController.onPath` edges, cleared when an event knot starts (a
      `story` effect) and restored from the path state at the `room` effect after `event-returned` (W4, X12);
    - a non-null `reset` from resume → the toast `explore.area_reset` (W5, X9); a `reset` effect from the explore
      controller (a section restarted at its entry) → the same toast (changed by PUZZLES-PLAN revision 3, W1).
    - Red: `yields: puzzle end projects then enters`, `yields: event return restores the room`,
      `yields: puzzle end clears the close-up`, `game_holds_one_explore_controller`,
      `game_holds_at_most_one_puzzle_session`.
    - Red: `yields: back during an event knot does not move rooms` (a fake controller whose `back()` always emits a
      `room` effect; a Back press between the `story` effect and `event-returned`) — predicted red on a wiring that
      keeps the root-back set during events: a `room` effect while `pendingStory` is non-empty.
  - **Commit 3:** `App.svelte` renders the explore UI and the puzzle host as dynamic components from their view stores
    (loaded by `yields.ts`); the hotspot layer mounts inside the `Stage.svelte` host element through its `children`
    snippet, never in the inset-padded overlay, and the host element goes to `createExploreController` as
    `deps.stageHost` (W3, X10 "The box").
  - **New commit 6a — `puzzles.spec.ts`:** it reads the demo solutions from `story/ch1/world.json` in the Node test
    process; they are never in the bundle. The tests are the eight of PUZZLES-PLAN "Test strategy": search → item →
    drawer → buy hint 1 (mock Pay) → solve; the gate fail branch; reload in a room; hint text absent until bought;
    the paid chapter's puzzle needs the entitlement; back walks rooms; live texture bytes ≤ 32 MiB while exploring;
    and (changed by PUZZLES-PLAN revision 1, W3) `explore: hotspot buttons align with props under safe area and
    landscape` — under `__tgMock.setSafeArea()` and a landscape viewport, each prop hotspot button's page rect is
    compared with `__novelDebug.propRects()` (L11 `debugPropRects()`; `__novelDebug` gains `propRects`, mock only):
    centres within 1 CSS px, sizes equal unless min-target expanded.
    - Red: before the `yields.ts` wiring, `explore: search item puzzle buy hint solve` fails at "hotspot layer
      visible"; with the mock invoice forced `failed`, the hint text never appears.
    - Red: the hotspot layer mounted in the padded overlay (scratch) → the alignment test fails; predicted red: the
      rects differ by the safe-area inset (or the landscape pillar-box margin).
  - **Seen working** gains the live attempt check moved from L6c (21 quick attempts → 429 + `Retry-After`) and an
    attempt round trip timed on a device if one is available (X5 verify). Changed by PUZZLES-PLAN revision 2 (W1):
    it also gains the resume search after a rules update (a save on the demo section, a world with one changed
    `accepts`, then a reload), timed on a LOW Android if one is available and scaled per state to 5,000 states
    (X9 cost: ≤ 300 ms).
- **Changed by STORIES-PLAN (re-cut).** STORIES-PLAN Y4, Y7, Y13, Y14:
  - **Gate to start:** + LS1, LS2, LS3, LS4, N2 (and every re-cut lane above).
  - **Lock:** + `client/e2e/stories.spec.ts` → 14.
  - **Commit 1** (`game.ts`): `start({ new | slot, story, … })` (a chapter outside the story → `chapter-outside-story`);
    one `SaveService` per session; `exitToStories()` in the order of STORIES-PLAN "Module API" (revision 1: the open
    `PuzzleSession` and `PurchaseFlow` disposed first, then the autosave, then the `ExploreController`, then runner,
    scene, audio, saves, flush); F4′ (the declared ending → `the_end`; `next` within the story); F2's ending knot
    (`ending_reached`, no F5); the reporter calls (changed by STORIES-PLAN revision 1: `chapter_started` for every
    runner created from a `fresh` start point — a new game, a chapter change, resume step 2 "pending chapter start" and
    step 5 "chapter start" — never for an `exact` or `checkpoint` one; `chapter_completed` at an END whose last entered
    knot is not a declared ending, while a declared ending's END records only its `ending_reached`; `puzzle_ended`
    from `yields.ts` with the outcome). Reds:
    `game: chapter start and end are reported`, `game: exact or checkpoint resume does not report chapter start`,
    `game: ending knot reports the ending and skips next-chapter preload` (predicted red: a `next:` holder requested
    at the ending knot), `game: story end shows the end`, `game: exit to stories returns the registry to baseline`
    (predicted red: `scene:` holders still live after exit), `game: exit to stories disposes the save service`,
    `game: start rejects a chapter outside the story`; and (revision 1):
    - `game: declared ending end is distinguishable from chapter end` (fixture: a chapter with a declared ending knot
      `bad` and a plain END knot `stairs`, one run into each) — predicted red on the revision-0 order: two identical
      `chapter_completed` events;
    - `game: pending chapter start reports chapter start` (a slot whose body has `ink: null`) — predicted red: no
      `chapter_started`;
    - `game: exit to stories disposes explore, puzzle and purchase sessions` (fixture: in a room, with a puzzle attempt
      in flight and a chapter purchase `confirming`; after exit: no `room:*` holder in the fake registry, the fake
      `ResizeObserver` disconnected, the attempt's late response dispatches nothing, the flow disposed once) —
      predicted red: `room:*` holders live and the observer still connected after exit.
  - **Commit 2** (`boot.ts`, `main.ts`): `covers.json` beside the catalog; `listSaves()`; the reporter after auth,
    its two flush subscriptions; Home's Continue = the newest `auto`; `unlockAudio()` in every Home button handler.
  - **Commit 3** (`App.svelte`): Home (`TapToStart` + `StoryPicker` in its snippet, mounted only while no game runs);
    ChapterSelect per story; `the_end`; "Back to stories".
  - **New commit 6b — `stories.spec.ts`:** the six tests of STORIES-PLAN "Test strategy" (e2e). The stats check
    obtains its own token through `/dev/launch` + `POST /api/auth` for the same dev user and reads `GET /api/stats`.
    Red: before the Home wiring, `stories: picker lists both stories with covers` fails at "story card visible"; with
    the saves keyed without the story in a scratch tree, `stories: saves are per story` fails (quoted).
  - `perf.spec.ts`: `time to first line under throttling` taps the first card's Start (still one tap).
  - **Seen working** gains: Home with both covers; `tide` to `drowned` → "The End" → Home → `manor` Continue resumes
    its own line; `curl GET /api/stats` with the dev token shows `tide` `endingsReached: ["drowned"]`.
- **Gates:** every client gate + `e2e` (all five specs, counted by name); `build` shows the engine row measured, no
  longer PENDING (quoted), and the three lazy chunk rows measured. Red: the BackButton binding removed from
  `ui/screens.ts` in a scratch tree → `back button closes overlays without history` fails. Changed by STORIES-PLAN:
  all six specs (`boot`, `smoke`, `purchase`, `perf`, `puzzles`, `stories`).
- **Seen working:** `npm run dev` + `cargo run -p server-dev`, play to the paywall, buy, ch2. `npm --prefix client run
  e2e`.
- **Changed by META-PLAN (re-cut; same lock, 14 files).** META-PLAN M1, M21, M27, M28:
  - **Gate to start:** unchanged by the meta lanes — L15 waits for none of LE1–LE2, LM1–LMI or L9 (the prototype
    milestone; the dependency order).
  - **Commit 1** (`game.ts`): a pick calls `runner.choose(i)` and `reporter.record({ kind: 'choice_made', chapterId,
    storyVersion, option: choices[i].lineId })`. Red: `game: a choice records its option line id` — predicted red: no
    event recorded. `yields.ts` creates every `PuzzleSession` with `hints: null` (LMI passes the wallet's port).
    `the_end` and `StoryPicker` get no card action (`card: false`, no `onCard`).
  - **Commit 6a** (`puzzles.spec.ts`): the "buy hint 1 (mock Pay)" step is removed — `explore: search item puzzle
    solve`; "hint text absent until bought" becomes "hint text absent while locked" (no use button, `hints: null`);
    the forced-`failed` hint invoice red is replaced by: before the `yields.ts` wiring, `explore: search item puzzle
    solve` fails at "hotspot layer visible". The hint use e2e moves to LMI (`meta: hint from a pack shows its text`).
  - **Commit 6b** (`stories.spec.ts`): the stats check asserts `endingsReached: ["drowned"]` and that the response has
    no `endingsTotal`.

#### LMI meta-integration (client; new, META-PLAN)
- **Goal:** the meta controller and its wiring into boot, GameSession, the yields and App; the gift call; the
  `meta-ui` budget row and the all-JS limit 305; the meta and social e2e (META-PLAN M9, M11, M14, M22, M27, F16–F25,
  F28).
- **Gate to start:** L15, LMD, LU1, LE2 merged (N1, N2 and LM1 through L15).
- **Lock:** `client/src/app/{meta.ts,meta.test.ts}` (new), `client/src/app/{boot.ts,game.ts,game.test.ts,yields.ts}`,
  `client/src/ui/App.svelte`, `client/src/api/{endpoints.ts,decode.ts,decode.test.ts}`,
  `client/scripts/{budget.ts,budget.test.ts}`, `client/e2e/{helpers.ts,meta.spec.ts,social.spec.ts}` (15;
  `meta.spec.ts` and `social.spec.ts` are new).
- **Commits:**
  1. `app/meta.ts` (`createMetaController`, META-PLAN "Module API"): the three boot GETs in parallel, `hasCard`,
     `openCard`, `onEnding`, the overlays, `share` (M14: prepare → `shareMessage` when supported, else
     `openTelegramLink` of `t.me/share/url`; one re-prepare on `expired`), `hintPort`, `dispose`; `loadUi` imports
     `ui/meta/index.ts` dynamically and is prefetched once after the first line.
     - Red: `meta: boot fetches never block the first line` (fake http that never answers; `boot()` returns and the
       fake first line renders) — predicted red on an awaited boot: the test times out.
     - Also: `meta: invite prompt only for an open invite` (revision 1, C1; was `… only for an incoming request`: a
       `startParam` code whose `GET /api/invites/{code}` answers `requested`, `friends`, `own` or 404 → no prompt;
       `open` → the prompt, and its Send posts `POST /api/invites/{code}/request` once), `meta: share falls back when
       unsupported`, `meta: expired prepared message re-prepared once` (a second `expired` → the fallback link, no third
       request).
  2. The gift: `postGift` + the `GiftResponse` decoder (LE2's sample) + `MetaController.gift` (one `requestId` per
     submit, kept across retries; then `wallet.refresh()`).
     - Red: `wallet: gift retry keeps its request id` (a network failure, then a retry) — predicted red on a stub that
       draws an id per attempt: two ids. `decode: meta samples decode` gains `GiftResponse`.
  3. `boot.ts` + `game.ts` + `yields.ts`: the controller after auth; a declared ending's END → `meta.onEnding(story)`
     after `the_end` is shown; `the_end`'s `onCard`; `yields.ts` passes `meta.hintPort()` to every `PuzzleSession`;
     `exitToStories` closes the meta overlays.
     - Red: `game: ending settles stats then opens the card` (fake reporter and controller; the card requested only
       after `settle` resolves) — predicted red on a wiring that opens the card first: the request precedes `settle`.
     - Red: `game: card failure keeps the end` (the card request fails → `the_end` stays with its card action and the
       toast) — predicted red: `the_end` popped.
  4. `App.svelte`: the meta overlays from the lazy module per `Screen` kind; `StoryPicker` `card` from `hasCard`,
     `onCard`, `onFriends`, `onWallet`; the `Menu` items. Each component's props `satisfies` the LMD view (`check`).
  5. `budget.ts`: the `meta-ui` row keyed on `app/meta.ts` (PENDING until it exists; then FAIL without a dynamic entry
     or inside a static closure); the all-JS limit 290 → 305.
     - Red: `budget: meta ui in entry closure fails` (a synthetic manifest with `CompletionCard.svelte` statically
       imported by `app/boot.ts`) — predicted red: a PASS row.
     - Red: `budget: meta row pending until its importer exists` — predicted red on a sources-keyed row: FAIL.
  6. `meta.spec.ts` (`helpers.ts` gains the second dev user and the `startapp` launch): the six tests of META-PLAN
     "Test strategy" (e2e).
     - Red: before the commit-3 wiring (scratch tree), `meta: ending opens the card with the ending and a new
       achievement` fails at "card visible" (quoted).
  7. `social.spec.ts`: the five tests of META-PLAN "Test strategy" (e2e); the second context launches with
     `startapp=f<the first user's code>` and sends the request from the prompt; the first context accepts it in Friends
     (revision 1, C1: `social: invite link sends a request the inviter accepts`).
     - Red: with the mock's `shareMessage` reporting version 7.10, `social: share sends a prepared message without
       titles` fails and `social: share falls back to a share link below 8.0` passes (quoted).
- **Gates:** every client gate + `e2e` (all eight specs, counted by name); `build` shows the `meta-ui` row measured
  (≤ 14 KB br, quoted) and all JS ≤ 305 KB br.
- **Seen red once:** the `meta-ui` row with a static import of `CompletionCard.svelte` from `app/boot.ts` (scratch) →
  FAIL.
- **Tester mutations:** await a boot GET before the first line; open the card before `settle`; draw a new gift id per
  retry; import the meta UI statically; pass `null` as the hint port.
- **Seen working:** `npm run dev` + `cargo run -p server-dev`: play `tide` to `drowned` → "The End" → the card with
  `drowned` and `first_ending` marked new; Back → `the_end`; Home shows "Прохождение"; a pack bought through the mock →
  the wallet shows it → a hint used in ch1; a second dev user via `startapp` → Send in the prompt → the first user
  accepts → a gift.
  `npm --prefix client run e2e`.

#### D2 docs-final (doc-writer)
- **Goal:** README (local run, the owner's steps to connect a real bot), FEATURE_MAP/ARCHITECTURE final, runbooks
  (`local-dev`, `bot-setup`, `webhook`, `payments-ops`).
- **Lock:** `README.md`, `docs/FEATURE_MAP.md`, `docs/ARCHITECTURE.md`, `docs/runbooks/**`.
- **Owner's real-bot steps** (README):
  1. Create a test-environment bot (R1 §5); real Stars testing in the test environment [R2 §1.7].
  2. Set `BOT_TOKEN`, `WEBHOOK_SECRET`, `TOKEN_KEY`, `PUBLIC_APP_URL`, `ADMIN_TELEGRAM_IDS`.
  3. `npm --prefix client run build`.
  4. `server serve` with `STATIC_DIR=client/dist`.
  5. Expose HTTPS: a cloudflared named tunnel, or a quick tunnel, re-registered each run [R1 §5].
  6. Register the URL in BotFather (Main Mini App + menu button).
  7. `server setup`.
  8. 2-step verification on the owner account [R2 §1.5].
- **Changed by PUZZLES-PLAN.** The FEATURE_MAP rows Puzzles / Exploration / Hints / World tooling. The
  `payments-ops` runbook covers hint products (refund = revoke; consumed-hint policy per Q15). The `bot-setup` runbook
  adds host time sync (NTP; the `initdata_expired` from-future erratum).
- **Changed by STORIES-PLAN.** The FEATURE_MAP rows Stories / Saves per story / Player statistics (STORIES-PLAN
  "Integration"). README: Home and the two demo stories. `local-dev`: `pgdev reset` after a rewritten migration (the
  LS2 rule: migrations are rewritten until the first deployment, append-only after it); the dev path of a save is
  `/api/saves/<story>/<slot>`. `payments-ops`: chapter prices are `defaultPriceStars` + overrides in
  `server/catalog.json`; a new paid chapter needs no catalog edit. A privacy note: what `stat_events` holds (user id,
  closed vocabulary), and that retention and deletion are open (Q23).
- **Changed by META-PLAN.** META-PLAN M17–M26, "docs/FEATURE_MAP.md entries":
  - **Gate to start:** + LMI and L9 merged (revision 1: and LPO).
  - **Lock:** + `docs/AUTHORING.md` (only for the story-meta part below).
  - FEATURE_MAP / ARCHITECTURE: the META-PLAN rows (choice capture, achievements, completion card, friends, sharing,
    economy, hints, gifts and referrals, privacy) and its two review rules, unless D1 wrote them.
  - `payments-ops`: hint products are gone; packs (`pack:<id>` in `catalog.json` `economy`, PLACEHOLDER amounts and
    prices); a pack refund claws back the unspent part and records the rest as debt (M20); "unapplied" includes a
    pack charge without its ledger row. The PUZZLES-PLAN hint-product paragraph is superseded.
  - `bot-setup`: BotFather's privacy policy URL = `<PUBLIC_APP_URL>api/privacy`; `setMyCommands` with `/privacy`;
    verify on the real bot whether `savePreparedInlineMessage` needs inline mode (`/setinline`; META-PLAN MQ7).
  - New runbook `privacy-ops`: filling the policy placeholders (no real identity in the repository; revision 1, W4:
    the owner writes the operator identity facts as a flat JSON object — keys = the ten identity placeholder names of
    META-PLAN M26, revision 2 — into a file on the host outside the repository and sets `PRIVACY_OPERATOR_FILE`; a
    production server refuses to start until every placeholder is filled, and the error names the missing ones);
    changing the policy (changed by META-PLAN revision 2, W1): a content value (retention, minimum age, database
    country, hosting provider, cross-border transfer, supervisory authority) or any other text is a template commit
    that sets a new `policy-version` meta (the date it takes effect) and appends a `POLICY_PINS` row, then a deploy, so
    new consents name the new version; a contact fix is a host-file edit and a restart, with no new version; a change
    of the operator itself (name, form, OGRN, INN) is both (MV22 default); every host-file revision is kept on the host
    with its date, which is the only record of the identity facts in force at a consent's `at`; answering an access or deletion request by hand in the order of META-PLAN
    "Privacy: personal-data inventory, lawful bases, erasure" until the erase-user lane exists; the 10-working-day / one-month answer windows.
  - README: the meta features in one paragraph; the owner's steps gain the BotFather privacy URL and (revision 1)
    `PRIVACY_OPERATOR_FILE`.
  - The AUTHORING.md story-meta part if D1 did not write it (D1 re-cut).
- **Gates:** the link check; env var names grep-matched against `config.rs`.

---

## Later

| Item | Trigger / note |
|---|---|
| **R2 + TS Worker for paid assets** | axum issues a short-lived token scoped to `(user, item, exp)`; the Worker verifies it and reads R2 by binding; presigned URLs do not work on a custom domain [O]. `GET /api/assets/{file}` stays the reference implementation and test oracle |
| **Spine** (`@esotericsoftware/spine-pixi-v8`, needs Pixi ≥ 8.16 [O]) | a new staging kind (`anim:`), its own memory budget |
| **Real art and audio** | PNG sources into `assets/src/` through the same sharp path; ffmpeg → AAC/M4A (new encoder step; WAV allowed only for placeholders, so a real WAV fails the gate on purpose); measure the CPU+GPU texture cost on an iPhone and a LOW Android |
| **Deployment / hosting** | VPS + Cloudflare (Q5); TLS; `setWebhook` on the public URL; backups of the payments DB [R2 §1.5] |
| Subscriptions (30-day, ≤ 10,000 Stars) | the 10.2 `Update.subscription`; its own plan |
| CloudStorage sync beyond settings/read-set | — |
| Reconciliation with `getStarTransactions` | the nightly job compares payments [R2 §1.4]; automatic refund of unapplied charges, if the owner picks it (V4; the prototype notifies and flags them, K19) |
| CG gallery, voice bus, WebGPU, fullscreen mode | — |
| TS 7.1 (API) migration | when svelte-check supports it |
| Ed25519 third-party validation | only if a token-less service must validate initData |
| Rate limiting, request IDs, metrics/analytics | before public launch |
| Token key rotation (`v2`) | — |
| Statistics screen and metrics (changed by STORIES-PLAN) | the owner's Q22; reads `GET /api/stats`; projections (`story_endings`, rebuilt from `stat_events` by one `INSERT … SELECT`) when a screen needs them |
| Community percentages ("5 % found this ending") (changed by STORIES-PLAN) | `GROUP BY story_id, subject` over `stat_events` + an index `(kind, story_id, subject, user_id)`; a minimum-count rule at display (unresearched) |
| Choice events (changed by STORIES-PLAN) | only if the owner wants them (Q24); a new `kind` + a choice-ID vocabulary per build. Changed by META-PLAN: **resolved** — `choice_made` (META-PLAN M1, M2; LS3, LM2, LS4, L15) |
| Statistics retention and erasure (changed by STORIES-PLAN) | Q23: an admin erasure command (`DELETE … WHERE user_id`), an age cut-off job. Changed by META-PLAN: the **erase-user lane** (META-PLAN "Privacy: personal-data inventory, lawful bases, erasure": one transaction in the documented table order, the ledger anonymised, payments kept for the legal period) is required before production (Telegram §4.2(a)); until then the `privacy-ops` runbook (D2) |
| Choice aggregate (changed by META-PLAN) | "N % chose this" from `choice_made` (`GROUP BY subject` per choice point of `server/content/meta.json`); a minimum-count rule; only for free chapters or entitled viewers |
| Completion card image (changed by META-PLAN) | a rendered share image (`InlineQueryResultPhoto` needs a public URL: no paid title on it); the prototype shares text + a button |
| Referral hardening (changed by META-PLAN) | signals beyond the 120 s play gap and the caps (account age from the user id range, device repeats); only if abuse is seen |
| Limiter table (changed by META-PLAN) | the share window is in memory per process (LF2); a second server instance needs a PostgreSQL table (or one shared store) for every rolling window |
| Per-story globals, "Start over" on a finished story, story deep links (`startapp`) (changed by STORIES-PLAN) | past ~50 globals; UX polish; when the bot is real |

Changed by RULINGS 14 (decision section 6): the **PostgreSQL** row is deleted; PostgreSQL 18 runs from day one (K14).

---

## Open questions

### Engineering (for the orchestrator) — each with a recommendation

| # | Question | Recommendation |
|---|---|---|
| E1 | The cold cargo build is 5 min 11 s [R2], over the per-call timeout | Install the gate kit (WORKFLOW.md "Gate kit") before L2 |
| E2 | `npm --prefix client run e2e` is not in the CLAUDE.md gate list | Add it as a gate from L7 on (run through the kit). The kit gives each parallel lane its own `DEV_API_PORT` / `DEV_WEB_PORT` pair (e.g. 8787/4173 and 8797/4183); every `server-dev` launch of a lane uses it |
| E3 | Playwright needs `npx playwright install chromium` (a browser download, about 150 MB, to `%USERPROFILE%\AppData\Local\ms-playwright` [R4]) | Approve once per machine before L7 |
| E4 | CLAUDE.md "Stack and layout" lacks `server/dev/`, `assets/catalog.json`, the generated dirs | Update it when L4b merges |
| E5 | The narrative-designer role allows only `npm --prefix client run story`; ID assignment uses `story -- --fix-ids` / `--sync-locales` | Allow the two flags in the role file, or the designer hand-writes IDs in the format (both valid) |
| E6 | No real-launch initData vector exists; the validator is pinned by independent Node-signed vectors | The owner copies one `Telegram.WebApp.initData` from a test-environment launch (R1 §5); add it as a vector in a later lane |
| E7 | FEATURE_MAP/ARCHITECTURE are created by D1, not by "the first lanes" (CLAUDE.md wording) | Accept: parallel lanes would collide on one file |
| E8 | How long can a Stars payment stay `pending` (e.g. while the user buys Stars)? It sets the 120 s checkout lock; a payment pending past it can let a second order pass pre-checkout and land as an unapplied charge | Measure with a test-environment purchase (owner step, with E6); keep 120 s until then. Unapplied charges are notified and flagged either way (K19) |

### VALUES / SCOPE (for the owner — recorded in docs/OPEN-QUESTIONS.md by the orchestrator)

| # | Question | Default in the design |
|---|---|---|
| V1 | Minimum iOS: Vite 8's default target means iOS ≥ 16.4 [R4]; older devices get a blank page | Keep the default, add a "device not supported" notice later |
| V2 | Default language for users whose Telegram language is neither ru nor en | ru for `ru/uk/be/kk`, en otherwise |
| V3 | Price of chapter 2 in Stars (Q3) | Placeholder `1` in `server/catalog.json`, marked PLACEHOLDER |
| V4 | Refund policy: admin-only manual refunds via `/refund`; no self-service. And unapplied charges (`OrderMismatch` / `AlreadyEntitled`, e.g. a payment pending past the checkout lock, E8): refund them automatically, or notify and let the admin refund? | As designed; the `/paysupport` text explains how to ask. Unapplied charges: the payer and the admins get a bot message, `/paysupport` flags the charge, the admin refunds with `/refund` |
| V5 | Terms, support contact, bot texts (Q4) | Placeholders in `server/locales/bot.*.json` and the UI tables |
| V6 | Keep a copy of Telegram's `telegram-web-app.js` in `client/e2e/fixtures/` (it has no stated licence) | Keep it as a test fixture only; the alternative is a network fetch in e2e |
| V7 | May ch2 be started from chapter select without finishing ch1 (default carry values)? | Allowed |
| V8 | Story genre/setting, character names (Q1), art direction (Q2) | Placeholder ids `ally`, `stranger`, `voice`; names chosen by the narrative-designer as placeholders |

### Puzzles extension (changed by PUZZLES-PLAN)

The engineering forks PE1–PE6 and the owner questions Q14–Q20 (hint prices, the consumed-hint refund policy, the
attempt limits, exploration scope and others) live in [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Open
questions". The orchestrator copies Q14–Q20 into docs/OPEN-QUESTIONS.md. None blocks a lane: each has a placeholder
default there.

### Stories extension (changed by STORIES-PLAN)

The engineering forks SQ1–SQ8 (the story index at startup and the L7 gate, the reopened DSL files, the `0001`
rewrite rule, the LS3 / L9 / LDB2 order, the errata line drift, L3c's C4, the array binding, the 3-lane rule) and the
owner questions Q22–Q25 (statistics metrics, retention and lawful basis, choice events, ending counts before purchase)
live in [STORIES-PLAN.md](STORIES-PLAN.md), section "Open questions". None blocks a lane: each has a default there.

### Meta extension (changed by META-PLAN)

The engineering forks MQ1–MQ14 (the meta tail after L15, PostgreSQL 18 `RETURNING old`, inline meta texts, `getMe`,
the file caps of LF1 / LF2 / LM2 / LMI, the policy route, the inline-mode GAP and others) and the owner questions
MV1–MV19 (profile visibility and what friends see, share content, pack sizes and prices, the hint cost, the referral
bonus and caps, gift limits, the spent-pack refund, the minimum age, the policy's operator facts, the BotFather
privacy URL, social limits and others) live in [META-PLAN.md](META-PLAN.md), section "Open
questions". STORIES-PLAN Q23, Q24, Q25 are resolved there (privacy, choice events, ending counts). None blocks a lane:
each has a default there; the policy's operator facts are placeholders until the owner fills them before production.

---

## Readiness checklist

- [x] Goal names budget and correctness targets (T1–T6, budget table); every decision has why / alternatives /
  trade-off (K1–K30).
- [x] TS and Rust types for every new JSON with one source of truth (ts-rs; client-owned save body). SQL has a
  constraint per invariant. Every endpoint has auth, errors, idempotency and Cache-Control (HTTP API table).
- [x] Tags documented in STAGING-DSL.md; one parser for the gate and the runtime; the scene and the overlay never
  read story state; every line and choice has an ID.
- [x] Grant only on `successful_payment` via the charge-id insert, in one transaction; refund revokes; pre-checkout
  does three indexed statements in one transaction (the payer-row lock, the order PK read, the conditional UPDATE)
  plus one call under 7.5 s (changed by RULINGS 14; it read "one statement"). Changed by META-PLAN: two statements
  (the payer-row lock, the conditional UPDATE; the order PK read and the hint predicates are gone with the hint
  products), and the grant's pack credit is in the grant transaction; paid chapters and art only behind the
  entitlement check; `scan-dist.ts` proves their absence in `dist/` (changed by META-PLAN: and the meta texts').
- [x] Audio unlock in the gesture; viewport vars + safe areas; BackButton per closable overlay;
  `deactivated`/`activated` behaviour; no Service Worker, `window.open` or `alert` (arch test); SDK on the main origin.
- [x] Textures ≤ 2048 px; resolution ≤ 2× DPR; a release point per texture; long BGM streamed; peak and steady memory
  estimated.
- [x] Duplicate webhook, double tap, reload, token expiry, story update, context loss: outcomes in the failure table.
- [x] Red-first per commit (lane cut); test names; budget numbers the build gate enforces; each new gate seen failing
  ("Gates that must be seen red once").

---

## Revision log

| Rev | Date | Source | Summary |
|---|---|---|---|
| 0 | 2026-10-30 | architect round 1 | Initial design |
| 1 | 2026-10-30 | `D:/tmp/novel-orch/design/triage_r1.md` (critique `design/critique_r1.md`) | The 13 confirmed items W1–W7 and W9–W14 resolved. W8 (refuted) not touched. Optional O1–O13 noted, not folded in. Per-item detail: `D:/tmp/novel-orch/design/revision_r1.md` |
| 2 | 2026-10-30 | `D:/tmp/novel-orch/design/triage_r2.md` (critique `design/critique_r2.md`) | The 5 confirmed items W15–W19 resolved (none refuted or deferred). Optional O14–O18 noted, not folded in; the critique's open questions pass through. Per-item detail and verbatim patches: `D:/tmp/novel-orch/design/revision_r2.md` |
| 3 | 2026-10-30 | `D:/tmp/novel-orch/design/puzzles/spec.md` (RULINGS 10) + errata RULINGS 7 b/d/e/f, 8, 9 Q3/Q5 | Extended by [PUZZLES-PLAN.md](PUZZLES-PLAN.md); the changed decisions are marked "changed by PUZZLES-PLAN"; errata applied; the waves table replaced by a dependency order; lanes not yet started re-cut; new lanes LW1, LW2, LW3, L6c, LP2, LX. Design log: `D:/tmp/novel-orch/design/puzzles/design_log.md` |
| 4 | 2026-10-30 | `D:/tmp/novel-orch/design/puzzles/triage_r1.md` (critique `design/puzzles/critique_r1.md`) | PUZZLES-PLAN revision 1: the 9 confirmed items W1–W9 of the puzzles triage resolved in both documents; each PP edit is marked "changed by PUZZLES-PLAN". Per-item list: [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Revision log"; detail: `D:/tmp/novel-orch/design/puzzles/revision_r1.md`. Pre-revision copy: `D:/tmp/novel-orch/design/puzzles/PROTOTYPE-PLAN.r1.before.md` |
| 5 | 2026-10-31 | `D:/tmp/novel-orch/design/puzzles/triage_r2.md` (critique `design/puzzles/critique_r2.md`) | PUZZLES-PLAN revision 2: the 2 confirmed items W1 (one section cap `RESUME_STATE_CAP` = 5,000 for build and resume, ≤ 300 ms at CPU 4×; a world version that ignores texts) and W2 (membership resume proof from section entry; `resetSection` re-enters through the start room's `onEnter`) resolved in both documents; each PP edit is marked "changed by PUZZLES-PLAN revision 2". Per-item list: [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Revision log"; detail: `D:/tmp/novel-orch/design/puzzles/revision_r2.md`. Pre-revision copy: `D:/tmp/novel-orch/design/puzzles/PROTOTYPE-PLAN.r2.before.md` |
| 6 | 2026-10-31 | `D:/tmp/novel-orch/design/puzzles/triage_r3.md` (critique `design/puzzles/critique_r3.md`) | PUZZLES-PLAN revision 3: the 1 confirmed item W1 (the membership resume proof covers every section, not only the current one: after a version change every other section joins `WorldState.unproved` and is proved at its next entry by `admitSection`, the explore controller's only way in; ≤ 300 ms at CPU 4× per search, one search per load and per entry) resolved in both documents; each PP edit is marked "changed by PUZZLES-PLAN revision 3". Optional O1–O5 noted, not folded in. Per-item list: [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Revision log"; detail: `D:/tmp/novel-orch/design/puzzles/revision_r3.md`. Pre-revision copy: `D:/tmp/novel-orch/design/puzzles/PROTOTYPE-PLAN.r3.before.md` |
| 7 | 2026-10-31 | `D:/tmp/novel-orch/design/puzzles/triage_r4.md` (critique `design/puzzles/critique_r4.md`) | PUZZLES-PLAN revision 4: the 1 confirmed item W1 (a cross-section `unlock` was reverted by `admitSection` after any version change while its trigger stayed fired, so the chapter could not be finished) resolved by a new LW3 story-gate error, `world/cross-section-effect` (a trigger's `unlock` stays in its own section; an item or doc is given in one section); reconcile is unchanged. The PP edits are LW3 commit 1 and the seen-red "puzzle extension" row, each marked "changed by PUZZLES-PLAN revision 4". Optional O1, O2 noted, not folded in. Per-item list: [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Revision log"; detail: `D:/tmp/novel-orch/design/puzzles/revision_r4.md`. Pre-revision copy: `D:/tmp/novel-orch/design/puzzles/PROTOTYPE-PLAN.r4.before.md` |
| 8 | 2026-10-31 | RULINGS 14 + `D:/tmp/novel-orch/design/db/decision.md` §4.6, §5.3 | PUZZLES-PLAN revision 4b (database errata): the dependency order gains the port lanes LDB0 → LDB1 before L6b (table rows, L6b's gate + LDB1, L6c's gate = L6b which waits for LDB1, the lane count, the server launch order, the critical path's server chain and the LW3 note); lane L6c gets the PostgreSQL red text (`42P01`), the named-constraint assertions, `schema_puzzle_id_shape` and its tester mutation. The dependency order edits are marked by one sentence under that heading, the L6c edits each by "changed by PUZZLES-PLAN revision 4b". K14, K18, K19, the `0001` schema section and the other decision §6 edits are not touched: they land with LDB0/LDB1. Per-item list: [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Revision log"; removed/added text verbatim: `D:/tmp/novel-orch/design/puzzles/errata_db.md` |
| 9 | 2026-10-31 | `D:/tmp/novel-orch/design/puzzles/triage_r5.md` (critique `design/puzzles/critique_r5.md`) | PUZZLES-PLAN revision 5: the 1 confirmed item W1 (a puzzle attached to locks in two sections wrote another section's state: a courtyard solve left the tower gate on its lock panel, a strand the per-section soft-lock check never reaches, and after a version change `admitSection` reverted a run the current version wrote) resolved by a new LW3 story-gate error, `world/puzzle-multi-lock` (a puzzle is attached to at most one lock); reconcile is unchanged. The PP edits are LW3 commit 1 and the seen-red "puzzle extension" row, each marked "changed by PUZZLES-PLAN revision 5". Optional O1–O3 noted, not folded in. Per-item list: [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Revision log"; detail: `D:/tmp/novel-orch/design/puzzles/revision_r5.md`. Pre-revision copy: `D:/tmp/novel-orch/design/puzzles/PROTOTYPE-PLAN.r5.before.md` |
| 10 | 2026-10-31 | `D:/tmp/novel-orch/design/puzzles/triage_r6.md` (critique `design/puzzles/critique_r6.md`) | PUZZLES-PLAN revision 6: the 1 confirmed item W1 (a room→room exit into another section's room let the player act in that section while another was current: a courtyard arch into a tower room let a tower lever drop the player into a pit that neither per-section soft-lock search expands, and after a version change `admitSection` reverted the lever the current version pulled) resolved by a new LW3 story-gate error, `world/cross-section-exit` (every room→room exit leads to a room of its own section; sections join through a `leave` and an `explore` yield); reconcile is unchanged. The PP edits are LW3 commit 1 and the seen-red "puzzle extension" row, each marked "changed by PUZZLES-PLAN revision 6". Optional O1, O2 noted, not folded in. Per-item list: [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Revision log"; detail: `D:/tmp/novel-orch/design/puzzles/revision_r6.md`. Pre-revision copy: `D:/tmp/novel-orch/design/puzzles/PROTOTYPE-PLAN.r6.before.md` |
| 11 | 2026-10-31 | `D:/tmp/novel-orch/design/stories/spec.md` (RULINGS 20) | Extended by [STORIES-PLAN.md](STORIES-PLAN.md): several stories (a story = a chain of game-unique chapters, `story/stories.json`), the first chapter of each free, endings declared per story, saves per story, the statistics foundation. Changed items marked "changed by STORIES-PLAN": Goal, invariants, K3, K8, K9, K12, K13, K26, layout, TS types, SQL, HTTP API, Build outputs, Shared types, `Game`, F1, F4, F5, Budgets, Test strategy, seen-red, Integration, Later, Open questions. The lane cut: the 3-lane rule (RULINGS 18), collision locks, the dependency order (38 lanes; LS2 on the critical path); new lanes LS1, LS2, LS3, LS4, N2; re-cut L3c, L5, L6b, L6c, L7, L8a/L8b (seen-working note), L9, L10, L13, L14a, L14b, LW3, D1, N1, L15, D2. The RULINGS 21 errata are not applied here; the PP lines they cite moved (design log). Design log: `D:/tmp/novel-orch/design/stories/design_log.md` |
| 12 | 2026-10-31 | `D:/tmp/novel-orch/design/stories/triage_r1.md` (critique `design/stories/critique_r1.md`) | STORIES-PLAN revision 1: the 5 confirmed items resolved (W3 part 2 as narrowed). W1: the LS1 commits reordered (locales, the arch rule, `story.ts` with the skeleton `stories.json`, then emit) and the five moved `build.test.ts` pins named old → new; W2: the N2 commits carry their cast, names and titles (2 commits); W3: no `chapter_completed` at a declared ending's END, `chapter_started` for every `fresh` runner start (resume steps 2 and 5 included), L15 reds, LS3's `stats_ending_completes_its_chapter`; W4: the arch rule `import-outside-src` in LS1 (lock + `arch.test.ts`, collision chain L1 → LW2 → LS1 → LP2, the arch rules list); W5: `exitToStories()` disposes the puzzle session, the purchase flow and the explore controller (`Game` comment, L15 red). Each PP edit is marked "STORIES-PLAN revision 1". Optional O1–O8 noted, not folded in. Per-item list: [STORIES-PLAN.md](STORIES-PLAN.md), section "Revision log"; detail: `D:/tmp/novel-orch/design/stories/revision_r1.md`. Pre-revision copy: `D:/tmp/novel-orch/design/stories/PROTOTYPE-PLAN.r1.before.md` |
| 13 | 2026-10-31 | `D:/tmp/novel-orch/design/stories/triage_r2.md` (critique `design/stories/critique_r2.md`) | STORIES-PLAN revision 2: the 3 confirmed items resolved. W1: LS1 commit 8 makes the tool tests read an inline cast (`build.test.ts`, L3c's `locales.test.ts`, and one hunk each in the frozen `tags.test.ts` / `lint.test.ts`, reopened SQ2-style), proved by a scratch speaker `keeper` with `test` green; the LS1 lock 14 → 17; the collision locks; commit 6's "inline" sentence restated (the asset catalog is still read from the tree); N2's per-commit proof gains `test`. W2: `import-outside-src` judges template-literal `import()` / `new URL` heads, `+` joins and the glob `base` option as Vite does, flags `#` specifiers and refuses forms it cannot read; six red and two allow fixtures and a literal-only red ("Arch test rules", LS1 commit 5). W3: the fixture's paid ending is `q7_sealed_vault` (commit 6 fixture, commit 7 pin and test). Each PP edit is marked "STORIES-PLAN revision 2". Optional O1–O3 noted, not folded in. Per-item list: [STORIES-PLAN.md](STORIES-PLAN.md), section "Revision log"; detail: `D:/tmp/novel-orch/design/stories/revision_r2.md`. Pre-revision copy: `D:/tmp/novel-orch/design/stories/PROTOTYPE-PLAN.r2.before.md` |
| 14 | 2026-10-31 | `D:/tmp/novel-orch/design/stories/triage_r3.md` (critique `design/stories/critique_r3.md`) | STORIES-PLAN revision 3: the 2 confirmed items resolved. W1: LS1 commit 6 also gives `locales.test.ts`'s own `repoFiles()` an inline `story/stories.json` (`manor`, `endings: {}`) with the story's title and teaser in its temp-repo name tables, with a red (`story: catalog names come from the locale tables`, ENOENT on the temp repo's `catalog.json`); the new `LocaleInput` story ids (commit 4) and `planEmit` story input (commit 7) are required fields, so the lock note names commits 4, 6, 7 and 8 for `locales.test.ts`, and commits 4 and 7 state their one-argument hunks; commit 6's real-tree line names both helpers. W2: `tags.test.ts` reopens for L5 (SQ9), one hunk: the catalog-key pins of `catalog: demo catalog and cast decode` (:450-458) become subset pins of the L3a keys, with a red-first and a seen-failing scratch; the L5 lock 13 → 14; the frozen-file bullet; LS1 commit 8 notes that L5 owns those pins. Each PP edit is marked "STORIES-PLAN revision 3". Optional O1–O3 noted, not folded in. Per-item list: [STORIES-PLAN.md](STORIES-PLAN.md), section "Revision log"; detail: `D:/tmp/novel-orch/design/stories/revision_r3.md`. Pre-revision copy: `D:/tmp/novel-orch/design/stories/PROTOTYPE-PLAN.r3.before.md` |
| 15 | 2026-10-31 | `D:/tmp/novel-orch/design/stories/triage_r4.md` (critique `design/stories/critique_r4.md`) | STORIES-PLAN revision 4: the 1 confirmed item resolved. W1: `StoryNames` gains `stories` and `teasers` (`Record<StoryId, { ru; en }>`) in LS1 commit 7, where `emit.ts` first reads them, filled by `locales.ts` `nameChecks` for the `LocaleInput.stories` ids (commit 4 only requires them); L3c's pin `locales: matching tables raise nothing` (`locales.test.ts:291-298`) moves on purpose (`r.names` gains `stories: {}`, `teasers: {}`), with a red-first keyed on the diff lines; the inputs `NAMES` (`build.test.ts`), test 35's names and the `stories.test.ts` literals gain the keys; commit 4's red `loc: story title and teaser required` lives in `stories.test.ts`; the lock note (commit 7: two `locales.test.ts` hunks), the moved list (six pins) and the Gates line. Each PP edit is marked "STORIES-PLAN revision 4". Optional O1–O4 and the critique's open question 1 noted, not folded in. Per-item list: [STORIES-PLAN.md](STORIES-PLAN.md), section "Revision log"; detail: `D:/tmp/novel-orch/design/stories/revision_r4.md`. Pre-revision copy: `D:/tmp/novel-orch/design/stories/PROTOTYPE-PLAN.r4.before.md` |
| 16 | 2026-10-31 | RULINGS 12, 14, 22 + `D:/tmp/novel-orch/design/db/decision.md` §6 (PP bullets; replacement texts §1.3, §3.5, §4.1, §4.3, §4.4, §4.7, §4.8), as merged: LDB0 `857f7d6`, LDB1 `fee9da7`, LDB2 `a7e4a04` | RULINGS 12: PostgreSQL 18 from day one (design/db/decision.md). Docs lane `docs-errata`, group A: T2; K12 storage; K14 rewritten to DB-1/DB-2; K18 (payer-row lock, DB-4; the X6 bullet's count: three statements, lock first); K19 (why); the Deviations and Later PostgreSQL rows deleted; the layout and module map (`server/pgdev/`, the server-dev `lib.rs`/`main.rs` rows, `DevPaths`, `launch_database`); the `0001` section (heading LDB1, the merged schema byte for byte, connection = the session pins, isolation = DB-4); the shared-types save-body row; the pre-checkout, grant and refund SQL in the PostgreSQL dialect; the concurrency table (renamed and new test names, `lock_timeout`, the §4.7 rows with `53300`); resource lifetime (§4.8); test strategy (server row: the lock-wait probe under `server/tests/it/`, schema / pre-checkout / grant / dev-crate names, a pgdev bullet); seen-red rename; dependencies (sqlx features, `pgdev` for `tempfile`); gate mapping (cargo + e2e env, `pgdev` targets); L2/L4a/L4b "superseded by LDB1" lines; L8b commits 2-3 and its tester mutation (the `$6` previous-tier predicate); the readiness checklist's pre-checkout count (review round 1). Each place is marked "changed by RULINGS 14". Ledger: `D:/tmp/novel-orch/docs-errata/ledger.md` |
| 17 | 2026-10-31 | RULINGS 21 + `D:/tmp/novel-orch/lw2-world-model/cut.md` §6 (Q1-Q8) and its addendum, as merged: LW2 `38bc717` | Docs lane `docs-errata`, group B: the LW2 entry gains an "As merged" bullet (Q1 commit order rules → decode and the merged SHAs, Q2 PE7, Q3 signatures, Q4 the transitive `pure-world` rule, Q5 / C1 / W1 pointers to PUZZLES-PLAN (`WorldIssue` under "TS types — changes to existing modules", review round 1), Q6, Q7 provisional timing, Q8 names); LW3 commit 3 gains the `RULES_VERSION` hash input and its red (Q2) and an erratum line (Q4, Q6); L5 gains the `catalog.ts` purity line (Q4). PUZZLES-PLAN revision 9 holds the PZ errata. Ledger: `D:/tmp/novel-orch/docs-errata/ledger.md` |
| 18 | 2026-10-31 | RULINGS 22, 23 (as merged: LDB1 `fee9da7`, LDB2 `a7e4a04`, STORIES-PLAN `66c92c4`; L3c resumed, L6b running) | Docs lane `docs-errata`, group C: "Dependency order" — the State column at main `d9ca9f1` (LDB1, LDB2 merged; L3c, L6b running; a marker paragraph under the revision-11 note), the count (12 merged, 2 running, 24 to go), the server launch preference without LDB1 and LDB2 (the slot frees after L9), the critical path from L6b. The planned order is otherwise unchanged. STORIES-PLAN revision 5 holds the SP lines. Ledger: `D:/tmp/novel-orch/docs-errata/ledger.md` |
| 19 | 2026-10-31 | the META-PLAN campaign spec (choices, achievements, the card, sharing and friends, the economy foundation, privacy) + RULINGS 25 | Extended by [META-PLAN.md](META-PLAN.md) (M1–M28). Changed items marked "Changed by META-PLAN": Goal (an MT row, the budget line, the player paragraph); K3, K18, K19, K20, K26; the module map; HTTP API and the dev routes; Payment flow (packs instead of hint products, the two-statement pre-checkout, the grant's pack branch, unapplied, the refund clawback, `/privacy`); the Telegram module and the mock; BackButton overlays; Budgets (all JS 305, the `meta-ui` row); the lane cut (collision locks, the dependency order: 47 lanes, 14 merged, 33 to go; launch preference; the critical path); re-cut L6c, L8a, L8b, LS3, L7, L10, L9, D1, L14a, N1, N2, L14b, LP2, LS4, L15, D2; new lanes LE1, LF1, LM2, LF2, LE2 (server), LM1, LU1, LMD, LMI (client); Later; Open questions; Readiness. L3c (running at design start, merged since as `91e35cd`) and the merged lanes are not touched. Design log: `D:/tmp/novel-orch/design/choices/design_log.md` |
| 20 | 2026-10-31 | META-PLAN revision 1 (`D:/tmp/novel-orch/design/choices/triage_r1.md`, critique `design/choices/critique_r1.md`) | The 7 confirmed items, marked "revision 1": C1 / W1 — LF1 (the launch creates no request; `GET` / `POST /api/invites/{code}`: a holder asks, the owner accepts per person; `friend_blocks` makes a decline or removal durable; `user_handles` replace the Telegram id; eight commits), LF2 (the profile by handle; the `InviteView` sample), LE2 (`to` a handle), L14a (screen kinds by handle and code), LU1 (the prompt names nobody; the consent text names the circle), LMD, LMI, the HTTP API row, the `startParam` wrapper line; W2 — LS3 (facts and choices counted apart, first picks kept), LS4 (choices evicted first, facts first in a batch), the stats HTTP row; W3 — K19, K20, Payment flow, LE1 (`db/orders.rs`: the order binds the pack's kind and amount; 15 files), L9 (the clawback from the credited ledger row); W4 — the new lane LPO privacy-operator (`PRIVACY_OPERATOR_FILE`, the prod refusal; 8 files, 2 commits; LE2 → LPO → L9), LF1 commit 7 without the log warning, the config pre-declaration rule, collision locks, the dependency order, 48 lanes / 34 to go, the launch preference, the critical path, D2 (`privacy-ops`, README, gate); W5 — LE2 (the hook on every batch, never failing the response); W6 — META-PLAN only (the inventory). Pre-revision copy: `D:/tmp/novel-orch/design/choices/PROTOTYPE-PLAN.r1.before.md` |
| 21 | 2026-10-31 | META-PLAN revision 2 (`D:/tmp/novel-orch/design/choices/triage_r2.md`, critique `design/choices/critique_r2.md`) | The 1 confirmed item W1, marked "revision 2". The policy's operator file carries identity facts only, and content values change only with a new policy version. LPO: the goal (`IDENTITY_KEYS`, `CONTENT_KEYS`, `PolicyError::ContentKey`, `{POLICY_VERSION}` from the meta, `POLICY_PINS`); commit 1's `.env.example` comment; commit 2 gains the reds `privacy_operator_content_key_refused` and `api::legal::tests::policy_template_pinned_per_version`, plus `policy_placeholders_classified`, and three restated tests; the mutations and seen working. D2 `privacy-ops`: how the policy changes (a content value is a template commit with a new version and a pin row; a contact fix is a host-file edit; an operator change is both; dated host-file copies). LPO keeps 8 files and 2 commits; the lock, the dependency order and the lane count are unchanged. Pre-revision copy: `D:/tmp/novel-orch/design/choices/PROTOTYPE-PLAN.r2.before.md` |
| 22 | 2026-10-31 | META-PLAN revision 3 (`D:/tmp/novel-orch/design/choices/triage_r3.md`, critique `design/choices/critique_r3.md`) | The 1 confirmed item W1, marked "revision 3": each of the policy pin's three conditions gets a failing input. LPO: the goal (one `#[cfg(test)]` checker `check_pins`); commit 2 gains the red `pin_check_rejects_non_increasing_versions` / `pin_check_rejects_last_not_meta` / `pin_check_rejects_hash_mismatch` (crafted histories, red against an `Ok(())` stub) and the control `pin_check_accepts_a_valid_history`; `policy_template_pinned_per_version` runs the checker on the real data; tester mutation 3 restated against the checker; seen working. LPO keeps 8 files and 2 commits; the lock, the dependency order and the lane count are unchanged. Pre-revision copy: `D:/tmp/novel-orch/design/choices/PROTOTYPE-PLAN.r3.before.md` |
| 23 | 2026-11-01 | `D:/tmp/novel-orch/carry.md` at ORCH `d97ba64` (the docs-errata-2 spec, group A; RULINGS 26-52), as merged on main `6043941` | Docs lane `docs-errata-2`, group A: the carried plan errata of the merged lanes, each place marked "as merged" with its SHA and ruling. "As merged" bullets (commit lists, names, red texts, fill-ins) in the L3c, L6b, L6c, L5, LS1, LW3, LM1, L8b, LS3, L11 and L14a entries; in place: the LS2 entry (lock, commits, seen working), the en-table output row (L3c C5), the collision chains (`emit.ts` / `build.test.ts`, `story/locales/{ru,en}/story.json`, `client/src/telegram/**`, `client/src/ui/state.svelte.ts`), the L3c and LS2 and LW3 locks, K5's eviction class and the registry sections (L11), the Module API (`AssetRegistry`, `ensure`, `AudioManager`), the layout's character height, `asset-owners.json` dropped (L5), the audio placeholder flag, the `startParam()` wrapper (L7), the e2e gate row and the skip guard (L7), the L8a / L8b seen working (`assets` after `story`), the Rust payment types and the simulate route (L8b), the test-strategy timing and the idempotency seen-red row (L8b), the LS3 commit-3 red, seen working and `StatKind` home. The code on `6043941` is the ground truth. Fix round 1: the same L8b facts at their siblings (T3 real time, the L8b gates' check-then-insert mutation) and the probe erratum narrowed (`ProbeSuccessful` stays). Ledger: `D:/tmp/novel-orch/docs-errata-2/ledger.md` |
| 24 | 2026-11-01 | RULINGS 54 (as merged: every lane up to LU1 `2a7b50c`; L10, LE1 running; main `6043941`) | Docs lane `docs-errata-2`, group B: "Dependency order" — a marker paragraph and the State column as of `6043941` (29 merged with SHAs from `git log --first-parent main`, the seven pre-rewrite SHAs kept beside the new ones; L10 and LE1 running; 17 to go), the lane count (48: 29 merged, 2 running, 17 to go), the launch preference without the merged lanes, the critical path from L10 → L14b → LP2 → L15 (and the server chain from LE1). The planned order is otherwise unchanged. STORIES-PLAN revision 9 and META-PLAN revision 5 hold their lines. Ledger: `D:/tmp/novel-orch/docs-errata-2/ledger.md` |

**Revision 1 (2026-10-30)** — what changed, by triage item:
- **W1** (undecodable payment ACKed and lost): K17 (lenient `PaymentProbe` for the payment subset, 500 only when the
  money fields themselves are unreadable); K19; Rust types (`PaymentFact`, `RefundFact`, probe); HTTP API webhook row;
  shared-types table; concurrency table; `payments.provider_payment_charge_id` comment; server test names; L8b
  commit 4, L9 commit 3.
- **W2** (one order through pre-checkout twice; unapplied charges only logged): K18; pre-checkout SQL (the lock
  subquery includes the order itself) and the `InProgress` row; grant SQL comments + "Unapplied charge"; K19;
  `/paysupport`; concurrency table; Rust `notify_unapplied`; L8b commit 2, L9 commit 5; Later; E8; V4.
- **W3** (paid art / paid BGM without re-auth): `FetchAsset` (`story/catalog.ts`, implemented by `api/http.ts`)
  injected into scene and audio; K4, K24; module table + arch rule (`fetch(` never in `scene/` / `audio/`,
  `Authorization` only in `api/`); Module API (`mount`, `setChapter`, `createAudioManager`); registry and audio
  sections; concurrency table; L5 commit 4, L10 commit 1, L11 commit 6, L12 commits 2–3.
- **W4** (lost PUT response → self-conflict): HTTP API saves row (the one retry contract); F3 (`sentIds`, 409 and
  reload rules); concurrency table; L6a commit 2, L10 commits 3–4.
- **W5** (checkpoint resume errors in tunnel knots, loses LIST): DSL v1 forbids tunnels, knot/stitch parameters and
  `LIST` (STAGING-DSL §8, §9, §10, §11); K8, K9, K12; resume step 4 + the error floor; F2 runtime errors; T5; L3a
  commit 5, L13 commit 4, L15 commit 1.
- **W6** (next-chapter preload cannot resolve the next chapter's ids): K5 holders (`next:<chapterId>`); Module API
  `preload(…, from?)` / `setChapter`; F4 step 4–5; F5; registry section; audio SFX; L11 commit 5, L12 commit 4,
  L15 commit 1.
- **W7** (texture and memory budget not closed): K5 caps 32 / 48 MiB and the over-cap refusal; carried stage in K9,
  `usage.json`, the `budget/knot-set` row and STAGING-DSL §8; memory estimate and steady total redone in MiB at the
  gated limits (135.5 MiB = 142.1 MB; CPU bitmaps counted, justified by the context-loss restore); Goal; budget
  rows; concurrency table; L3b commit 2, L5 commit 5, L11 commit 2.
- **W9** (lane locks miss parent files): Rules ("Parent files"); collision locks; L2 pre-declares `config.rs`,
  `.env.example`, `error.rs` (`TelegramUnavailable` without the `GatewayError` source); `db/mod.rs` /
  `telegram/mod.rs` / `error.rs` added to the lanes that need them (L4a, L6a, L6b, L8a, L8b, L9); `server-dev` gets a
  lib target (`server/dev/src/lib.rs`, L4b/L8a/L8b; layout, module table, test-strategy and cargo gate rows); L14a
  seen working inside its lock.
- **W10** (screens without a lane): L14a Toast scope; L14b `Notice` (replaces `ReopenApp`) and `Menu`, the screen
  map; `app/boot.ts` row.
- **W11** (engine budget row vacuous before L15): budget states (PENDING); engine row; vacuous-green guards; L1
  commit 3; L11 gates and seen working; L15 gates.
- **W12** (fixed e2e ports collide): K27; `server-dev` `lib.rs`/`main.rs` rows (`DEV_API_PORT`); gate mapping e2e
  row (`DEV_WEB_PORT`, `reuseExistingServer: false`); seen-red table; L4b, L7 commits 4 and 6, L8a seen working; E2.
- **W13** (paid-path check never reaches a dev server): Paid-content protection (dev-server vitest checks, e2e test
  removed); smoke spec list; seen-red table; L3b commit 6.
- **W14** (`fingerprints.json` has two producers): shared outputs (`fingerprints.lines.json` /
  `fingerprints.assets.json`, one producer each, a minimum text sample); scan-dist rules (per-section non-vacuity);
  vacuous-green guards; seen-red table; L3b commits 3 and 5, L5 commit 4; asset-tool row.

**Revision 2 (2026-10-30)** — what changed, by triage item:
- **W15** (`next:<chapterId>` stays live after a non-END branch, so the chapter's own preloads are refused): F2
  `enteredKnot` now orders the holders: the F4 hand-over, then releasing every `next:*` holder on a knot that is not
  `ending`, then the stale preloads, then `next(K)`, then F5. F5 has one trigger definition (`meta.knots[K].ending`:
  a `-> END` is written in K), the same in STAGING-DSL §8, plus a Release paragraph. F2's `end` step now points to
  F4. Also changed: K5 holders; the `ChapterMeta.ending` comment; the registry Preload sources and release points;
  the concurrency table; test names; L15 commit 1 (`game: next-chapter holder released on non-ending branch`).
- **W16** (the carried stage is unsound for a cross-knot divert to a stitch or label): a lint makes every knot
  entry a knot top (`graph/entry-below-top`, STAGING-DSL §10, §11). The only clears the build credits are K's
  opening tag lines, as `classify.ts` classifies them: a subset of the runner's first batch on every path, so no
  second batch parser is needed (STAGING-DSL §3.3, §8). Also changed: K9 What, Why, Alternatives and Trade-off; the
  `budget/knot-set` row; L3b commit 2 (`lint: graph/entry-below-top red on fixture`, the extended
  `graph: carry propagates until cleared`).
- **W17** (the asset half of `scan-dist` is never seen red, and its trigger comes from the tool it checks):
  `scan-dist` computes "a paid-only asset exists" itself, from `usage.json` + `story/chapters.json`, and fails when
  `usage.json` is missing for a paid chapter. Two L5 reds in `scan-dist.test.ts`, which joins L5's lock (12 → 13):
  `scan: paid asset bytes in dist fail` and `scan: paid-only asset with empty files section fails`. Also changed:
  Paid-content protection; shared outputs (`usage.json`); the vacuous-green guards; the seen-red `build` scan row
  (L5); test names; collision locks (`scan-dist.ts` L1 → L3b → L5, `scan-dist.test.ts` L1 → L5).
- **W18** (`build_dev_app()` hard-wires one SQLite file for parallel tests): `build_dev_app(DevPaths)`; the
  `server-dev` `main.rs` deletes and passes `target/e2e/dev.db`; every `dev.rs` test gets its own `tempfile` DB
  through one `dev_app()` helper. Also changed: the server-dev module rows; the Module API; the test-strategy server
  row; dev crate test names; the dependency row; L4b commit 1 (`dev_app_uses_given_db_path`).
- **W19** (lanes that grow `AppState` do not hold its construction sites): one constructor, `AppState::new(cfg)`,
  plus the `with_clock` / `with_gateway` seams and `StartupError`, all in `server/src/lib.rs`. A private field makes
  any struct literal outside the lib a compile error. Its callers (server `main.rs`, `build_dev_app`, the `it` helper
  `test_state()`) each pass a complete `Config`; every test `Config` names the fixture `CONTENT_DIR`
  `server/tests/fixtures/content/`, which L6b fills; `DevPaths` gains `content`. A lane rule carries the acceptance
  check. Also changed: the `lib.rs` and server-dev rows; the Module API; the test-strategy server row; L2 commit 2,
  L4a (lock note, commit 4), L4b commit 1, L6b (lock + fixtures, commit 2), L8a commits 1 and 4.

**Revision 3 (2026-10-30)** — the puzzles extension (RULINGS 10) and the errata:
- **Extension.** The subsystem design is [PUZZLES-PLAN.md](PUZZLES-PLAN.md). Here only the decisions it changes are
  marked "changed by PUZZLES-PLAN":
  - Goal: the exploration step and T7–T11;
  - the yield-channel invariant;
  - K3 (lazy chunks); K5 (`room:` and `scene:prop:` holders); K9 (yield edges); K12 (world + `at.yield`);
    K14 (residual); K18 (hint products); K26 (root-back);
  - the module map rows; three arch rules; the TS and Rust type notes;
  - the SQL `0002` note; the HTTP API rows; the concurrency, payment, paid-content, scene and resource-lifetime
    pointers;
  - the budget rows (all JS 290, before the first line 270, the lazy chunks, world, props, room set);
  - the test-strategy rows; the Open-questions pointer.
- **Errata:**
  - RULINGS 7b: `synchronous=FULL`.
  - RULINGS 7d: `AppState` is `#[non_exhaustive]`; the private-field wording is replaced.
  - RULINGS 7e: the 16 KB body limit is owned by L4a.
  - RULINGS 7f: the K14 residual is stated.
  - RULINGS 9 Q3: host clock sync (concurrency row; D2 runbook).
  - RULINGS 9 Q5: the L4a `db/mod.rs` and `it/common.rs` notes.
  - RULINGS 8: the waves table is replaced by "Dependency order" (critical path
    L3a → L3b → L3c → L5 → L7 → L11 → L14a → L14b → LP2 → L15 → D2).
- **Lane cut:**
  - New lanes: LW1 puzzle-dsl, LW2 world-model, LW3 story-world, L6c server-puzzles, LP2 puzzle-ui,
    LX explore-ui.
  - Re-cut: L5, L6b, L8a, L8b, L9, L10, L11, L13, L14a, L14b, L15, D1, N1, D2 (each block marked "Changed by
    PUZZLES-PLAN").
  - Collision locks rewritten.
  - L1, L2, L3a, L4a keep their scope.
