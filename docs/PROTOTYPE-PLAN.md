# Architecture: prototype vertical slice

Status: design (campaign deliverable, architect round 1, 2026-10-30; revision 10 — see [Revision log](#revision-log)).
Extended by [PUZZLES-PLAN.md](PUZZLES-PLAN.md) (RULINGS 10: puzzles, exploration, inventory, paid hints). Every
decision that extension changes is marked "changed by PUZZLES-PLAN" here, and the lane cut below is re-cut for it
(revision 3).
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

**Correctness targets** — each is a gate, not a review item:

| # | Target | Proved by |
|---|---|---|
| T1 | No paid chapter JSON, paid English table or paid art in `client/dist/` or under any public/static route | `scan-dist.ts` in `build`; `paid_chapter_403_without_entitlement` test |
| T2 | Grant only on `successful_payment`, exactly once per `telegram_payment_charge_id`, even under concurrent redelivery; refund revokes | server integration tests (temp-file WAL DB) |
| T3 | `pre_checkout_query` answered < 7.5 s worst case, typically < 50 ms + one Bot API call | `precheckout_*` tests with a fake gateway and paused time |
| T4 | Identity only from server-verified initData (HMAC, constant time, `auth_date` window) | initData vector tests (independently signed fixtures) |
| T5 | A save from an older story version resumes (exact → knot checkpoint → chapter start), never throws; an ink error after a resume steps the next resume down a level, never loops | `resume_*` vitest tests on edited fixture chapters, incl. `resume: ink error after checkpoint resume falls back to chapter start` |
| T6 | Every player line and choice has a unique, stable line ID; English complete for the demo | `npm run story` |
| T7–T11 | Changed by PUZZLES-PLAN: no hint text, solution or paid world text in `dist/`; a hint tier granted once per charge, never out of order or after a solve, revoked on refund; no exploration soft-lock; the host writes ink only at a yield; a save restores the open puzzle's start and the exact exploration state, and a story update never strands the player | [PUZZLES-PLAN "Goal"](PUZZLES-PLAN.md#goal) |

**Budget targets** (numbers and gates in [Budgets](#budgets-and-validation)):
- initial JS ≤ 40 KB brotli; all JS before the first line ≤ 270 KB brotli; first-load ≤ 800 KB;
- time to first line ≤ 6 s at 4× CPU and 1.6 Mbps;
- live texture bytes ≤ 32 MiB steady (hard cap 48 MiB); steady memory ≤ 135.5 MiB (142.1 MB) at the gated limits
  (principle 4: < 150 MB). All memory figures are MiB (2^20 B) unless marked MB.

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
    reducer is pure and shared by the runtime, the soft-lock checker and the playthroughs.

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
  - **Storage.** The server stores the client's `SaveBodyV1` string (size-capped, `json_valid`) plus typed envelope
    columns.
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

**K14. Server: axum 0.8.9 + sqlx 0.9.0 runtime queries (no `query!` macros) behind a `db/` module seam; SQLite WAL;
the whole schema in one migration** [R2 §4].
- **Why:**
  - Runtime `query_as` + `FromRow` needs no `.sqlx/` offline data under `--locked` gates and causes no lane friction.
  - sqlx 0.9 refuses non-`'static` SQL unless wrapped in `AssertSqlSafe`, so string concatenation is impossible by
    type. A grep test bans `AssertSqlSafe` entirely.
  - Erratum (RULINGS 7 f): `no_dynamic_sql` cannot see SQL built into a `String` held in a `static`
    (`LazyLock` / `OnceLock`): such a string is `'static`, so sqlx accepts it. Reviewers of every `db/` change check
    for such statics.
  - One migration up front: the schema is fully designed here, so no two lanes fight over `server/migrations/`.
- **Alternatives:**
  - The `query!` macros (compile-time checks; `.sqlx` refresh per lane).
  - rusqlite + `spawn_blocking`: cannot coexist with sqlx 0.9 (different `libsqlite3-sys` majors), and moving to
    PostgreSQL would mean a rewrite [R2 §4.5].
- **Trade-off.** Column errors surface in repository tests, not at compile time. Revisit `query!` with PostgreSQL
  (Later).

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
- **Changed by PUZZLES-PLAN (X6).** Products are chapters and hint tiers (`hint:<puzzleId>:<tier>`). Pre-checkout
  becomes two indexed statements, both inside the same 2 s DB timeout (worst case still about 7.5 s):
  1. a PK read of the order's `product_id`;
  2. the conditional UPDATE above, plus three nullable predicates computed in Rust from the catalog:
     - tier n−1 owned;
     - the paid chapter owned;
     - the puzzle not solved.

  A failed predicate → `RejectReason::Unavailable`. For a chapter product all three parameters are NULL, so the
  effect is unchanged.

**K19. Grant: one transaction, write-first.**
- **Steps.**
  1. `INSERT INTO payments … ON CONFLICT (telegram_payment_charge_id) DO NOTHING RETURNING`.
  2. Only if that inserted a row: the order → `paid`.
  3. `INSERT INTO entitlements … ON CONFLICT (user_id, product_id) DO NOTHING`.
  4. Commit, then 200.
- **Why.** Principle 2; R2 MEASURED the RETURNING behaviour. Write-first avoids the SQLite DEFERRED
  read→write upgrade `SQLITE_BUSY`.
- **Never lose money facts.** A payment row is recorded even if the order is unknown, and even if the pinned
  frankenstein types cannot decode the update (K17 probe).
- **Unapplied charges reach the payer.** A charge that ends `OrderMismatch` or `AlreadyEntitled` (recorded, no grant)
  triggers, after the commit, a bot message to the payer and to every `ADMIN_TELEGRAM_IDS` entry (charge id,
  `/paysupport`); `/paysupport` lists it as "not applied" from then on (derived: a `payments` row with no
  `entitlements` row and `refunded_at IS NULL`). The refund is the admin's `/refund` (V4 default); automatic refund
  is the owner's V4 call.

**K20. Refunds: admin `/refund <charge_id>` → `refundStarPayment` → revoke transaction; `refunded_payment` →
the same revoke, idempotent** [R2 §1.4].
- **Why.** The docs do not say whether `refunded_payment` arrives for bot-issued refunds, so revoke on our own call's
  success and also on the update.
- **Trade-off.** No user self-service refund (owner question V4).

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
| PostgreSQL | SQLite WAL behind the `db/` seam for the prototype (RULINGS 1; [O] also names SQLite as a simplified start) | K14 |
| WebGPU optional | WebGL only | K30 |
| HMAC + "Ed25519 if needed" | HMAC only; a locally minted initData can never carry a valid Ed25519 signature [R1 §4] | K16 |
| Narrat "last release Oct 2023" | not dormant (npm 4.1.18, 2026-09) [R3 §7]; no design effect | — |

---

## Module map

### Repository layout (the lanes create it; CLAUDE.md "Stack and layout" gets these additions — open question E4)

```text
Cargo.toml                 virtual workspace: members ["server", "server/dev"], resolver "3"
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
story/                     ink sources and story data
  chapters.json  cast.json  retired-ids.txt  lint-allow.json
  common/globals.ink  ch1/main.ink  ch2/main.ink
  locales/en/<ch>.json  locales/{ru,en}/story.json
assets/                    catalog.json (+ src/ for real art later)
docs/                      PROTOTYPE-PLAN.md  STAGING-DSL.md  (+ FEATURE_MAP, ARCHITECTURE, AUTHORING, runbooks)
```

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
| `catalog.rs` | products from `server/catalog.json` (prices are server-only); changed by PUZZLES-PLAN: hint-tier products derived from the puzzle index + `hints.priceStars`, `prereqs()` |
| `content.rs` | `ContentStore`: loads `CONTENT_DIR` at startup (paid chapters, paid en tables, manifests, the asset file index); changed by PUZZLES-PLAN: paid worlds and the puzzle index (`content/puzzles/<ch>.json`: solutions, hint texts) |
| `puzzles/mod.rs` (+ `api/puzzles.rs`, `db/puzzles.rs`) | changed by PUZZLES-PLAN: answer check, attempt rate limit, puzzle status + hint texts (L6c) |
| `telegram/gateway.rs` | `BotGateway` trait + `FrankensteinGateway` (frankenstein 0.52.1, short-timeout reqwest client) |
| `telegram/webhook.rs` | the `/telegram/webhook` handler: secret check → decode → `process_update` |
| `telegram/payments.rs` | pre-checkout validation, grant, revoke |
| `telegram/commands.rs`, `texts.rs`, `setup.rs` | `/start`, `/terms`, `/support`, `/paysupport`, admin `/refund`; ru/en bot texts; the setup subcommand |

### `server/dev` (crate `server-dev`: lib target + binary `server-dev`)

| Module | Responsibility |
|---|---|
| `lib.rs` | `build_dev_app(paths: DevPaths) -> Result<Router, server::StartupError>`: `server::build_router(state)` merged with the dev router (each dev module exposes `routes()`). The state comes from `server::AppState::new(<dev Config>)` + `.with_gateway(FakeBotGateway)` (L8a), never a struct literal; the dev `Config` holds the fixed dev bot token / webhook secret, a random token key, `DATABASE_PATH = paths.db` (opened and migrated; it never deletes a file) and `CONTENT_DIR = paths.content`; `pub mod`s. The lib target lets `server/dev/tests/dev.rs` drive the app through `oneshot` with no port; each of its tests passes its own `tempfile` DB path (one `dev_app()` helper in `dev.rs`), so parallel test threads never share a file |
| `main.rs` | deletes `target/e2e/dev.db` and its `-wal` / `-shm` (a fresh DB per launch; the path is resolved from the workspace root, not the cwd), then binds `build_dev_app(DevPaths { db: <that path>, content: server/content })` (the generated content, also resolved from the workspace root) to `127.0.0.1:$DEV_API_PORT` (default 8787; loopback only) and serves it |
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

pub enum PreCheckoutVerdict { Ok, Reject(RejectReason) }
pub enum RejectReason { UnknownOrder, Mismatch, AlreadyOwned, InProgress, Expired, Temporary,
                        Unavailable /* changed by PUZZLES-PLAN: a hint's tier, chapter or solved predicate */ }
pub enum GrantOutcome { Granted, Duplicate, AlreadyEntitled, OrderMismatch }
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

### SQL schema — `server/migrations/0001_init.sql` (whole schema, L2)

One constraint per invariant. All timestamps are unix seconds. `STRICT` tables.

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,                    -- Telegram user id (from verified initData only)
  first_name    TEXT    NOT NULL,
  language_code TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE payments (                                 -- money facts: never rejected, never deleted
  telegram_payment_charge_id TEXT    PRIMARY KEY,       -- THE idempotency key (principle 2)
  invoice_payload            TEXT    NOT NULL,          -- not an FK: an unknown payload is still recorded
  user_id                    INTEGER NOT NULL,          -- payer (Message.from.id); no FK: a payment row is never refused
  amount                     INTEGER NOT NULL CHECK (amount > 0),
  currency                   TEXT    NOT NULL,          -- recorded as received; grant requires 'XTR' (orders CHECK)
  provider_payment_charge_id TEXT    NOT NULL,          -- '' when Telegram omits it (K17 probe)
  paid_at                    INTEGER NOT NULL,
  refunded_at                INTEGER,
  CHECK (refunded_at IS NULL OR refunded_at >= paid_at)
) STRICT;
CREATE INDEX payments_by_user ON payments(user_id);

CREATE TABLE orders (
  id           TEXT    PRIMARY KEY,                     -- OrderId = invoice payload
  user_id      INTEGER NOT NULL REFERENCES users(id),
  product_id   TEXT    NOT NULL,
  amount       INTEGER NOT NULL CHECK (amount > 0),     -- from server/catalog.json at creation, never from the request
  currency     TEXT    NOT NULL CHECK (currency = 'XTR'),
  status       TEXT    NOT NULL CHECK (status IN ('created','checkout','paid','refunded')),
  invoice_url  TEXT,
  created_at   INTEGER NOT NULL,
  checkout_at  INTEGER,
  paid_at      INTEGER,
  charge_id    TEXT    UNIQUE REFERENCES payments(telegram_payment_charge_id),
  CHECK (status <> 'checkout' OR checkout_at IS NOT NULL),
  CHECK (status NOT IN ('paid','refunded') OR (charge_id IS NOT NULL AND paid_at IS NOT NULL))
) STRICT;
CREATE INDEX orders_by_user_product ON orders(user_id, product_id, status, created_at);

CREATE TABLE entitlements (                             -- the ONLY unlock fact
  user_id    INTEGER NOT NULL REFERENCES users(id),
  product_id TEXT    NOT NULL,
  charge_id  TEXT    NOT NULL UNIQUE REFERENCES payments(telegram_payment_charge_id),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, product_id)                     -- one entitlement per product; revoke = DELETE
) STRICT;

CREATE TABLE saves (
  user_id       INTEGER NOT NULL REFERENCES users(id),
  slot          TEXT    NOT NULL CHECK (slot IN ('auto','s1','s2','s3')),
  rev           INTEGER NOT NULL CHECK (rev >= 1),
  chapter_id    TEXT    NOT NULL,
  story_version TEXT    NOT NULL,
  line_id       TEXT,
  write_id      TEXT    NOT NULL,                       -- client idempotency key of the last successful write
  body          TEXT    NOT NULL CHECK (json_valid(body) AND length(body) <= 262144),
  saved_at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot)
) STRICT;
```

- **Connection.** WAL, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5s`, pool of 4 connections
  [R2 §4.2].
  - Erratum (RULINGS 7 b, supersedes NORMAL): a grant committed and answered 200 to Telegram must survive an OS crash
    or power loss (principle 2), and one fsync per commit costs nothing at this load. L4a made the change.
- **Changed by PUZZLES-PLAN.** `server/migrations/0002_puzzles.sql` (L6c) adds `puzzle_progress` (attempt window +
  `solved_at` per user and puzzle). `server/build.rs` (`cargo:rerun-if-changed=migrations`) makes `migrate!` pick up
  a new migration file in incremental builds. A hint unlock is an `entitlements` row: no new unlock table.
  [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "SQL".
- **Transactions start with a write** (K19): no read-then-write upgrade inside a DEFERRED transaction.
- **PostgreSQL later.** The same statements work with `$n` placeholders and `jsonb` for `body`, behind `db/`.

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
| `GET /api/saves` | bearer | — | `SaveListResponse { slots: SaveSummary[] }`, `SaveSummary { slot, rev, chapterId, storyVersion, lineId, savedAt, writeId }` | 401 | read |
| `GET /api/saves/{slot}` | bearer | — | `SaveFull { summary: SaveSummary, body: string }` | 400 bad slot, 404 `not_found` (also for another user's slot: rows are keyed by the token's user) | read |
| `PUT /api/saves/{slot}` | bearer | `PutSaveRequest { expectedRev: number\|null, writeId: string, chapterId, storyVersion, lineId: string\|null, body: string }` | `PutSaveResponse { rev, savedAt }` | 400, 409 `save_conflict` + `current`, 413 `payload_too_large` | `expectedRev` (optimistic) + `writeId`. **The one statement of the retry contract:** a PUT whose `writeId` equals the stored row's `write_id` returns 200 with the stored `rev` / `savedAt` and writes nothing, whatever its `expectedRev`. Any other `expectedRev` mismatch → 409 + `current` (F3 handles an earlier write of ours in `current`) |
| `POST /api/invoices` | bearer | `CreateInvoiceRequest { productId }` (`chapter:<ch>`, or `hint:<puzzleId>:<tier>`, changed by PUZZLES-PLAN) | `CreateInvoiceResponse { orderId, invoiceUrl }` | 404 `unknown_product`, 409 `already_owned`, 409 `hint_unavailable` (tier order, solved, paid chapter not owned; changed by PUZZLES-PLAN), 502 `telegram_unavailable` | reuses this user's `created` order for the product younger than 1 h |
| `GET /api/orders/{orderId}` | bearer | — | `OrderResponse { orderId, productId, status: 'created'\|'checkout'\|'paid'\|'refunded' }` | 404 (unknown, or not this user's) | read |
| `GET /api/chapters/{chapterId}` | bearer | — | `ChapterPayload { chapterId, storyVersion, story: unknown, meta: unknown, assets: unknown, en: unknown, world: unknown }` (raw JSON composed from `ContentStore` via `RawValue`; `world`, the paid public world or `null`, changed by PUZZLES-PLAN) | 403 `not_entitled`, 404 (unknown or free chapter: free chapters are static files) | read; `private, no-store` |
| `GET /api/assets/{file}` | bearer | — | bytes (`image/avif`, `image/webp`, `audio/mp4`, `audio/wav`) | 403, 404 (file not in the content index — a map lookup, never a path join) | read; `private, no-store` |
| `GET /api/puzzles/{puzzleId}?lang=ru\|en` (changed by PUZZLES-PLAN, L6c) | bearer | — | `PuzzleStatus { puzzleId, solved, hints: HintTier[] }`; `text` only for owned tiers | 400, 403 `not_entitled` (paid chapter), 404 | read; `private, no-store` |
| `POST /api/puzzles/{puzzleId}/attempts` (changed by PUZZLES-PLAN, L6c) | bearer | `AttemptRequest { answer: number[] }` | `AttemptResponse { correct, solved }` | 400 shape, 403, 404, 429 `rate_limited` + `Retry-After` (20 per 600 s per user and puzzle) | the result is a function of the answer; a retry counts once more toward the window |
| `POST /telegram/webhook` | header `X-Telegram-Bot-Api-Secret-Token` (constant-time) | Telegram `Update` (bytes) | 200 (also on undecodable input without a payment, logged; an undecodable payment goes through the K17 probe first) | 401 bad/missing secret (before parsing); 500 when a `successful_payment` / `refunded_payment` transaction failed, or when a payment-bearing update's money fields are unreadable even by the probe (Telegram redelivers; grant and revoke are idempotent) | `telegram_payment_charge_id` |

**Dev routes** (`server-dev` only; not routable on the `server` binary, test `server_has_no_dev_routes`):

| Route | Behaviour |
|---|---|
| `GET /dev/launch?uid=1001&lang=ru&name=Dev` | sign initData with the dev bot token → `302 /#tgWebAppData=<enc>&tgWebAppVersion=9.6&tgWebAppPlatform=android&tgWebAppThemeParams=<enc json>` |
| `GET /dev/invoices/{slug}` | `{ orderId, title, description, amount }` recorded by the fake gateway |
| `POST /dev/simulate-payment` | `{ slug, outcome: 'paid' \| 'paid_twice', webhookDelayMs?: number }`. Feeds a `pre_checkout_query` update, then (if answered ok) a `successful_payment` message (`provider_payment_charge_id: ""`, `telegram_payment_charge_id: "dev_<uuid>"`) through the real handler. Returns `{ precheckoutOk, chargeId? }` |
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
| en table `{id: text}` | `client/src/story-gen/free/<ch>.en.json` | `server/content/chapters/<ch>/en.json` |
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
- `server/content/build/asset-owners.json` — paid file → products allowed to read it.

The client imports free outputs only by URL:
- `import.meta.glob('../story-gen/free/*.json', { query: '?url', import: 'default', eager: true })`;
- `import catalogUrl from '../story-gen/catalog.json?url'`, fetched at boot.

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
| Save body | TS `SaveBodyV1` (client-owned; opaque to the server) | `save-codec.ts` | codec tests; the server checks only `json_valid` + size |
| Build outputs (catalog, meta, manifest) | TS types in `story/catalog.ts` (both producer and consumer are TS) | decoders | story/asset tool tests |
| Chapters ↔ products | `story/chapters.json` (`productId`) + `server/catalog.json` (prices) | — | `catalog_matches_story_chapters` (Rust reads `../story/chapters.json`); the server refuses to start if a catalog product has no content |
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
pub struct DevPaths { pub db: PathBuf, pub content: PathBuf }
    // main.rs: target/e2e/dev.db (deleted first) + server/content; dev.rs: a temp file per test + the test fixtures
pub async fn build_dev_app(paths: DevPaths) -> Result<Router, StartupError>;   // AppState::new + with_gateway (L8a);
                                                                             // opens + migrates paths.db, never deletes
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
- `ui/screens.ts` holds the overlay stack (menu, backlog, settings, saves, chapters, paywall, terms).
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

**The client never grants.** `paid` from `invoiceClosed` only starts polling [R1 §2]. The UI unlocks only when
`GET /api/entitlements` says `owned` (principle 1). The `purchase_unlocks_only_from_server` unit test forges a
CloudStorage/DeviceStorage "owned" value and expects nothing to unlock.

**Pre-checkout (P5).** One statement, then one answer:

```sql
UPDATE orders SET status = 'checkout', checkout_at = ?now
 WHERE id = ?payload AND user_id = ?from AND amount = ?total AND ?currency = 'XTR'
   AND status IN ('created','checkout') AND created_at > ?now - 86400
   AND NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = orders.user_id AND e.product_id = orders.product_id)
   AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.user_id = orders.user_id AND o2.product_id = orders.product_id
                     AND o2.status = 'checkout' AND o2.checkout_at > ?now - 120)
RETURNING id;
```

The lock subquery deliberately has no `o2.id <> orders.id`: it sees this order too (SQLite evaluates the subquery
against the pre-update row), so a second pre-checkout of the **same** order — the same slug opened on two devices —
is refused while that order's own `checkout_at` is inside the 120 s window. After the window the same order may pass
again (a retry after a failed payment).

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
- A PK read of the order's `product_id` comes first.
- The statement above gains three nullable predicates: the previous tier owned; the paid chapter owned; the puzzle not
  solved in `puzzle_progress`.
- A failure classifies as `Unavailable`.
- For chapter products the three parameters are NULL.
- The SQL text: [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "SQL".

**Timing.** DB ≤ 2 s (`timeout`), answer ≤ 5 s (`timeout` + reqwest 2 s connect / 5 s total) → worst case about 7.5 s
< 10 s (principle 2). No other work happens on this path. The answer gateway error is logged; we still return 200,
because Telegram cancels the transaction itself when unanswered.

**Grant (P6).** One transaction, write first:

```sql
-- 1  (if RETURNING yields no row → Duplicate: commit, 200)
INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency,
                      provider_payment_charge_id, paid_at)
VALUES (?charge, ?payload, ?from, ?total, ?currency, ?provider, ?now)
ON CONFLICT (telegram_payment_charge_id) DO NOTHING RETURNING telegram_payment_charge_id;
-- 2  (no row → OrderMismatch: payment recorded, NO grant, tracing::error!; after COMMIT notify_unapplied (K19))
UPDATE orders SET status = 'paid', paid_at = ?now, charge_id = ?charge
 WHERE id = ?payload AND user_id = ?from AND amount = ?total AND ?currency = 'XTR' AND status IN ('created','checkout')
RETURNING product_id;
-- 3  (no row → AlreadyEntitled: a second paid order slipped past the checkout lock; after COMMIT notify_unapplied)
INSERT INTO entitlements (user_id, product_id, charge_id, granted_at) VALUES (?from, ?product, ?charge, ?now)
ON CONFLICT (user_id, product_id) DO NOTHING RETURNING product_id;
-- COMMIT; then, only for OrderMismatch / AlreadyEntitled: notify_unapplied; then 200
```

**Unapplied charge** (`notify_unapplied`, after the commit, outside any transaction): `send_message` to the payer
(bot text `payment_unapplied`: the charge id and `/paysupport`) and to each `ADMIN_TELEGRAM_IDS` entry (charge id,
payer, outcome), each under the gateway's 5 s timeout; a gateway error is logged and the webhook still answers 200.
The durable record is the data itself: `/paysupport` flags every charge of the user that has no `entitlements` row and
`refunded_at IS NULL` as "not applied". A redelivered duplicate is `Duplicate` and sends nothing. The remedy is the
admin's `/refund`; automatic refund is the owner's call (V4).

**Refund.**
1. Admin `/refund <charge_id>` (from `ADMIN_TELEGRAM_IDS`) or `POST /dev/refund` → look up the payment.
2. `gateway.refund_star_payment(user, charge)`, with no transaction open.
3. On `Ok`, or on an API error that says the charge is already refunded (verify: the exact error text, L9) → revoke:

```sql
UPDATE payments SET refunded_at = ?now WHERE telegram_payment_charge_id = ?charge AND refunded_at IS NULL RETURNING user_id;
DELETE FROM entitlements WHERE charge_id = ?charge;
UPDATE orders SET status = 'refunded' WHERE charge_id = ?charge;
```

- `refunded_payment` updates run the same revoke; repeats are no-ops (`AlreadyRefunded`).
- Gateway failure → no revoke (money not returned) and the admin is told.
- A crash between refund and revoke → the next `/refund` sees "already refunded" → revoke. That is repeat-safe.

**Bot commands:**
- **`/start`** — a message with an inline `web_app` button (`PUBLIC_APP_URL`).
- **`/terms`** — the terms text (placeholder, Q4).
- **`/support`** — the support contact, plus the required note that Telegram support cannot help with purchases
  [R2 §1.5].
- **`/paysupport`** — payment-support instructions and the user's own charge ids with dates, so they can quote them;
  charges not applied to a purchase are flagged "not applied" (K19).

Texts come from `server/locales/bot.{ru,en}.json` by `from.language_code`. `server setup` registers the commands with
`setMyCommands` (ru, en, default), the webhook (`secret_token`, explicit `allowed_updates`) and the menu button
[R2 §1.5–1.6].

---

## Concurrency and failure model

| Situation | Authority | Outcome |
|---|---|---|
| Webhook `successful_payment` delivered twice (sequential or concurrent) | `payments` PK | first: Granted; second: Duplicate; both 200; one payment, one entitlement — `successful_payment_duplicate_concurrent_wal` (`tokio::join!`, temp-file WAL DB so connections really race [R4 §5.3]) |
| Client `paid` before the webhook | DB | polling sees `checkout`, keeps polling; unlock on `paid` |
| Webhook before `invoiceClosed` | DB | first poll sees `paid` |
| Webhook never arrives (Telegram outage) | DB | `delayed` state; Check again; reload → entitlements; the payment is still recorded when Telegram redelivers |
| Double tap on Buy | client guard + order reuse + checkout lock | one sheet; a second open of the same slug throws → ignored |
| One order (one slug) opened on two devices, both press Pay | checkout lock, own order included | the second pre-checkout within 120 s of the first is refused (`InProgress`) — `precheckout_same_order_twice_refused` |
| Two orders for one product paid in parallel | checkout lock (120 s) + entitlement PK | second pre-checkout refused (`InProgress`); if a charge still lands unapplied (`AlreadyEntitled` / `OrderMismatch`, e.g. a payment `pending` past the 120 s lock — E8): payer + admins notified, `/paysupport` flags it, refund per V4 — `unapplied_charge_notifies_payer_and_admin` |
| Pre-checkout DB contention | `busy_timeout` within `timeout(2 s)` | answer `ok=false` (Temporary), 200 |
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
       own files (`asset-owners.json`, `fingerprints.assets.json`): an asset id in `server/content/build/usage.json`
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
  never upscaled above the source's native size × resolution.

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
    every `preload:*` and `next:*` holder, and is refused with `over-cap` if it still does not fit.
- **Release.** At holder-set empty: `texture.destroy(true)`, `bitmap.close()`, counters down.

**Per-chapter manifest.** `scene.setChapter(manifest)` swaps the id → `AssetEntry` table. A missing id → error value.
`preload(tag, ids, from)` resolves in `from` when given, so the next chapter's ids resolve in its own manifest (F5);
asset ids are global (one catalog), so an entry fetched under `next:<id>` is the same registry entry `ensure` finds
after `setChapter`.

**Preload.**
- **Sources.** Knot hints from GameSession (`next(K)` from `ChapterMeta`); the next chapter's first knot (holder
  `next:<chapterId>`, resolved in that chapter's manifest, kept across `setChapter` to it — F4, F5 — and released on
  entering a knot without `-> END` — F2); the blocking `ensure()` for a batch's own assets.
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
  22.05 kHz 16-bit ≈ 353 KB, SFX ≤ 1 s. Shipped as `codec: 'wav'` with `placeholder: true` (K23).
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
| SQLite pool | `AppState` | startup | shutdown | — |
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
| All JS in `dist/` | ≤ 290 KB br (changed by PUZZLES-PLAN: was 270; + about 20 KB of lazy puzzle and explore chunks that never load before the first line) | R4 recommends ≤ 260 KB for one bundle; +10 for the split overhead | `budget.ts` |
| JS before the first line (entry + engine closures) | ≤ 270 KB br (changed by PUZZLES-PLAN: the old all-JS limit, now scoped to what loads before the first line) | as above | `budget.ts` (L5) |
| Lazy chunks, world JSON, props, `budget/room-set` | changed by PUZZLES-PLAN: puzzle type ≤ 8 KB br each, puzzle host ≤ 10, explore UI ≤ 16 (dynamic entries, never in a static closure; PENDING until `src/app/yields.ts` exists, then FAIL without a dynamic entry); world ≤ 32 KB raw / 8 KB br; prop ≤ 512 px; room-set ≤ 32 MiB | [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Budgets and validation" | `budget.ts` (L5, LP2) |
| CSS total | ≤ 12 KB br | | `budget.ts` |
| `index.html` | ≤ 2 KB br | | `budget.ts` |
| Story JSON per chapter | ≤ 160 KB raw and ≤ 35 KB br | ink JSON is verbose, compresses well [R4 §4.3] | `budget.ts` (free from `story-gen`, paid from `server/content`) |
| en table per chapter | ≤ 48 KB raw | | `budget.ts` |
| First-load to first line (static estimate) | ≤ 800 KB transfer | the entry + engine closures (changed by PUZZLES-PLAN: lazy chunks excluded; was "all JS") + CSS + html + TWA 16.2 KB [R1] + ch1 story/meta/manifest + first knot's images (AVIF); audio excluded (it streams, never blocks the first line) | `budget.ts` |
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
| Server | `cargo test --workspace --all-targets --no-fail-fast --locked`; unit tests in modules + one integration crate `server/tests/it/` (one binary: one link; every state from `common::test_state()` → `AppState::new`) + `server/dev/tests/dev.rs` (imports the `server-dev` lib target, `oneshot`, binds no port, a temp-file DB per test [R4 §5.3]) | initData vectors, token, schema constraints, repos, routes via `tower::ServiceExt::oneshot`, payments, webhook, refunds, content gating, bindings, catalog contract | see below |
| e2e | Playwright 1.64.1, Chromium, 375×812, `hasTouch`, against `dist-e2e` via `vite preview` + `server-dev` | smoke + purchase + perf | see below |

**Server test names:**
- **auth** — `initdata_valid_vector`, `initdata_tampered_field`, `initdata_missing_hash`, `initdata_expired`,
  `initdata_from_future`, `initdata_reordered_keys`, `initdata_url_encoded_values`, `initdata_duplicate_key`,
  `initdata_unknown_field_included`, `initdata_signature_in_dcs`.
- **token** — `token_roundtrip`, `token_expired_401`, `token_wrong_key_401`, `token_missing_401`,
  `auth_ignores_body_user_id`.
- **schema** — `schema_charge_id_unique`, `schema_order_status_check`, `schema_paid_requires_charge`,
  `schema_save_body_json_valid`, `wal_mode_on_file_db`, `no_dynamic_sql`.
- **saves** — `saves_create_then_conflict`, `saves_rev_increments`, `saves_retry_same_write_id_ok`,
  `saves_other_user_404`, `saves_body_too_large_413`, `saves_bad_slot_400`.
- **invoices** — `invoice_unknown_product_404`, `invoice_already_owned_409`, `invoice_reuses_recent_order`,
  `invoice_price_from_catalog`.
- **pre-checkout** — `precheckout_ok`, `precheckout_wrong_amount`, `precheckout_wrong_currency`,
  `precheckout_unknown_payload`, `precheckout_already_owned`, `precheckout_other_order_in_checkout`,
  `precheckout_same_order_twice_refused`, `precheckout_expired_order`, `precheckout_grants_nothing`,
  `precheckout_answer_times_out_at_5s` (paused time).
- **grant** — `successful_payment_grants_once`, `successful_payment_duplicate_concurrent_wal`,
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
- **dev crate** — `dev_app_uses_given_db_path`, `launch_signs_valid_initdata`,
  `simulate_payment_goes_through_webhook_handler`, `simulate_paid_twice_grants_once`.

**e2e test names** (`client/e2e/*.spec.ts`):

| Spec | Tests |
|---|---|
| `boot.spec.ts` (L7) | `boot records ready, expand and swipe events`, `viewport vars and safe areas applied`, `no window.open or alert` (an init script patches them to record calls) |
| `smoke.spec.ts` (L15) | `tap-to-start unlocks audio only after the gesture`, `play choose save reload load resumes at same line` (asserts `data-line-id`), `autosave resume after reload`, `back button closes overlays without history` (`history.length` unchanged, `web_app_setup_back_button` events recorded), `deactivated pauses audio, activated resumes` (the dev-server `/@fs` check is a vitest test, not e2e: see Paid-content protection) |
| `purchase.spec.ts` | `purchase unlocks chapter 2` (403 before, sheet shows the server price, 200 after, ch2 first line reacts to a ch1 choice), `cancelled purchase keeps paywall`, `failed purchase keeps paywall`, `delayed webhook unlocks after polling`, `paid twice grants once` |
| `perf.spec.ts` | `time to first line under throttling`, `textures released on chapter change`, `heap under budget`, `context loss recovers` (debug hook calls Pixi's `forceContextLoss()`, then a pixel sample of the stage is not black) |
| `puzzles.spec.ts` (L15; changed by PUZZLES-PLAN) | `explore: search item puzzle buy hint solve`, `explore: gate fail branch`, `explore: reload resumes in the same room with items`, `puzzle: hint text absent until bought`, `puzzle: paid chapter puzzle needs entitlement`, `explore: back button walks rooms then hides`, `explore: live texture bytes stay under the steady cap`, `explore: hotspot buttons align with props under safe area and landscape` |

**Changed by PUZZLES-PLAN.** The unit, DOM, story and server test names of the puzzle extension (world, rules,
reduce, softlock, cover, runner yields, session, controller, yields, arch, budget, scan, emit; schema, attempts,
status, catalog, invoices, pre-checkout, refunds) are listed in [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section
"Test strategy". Each lane's commits name the ones it adds.

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
| idempotency | mutation: the PK on `payments` removed / check-then-insert → `successful_payment_duplicate_concurrent_wal` red | L8b (tester mutation) |
| e2e | L7: `main.ts` not calling the facade → `boot records ready, expand and swipe events` red; `$DEV_API_PORT` already bound by another process → the webServer "is already used" error (`reuseExistingServer: false`), never a run against the foreign server. L15: mock invoice forced to `failed` → `purchase unlocks chapter 2` red; BackButton binding removed → `back button closes overlays without history` red | L7, L15 |
| puzzle extension | changed by PUZZLES-PLAN: yield lint and the `dsl-doc` heading (LW1); the soft-lock stub, the `successors` stub without `closed`, the checker capped at 200,000 instead of `RESUME_STATE_CAP`, the path-only reconcile step 4, the `resetSection` that keeps `section`, the current-section-only reconcile with no `unproved` (revision 3), and the pure-module arch rule (LW2); every `world/*` / `puzzle/*` / `explore/*` code (the cross-section-unlock world for `world/cross-section-effect`, revision 4; the multi-lock puzzle world for `world/puzzle-multi-lock`, revision 5; the cross-section arch world for `world/cross-section-exit`, revision 6), `paid/leak` for hints, the scan of hint text and of paid world text in dist, the whole-body world version (LW3); room-set and prop budget rows (L5); puzzle UI in the engine closure, the lazy rows without their importer, and the lazy-import arch rule (LP2); the controller that enters a section through `reduce` instead of `admitSection` (LX, revision 3); `0002` absent and the never-limiting stub (L6c); the pre-checkout without hint predicates (L8b); the wrong gate order, the failed mock invoice and the hotspot layer in the padded overlay in `puzzles.spec.ts` (L15) | [PUZZLES-PLAN.md](PUZZLES-PLAN.md), section "Gates that must be seen red once" |

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
| sqlx | 0.9.0 | `default-features = false, features = ["runtime-tokio", "sqlite-bundled", "migrate", "macros"]` (macros only for `migrate!`) |
| serde / serde_json | 1.0.229 / 1.0.154 | derive / raw_value |
| thiserror | 2.0.21 | |
| tracing / tracing-subscriber | 0.1.44 / 0.3.23 | fmt, env-filter |
| hmac / sha2 | 0.13.0 / 0.11.1 | (sqlx pulls sha2 0.10 too; harmless duplicate [R2]) |
| subtle | 2.6.1 | webhook secret compare |
| hex | 0.4.3 | hash/MAC encoding (no base64 dependency) |
| form_urlencoded † | 1.2.2 | initData parsing (already in axum's tree via serde_urlencoded) |
| getrandom † | 0.4.3 (MSRV 1.85) | order ids, token keys in dev (verify: the 0.4 fill API, L2) |
| ts-rs † | 12.0.1 (MSRV 1.78) | default (`serde-compat`) + `no-serde-warnings` |
| dev: tempfile † / http-body-util † / tower | 3.27.0 / 0.1.5 / 0.5.3 (util) | temp-file WAL DBs (dev-dependencies of `server` and `server-dev`); body collection in oneshot tests |

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
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | as is | `server` (lib, bin, `tests/it`), `server-dev` (lib, bin, tests) |
| `cargo test --workspace --all-targets --no-fail-fast --locked` | as is | `server` lib unit tests, `server` bin, `server/tests/it` (one binary), `server-dev` lib + bin + `tests/dev.rs` |
| *(new, proposed)* `npm --prefix client run e2e` | `npm run story && npm run assets && vite build --mode e2e --outDir dist-e2e && cargo build --manifest-path ../Cargo.toml -p server-dev --locked && playwright test -c e2e/playwright.config.ts` | e2e; the config starts `server-dev` (fresh DB) on `127.0.0.1:$DEV_API_PORT` and `vite preview --mode e2e --outDir dist-e2e --port $DEV_WEB_PORT --strictPort`, both webServers with `reuseExistingServer: false` set explicitly; `preview.proxy` targets `$DEV_API_PORT`. Defaults 8787 / 4173; each parallel lane gets its own pair from per-lane env (E2), and every `server-dev` launch of a lane (e2e, seen working) uses it. Exceeds 2 min → the gate kit (open questions E1, E2) |

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
  off; a custom check on `skipped == 0`);
- cargo targets are counted by name against the lists above.

---

## Integration

### New files per lane

See the lane cut.

### Updates outside the lanes' code

- **CLAUDE.md "Stack and layout".** Add `server/dev/` (crate `server-dev`, dev-only), `assets/catalog.json`, the
  generated dirs (`client/src/story-gen/`, `client/public/assets/`, `server/content/`) and the e2e gate.
  Orchestrator's call (E4).

### docs/FEATURE_MAP.md entries

Created by D1, completed by D2. Each implementation lane lists its rows in `impl.md`. The doc lanes own the file:
parallel lanes would collide on it.

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
  sets.
- Lock sets are paths. A file outside a lane's set is a STOP (lane.js).
- **Parent files.** Every lane's lock holds the parent module file (`mod.rs` / `lib.rs`) of each `.rs` file it
  creates. Shared files no later lane needs to touch are pre-declared by L2 in full: `server/src/config.rs` and
  `.env.example` (every variable of the plan, L2 commit 1) and `server/src/error.rs` (every variant except what L6a
  adds and, changed by PUZZLES-PLAN, what L6c adds). Acceptance check for each cut: every new `.rs` file's parent is
  in that lane's lock.
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
- `client/package.json` + lock: L1, L3b, L5, L7. The puzzle lanes add no dependency.
- `Cargo.toml` + `Cargo.lock`: L2, L4b.
- `server/migrations/`: L2 (`0001`), then L6c (`0002`, plus `server/build.rs`).
- `server/src/{lib.rs, main.rs, api/mod.rs, api/dto.rs, db/mod.rs, telegram/mod.rs, error.rs}` and
  `client/src/api/generated/api.ts`: L4a → L6a → L6b → L6c → L8a → L8b → L9, sequential.
- `server/dev/src/lib.rs`: L4b → L8a → L8b.
- `server/src/ids.rs`: L4a → L6b (adds `PuzzleId`).
- `server/src/{catalog.rs,content.rs}` and `server/catalog.json`: L6b only (later lanes consume their API).
- One server lane runs at a time, so none of the server files is held by two live lanes.
- `server/tests/it/main.rs`: server lanes only, sequential.
- `client/src/story/{staging.ts,tags.ts,tags.test.ts,dsl-doc.test.ts}`, `client/scripts/story/{lint.ts,lint.test.ts}`:
  L3a → LW1, then frozen.
- `client/src/story/catalog.ts`: L3a → L3b → L5 → L13.
- `client/scripts/story.ts`: L3b → L3c → LW3.
- `client/scripts/story/{graph.ts,emit.ts,build.test.ts}`: L3b → LW3.
- `client/scripts/story/{fix.ts,locales.ts,playthrough.ts,play.test.ts,locales.test.ts}`: L3c → LW3.
- `client/scripts/scan-dist.ts`: L1 → L3b → L5 → LW3. `client/scripts/scan-dist.test.ts`: L1 → L5 → LW3.
- `client/scripts/{budget.ts,budget.test.ts}`: L1 → L5 → LP2.
- `client/src/arch.test.ts`: L1 → LW2 → LP2.
- `client/src/i18n/{ru.ts,en.ts}`: L14a → L14b (which pre-declares the puzzle and explore keys), then frozen.
- `client/src/ui/screens.ts`: L14a only.
- `client/src/main.ts`: L1 → L7 → L15. `client/src/ui/App.svelte`: L1 → L15.
- `docs/FEATURE_MAP.md`, `docs/ARCHITECTURE.md`: D1, D2 only.
- `docs/STAGING-DSL.md`: L3a (doc-test fixes only), then LW1 (DSL v2), then frozen.

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

| Lane | Slot | State | Gate to start (merged) | Re-cut |
|---|---|---|---|---|
| L1 client-shell | client | merged `f6e2624` | — | — |
| L2 server-skeleton | server | merged `e005dc6` | — | — |
| L4a server-auth | server | merged `0aef72e` | L2 | — (errata below) |
| L3a staging-dsl | client | running | L1 | — |
| L3b story-compile | client | | L3a | no |
| **LW1 puzzle-dsl** | client | new | L3a | new |
| L4b server-dev | server | | L4a | no |
| L6a server-saves | server | | L4a | no |
| **LDB0 pg-dev-cluster** | server | new (RULINGS 14) | L6a | new; cut in `design/db/decision.md` §5.1 |
| **LDB1 db-port** | server | new (RULINGS 14) | LDB0 | new; cut in `design/db/decision.md` §5.2 |
| L3c story-locales | client | | L3b | no |
| L5 asset-pipeline | client | | L3c | yes |
| L6b server-content | server | | L6a, LDB1 | yes |
| **LW2 world-model** | client | new | L3a, LW1 | new |
| **L6c server-puzzles** | server | new | L6b (which waits for LDB1) | new |
| L7 telegram-client | client | | L1, L4b, L5 | no |
| L11 scene | client | | L3a, L5, LW1 | yes |
| L8a invoices | server | | L4b, L6c | yes |
| **LW3 story-world** | client | new | L3c, L5, L6b, LW1, LW2 | new |
| L8b webhook-grant | server | | L8a | yes |
| L12 audio | client | | L5 | no |
| L9 refunds-bot | server | | L8b | yes |
| L10 client-data | client | | L7, L8b | yes |
| L13 story-runtime | client | | L3c, L5, L10, LW2 | yes |
| L14a overlay-core | client | | L7, L11 | yes |
| D1 docs-authoring | doc | | L3c, L5, LW3 | yes |
| L14b overlay-menus | client | | L10, L14a | yes |
| N1 demo-story | narrative | | D1, LW3 | yes |
| **LP2 puzzle-ui** | client | new | L10, L14b, LW2 | new |
| **LX explore-ui** | client | new | L11, L14b, LW2 | new (∥ LP2: disjoint locks) |
| L15 integration | client | | every lane above (N1 included: the e2e plays the demo) | yes |
| D2 docs-final | doc | | L15 | yes |

There are 32 lanes: 3 merged, 1 running, 28 to go; 6 are new from PUZZLES-PLAN and 2 (LDB0, LDB1) from RULINGS 14.

**Launch preference** when several lanes are ready (critical path first):
- client: L3b, LW1, L3c, L5, L7, L11, LW2, LW3, L12, L10, L14a, L13, L14b, LP2 ∥ LX, D1, N1, L15, D2;
- server: L4b, L6a, LDB0, LDB1, L6b, L6c, L8a, L8b, L9.

After L9 the server slot takes D1 / N1 / LX.

**Critical path:**
- The client chain: L3a → L3b → L3c → L5 → L7 → L11 → L14a → L14b → LP2 → L15 → D2.
- L14b also waits for L10, which waits for the server chain L4b → L6a → LDB0 → LDB1 → L6b → L6c → L8a → L8b. That
  chain must merge L8b before L11 merges, or it becomes the critical path.
- N1 (← D1 ← LW3 ← LW2 ← LW1) must merge before L15. It runs in the second slot after L9 and stays off the critical
  path while LW1 / LW2 / LW3 are launched early.
- LW3 also waits for L6b (its commit 3 red reads L6b's `server/tests/fixtures/content/puzzles/ch1.json`; changed by
  PUZZLES-PLAN revision 1). L6b is fifth in the server launch order (L4b, L6a, LDB0, LDB1, L6b; PUZZLES-PLAN
  revision 4b) while LW3 is eighth in the client order. If L6b is late, LW3 waits (its red would otherwise be ENOENT,
  not the predicted one).

The puzzle work adds one lane to the critical path (LP2); everything else runs beside it.

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
  `story/retired-ids.txt`, `story/lint-allow.json` (12).
- **Commits:**
  1. `fix.ts` `--fix-ids`. Red: a fixture without IDs → the IDs written, the existing ones untouched.
  2. `locales.ts` (`loc/*`, `id/duplicate` across chapters, `id/retired`). Red: one fixture per code.
  3. `playthrough.ts` (200 seeds, mulberry32, step cap, `onError` fails, ch2 with ch1 carries, `play/*`). Red: a loop
     fixture → `play/step-cap`; an unvisited-ending fixture.
  4. Skeleton en tables + story.json (names, titles).
- **Gates:** `test`, `story` (the coverage report lists seeds and endings per chapter).
- **Seen working:** `npm --prefix client run story` reports `ch1: 200 runs, knots 3/3, endings 1/1`.

#### LW1 puzzle-dsl (client; new, PUZZLES-PLAN)
- **Goal:** DSL v2 — the `puzzle` and `explore` yield tags in the one parser, the yield-block lint, the narrowed
  `-> DONE` ban, `props` in the staging snapshot; STAGING-DSL.md updated and two-way checked. PUZZLES-PLAN X1, "Staging
  DSL additions".
- **Gate to start:** L3a merged. It may run beside L3b (disjoint locks).
- **Lock:** `client/src/story/{staging.ts,tags.ts,tags.test.ts,dsl-doc.test.ts}`,
  `client/scripts/story/{lint.ts,lint.test.ts}`, `docs/STAGING-DSL.md` (7).
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
  3. `paid_chapter_200_with_entitlement` (entitlement row inserted by the test through `db/`),
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

#### L6c server-puzzles (server; new, PUZZLES-PLAN)
- **Goal:** server-checked puzzle attempts with a per-(user, puzzle) rate limit; puzzle status with hint tiers and
  owner-only hint texts; migration `0002`; the two new error codes (X5, X6, X7).
- **Gate to start:** L6b merged (ContentStore puzzle index, catalog hint products, `PuzzleId`). L6b itself waits for
  LDB1, so `0002` and every L6c statement are PostgreSQL (changed by PUZZLES-PLAN revision 4b, RULINGS 14).
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

#### L5 asset-pipeline (client)
- **Goal:** `npm run assets` renders the placeholders, encodes AVIF + WebP with sharp, synthesizes WAV, writes the
  per-chapter manifests and tiers; the asset budget rows, seen red.
- **Lock:** `client/scripts/assets.ts`,
  `client/scripts/assets/{placeholder.ts,synth.ts,encode.ts,manifest.ts,assets.test.ts}`,
  `client/scripts/{budget.ts,budget.test.ts,scan-dist.ts,scan-dist.test.ts}`, `client/src/story/catalog.ts`,
  `client/package.json` (scripts), `assets/catalog.json` (13; `scan-dist.test.ts` is L1's file, serialized after L1).
- **Commits:**
  1. `placeholder.ts` (deterministic SVG: label, hue, silhouette for characters, canonical sizes). Red: snapshot of
     dimensions.
  2. `encode.ts` (sharp: resize clamp ≤ 2048, AVIF q50 effort 4, WebP q80, metadata dims). Red: a 4096 px input →
     clamp test.
  3. `synth.ts` (WAV header + PCM). Red: a header-bytes test.
  4. `manifest.ts`:
     - tiering (free if any free chapter uses the asset) → `client/public/assets/` or `server/content/assets/`;
     - `asset-owners.json`;
     - `fingerprints.assets.json` (paid file names + content hashes; the asset tool's own file, never
       `fingerprints.lines.json`); `scan-dist.ts` reads it (file names and content hashes over every `dist/` file)
       with the per-section non-vacuity check, its paid-only trigger computed from `usage.json` +
       `story/chapters.json` (Paid-content protection);
     - `story/catalog.ts` gains `FetchAsset` / `AssetFetchError` next to `AssetRef` (used by L10, L11, L12).
     - Reds:
       - a paid-only asset routed public → test failure;
       - `scan: paid asset bytes in dist fail` (in `scan-dist.test.ts`: a synthetic dist holding the paid AVIF under
         its own name, and a second one holding its bytes renamed) — predicted red: exit 0 on both dists before the
         reader exists; a name-only reader would still exit 0 on the renamed copy;
       - `scan: paid-only asset with empty files section fails` (`usage.json` + `chapters.json` show a paid-only
         asset; `files` and `asset-owners.json` empty, the single tiering fault) — predicted red: exit 0.
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

#### LW3 story-world (client; new, PUZZLES-PLAN)
- **Goal:** the story gate understands worlds:
  - the yield edges in the graph;
  - the world lint (`world/*`, `puzzle/*`, `explore/*`) and the soft-lock check;
  - the public/server split of `world.json` (`server/content/puzzles/<ch>.json`; hint text server-only);
  - world texts in IDs and locales;
  - seeded playthroughs through yields;
  - `scan-dist` hint and paid-world fingerprints from the sources (X4, X7, T7, T9).
- **Gate to start:** L3c, L5, L6b, LW1, LW2 merged (L5 for the `scan-dist.ts` serialization; L6b for
  `server/tests/fixtures/content/puzzles/ch1.json`, which commit 3's red reads — changed by PUZZLES-PLAN revision 1,
  W9).
- **Lock:** `client/scripts/story.ts`,
  `client/scripts/story/{graph.ts,emit.ts,locales.ts,fix.ts,playthrough.ts,world.ts,build.test.ts,play.test.ts,locales.test.ts,world.test.ts}`,
  `client/scripts/{scan-dist.ts,scan-dist.test.ts}` (13). Fixtures are inline in the tests; `story/` is untouched
  (N1 writes the real worlds).
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
- **Gates:** fmt, clippy, test; client `check`.
- **Seen working:** `server-dev` on the lane's `DEV_API_PORT` + `curl POST /api/invoices` → `https://t.me/$dev-o_…`.

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
  3. Grant transaction (`on_successful_payment(&PaymentFact)`). Red: `successful_payment_duplicate_concurrent_wal`
     against a check-then-insert stub → 2 entitlements.
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
  - **Commit 3** adds `hint_purchase_duplicate_concurrent_grants_once` (the WAL `tokio::join!` race on a hint order:
    one payment, one `hint:` entitlement).
  - **Tester mutation:** drop the `?prev` predicate.
- **Gates:** fmt, clippy, test. The tester mutations from the catalogue: no PK, grant in pre-checkout, non-XTR
  accepted.
- **Seen working:** `curl POST /dev/simulate-payment` → `GET /api/entitlements` shows `owned: true`.

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
- **Gates:** `check`, `test`.
- **Seen working:** `npx vitest run src/api src/saves src/purchase --reporter=verbose`.

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
- **Gates:** fmt, clippy, test.
- **Seen working:** `curl POST /dev/refund` → `GET /api/chapters/ch2` → 403.

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
- **Gates:** the link check (every link target exists); the two-way DSL check is in `test`.
- **Seen working:** N1 starts from it without STOP.

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
- **Gates:** `check`, `test` (the `dom` project names present).
- **Seen working:** inside the lock (`ui/App.svelte` is L1's and L15's): `npx vitest run --project dom src/ui
  --reporter=verbose` lists `screens: *`, `typewriter: *`, `choices: *` by name; the components render in happy-dom.

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
- **Gates:** `story` green, naming both chapters, with the world line `softlock OK` for ch1; `build` green (budgets
  incl. `budget/room-set`, scan incl. hint fingerprints).
- **Seen working:** the story gate's coverage report (incl. `pz_*` outcomes seen); the L15 e2e plays it.

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
- **Gates:** `check`, `test`.
- **Seen working:** in L15.

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
- **Gates:** every client gate + `e2e` (all five specs, counted by name); `build` shows the engine row measured, no
  longer PENDING (quoted), and the three lazy chunk rows measured. Red: the BackButton binding removed from
  `ui/screens.ts` in a scratch tree → `back button closes overlays without history` fails.
- **Seen working:** `npm run dev` + `cargo run -p server-dev`, play to the paywall, buy, ch2. `npm --prefix client run
  e2e`.

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
- **Gates:** the link check; env var names grep-matched against `config.rs`.

---

## Later

| Item | Trigger / note |
|---|---|
| **R2 + TS Worker for paid assets** | axum issues a short-lived token scoped to `(user, item, exp)`; the Worker verifies it and reads R2 by binding; presigned URLs do not work on a custom domain [O]. `GET /api/assets/{file}` stays the reference implementation and test oracle |
| **PostgreSQL** | the `db/` seam: `$n` placeholders, `jsonb` for `saves.body`, `query!` + `.sqlx` reconsidered; `BEGIN IMMEDIATE` semantics are no longer needed |
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

---

## Readiness checklist

- [x] Goal names budget and correctness targets (T1–T6, budget table); every decision has why / alternatives /
  trade-off (K1–K30).
- [x] TS and Rust types for every new JSON with one source of truth (ts-rs; client-owned save body). SQL has a
  constraint per invariant. Every endpoint has auth, errors, idempotency and Cache-Control (HTTP API table).
- [x] Tags documented in STAGING-DSL.md; one parser for the gate and the runtime; the scene and the overlay never
  read story state; every line and choice has an ID.
- [x] Grant only on `successful_payment` via the charge-id insert, in one transaction; refund revokes; pre-checkout
  does one statement plus one call under 7.5 s; paid chapters and art only behind the entitlement check;
  `scan-dist.ts` proves their absence in `dist/`.
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
