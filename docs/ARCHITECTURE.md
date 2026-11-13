# Architecture

> The layers of tg-app-novel as merged at `f6487fc`, how data moves between them, and where each CLAUDE.md principle
> is enforced. First version at `e5ce724`, with LS3 server-stats and LU1 meta-ui added at `6043941`, L10, L14b, LE1,
> LP2, L13, LF1, LS4, LX and LM2 since, LF2 share-profile, LE2 gifts-referrals, L15a engine-wiring and LMD
> meta-data at `48abfaf`, LPO privacy-operator, L15b app-e2e, L9 refunds-bot, LFU1 engine-followups and LFU2
> client-followups at `6d77329`, LPH payments-hardening at `a4d53ef` (merged `d423cb3`), LMI meta-integration at
> `3e35a7b`, and M1 memory-trim (merged `f1b707d`) and M2 memory-cpu-copy (merged `385d52f`) at `385d52f`, by D2
> docs-final (MEMORY-PLAN section 11), and LFU3 client-followups (merged `48bc82a`) and M3c memory-half-tier (merged
> `a6365a8`) at `a6365a8`, by docs-errata-8 (RULINGS 125, 127), and LRF auto-refund (merged `a93fe54`) at
> `805f382`, by docs-errata-9 (RULINGS 130, 131), and LEL entry-lever (merged `7b37278`), LBI build-skew (merged
> `fe996a0`), LHJ handover-join (merged `972f773`), M3s memory-half-paid (merged `a5f887b`), LFL first-line (merged
> `cec347c`) and LRB reload-bounds (merged `3c62a86`) at `3c62a86`, by docs-adopt (RULINGS 158), and L1 entry-summary
> (merged `eec24fe`), GM6k puzzle-keys (merged `fd62933`), GM1a mech-run-split (merged `ef8b4dc`), GM6s1
> values-domain (merged `81a15b0`) and GM1b mech-registry (merged `03a00bc`) at `9a83251`, by docs-errata-10 (RULINGS
> 172, 173), and GM6s2 values-routes (merged `2815340`), GM1c puzzle-instance (merged `8c2fa03`) and GM2a save-v2
> (merged `9b4fd25`) at `9b4fd25`, by docs-errata-11 (RULINGS 182), and GM1d mech-clues (merged `794181b`), GM3w
> ui-wiring (merged `508bd36`), GM6a scene-anchors (merged `23e1d31`), GM2b mech-renamed (merged `1782d6d`), GM3m
> mech-cue-gate (merged `a3f0678`) and GM3c mech-conditions (merged `837b1ed`) at `837b1ed`, by docs-errata-12
> (RULINGS 197), and SH1 shot-dsl (merged `2db33c3`), GM3s mech-cue-stage (merged `65e10ad`), SH2 shot-flow (merged
> `7f45dee`) and lever X pixi-env (merged `597dded`) at `461424d`, by docs-errata-13 (RULINGS 209), and lever P
> purchase-lazy (merged `3d120bc`), GM3 mech-use (merged `7082a35`), GM3k mech-kernel-world (merged `3131844`) and the
> lazy-chunk recovery (merged `8e099ee`) at `52e328e`, by docs-errata-14 (RULINGS 225), and E6 money-holds (merged
> `d5e04ef`), GM3u mech-ribbon (merged `33b4f8d`), the Q63 fix vitest-fs-cache (merged `340f47c`), lever O5 overlays
> (merged `9a0ae2d`) and the Q64 fix paywall-reopen (merged `d820803`) at `0b91acc`, by docs-errata-15 (RULINGS 237),
> and GM3p mech-puzzle-cues (merged `d478384`), the Q67 fix phone-column (merged `4f26e8e`), SH3a shot-assets (merged
> `efd3811`), GM3b mech-state-visuals (merged `ac9cab1`), SH3b shot-budget (merged `e1e7637`), the Q69 fix ripple-flake
> (merged `99be5c1`) and per-player GM6t toast-motion (merged `a064399`) at `a064399`, by docs-errata-16 (RULINGS 270),
> and SH3c shot-extract (merged `5d3013e`), GM4g mech-room-set-pair (merged `56cc302`) and SH4 shot-view (merged
> `768fc9d`) at `768fc9d`, by docs-errata-17 (RULINGS 291), and GM4 mech-views (merged `d695053`), GM4u
> mech-view-ui (merged `aac7a97`), GM5 mech-combine (merged `5190235`) and SH5a shot-preload (merged `48489b7`) at
> `48489b7`, by docs-errata-18 (RULINGS 315), and GM5q mech-place-quotient (merged `5142d5d`), GM5f mech-flags (merged
> `402d4d8`), GM7r mech-reach-runtime (merged `9516951`) and SH5b shot-entry (merged `f6487fc`) at `f6487fc`, by
> docs-errata-19 (RULINGS 347);
> open at `805f382`:
> docs-errata-9 (RULINGS 131) and the `design-animation` and `design-mechanics` rounds, superseded since (RULINGS 132
> stopped the character half of `design-animation`, and `design-shots` and `design-mechanics` became the adopted plans,
> RULINGS 143, 152, 158); open at `3c62a86`: this docs lane `docs-adopt` (RULINGS 158), the client lane L1
> `l1-entry-summary`, and the planned lanes of the adopted plans ([docs/plans/README.md](plans/README.md)), of which
> GM1a and GM6k were launched from the frozen designs (RULINGS 160); open at `9a83251`: the server lane GM6s2
> `gm6s2-values-routes` (RULINGS 169, 170) and this docs lane `docs-errata-10` (RULINGS 173); open at `9b4fd25`: the
> client lanes GM1d `gm1d-mech-clues` (RULINGS 179, 180) and GM3w `gm3w-ui-wiring` (RULINGS 182) and this docs lane
> `docs-errata-11` (RULINGS 182); open at `837b1ed`: the client lanes GM3s `gm3s-mech-cue-stage` (RULINGS 194, 195)
> and SH1 `sh1-shot-dsl` (RULINGS 196) and this docs lane `docs-errata-12` (RULINGS 197); open at `461424d`: the
> client lanes GM3 `gm3-mech-use` and lever P `lever-p-purchase-lazy` and this docs lane `docs-errata-13` (RULINGS
> 209); open at `52e328e`: the client lanes E6 `e6-money-holds` (lane C) and GM3u `gm3u-mech-ribbon` (lane A) and this
> docs lane `docs-errata-14` (RULINGS 225); open at `0b91acc`: the client lane GM3p `gm3p-mech-puzzle-cues` (lane A,
> RULINGS 232-234) and this docs lane `docs-errata-15` (RULINGS 237); open at `a064399`: the client lane SH3c
> `sh3c-shot-extract` (lane A, RULINGS 263, 264, 267) and this docs lane `docs-errata-16` (lane C, RULINGS 270); open at
> `768fc9d`: the client lane GM4 `gm4-mech-views` (lane A, RULINGS 285) and this docs lane `docs-errata-17` (lane C,
> RULINGS 291); open at `48489b7`: the client lane GM5q `gm5q-mech-place-quotient` (lane A, RULINGS 309, 313) and
> this docs lane `docs-errata-18` (lane C, RULINGS 315); open at `f6487fc`: the client lane GM7p `gm7p-mech-path`
> (lane A, RULINGS 342, 344, 345) and this docs lane `docs-errata-19` (lane C, RULINGS 347). Parts not
> built yet are marked **planned** with the lane and the plan section. Operating the bot and the server: the
> runbooks, indexed in the [README](../README.md#documentation).

The design is in [PROTOTYPE-PLAN.md](PROTOTYPE-PLAN.md) (PP), [PUZZLES-PLAN.md](PUZZLES-PLAN.md) (PZ),
[STORIES-PLAN.md](STORIES-PLAN.md) (SP) and [META-PLAN.md](META-PLAN.md), and the adopted plans,
[docs/plans/README.md](plans/README.md) (planned, not built); this page describes what the tree does. Where
is a given file: [FEATURE_MAP.md](FEATURE_MAP.md). The ink tag language: [STAGING-DSL.md](STAGING-DSL.md).

## Overview

Three parts, joined at build time by generated files and at run time by one HTTP API:
- **`story/` + `assets/`** - hand-written sources: ink, the chapter and story lists, worlds, meta, locale tables, the
  asset catalog.
- **`client/`** - the Telegram Mini App (Svelte 5, PixiJS v8, inkjs runtime) and its Node build tools under
  `client/scripts/`. Its build splits the sources into a public half and a server-only half.
- **`server/`** - the axum server (crate `server`), the dev-only crate `server-dev` and the dev/test-only crate
  `pgdev`.

```mermaid
flowchart LR
    S["story/ + assets/"] -->|"story.ts main"| SG["client/src/story-gen/ - free chapters, public catalog"]
    S -->|"story.ts main"| SC["server/content/ - paid chapters, puzzles, stories.json, meta.json, fingerprints, build/shots.json"]
    S -->|"assets.ts"| PA["client/public/assets/ - free art and audio, covers"]
    S -->|"assets.ts"| SA["server/content/assets/ - paid-only art and audio"]
    SG -.->|"URL globs in app/boot.ts and story/chapters.ts"| V["vite build"]
    PA --> V
    V --> D["client/dist/"]
    D -->|"budget.ts, scan-dist.ts"| G{"build gate"}
    SC -->|"ContentStore::load"| SRV["server"]
    SA -->|"get_asset after the entitlement check"| SRV
```

Each arrow is a function: `main` ([story.ts:566](../client/scripts/story.ts#L566)) routes every chapter through
`chapterPaths` ([emit.ts:151](../client/scripts/story/emit.ts#L151)); the asset tool's output directories are
`ASSET_OUT` ([manifest.ts:47](../client/scripts/assets/manifest.ts#L47)); the server loads `server/content/` in
`ContentStore::load` ([content.rs:268](../server/src/content.rs#L268)).

## Client modules

What exists under `client/src/` at `f6487fc`. The boundary column is enforced by
[arch.test.ts](../client/src/arch.test.ts) (rules `RULE_IDS`, scopes in `applies`), not by review.

| Module | Responsibility | Boundary |
|---|---|---|
| [main.ts](../client/src/main.ts) | entry: dev mock install (dev and e2e only), inset variables, `expand`, `disableVerticalSwipes`, `startApp` (L15a), mount `App` with `startApp`'s handle (L15b, [main.ts:25](../client/src/main.ts#L25)), `ready` | |
| [app/boot.ts](../client/src/app/boot.ts) | the entry's half of the two-stage boot (L15a): `startApp` (:623) creates the view model, the screen stack, the API client and the settings store; runs the boot reads in parallel (auth, the public catalog and covers, the saves list, the entitlements, the settings), retried after `BOOT_RETRY_MS` (:75); imports the engine chunk beside them; creates the stats reporter after auth; as merged (LMI `3e35a7b`, RULINGS 105), then imports the meta controller's chunk beside the engine, never awaited before the first line, through the meta gate `createMetaGate` (:196; as merged, LFL `cec347c`, RULINGS 149, 155: not after auth any more, the gate requests it at the session's first step, a meta tap, an ending, a hint use, a launch parameter or Home idle, `HOME_IDLE_MS` 2 s after both Home and the engine import settled, [boot.ts:190-195](../client/src/app/boot.ts#L190), :154, and boot hands the gate its own stats read before Home, :962): one import in flight, and a failed one is imported again only by the next meta tap or ending, never on a timer (Changed by RULINGS 213, 214, 224 (as of `52e328e`; docs lane `docs-errata-14`, group A): where the module map lets it, since Chromium-based WebViews before 156 keep a failed `import()`; a load that fails again after the evidence restarts the page once per build, Q60's `createPageRecovery`, the recovery lane `8e099ee`) (as merged, LFL `cec347c`: or by the next hint use, whose port's `use` awaits the import, :193, :261, :320); a tap before the chunk lands runs once it does, except the policy tap, which only starts the import (F28); an ending waits for the import in flight; as merged (LFU3 `48bc82a`, RULINGS 121), a waiting tap is dropped when the screen stack's root changed before the chunk landed, and an ending left meanwhile still marks its card (the gate's `root`, :202, :292-294, :362); the Game gets the gate's port before it is published (`attachMeta`, :815) and App the gate's taps (`metaTaps`, :922); owns the lifecycle, `pagehide` and session-expiry subscriptions; Home's actions unlock audio first, inside the tap; as merged (LBI `fe996a0`, RULINGS 145), it lends the Game the reload port (`page` :986: `location.replace` of the URL with the latch, then `location.reload()`), hands the Game each skew `http` reports (:1011-1015) and one the boot reads saw before the Game existed (:817-820), and probes `/api/health` on `vite:preloadError`, a lazy chunk a deploy removed (:1016-1020; since the recovery lane `8e099ee` the page recovery's evidence, `createPageRecovery` :446); as merged (the recovery lane `8e099ee`, Q60; RULINGS 214, 215, 218, 224), the page recovery (`createPageRecovery` :446): every engine import goes through it (:779-786), every `vite:preloadError` feeds it (:1016-1020), and the one stylesheet is checked once the document loaded (:1031-1045, D6); a failure that fails again after the evidence (`/api/health` with no skew, and the failed URL answering 2xx) restarts the page once per build at a safe point: through `Game.restart` when a Game exists, else, once the engine import failed, itself after the background and the meta holds ([Failure modes](#failure-modes)); `__novelChunks` (:1003-1005) only under `__TG_MOCK__`; as merged (E6 `d5e04ef`, RULINGS 215, 228), the background bit (`createBackgroundBit` :609), fed every lifecycle event first (:971) and joined by the Game `engineOf` makes (`bit.join` :814), so a Game made in the background starts paused ([WebView constraints](#webview-constraints)) | no Pixi, inkjs or GSAP: the engine is reached only through `import('./engine.ts')` (:780), budgeted by the engine and first-line rows; the meta controller only through `import('./meta.ts')` (:650, LMI), budgeted by the `meta controller chunk (br)` row and counted in the first-line row (as merged, LFL `cec347c`: not counted there any more); as merged (the recovery lane `8e099ee`), the reload rules both sides share live in [app/reload.ts](../client/src/app/reload.ts), in the entry closure with type-only imports, so neither the meta controller nor the purchase flow enters the entry |
| [app/engine.ts](../client/src/app/engine.ts) | the engine chunk's composition root (L15a): `createEngine` (:67) builds the scene controller, one chapter loader per role, the SaveService factory, the explore and puzzle views and the Game; the audio manager at the first start, after a Home tap; hands the overlay the in-play components (`EngineUi`, :36; as merged, lever O5 `9a0ae2d`: the first line's components, the Paywall and its Terms and the two lazy views' stores, without the four in-play overlays, which the Game loads from their own chunk, below the table) | the only path to Pixi, inkjs and GSAP; `ENGINE_SRC` ([budget.ts:206](../client/scripts/budget.ts#L206)) |
| [app/game.ts](../client/src/app/game.ts), [app/yields.ts](../client/src/app/yields.ts), [app/stage-route.ts](../client/src/app/stage-route.ts) | GameSession (L15a, `createGame` :404): runner steps to staging batches for the scene and the audio, views for the overlay, autosaves; one intent at a time; chapter change and the next-chapter preload, endings and the chapter reports, the ink-error floor, the autosave conflict prompt, the read-sets, the resume toasts, the chapter purchase and exit to stories. The yields (`createYields` :346): linear puzzles and exploration sections, every `import()` of the lazy families (`LAZY_CHUNKS` :78) and their prefetch after a chapter's first line. GameSession's failure model as merged (LFU1 `f637bac`; PP F3): no autosave while the session `mixes` two steps (`mixes` :659), a failed "Load it" read shows the error notice (`adoptFailed` :1784), "Return to last save" with no save exits to the stories (`returnToSave` :913), a manual save waits for a step in flight (`writeManual` :1874), and a 409's conflict ask is held until `CONFLICT_HOLD_MS` (500 ms, :296) after the tap ([Failure modes](#failure-modes)). As merged (LFU3 `48bc82a`, RULINGS 121): a resume records the body it runs from as the last save (`resumeBody` :1014); each manual slot keeps its own 409, the ask shown is the slot asked first, and an answer or a No applies to its own slot only (`conflicts` :355, `shownAsk` :592, `dropConflict` :602); the reopen notice of an ended session closes the Mini App through the facade (:1456, :1790); a take fades its prop out of the picture at once (B-001; as merged, GM3b `ac9cab1`, RULINGS 246, 258: a dispatch that changes its room's picture, a take included, queues one state batch, `stateBatch` in yields.ts :798, which replaced `takeBatch`: a `TAKE_FADE_MS` 300 ms crossfade of the props that changed). As merged (LMI `3e35a7b`, RULINGS 105): boot's meta port (`GameMeta` :183, attached by `attachMeta` :2266) is read when called, so a session runs the same before and after the meta controller's chunk lands: a declared ending's END shows `the_end` with its card action and asks the port for the card (`onEnding`, after the stats settle; `chapterEnd` :1380), a revealed line calls its `lineShown`, an exit closes the meta overlays (`exitNow` :1680), and each new puzzle session takes the port's `hintPort()` (game.ts :1537, yields.ts :1098), null until the chunk lands, so the ladder spends a usable tier only through the wallet's port. As merged (LFL `cec347c`, RULINGS 149): that port is boot's forwarding port, never null, whose use waits for the chunk (HP), and a step on screen tells the port `stepShown` (T1, game.ts :831; also D11's paywall over the empty stage, which no step follows, :1040), the chunk's request on the path that taps Start as soon as it can. Changed by RULINGS 234-236 (as of `0b91acc`; docs lane `docs-errata-15`, group A): D11's re-open by a tap on the empty stage now has a control (Q64, the fix `d820803`). While the session's pending paid start waits for its purchase, the Game holds the view model's `stageTap` ([state.svelte.ts:105](../client/src/ui/state.svelte.ts#L105), the field :164), written beside the pending start in six places: true in `pendingPaid` ([game.ts:1371](../client/src/app/game.ts#L1371); D11's resume and `chapterEnd`'s two sites go through it) and in `startPending`'s refund branch (:1317), false in `unlocked` (:1337, the purchase landed, before the chapter loads), `beginChapter` (:996), `resumeBody` (:1071) and `endSession` (:1660), so it holds only while a pending start exists and unlocks nothing (principle 1). App passes it as one prop ([App.svelte:90](../client/src/ui/App.svelte#L90)), and with no line on screen DialogueBox renders a transparent whole-stage `<button class="stage-tap">` named `quick.advance` ([DialogueBox.svelte:115-117](../client/src/ui/DialogueBox.svelte#L115)), whose tap runs the existing `advance()` -> `next()`'s D11 branch (:886-889) -> `openPaywall`. The stage offers it after Back from the paywall of a D11 resume (Home's or a card's Continue, an in-session load, W1's "Load it"), after a P9 refund, and at a chapter end reached with no line on screen (a resumed choice set whose pick diverts to END); never on Home, during a chapter load, at a choice set, a yield, the end screens, or once the purchase landed. Whether the black stage needs a hint is the owner's Q66 ([OPEN-QUESTIONS](OPEN-QUESTIONS.md)). As merged (LBI `fe996a0`, RULINGS 145), the build-skew recovery: `skewed` (:2269) waits for a safe point (`reloadBlocker` :1922: no intent, not in the background, no invoice being created, open or confirmed, no attempt awaiting its answer, no manual save or gift in flight), then autosaves the step on screen, covers every control with the update notice and, once the autosave is flushed, reloads into the new build through boot's port, the build id it reloaded for kept in the URL's fragment, so a tab reloads once per build (`reloadTick` :1952, `withReloadedFor` :124); a chapter file that fails to load probes `/api/health` (:1461). As merged (LRB `3c62a86`, RULINGS 157), a wallet pack flow the player left (`MetaView.purchaseLeft`, the meta row below) holds nothing (`metaHold`, [app/reload.ts](../client/src/app/reload.ts) :22, read at `app/game.ts` :1930), and a gift holds only while its dialog shows it sending ([deploy.md](runbooks/deploy.md#clients-open-during-a-deploy)). As merged (GM3w `508bd36`, RULINGS 186): the explore layer and the puzzle frame reach the current session through one forwarder each (`exploreActions`, `puzzleActions`, game.ts :2283-2284; the puzzle UI and exploration UI rows below); `apply` reports the batch start after its loads, an empty batch included (`started`, [yields.ts:129-135](../client/src/app/yields.ts#L129)), and a yield step tells the yields ahead of its transition (`Yields.ahead`, yields.ts :160, an empty body until GM3s; game.ts :820); as merged (GM3s `65e10ad`, RULINGS 194, 195, 201, 204): one cue bus per session, the cue stage's chunk loaded before a section or a puzzle opens, every visual batch through the one held site `heldBy` (yields.ts :296) and today's effects on the bus (`coreCue` :318), and `Yields.ahead` prefetches the yield's chunks while its transition runs (`ahead: prefetch` :1487; the "Cue stage" rows); as merged (SH1 `2db33c3`, RULINGS 198): the batch routing, `manifestIndex`, `splitBatch` (with `think` for the session, read by nobody until SH7), `imageIds` and `knotAssets`, moved out of `game.ts` into [app/stage-route.ts](../client/src/app/stage-route.ts), so a lane adding a tag kind leaves `game.ts` alone; as merged (SH4 `768fc9d`, RULINGS 275), `imageIds` also takes the scene's snapshot and the chapter's manifest (its one call, [game.ts:721](../client/src/app/game.ts#L721)), so a shot chapter's batch ensures the shot's drawn files (the plate, the sheet by its rule, each visible face file not at rest; never a talk file) and a face there names no sprite, and `manifestIndex` answers a face from the chapter's rigs ([stage-route.ts:21-34](../client/src/app/stage-route.ts#L21), :83-105); as merged (GM3 `7082a35`, RULINGS 212, 216), the yields send the reducer's `cue` effects, the writer's fact and module cues, to the session's bus ([yields.ts:647](../client/src/app/yields.ts#L647)), a lock puzzle's run on its lock (`causeOf` :332); as merged (the recovery lane `8e099ee`, Q60), `Game.restart` ([game.ts:269](../client/src/app/game.ts#L269), :2276): a chunk restart takes the skew's safe point and rules, one recovery of either kind per page, the `restart` notice, and the chunk latch appended to the fragment (`reloadAfterFlush` :1976). As merged (E6 `d5e04ef`, RULINGS 215, 228): a session started while the Game is paused starts its audio suspended until `activated` (`paused` :428, :561-565). As merged (lever O5 `9a0ae2d`, RULINGS 228, 234): the Game owns the in-play overlays' module, one load per page (`loadOverlayUi` :413, `overlayUiModule` :1226, `withOverlays` :1247; the paragraph below the table). As merged (GM3p `d478384`, RULINGS 233, 234, 243): the yields emit every puzzle control's cue and the frame's appearance, waits and outcomes on the session's bus ([yields.ts:912](../client/src/app/yields.ts#L912), `puzzleCue`; `appear` :947), tell the host which frame is on screen (`frameShown`, :155), and hold the hint ladder's one writer (`setLadder` :923); a family root's cue point reaches the bus in stage-host px through `inStageHost` (:380-389), the frame family's since GM3p and the explore root's (`exploreCue` :394) since the Q69 fix `99be5c1` (RULINGS 260, 265). As merged (GM3b `ac9cab1`, RULINGS 245, 246, 258): `roomFor` (:1500) gives the state commands of the room a bg shows, built by the one builder `propsOf` (:735) that `roomBatch` and the state batch read; null before the explore chunk's controller exists (Q5, for SH5a). As merged, GM4 `d695053`, GM4u `aac7a97` and GM5 `5190235` (engine plan §6.2, §6.3): a zoom's room batch crossfades over `VIEW_FADE_MS` ([yields.ts:50](../client/src/app/yields.ts#L50), :758), writes `explore.inView` in its synchronous run (:768-772) and, for a zoom-out by no exit, takes its box from the parent's exit into the view (`exitBoxInto` :525); the leave control is Back's own press (`onleaveview` :1467); a combine runs as one tap block (`oncombine` :1460); the bar's Inventory and Reveal go through `h.tap` only while a batch that moved the bar runs (`barShift` :369, `barTap` :1405, RULINGS 308). As merged, SH5a `48489b7` (shots §5.8): every presented step hands the scene its window with its batch (`windowOf`, [game.ts:746](../client/src/app/game.ts#L746); a yield step none), a room batch its room's `r:<room>` window (`roomWindow` :764), from the chapter's look (`windowFor`, [stage-route.ts:143](../client/src/app/stage-route.ts#L143), with the event's room `withEventRoom` :133); a story cut to a room's shot gets the room's props (`withRoomProps` :172, through `roomFor`); a knot hold keeps only its `char/` images in a chapter with a look (game.ts :1109); `preloadNext` preloads the next chapter's first window (:1120), and the handover leaves `next:<id>` to the scheduler (:1158-1163; FEATURE_MAP "Step window"); as merged (SH5b `f6487fc`, RULINGS 330, 346; shots §5.8 "Entry at the half tier"), a chapter entry stages from half files: `Session.entry` ([game.ts:375](../client/src/app/game.ts#L375)) is `'entered'` at `enterChapter` (:953) and `'first'` at the next `present` (:782); while it is not `'none'`, `stage` ensures and applies previews and a windowless stage hands `KEEP_WINDOW`, so its swap starts the upgrades (:720-728), and the first windowed stage ends the entry (:729-731); a resume inside the current chapter is no entry (:1051); a save inside a paid chapter refunded since reaches the paywall on a 403 only, kept whole, and resumes as saved after a purchase (`resumeBody` :1023-1037, `startPending` :1307-1309), and any other load failure shows the error notice (:1043) | the scene, the audio and the explore controller only through their types (fakes in tests); `runner.enter` only in `yields.ts` (arch rule `runner-enter`) |
| [telegram/index.ts](../client/src/telegram/index.ts), [webapp.ts](../client/src/telegram/webapp.ts) | `TelegramClient`: the one Mini App facade, errors as values, version gates. Each TWA event, the BackButton press included, has one TWA registration and the facade's own dispatch over a snapshot of its subscribers: one added during a dispatch waits for the next event, one removed is skipped, a throwing one does not stop the others (`eventHub`, [webapp.ts:229-260](../client/src/telegram/webapp.ts#L229); the `facade:` tests in `telegram.test.ts`). A CloudStorage / DeviceStorage call whose callback has not come within `STORAGE_TIMEOUT_MS` (5 s, [webapp.ts:83](../client/src/telegram/webapp.ts#L83), L15a) settles as a `timeout` error, and a later callback changes nothing (the `storage:` tests). As merged (LFU2 `6d77329`): `close()` closes the Mini App through `WebApp.close` (a no-op in the inert client, never throwing; [index.ts:43-44](../client/src/telegram/index.ts#L43)), and the facade exports the one CloudStorage value limit `CLOUD_VALUE_MAX` (4096, [webapp.ts:78](../client/src/telegram/webapp.ts#L78)) that the settings store re-exports | only `webapp.ts` and `telegram/dev/` read `window.Telegram` |
| `telegram/{perf,viewport}.ts` | Android performance class; `--app-inset-*` CSS variables; as merged (the Q67 fix `4f26e8e`, RULINGS 251), the column's scale: `fitColumn` ([viewport.ts:45](../client/src/telegram/viewport.ts#L45)) keeps `--col-scale` on App's column while it is narrower than `DESIGN_WIDTH` (360 px, :35) | |
| `telegram/dev/*` | mock transport and fake Stars sheet | only under `__TG_MOCK__`; production compiles it out ([vite.config.ts:99](../client/vite.config.ts#L99)) |
| [api/http.ts](../client/src/api/http.ts), `api/{session,endpoints,decode,meta}.ts` | the API client (L10): `createHttp` (:159) carries every `/api` call and asset byte; the token lives only in `session.ts`'s closure; a `401 token_*` re-auths once, single flight, and retries once; typed calls per route; one decoder per server DTO ([Auth](#auth-initdata-then-the-servers-own-token)); created by `startApp` since L15a. The meta calls (LMD): `createMetaEndpoints`, the meta error table `metaError`, `DELETE` in the request method union for unfriend and decline. As merged (LMI `3e35a7b`): the gift call `postGift` (`POST /api/gifts`, the four fields of `GiftRequest` only; [meta.ts:322-326](../client/src/api/meta.ts#L322)) and its decoder `decodeGiftResponse` ([meta.ts:136](../client/src/api/meta.ts#L136)); the meta routes and their decoders live in `api/meta.ts`, which only the meta controller's chunk imports (as merged, LEL `7b37278`; the guard `arch: the entry closure holds no meta module`). As merged (LBI `fe996a0`, RULINGS 145): every response's `x-build-id` (`api/http.ts`: `BUILD_ID_HEADER` :24, `noteBuild` :174), the auth exchange's, the JSON calls' and the asset fetches' alike, is compared with the page's own build id, the `__BUILD_ID__` define, and a build other than the page's is reported once per id (`skew()`, `onSkew`, :77-79) to boot, which hands it to the Game (the game row above). As merged (GM6s2 `2815340`, RULINGS 176; Changed by RULINGS 185 (as of `837b1ed`; docs lane `docs-errata-12`, group A)): the per-player value calls `getValues` (`GET /api/chapters/{id}/values`) and `restartPuzzle` (`POST /api/puzzles/{id}/restart`) ([endpoints.ts:102-104](../client/src/api/endpoints.ts#L102)); no caller yet (FEATURE_MAP's "Per-player puzzle values" row) | only `api/` sets `Authorization` (arch rule `authorization`); the bearer goes to `/api/` URLs only |
| `saves/{service,pending}.ts` | saves per story (L10): one autosave PUT in flight, a retry replays its `writeId`, a foreign 409 pauses autosave, a `Retry-After` past an hour waits an hour (LFU1, K24; `RETRY_AFTER_MAX_MS`, [service.ts:72](../client/src/saves/service.ts#L72)); the unacknowledged body cached in DeviceStorage (`pending_<storyId>`); as merged, L1 `eec24fe` (RULINGS 159): the two load with the engine chunk, and the entry holds only boot's lookup `summaryOf` ([saves/summary.ts:8](../client/src/saves/summary.ts#L8)), held by the guards `arch: the entry closure holds no save service module` and `arch: entry closure save service fixtures` | a cache only: the server copy wins (principle 1) |
| [purchase/flow.ts](../client/src/purchase/flow.ts) | the purchase state machine (L10): the invoice, `openInvoice`, the order poll; `unlocked` only from server reads ([Payments](#payments-as-built)); as merged (LFU3 `48bc82a`), a 429 on the invoice is its own state `limited`, the server's wait counted down to `idle`; as merged (lever P `3d120bc`, RULINGS 201, 209, 213), a lazy chunk of its own: GameSession imports it when a paywall with a product opens and at Buy (`purchaseModule`, [game.ts:1206](../client/src/app/game.ts#L1206)), the meta controller at a pack Buy, so the engine chunk no longer carries it | typed to `openInvoice` alone, so no storage value reaches the decision (principles 1-2); as merged (lever P `3d120bc`), a lazy root file of the arch rule `lazy-ui` (`LAZY_ROOT_FILES`, [arch.test.ts:170](../client/src/arch.test.ts#L170)): `import()` only, its types anywhere, and no static chain from `app/engine.ts` (`arch: the engine closure holds no purchase flow`, [arch.test.ts:1538](../client/src/arch.test.ts#L1538)); its own budget row, `purchase-flow chunk (br)` |
| [stats/reporter.ts](../client/src/stats/reporter.ts) | the statistics reporter (LS4): the event queue, batches of at most 32, a retry with the same event ids, the queue's DeviceStorage copy ([Player statistics](#player-statistics-as-built)) | grants nothing, never throws; the copy is a cache |
| `story/{runner,chapters,carry,resume,save-codec}.ts`, [i18n/lines.ts](../client/src/i18n/lines.ts) | the story runtime (L13): `StoryRunner` ([runner.ts:188](../client/src/story/runner.ts#L188)) turns ink's `Continue()` into steps; the chapter loader (a free chapter by its static URLs, a paid one only through `GET /api/chapters/{id}`); the carry of `g_` globals; resume at the exact step, the knot's top or the chapter start; the save body codec (as merged, GM2a `9b4fd25`, RULINGS 181: format 2, [save-codec.ts:40](../client/src/story/save-codec.ts#L40); a format-1 body decodes with format 1's frozen decoder and upgrades, `upgradeV1` :417; `SAVE_FIELDS` :134 lists the world keys per format, and the mechanics registry's slice keys are pinned to it; a newer format is `unknown-format` and the start fails without a write); the line text by language | `inkjs` only in `story/runner.ts` (arch rule `import-inkjs`); `runner.enter` only from `app/yields.ts` (`runner-enter`) |
| `story/{tags,staging,catalog}.ts` | `parseTags`, the typed staging commands, catalog and manifest decoders; as merged, SH1 `2db33c3` (RULINGS 198, 200, 201): the shot kinds `face`, `cam`, `think`, `anim` and `fx` ([tags.ts:40](../client/src/story/tags.ts#L40), [staging.ts:49](../client/src/story/staging.ts#L49)), and the camera state a shot holds, `StagingSnapshot.cam` (:99); as merged (SH3a `efd3811`, RULINGS 254, 256): `story/shots.ts`, the strict decoders of what a chapter manifest carries of its shots (`decodeShotRigs`, `decodeLoops`, `decodeLook`, [shots.ts:467-517](../client/src/story/shots.ts#L467)), read at run time since SH4 `768fc9d`, whose `scene/shot-view.ts` decodes a chapter's rigs (`chapterRigs`) for the executor and the stage route, and the catalog's `sheet` / `face` / `talk` ids and the bg `src` and prop `loop` forms ([catalog.ts:488-493](../client/src/story/catalog.ts#L488); FEATURE_MAP "Shot assets") | `tags.ts` is the only tag parser |
| `scene/*` | `SceneController` (Pixi application, layers, context-loss rebuild), executor (batch → GSAP timeline), texture registry with caps, loader, preload scheduler, layout; as merged (M1 `f1b707d`, M2 `385d52f`): the texture laid out as its canvas, the kept file, the revive and its flow `scene/revive-flow.ts` ([Texture memory](#texture-memory-and-the-context-loss-revive)); as merged (M3c `a6365a8`, RULINGS 127): the session's size tier, the half files on a LOW phone whose largest stage fits, chosen at mount and demoted one way on a resize past the bound; as merged (LHJ `972f773`, RULINGS 143 QO19, 150), a preload item whose record is live or in flight joins it at once, outside the two fetch slots, as the registry's pure read `state(id)` says (`take`, [preload.ts:489-500](../client/src/scene/preload.ts#L489), which `preload` :547 calls per id; [registry.ts:202](../client/src/scene/registry.ts#L202)), so a next-chapter image in flight at the handover is fetched once; as merged (GM6a `23e1d31`, RULINGS 188; per-player plan §6.1): the bg, the CG and every prop sit in an anchor of four nested nodes, anchor, depth, motion and content, each with one writer (`AnchorRef`, [executor.ts:55](../client/src/scene/executor.ts#L55)); props are keyed by their `at` and follow the command's order; a target key with no anchor takes over an anchor showing one of its props that the target does not name (D5.1, `syncProps` :820); rebind re-creates each anchor before its art, reacquire drops every anchor it empties, and destroy leaves none; the Pixi adapter `pixiAdapter` and `createLayers` are named exports of `scene/controller.ts` ([controller.ts:162-175](../client/src/scene/controller.ts#L162)); as merged, SH1 `2db33c3`: a `face` changes a shown character's expression, the camera is held in the snapshot until the next cut (`reduce`, [executor.ts:195](../client/src/scene/executor.ts#L195)), `anim` and `fx` pass through to nothing yet (SH8), and a build whose sprite throws leaves no anchor (`backdrop` :609, `syncProps` :820-919, cut D8); as merged, lever X `597dded` (RULINGS 201, 208): Pixi's environment extensions are not imported (`SKIP_PIXI_ENV`, [pixi-env.ts:13](../client/src/scene/pixi-env.ts#L13), passed as `skipExtensionImports` by `appOptions`, [controller.ts:157](../client/src/scene/controller.ts#L157)), and the canvas keeps `touch-action: none` on every install (:360); as merged, SH4 `768fc9d` (RULINGS 274, 275, 279, 289, 290; shots plan §5.1, §5.2, §5.5): a shot chapter draws its shots from their rigs. `scene/shot-view.ts` is pure: the rest framing toward the shot's focus inside the slack, the overscan 1.03 at most, the zoom range never below it, a face's layers, the slots a shot's stage holds, a chapter's rigs ([shot-view.ts:34-145](../client/src/scene/shot-view.ts#L34)). A shot's root is its bg anchor, with a part per member, its figure plane and its expression group, each its own node, drawn back to front across members; a part's sprites draw registry frames of the record their slot holds, so a kept root, whose new plate failed, draws no file of another shot ([executor.ts:527-565](../client/src/scene/executor.ts#L527)). A face changes by K7, the new group over the old (`drawFaces` :571); a cut destroys the old root, a dissolve retires it whole under the new one, a fade dips through black; restore, rebind and reacquire redraw the faces (:1180, :1211, :1276); a failed face or sheet file draws the rest face, and a talk file is held, never awaited (`takeFor` :368). The carries it took: a sprite build that throws drops its fresh group (SH1 cut Q5), a `show` governs a `face` of the same character in its batch, and a moving prop keeps its live record while one prop may sit at two anchors (RULINGS 245 Q8; FEATURE_MAP "Scene" and "Shot view"). As merged, SH5a `48489b7` (shots §5.8; FEATURE_MAP "Step window"): the scheduler admits a step's window at its swap point (`want`, [preload.ts:584](../client/src/scene/preload.ts#L584): what left the window is released, what exists is joined with no slot, the rest queued as need, warm, hope and the event's room, and the entry tag ends after the chapter's first window), retries after a release (`retry` :508), and for a refused need or warm fetch evicts hope, then the window's warm decodes (back to their held files), the `room:` and `state:` holders outside the window, `next:*` and the event's room in that order, sparing need and warm (`evictFor` :301); the registry's warm form holds a record as its fetched file and decodes it only for a non-warm holder, shedding back to the file in the same turn ([registry.ts:328](../client/src/scene/registry.ts#L328), `drop` :410; `state(id)` :202 adds `held`), over the loader's `HoldImage` ([loader.ts:37](../client/src/scene/loader.ts#L37)); the executor reports a batch's window once at its swap point, after the sweep that released the old shot's holders (`sweepFor`, [executor.ts:440](../client/src/scene/executor.ts#L440)), wired by `windowDeps` ([controller.ts:542](../client/src/scene/controller.ts#L542)); as merged (SH5b `f6487fc`; shots §5.8 "Entry at the half tier"; FEATURE_MAP "Entry previews"), preview records on a full-tier registry (`previewing`, [registry.ts:174](../client/src/scene/registry.ts#L174), `previews()` :187, `tier()` :221) and their in-place `upgrade` ([registry.ts:641](../client/src/scene/registry.ts#L641)): one at a time beside the half, evicting nothing, at most `UPGRADE_TRIES` = 3 failed tries, each bounded by `UPGRADE_DEADLINE_MS` = 20 s (:31, :39); the loader swaps the full file into the same texture at the stored box ([loader.ts:138](../client/src/scene/loader.ts#L138)); the scheduler starts the chain at the chapter's first swap point (`swapSeen`, [preload.ts:151](../client/src/scene/preload.ts#L151); `kick` :462) and holds every later rank behind the entry gate until the visible upgrades and the need previews are done (:474-481); `applyStep` and `restoreStep` ([controller.ts:279](../client/src/scene/controller.ts#L279), :296) take an entry's new slots as previews, and each swapped record asks the on-demand loop for one frame (`sharpened`, :530) | `pixi.js` only in `scene/`; `gsap` only in `scene/executor.ts`; textures created only in `loader.ts` / `registry.ts`; no `fetch`; rule `pixi-env` (as merged, lever X): no mask, filter, pointer API or `accessible*` in scene code, no import of Pixi's environment entry points or GSAP's PixiPlugin, and one `Application`, built in `scene/controller.ts` on `appOptions` |
| `audio/*` | `unlockAudio` (in the gesture), the audio manager, two-deck BGM, SFX cache | `AudioContext` and `new Audio` only in `audio/`; no `fetch` |
| `world/*`, `puzzles/rules/*`, `puzzles/play/*`, `explore/{state,reduce,project,reconcile}.ts` | world types and the one decoder; puzzle rules; as merged (GM1c `8c2fa03`, RULINGS 178), the puzzle types' data halves: `PUZZLE_TYPES` ([puzzles/rules/index.ts:50](../client/src/puzzles/rules/index.ts#L50)), one instance per puzzle from its type's data half (`puzzleInstance` :99, `instanceOf` :80; no consumer switches on type), `PUZZLE_RULES` (:58) kept as their keyed view, and the play halves `puzzles/play/{code,order}.ts` (`CODE_PLAY`, `ORDER_PLAY`; no importer until a type UI imports one); the exploration kernel (`explore/reduce.ts`: the action and effect types, the section scope and `runReduce`; the section rules and the searches are the `mechanics/*` row's), reconcile and projection; as merged (GM1c `8c2fa03`), the world decoders take the puzzle types as an option (`DecodeOptions`, [world/decode.ts:754](../client/src/world/decode.ts#L754); `PUZZLE_TYPES` unless a test passes a fixture type); as merged (GM2a `9b4fd25`, RULINGS 181), the world state is format 2 ([explore/state.ts:26](../client/src/explore/state.ts#L26)): `flags` and a run's optional `work`, both outside the section key, and reconcile drops a saved `work` only with a puzzle the world lost ([explore/reconcile.ts:205](../client/src/explore/reconcile.ts#L205)); as merged (GM1d `794181b`, RULINGS 180), a source puzzle's `clues` decode from the source world only and never reach the public world or the server content (`SourcePuzzle`, [world/types.ts:112](../client/src/world/types.ts#L112)); as merged (GM2b `1782d6d`, RULINGS 190), a world's optional `renamed` map decodes, `toPublic` resolves each chain to its final target, and reconcile maps the renamed ids before `normalize` (step 0, `renameIds`, reconcile.ts :128; `giveBack` :100), an item merge leaving the item in a lock or in hand, never both; as merged (GM3c `837b1ed`, RULINGS 196), the decoder is composed: the keys a data-registry module owns reach that module in source order (`decodeWorld`, [world/decode.ts:698](../client/src/world/decode.ts#L698)), a decoded world carries their decoded `mods`, and `toPublic` (:855) writes them back into their places, so the emitted body has no `mods`; an object hotspot reports `then`'s issues before `lock`'s (:416-418); a clue is a condition (§4's grammar, the `mechanics/*` row); as merged (GM3 `7082a35`, RULINGS 212), every effect names where it acts and the writer's cues are `cue` effects ([reduce.ts:49-68](../client/src/explore/reduce.ts#L49)), and S's own facts are `ownScope` ([search.ts:379](../client/src/mechanics/rules/search.ts#L379)), the kernel's scope widened by each module's `scope` hook; as merged (GM5f `402d4d8`, RULINGS 328, 334), reconcile re-arms a module's effects from event facts (`triggerRan`, [reconcile.ts:57](../client/src/explore/reconcile.ts#L57), handed to each module's `normalize`, :329-331), and the projection writes `fl_<flag>` ([project.ts:39-41](../client/src/explore/project.ts#L39)); as merged (GM5q `5142d5d`, RULINGS 326), the section key names a merged view's state by its place, and the one search expands a place over its members under two bounds, places and work (`sectionPlaces`, [search.ts:309](../client/src/mechanics/rules/search.ts#L309), `searchSection` :545, `RESUME_WORK_PER_STATE` :535; FEATURE_MAP "Place quotient") | the pure-world rule (`isPureWorld`, [arch.test.ts:149](../client/src/arch.test.ts#L149); as merged (GM1c `8c2fa03`, RULINGS 178) it covers `puzzles/play/*`, :156): no DOM, network, storage, Svelte, clock or randomness; value imports stay inside these files and `story/{staging,catalog,tags}.ts`; as merged (GM1c `8c2fa03`, RULINGS 178) the play halves are value-imported only from `puzzles/ui/` (arch rule `rules-lazy`, `RULES_LAZY` [arch.test.ts:186-197](../client/src/arch.test.ts#L186)) |
| [geom/cover.ts](../client/src/geom/cover.ts) | the cover transform and the room safe frame and, as merged (GM3c `837b1ed`), the hotspot minimum `HOTSPOT_MIN_SOURCE_PX` ([cover.ts:28](../client/src/geom/cover.ts#L28)) the world lint reads, shared by `scene/layout.ts`, `scene/executor.ts` and the story tool's world lint | no module rule of its own: the pure-world rule does not cover it ([arch.test.ts:149](../client/src/arch.test.ts#L149), `isPureWorld`); the global rules below and `pixi.js` only in `scene/` apply ([arch.test.ts:330-364](../client/src/arch.test.ts#L330)) |
| `api/generated/api.ts` | ts-rs DTO types from the server | generated, committed |
| [ui/App.svelte](../client/src/ui/App.svelte) | the overlay's root (as merged, L15b `fbcfd38`): it routes `startApp`'s `AppHandle` (the view model, Home's actions, the game) to the components and their callbacks back, and decides nothing itself. Home, the notices, the chapter list and the toasts ship in the entry; every other component is the engine's `vm.ui` and renders once that chunk is in. The Stage mounts with the engine and stays for the page's life (one Pixi Application; the scene mounts at the first start), under the opaque Home and notice layers (D5′). Every layer is full-bleed, and each below the top overlay is `inert` (D6′; the overlays it renders, `OWN`, [App.svelte:30](../client/src/ui/App.svelte#L30)). A tap in play resumes sound that needs a gesture, in the capture phase (D12′, :52-65). As merged (LMI `3e35a7b`): the meta overlays render from the meta chunk once the controller has loaded it (`vm.meta.ui`, the set `META`, :32), as layers that make the ones below inert like `OWN`'s (:40); Home's card action, Friends and Wallet, the Menu's Friends and Wallet and the Terms' privacy link call boot's gate (`app.metaTaps`, :149-151, :200-201, :192), so they are given before the chunk lands. As merged (GM3w `508bd36`, RULINGS 186): the stage layer is inert while the puzzle store's `covers` holds (:75), the frame layer renders only then (:105-106), and it passes taps through while its two blocks, the frame and the load notice, take them back (`.frame-layer`, :369-371); as merged (GM3s `65e10ad`): the cue layer above the frame layer, below Home, the overlays and the toasts (:122-134), which takes no tap; as merged (the Q67 fix `4f26e8e`, RULINGS 244, 247, 251): App's root is one phone-shaped column, the whole window up to 480 CSS px wide and above that line min(width, height × 9/16), and every layer fills one design box drawn at `--col-scale` below the 360 px design width, with the insets divided by the scale ([App.svelte:327-338](../client/src/ui/App.svelte#L327), the query :348-359; FEATURE_MAP "Phone column"); as merged (per-player GM6t `a064399`), it passes the view model's reduced motion to the toasts (:302) | `ui/` imports no story, scene or audio module except types (arch rule `ui-imports`) |
| [ui/screens.ts](../client/src/ui/screens.ts) | `createScreens` (:71): overlays over a root view (Home, the game, a Notice), no router; the one owner of the BackButton ([WebView constraints](#webview-constraints)) | the button only through the facade's `backButton` |
| [ui/state.svelte.ts](../client/src/ui/state.svelte.ts) | `createViewModel` (:232): the overlay's view model (the line, the choices, the play mode, the text speed, the screens view, the toasts; since L15a also Home's cards, the notice, the chapters, the backlog, the settings, the saves, the paywall, `paused` and the engine's `ui`; as merged, LMI `3e35a7b`, `meta`, what the meta overlays render, written by the meta controller, :114), written by the boot and the game session; its `$state.raw` fields are replaced, never mutated; as merged (lever O5 `9a0ae2d`), `overlayUi`, the in-play overlays' module, written by the Game (:156); as merged (the Q64 fix `d820803`), `stageTap`, written by the Game beside a pending paid start (:105, the class field last, :164) | views only: never a Story, a runner or a Pixi object (principle 7) |
| `ui/{TapToStart,Stage,DialogueBox,Choices,QuickBar,Toast}.svelte`, [ui/typewriter.ts](../client/src/ui/typewriter.ts) | Home's frame, the stage host the scene mounts into, the dialogue box with the grapheme typewriter (by code point where `Intl.Segmenter` is missing, L15b), the choices (no tap-through), the quick bar, the toast stack (its `dev` banner only under the mock); as merged (the Q64 fix `d820803`, RULINGS 235, 236), with no line and the Game's `stageTap` the dialogue box draws the `.stage-tap` button over the empty stage, named `quick.advance`, whose tap is one more `onadvance` ([DialogueBox.svelte:115-117](../client/src/ui/DialogueBox.svelte#L115); D11, the Game modules row); as merged (per-player GM6t `a064399`), the toasts move (the `ui/toast-motion.ts` row) | presentational: props in, callbacks out; text through `t()`, `textContent` or Svelte text interpolation, never markup |
| [ui/toast-motion.ts](../client/src/ui/toast-motion.ts) | the toast motions (as merged, per-player GM6t `a064399`, RULINGS 266, 268, 269): the motion table `TOAST_MOTIONS` (:19; `in`, `out` and `swap`, each with a reduced form that animates opacity only), `playToast` (:62, `Element.animate`, never a Svelte transition) and `stackOf` (:85), which keeps a removed toast as a ghost at its index under a never-reused leave token until its `out` ends. Toast renders a ghost `inert` and `aria-hidden` ([Toast.svelte:138-139](../client/src/ui/Toast.svelte#L138)), recomputes the stack in a `$effect.pre` (:63) because Svelte documents the pre-effect order (a plain effect works in Svelte 5.57 only through an undocumented step, :60-62), drops an animation's record when its element leaves the stack, and cancels every running motion at unmount (:116-121) | one of the motion owners: `.animate(` only in `WAAPI_FILES` (arch rule `waapi`, [arch.test.ts:217](../client/src/arch.test.ts#L217)) |
| [i18n/index.ts](../client/src/i18n/index.ts), `i18n/{ru,en}.ts` | the UI string tables and `t(lang, key, params)` (:18); as merged (GM3u `33b4f8d`, RULINGS 230), the mechanics strings `mech.*` and `mechT` in [i18n/mechanics.ts](../client/src/i18n/mechanics.ts) (:33), imported by `app/yields.ts`, so they ship with the engine, never the entry (`arch: the mechanics string table loads with the engine, never with the entry`) | `ru.ts` defines the keys; `en.ts` is typed by them, so a missing or an extra key is a compile error ([en.ts:1-6](../client/src/i18n/en.ts#L1)) |
| `ui/{Paywall,ChapterSelect,StoryPicker,Notice,Terms}.svelte`, `ui/overlays/{Menu,Backlog,Settings,SaveLoad}.svelte` (as merged, lever O5 `9a0ae2d`; before it under `ui/`), [settings/store.ts](../client/src/settings/store.ts) | the menus (L14b): the game menu, the paywall with the terms checkbox, chapter select per story, the story picker, save and load, settings, the backlog, notices, the terms; the settings and read-sets cached in CloudStorage; as merged (LFU3 `48bc82a`, RULINGS 121), the reopen notice's one action is Close, which its producers pass as `() => tg.close()` (the facade's `close`), and the paywall shows a 429's wait in minutes with Buy disabled; as merged (LBI `fe996a0`), the `update` notice, with no action, covers every control while the page reloads into a new build ([Notice.svelte:56-57](../client/src/ui/Notice.svelte#L56)); as merged (lever O5 `9a0ae2d`, RULINGS 228-231, 234), the Menu, the Backlog, the Settings and the Saves screen are a lazy chunk behind [ui/overlays/index.ts](../client/src/ui/overlays/index.ts), and the Paywall and Terms stay in the engine (the paragraph below the table) | presentational, no I/O (`menus: components do no I/O`); the settings store is a cache that is never asked what is owned; `ui/overlays/` is a lazy directory (arch rule `lazy-ui`, `LAZY_DIRS`, [arch.test.ts:169](../client/src/arch.test.ts#L169)), and the engine closure holds none of it (`arch: the engine closure holds no in-play overlays`, :1574) but keeps the Paywall and Terms (`arch: the paywall and its terms stay in the engine closure`, :1600) |
| `puzzles/{registry,session}.ts`, `puzzles/ui/*`, `ui/puzzles/*`, [ui/puzzle-view.svelte.ts](../client/src/ui/puzzle-view.svelte.ts) | the puzzle UI (LP2): one puzzle session with its hint ladder (hint texts from the server, in memory only), one dynamic chunk per puzzle type, the puzzle host; as merged (LFU3 `48bc82a`, K46), an `order` piece shows its item's world glyph beside its name, from the yields producer (`PuzzleUiProps.item`, [puzzles/registry.ts:23](../client/src/puzzles/registry.ts#L23); lines as of `f6487fc`); as merged (GM3w `508bd36`, RULINGS 186), the host's callbacks forward to the current session's host (`forwardHost`, [puzzle-view.svelte.ts:91](../client/src/ui/puzzle-view.svelte.ts#L91); as merged, GM7r `9516951`: also the optional `onreach`, :102, beside `oncue`), `coversStage` (:143) decides what the frame covers, and `PuzzleFrameView.retrying` (:56) disables both Retry buttons while a reload runs (written by the yields since GM3p `d478384`); as merged (GM3p, RULINGS 243), every puzzle control declares and emits its cue: the frame root `data-cue-root="frame"` ([PuzzleHost.svelte:125](../client/src/ui/puzzles/PuzzleHost.svelte#L125)) emits to the view's `oncue` ([puzzle-view.svelte.ts:78](../client/src/ui/puzzle-view.svelte.ts#L78)), which the yields put on the session's bus; Changed by RULINGS 335, 337, 339, 341 (as of `f6487fc`; docs lane `docs-errata-19`, group A): as merged (GM7r `9516951`), a type UI also takes `onreach?` (a reach type's reached answer, through the edge `reachEdge`, [puzzles/play/reach.ts:11](../client/src/puzzles/play/reach.ts#L11)) and `oncue?` (a gesture step, which the host lands on the part's `[data-cue-part]`) ([registry.ts:28](../client/src/puzzles/registry.ts#L28), :30); the reply-kind rule: a reach type's answer posts once per solve when reached and a commit type's on Try; a reach post has two decisive replies, `correct` (solved) and `mismatch` (any `correct: false` reply: no attempt counted, the device resets to its start answer, [session.ts:240-244](../client/src/puzzles/session.ts#L240)), and no wrong attempt; an offline or rate-limited reply is not decisive, so the answer keeps awaiting and posts again (Try after an offline reply, [yields.ts:1209-1212](../client/src/app/yields.ts#L1209); the countdown's zero after a 429, :1152-1161; Changed by RULINGS 341 (as of `f6487fc`; docs lane `docs-errata-19`, group A, fix round 1)); Try is enabled on a reach frame only while its answer awaits (`frame.awaiting`, [puzzle-view.svelte.ts:44](../client/src/ui/puzzle-view.svelte.ts#L44)) | the lazy directories `puzzles/ui/`, `ui/puzzles/`, `ui/explore/` are imported from outside only by `import()` (arch rule `lazy-ui`, [arch.test.ts:169](../client/src/arch.test.ts#L169)) and budgeted per chunk |
| [explore/controller.ts](../client/src/explore/controller.ts), `ui/explore/*`, [ui/explore-view.svelte.ts](../client/src/ui/explore-view.svelte.ts), [ui/glyphs.ts](../client/src/ui/glyphs.ts) | the exploration UI (LX): the explore controller (hotspot views through the cover transform, 44 px minimum targets, the room path for Back, neighbour preloads), the hotspot layer, inventory, document reader and lock panel, one lazy chunk; as merged (GM3s `65e10ad`, RULINGS 201 E1): `ExploreView.svelte`'s root is the explore family's cue root, attached in an `$effect`, its controls emitting to the session's bus through the view's `oncue`; as merged (GM3u `33b4f8d`, RULINGS 226, 230), the item ribbon ([Ribbon.svelte](../client/src/ui/explore/Ribbon.svelte)) in the room while no sheet covers it, its selection the view store's `selected`, written by `app/yields.ts`, which dispatches a use as a `SectionAction` ([yields.ts:1442-1468](../client/src/app/yields.ts#L1442)); the bare-art catcher; every explore control declares and emits its cue; as merged (GM3b `ac9cab1`, RULINGS 246), the controller holds every image a room can show under `state:<room>` ([controller.ts:103](../client/src/explore/controller.ts#L103)) and requests a room's bg, its images, each neighbour's bg in exit order, then each kept neighbour's images (`roomShown`, :253), so a neighbour's bg outranks a kept room's state pictures. As merged, GM4 `d695053` (engine plan §6.3; FEATURE_MAP "Views"): the walk tells a zoom-in and a zoom-out apart by the move's `how` ([controller.ts:366](../client/src/explore/controller.ts#L366)), Back leaves a view first (`back()` :488, `leave-view`), the preload order puts Back's target first, then `nearRooms` (`neighbours` :185), and a zoom-in to a leaf view keeps the parent's state set (`releaseHolders` :214-225, RULINGS 286 Q3); as merged, GM4u `aac7a97`: the bar's leave control shows exactly while `inView` ([ExploreView.svelte:94](../client/src/ui/explore/ExploreView.svelte#L94); the button is `data-cue="view-leave"`, labelled with Back's `explore.room_back`, :96); as merged, GM5 `5190235`: a ribbon item tapped onto another dispatches `oncombine` ([Ribbon.svelte:35](../client/src/ui/explore/Ribbon.svelte#L35)); as merged, GM5f `402d4d8`: the controller reads a hotspot's presence (`shown`, [controller.ts:154](../client/src/explore/controller.ts#L154)): a hotspot its `when` hides has no view, its lock panel closes (:298) and Back's path leaves it (:352) | the world only through `reduce` / `admitSection` (principle 7); one lazy chunk, guarded per file: `ui/explore/*` by the arch rule `lazy-ui` ([arch.test.ts:169](../client/src/arch.test.ts#L169) `LAZY_DIRS`), the controller as a root of the budget row `explore-ui chunk (br)` ([budget.ts:256-262](../client/scripts/budget.ts#L256), measured since `app/yields.ts` exists, L15a); the view store and `ui/glyphs.ts` are statically importable (their module comments); as merged (GM1a `ef8b4dc`), the controller is the one importer of the rules half (the `mechanics/*` row below); as merged (GM3w `508bd36`, RULINGS 186), the layer's callbacks `ExploreLayerActions` live in the view store's module (moved from `app/yields.ts`, cut D2) and forward to the current session's layer (`forwardLayer`, [explore-view.svelte.ts:87](../client/src/ui/explore-view.svelte.ts#L87)) |
| [mechanics/contract.ts](../client/src/mechanics/contract.ts), `mechanics/data/*`, `mechanics/rules/*` | the mechanics engine (as merged, GM1a `ef8b4dc`, RULINGS 165, and GM1b `03a00bc`, RULINGS 171; engine plan §3): the module contract (types and constants only), the data registry `MECHANIC_DATA` (the engine half: decode, normalize), the rules registry `MECHANIC_RULES` (the explore-ui half: actions, apply, the tap and arrival hooks, the reads `sectionKey` is derived from), the explore rules and the searches (`reduce`, `admitSection`, `successors`, `sectionKey`) and the fact writer; module core alone today. The kernel stays in the engine (`explore/reduce.ts`, whose `runReduce` writes a linear puzzle's run with the same run rules); as merged (GM3c `837b1ed`, RULINGS 196; engine plan §4), the condition grammar: `decodeCond`, `condReads` and `condSize` in the data half ([mechanics/data/conditions.ts:130](../client/src/mechanics/data/conditions.ts#L130)), bounded at depth 4 and 16 atoms, and `holds` in the rules half ([mechanics/rules/conditions.ts:19](../client/src/mechanics/rules/conditions.ts#L19)); the data registry also composes the world decoder (the `world/*` row); as merged (GM3m `a3f0678`, RULINGS 193), a module declares its DOM controls (`MechanicData.controls?`) and every world field is a fact kind or silent (`SILENT_FIELDS`); as merged (GM3 `7082a35`, RULINGS 210, 212, 216, 217), module `use`, the second module ([data/use.ts](../client/src/mechanics/data/use.ts), [rules/use.ts](../client/src/mechanics/rules/use.ts); the build half `client/scripts/story/mechanics/use.ts`): an item used on a hotspot runs the target's first matching rule, else the lock fit, else a refusal; the module-agnostic hooks `MechanicRules.scope` ([contract.ts:166](../client/src/mechanics/contract.ts#L166)) and the build's `MECHANIC_STORIES`, so a later module adds its share of S's facts and the knots it enters without a kernel edit; the writer records every fact change and module cue, handed on as `cue` effects ([core.ts:364-365](../client/src/mechanics/rules/core.ts#L364)); as merged (GM3k `3131844`, RULINGS 219, 223), `KernelWorld` ([contract.ts:224](../client/src/mechanics/contract.ts#L224)) is the public body with its decoded `mods` required, and `WorldPublic` is `KernelWorld` with its `version` ([types.ts:161](../client/src/world/types.ts#L161)); the search API and the soft-lock proof take a `KernelWorld`, so a call without the modules' data fails `check`; as merged (GM3b `ac9cab1`, RULINGS 245, 250, 258), the third module `visual`: a hotspot's or decor's states and `is` rules ([data/visual.ts:145](../client/src/mechanics/data/visual.ts#L145)), a prop's state its first matching `is` ([rules/visual.ts:66](../client/src/mechanics/rules/visual.ts#L66)), every image a room can show (`roomImages` :81), in both registries, `[core, use, visual]`; as merged, GM4 `d695053` and GM5 `5190235`, `[core, use, visual, view, combine]` ([data/index.ts:76](../client/src/mechanics/data/index.ts#L76), [rules/index.ts:81](../client/src/mechanics/rules/index.ts#L81)): `view` owns a room's `view.of`, decides a move's kind (`moveHow`) and the exit-rooms rule (`nearRooms`), and offers `leave-view` in a view ([rules/view.ts:27](../client/src/mechanics/rules/view.ts#L27), :36, :56); `combine` runs the first recipe of a held pair whose `when` holds, else writes nothing and shakes both items ([rules/combine.ts:112](../client/src/mechanics/rules/combine.ts#L112)); their story-gate lints `VIEW_LINT` and `COMBINE_LINT` (FEATURE_MAP "Views" and "Combine"); as merged (GM5f `402d4d8`, RULINGS 327-329, 331, 333, 334), the sixth module `flags`, `[core, use, visual, view, combine, flags]` ([data/flags.ts](../client/src/mechanics/data/flags.ts), [rules/flags.ts](../client/src/mechanics/rules/flags.ts)): a `{ set }` effect runs among its trigger's kernel effects at its source index (`fire`, [writer.ts:48](../client/src/mechanics/rules/writer.ts#L48); `isKernelEffect` :23, judged by key), a `{ flag }` atom reads it, and a hotspot's `when` is its presence, read by core, use, visual and the explore controller (`present`, [rules/flags.ts:84](../client/src/mechanics/rules/flags.ts#L84)) and by the place quotient (`gated` :91); a module whose effects ride kernel triggers re-arms them at reconcile through `ran` (`normalize(w, s, dropped, ran)`, [contract.ts:137](../client/src/mechanics/contract.ts#L137), `effects?` :191); its story-gate lint `FLAGS_LINT` ([scripts/story/mechanics/flags.ts:126](../client/scripts/story/mechanics/flags.ts#L126), `world/flag-unknown-ref` and `world/flag-scope`); FEATURE_MAP "Flags" | pure: the pure-world rule covers the whole directory (`isPureWorld`, [arch.test.ts:149](../client/src/arch.test.ts#L149), `mechanics/` at :154); the rules half is imported by value, `import()` included, only from inside it and by the explore controller (arch rule `rules-lazy`, a bare directory specifier included since GM1b; as merged (GM1c `8c2fa03`, RULINGS 178): the rule holds per directory, `RULES_LAZY` [arch.test.ts:186-197](../client/src/arch.test.ts#L186) with `isRulesImporter` :208-210 and the check :849-854, `mechanics/rules/` from `explore/controller.ts` and `puzzles/play/` from `puzzles/ui/`; `RULES_IMPORTERS` / `RULES_DIR` are gone), so it loads with the explore-ui chunk; as merged (GM3m `a3f0678`), `RULES_LAZY` also holds the cue stage and the cue root action (the `cues/*` row), and a file entry matches its `.ts` and extensionless specifiers but not a `.js` one (`inRulesLazy` [arch.test.ts:201-206](../client/src/arch.test.ts#L201), GM3m review M3) |
| `cues/{types,bus,visible}.ts`, `cues/stage/{motions,presets,player}.ts` | the cue channel (as merged, GM3m `a3f0678`, RULINGS 193; engine plan §8; mounted since GM3s `65e10ad`, the next row): the cue union and keys, the bus (`createCueBus`, [cues/bus.ts:22](../client/src/cues/bus.ts#L22): held until the overlay subscribes, then played in order), the motion table (`CUE_MOTIONS`, [motions.ts:119](../client/src/cues/stage/motions.ts#L119): every cue key has a visible motion, reduced motion included), the presets and the player (`createCuePlayer`, [player.ts:98](../client/src/cues/stage/player.ts#L98): capture at emit, run after the flush, ghosts, wait holds, the checking loop); as merged (GM3 `7082a35`), the fact cues are the writer's record, and the motion table gains `fact:fired:added`'s `enter` sweep and `use`'s `module:use:refused` and `module:use:said` ([motions.ts:151](../client/src/cues/stage/motions.ts#L151), :221-222); as merged (GM3u `33b4f8d`, RULINGS 226, 230), the control gate ([controls.test.ts](../client/src/cues/controls.test.ts)): every explore control declares its cue, the gate refuses an undeclared handler, a foreign trigger and an unknown cue, and every puzzle gesture surface disables touch panning; the yields emit the panels' `panel-open` / `panel-close` from the screens diff (yields.ts :1569-1576); as merged, GM5 `5190235`: `module:combine:refused` (a shake with one error haptic) and `module:combine:refused-with` (a shake) on the ribbon ([motions.ts:223-226](../client/src/cues/stage/motions.ts#L223)); as merged, GM5f `402d4d8`: `fact:flag:added` sweeps the stage ([motions.ts:170](../client/src/cues/stage/motions.ts#L170)) | `cues/{types,bus,visible}.ts` are pure (`PURE_WORLD_FILES`, [arch.test.ts:122-124](../client/src/arch.test.ts#L122)); `cues/stage/` is its own chunk, imported from outside only by `import()` (`RULES_LAZY` :194); `.animate(` only in the motion owners (arch rule `waapi`, `WAAPI_FILES` :217; `waapiAnimate`, player.ts :55) |
| `cues/root.ts`, `cues/stage/{index.ts,CueStage.svelte}` | the cue stage (as merged, GM3s `65e10ad`, RULINGS 194, 195, 201, 203, 204; engine plan §8.1, §8.3, §8.5): one layer App mounts above the frame layer once the session loaded its chunk ([App.svelte:122](../client/src/ui/App.svelte#L122)); `mountStage` ([index.ts:232](../client/src/cues/stage/index.ts#L232)) subscribes as the bus's overlay role and plays every cue on ghosts through GM3m's player, resolves each target by its attribute, lands a target with no live control at `edge` or `centre`, paints a plain ghost a soft light unless its preset paints by itself (RULINGS 203, 204), plays a haptic only on top of a motion, and plays the family roots' entrance and exit itself (Branch F, RULINGS 195: no Svelte transition directive); `cueRoot` ([root.ts:29](../client/src/cues/root.ts#L29)) is the family root's capture listener, attached in an `$effect` (RULINGS 201 E1), with its own trigger tuple `ROOT_TRIGGERS` (:21, RULINGS 201 E2); `app/yields.ts` keeps one bus per session, loads the stage before a section or a puzzle opens and applies every visual batch through `heldBy` ([yields.ts:296](../client/src/app/yields.ts#L296)); as merged (GM3u `33b4f8d`, Q62), the stage layer is `inert` and `aria-hidden` ([CueStage.svelte:31](../client/src/cues/stage/CueStage.svelte#L31)); as merged (GM3p `d478384`, RULINGS 233, 243), PuzzleHost and ExploreView import `cues/root.ts` from one shared lazy chunk that holds it alone, and the request walk ([requests.test.ts](../client/src/requests.test.ts), engine plan §8.1 point 11) proves every request start a declared site and every wait of the views on one named with its hold (`HOST_WAITS`, nine members, :64-74); as merged (the Q67 fix `4f26e8e`), a target's box is measured in layer px, client px divided by the column's scale (`clientPerLayerPx`, [index.ts:34-39](../client/src/cues/stage/index.ts#L34)); every family root's cue point reaches the bus in stage-host px (`inStageHost`, [yields.ts:380](../client/src/app/yields.ts#L380); the frame family's since GM3p, the explore root's since the Q69 fix `99be5c1`) | `cues/stage/` is its own chunk, imported only by `app/yields.ts`'s `import()` (`RULES_LAZY` [arch.test.ts:194](../client/src/arch.test.ts#L194), `LAZY_DIRS` :169) and budgeted by its own row; `cues/root.ts` only in the family roots' chunks; no `use:` directive anywhere (rule `svelte-action`, :426); the debug attributes only under `__TG_MOCK__` |
| [ui/meta/index.ts](../client/src/ui/meta/index.ts), `ui/meta/*.svelte`, [i18n/meta.ts](../client/src/i18n/meta.ts) | the presentational meta overlays (completion card, friends and requests, a friend's profile, invite prompt, consent, wallet, gift) and their own string table (`mt` :142); `ui/meta/index.ts` is the one entry of one lazy chunk (META-PLAN M27). As merged (LMI `3e35a7b`): Friends gained the new invite link, which revokes the link already sent (M10), and its Accept, Decline and new link follow rule (b) of `Choices.svelte`, as the gift dialog's Send does: a pointer click counts only after a pointerdown on that button while the list is shown, so the tap that opened Friends decides nothing; a keyboard click counts ([Friends.svelte:2-8](../client/src/ui/meta/Friends.svelte#L2)) | as merged (LMI `3e35a7b`), `app/meta.ts` is the only module that loads `ui/meta/index.ts`, only by a dynamic import, prefetched once after the first line ([meta.ts:185](../client/src/app/meta.ts#L185), `lineShown` :805), and `ui/App.svelte` renders it from `vm.meta.ui`. Outside `ui/meta/` a module may reach it only by `import type`, nothing outside the chunk loads `i18n/meta.ts`, and the chunk does no I/O (`meta: one entry, no I/O, the meta table stays in the chunk`, [meta.svelte.test.ts:956-1014](../client/src/ui/meta/meta.svelte.test.ts#L956)); the build's budget gate also refuses the chunk in a static closure (`budget: meta ui in entry closure fails`; RULINGS 113), beside the arch rule `lazy-ui`, whose `LAZY_DIRS` holds `ui/meta/` since LFU3 `48bc82a` ([arch.test.ts:169](../client/src/arch.test.ts#L169)) |
| `meta/{card,social,wallet}.ts` | the meta data services (LMD): the completion card, one `POST /api/stories/{storyId}/card` per open and no copy kept; friends, invites, consent, a friend's profile (the first name from the friend list) and the share, the state being the last applied `SocialResponse`; the wallet with `maxPerGift` from each wallet answer, and the hint port. Social and wallet guard against a stale answer: an older response never replaces a newer state | a cache of server answers only, persisted nowhere (principle 1); as merged (LMI `3e35a7b`), only `app/meta.ts` imports them, so they load in the meta controller's chunk |
| [app/meta.ts](../client/src/app/meta.ts) | the meta controller (as merged, LMI `3e35a7b`; META-PLAN "Module API", M27; RULINGS 105): `createMetaController` (:180), one per page, made by boot's meta gate after auth (as merged, LFL `cec347c`, RULINGS 149: when the gate's import lands; the boot row above). It owns the LMD services, what the overlays render (`MetaView` :38, written to `vm.meta`) and the overlays' chunk. Its `boot` (:521) reads the friends, the wallet and the stats, none awaited by the first line (as merged, LFL: the stats are boot's own read, handed over by the gate, `stats` :132, :524; LRB `3c62a86` pins it, the arch guard `metaStatsGaps`); the stats give a story card its card action (`hasCard` :547), and a `startParam` invite in the `open` state the invite prompt, over Home only. At an ending (`onEnding` :582) it waits for the stats to settle, at most `CARD_SETTLE_MS` (3 s, :174), then opens the card; a timeout shows `meta.card_later`. One refresh per service is in flight and none while one of its mutations is (`syncOf` :264); Accept, Decline and Remove run one at a time, and a 404 reads the friends again (`friendCall` :364); a gift is single flight, with one request id kept across a network retry (`gift` :650), and as merged (LFU3 `48bc82a`, RULINGS 121) its success closes only the dialog opened for its own friend (:675); one pack purchase flow serves the wallet (`buyPack` :759), whose Buy is held while a 429's wait lasts (`purchased` :478, LFU3); as merged (LRB `3c62a86`, RULINGS 157), `MetaView.purchaseLeft` (:55) says the player left that flow: the wallet is not open and the flow is `delayed`, or `sheet` after the player's Back on the wallet (`purchaseLeft` :475, `popped` :163, `sheetLeft` :224), so the Game's build-skew reload does not wait for it (the game row above); the share sends a prepared message through `shareMessage` when supported, prepares it once more on `expired`, and otherwise opens `t.me/share/url` through `openTelegramLink` (M14, `shareOnce` :413); the policy opens through `openLink` (`openPolicy` :783). An epoch, bumped by `closeOverlays`, a root change and `dispose`, drops an answer that would push an overlay over a later screen (:1-6). As merged (E6 `d5e04ef`, RULINGS 215, 228): a pack Buy that waits for the purchase module sets the view's `purchaseWaiting` (:50; `buyPack` :759, :764) until the flow's first state is in the view or its load failed (:778), and `metaHold` reads it as a `purchase` hold ([reload.ts:23](../client/src/app/reload.ts#L23)) | an overlay renders a service's state, never a call's own answer, and nothing here unlocks anything (principle 1); its own lazy chunk, loaded only by boot's `import('./meta.ts')` ([boot.ts:650](../client/src/app/boot.ts#L650)) and budgeted by the `meta controller chunk (br)` row ([budget.ts:266](../client/scripts/budget.ts#L266)), whose gate refuses a static import (`budget: meta controller imported statically fails`; RULINGS 113), as the arch rule `lazy-ui` does since LFU3 `48bc82a` (`LAZY_ROOT_FILES`, [arch.test.ts:170](../client/src/arch.test.ts#L170)); `boot.ts` and `ui/state.svelte.ts` import only its types |

Forbidden anywhere in `src/` (arch rules): `vh` units, `window.open` and dialogs, `innerHTML` / `{@html`, Service
Workers, `document.cookie`, `<iframe`, `history` navigation, `localStorage` / `sessionStorage` outside
`telegram/dev/`, `initDataUnsafe`, `inkjs/full` and `inkjs/compiler`, `svelte-pixi`, a Svelte `use:` directive
(rule `svelte-action`, as merged GM3s `65e10ad`, RULINGS 201 E1), and any import that resolves
outside `src/` (so neither `story/` nor `server/content/` can enter the bundle).

**Wired and rendered** (as of `6d77329`; L15a, L15b; LMI as merged at `3e35a7b`). `main.ts` calls `startApp`, which creates the view model, the
screen stack, the API client, the settings store and, after auth, the statistics reporter, and runs the boot reads.
The engine chunk (`app/engine.ts`) is imported beside the boot reads and created ahead of a tap: the scene
controller, the chapter loaders, the SaveService factory and GameSession, whose yields open the puzzle and explore
sessions. As merged (LMI `3e35a7b`, RULINGS 105), once the boot reads are in (auth among them; RULINGS 113)
`startApp` also imports the meta controller's chunk (`app/meta.ts`) beside the engine, never awaited before the first
line; boot's meta gate is the one way to it. As merged (LFL `cec347c`, RULINGS 149, 155), the gate requests it no longer
after auth but at the session's first step, a meta tap, an ending, a hint use, a launch parameter or Home idle, so the
engine download has the link to itself; after auth boot hands the gate its stats read and the launch parameter
([boot.ts:961-965](../client/src/app/boot.ts#L961)).
The readers of `client/src/story-gen/` are boot's URL glob for the catalog and the covers (`PUBLIC_JSON`,
[boot.ts:81](../client/src/app/boot.ts#L81)) and the chapter loader's in the engine chunk (`FREE_CHAPTER_FILES`,
[chapters.ts:67](../client/src/story/chapters.ts#L67)). Since L15b (`fbcfd38`) `App.svelte` renders Home, the play
surface and the overlay and menu components from `startApp`'s handle, so a story starts from Home's tap; as merged
(LMI `3e35a7b`) it also renders the meta overlays from the meta chunk, and a story card's card action shows once the
controller says the story has a card (as merged, LFL `cec347c`: the gate's `hasCard`, the controller's once it is in,
else the endings of boot's own stats read, [boot.ts:698](../client/src/app/boot.ts#L698), :330; the action
[App.svelte:149](../client/src/ui/App.svelte#L149)). The e2e suite runs the app on `server-dev` and the mock: the boot
spec ([boot.spec.ts](../client/e2e/boot.spec.ts)) and, since L15b, the smoke, stories, purchase, perf and puzzles
specs, 35 names in all (with M1's `memory.spec.ts`, 36; FEATURE_MAP "App shell and the app e2e"); as merged (LMI
`3e35a7b`), with the meta and social specs ([meta.spec.ts](../client/e2e/meta.spec.ts),
[social.spec.ts](../client/e2e/social.spec.ts)), 47 names in nine specs; as merged (M2 `385d52f`), + 3 in
`memory.spec.ts`, 50 names (RULINGS 117); as merged (M3c `a6365a8`), + 4 in `memory.spec.ts`, 54 names (RULINGS
127); as merged since, LBI's and LRB's
[build-skew.spec.ts](../client/e2e/build-skew.spec.ts) (3), LHJ's [handover.spec.ts](../client/e2e/handover.spec.ts)
(1) and M3s's + 1 in `memory.spec.ts`: 59 names in eleven specs at `3c62a86` (RULINGS 157); with GM3s's
[mechanics.spec.ts](../client/e2e/mechanics.spec.ts) (4) and lever X's [scene-env.spec.ts](../client/e2e/scene-env.spec.ts)
(3), 66 names in thirteen specs at `597dded` (RULINGS 204, 208); with lever P's + 2 in `purchase.spec.ts`, 68 names
(RULINGS 213), and with the recovery lane's [lazy-recovery.spec.ts](../client/e2e/lazy-recovery.spec.ts) (10) and
[lazy-recovery-sticky.spec.ts](../client/e2e/lazy-recovery-sticky.spec.ts) (4), run in a Playwright project of its own
with a failed module kept in the module map, 82 names in fifteen specs at `8e099ee` (RULINGS 224); with E6's + 2 in
`lazy-recovery.spec.ts` (84, RULINGS 228), GM3u's + 1 in `mechanics.spec.ts` (85, RULINGS 230), lever O5's
[overlays.spec.ts](../client/e2e/overlays.spec.ts) (5; 90, RULINGS 234) and the Q64 fix's + 1 in `purchase.spec.ts`,
91 names in sixteen specs at `d820803` (RULINGS 236); with GM3p's + 4 in `mechanics.spec.ts` (95, RULINGS 243), the
Q67 fix's [layout.spec.ts](../client/e2e/layout.spec.ts) (4; 99, RULINGS 251) and GM3b's + 3 in `mechanics.spec.ts`,
102 names in seventeen specs at `ac9cab1` (RULINGS 258), unchanged through `a064399`; with SH4's
[shots.spec.ts](../client/e2e/shots.spec.ts) (2), 104 names in eighteen specs at `768fc9d` (RULINGS 290); with GM4u's + 2
in `mechanics.spec.ts` and SH5a's + 3 in `shots.spec.ts`, 109 names in eighteen specs at `48489b7` (RULINGS 314); with
SH5b's + 2 in `shots.spec.ts`, 111 names in eighteen specs at `f6487fc` (RULINGS 346); and
`handover.spec.ts`'s fixture is now the close-up's gated plate (RULINGS 282); the overlay components are
tested in the vitest `dom` project.

Changed by RULINGS 201, 221, 228-231, 234-236 (as of `0b91acc`; docs lane `docs-errata-15`, group A): **the in-play overlays chunk**
(lever O5, merged `9a0ae2d`). The engine chunk no longer holds the Menu, the Backlog, the Settings and the Saves
screen: they moved to `client/src/ui/overlays/{Menu,Backlog,Settings,SaveLoad}.svelte` behind one barrel
([ui/overlays/index.ts](../client/src/ui/overlays/index.ts)), a lazy root with its own row (`overlays chunk (br)`,
≤ 3.0 KB br, [budget.ts:167](../client/scripts/budget.ts#L167), :277). The Game owns the load, one per page
(`overlayUiModule`, [game.ts:1226](../client/src/app/game.ts#L1226); the import `loadOverlayUi` :413), and writes the
module into `vm.overlayUi` ([state.svelte.ts:156](../client/src/ui/state.svelte.ts#L156)) before any caller reacts;
App renders the four from it ([App.svelte:177](../client/src/ui/App.svelte#L177)). The prefetch runs once, at the
first line's reveal, after the gameplay chunks' prefetch (`lineShown`, game.ts :2076-2078); before a first line only a
Menu or Backlog tap requests it (during a start or a chapter load, on a paywall-first session's empty stage once Back
has closed its paywall, in a room before any line), and a failed tap there is not followed by the prefetch. An open
before the module lands waits on the one load and runs only if the screen stack has not moved since its tap, so the
first of several taps wins (`withOverlays`, :1247); a failed load shows the meta gate's note `meta.action_failed`,
opens nothing, keeps the game playable and loads again at the next tap (where the module map lets it); a load that
fails again after the evidence restarts the page through the recovery (Q60's B'), with no new wiring. The Paywall and
Terms stay in the engine (`EngineUi`, [engine.ts:35-47](../client/src/app/engine.ts#L35)), so `/terms` never depends
on the chunk. Since the Q64 fix (`d820803`), that paywall-first empty stage is also a tap that opens the pending
chapter's paywall again (D11, the Game modules row), so the stage never depends on the overlays chunk either; while
the chunk fails, its Menu or Backlog tap shows the failure note. Measured at the merge: engine -1,939 B br, first line
-1,867, the chunk 2,498 B (RULINGS 234).

## Server modules

| Module | Responsibility |
|---|---|
| [main.rs](../server/src/main.rs) | `server serve` (the default): `Config::from_env`, `AppState::new`, bind `LISTEN_ADDR`, graceful shutdown. As merged (L9 `d837c8b`): before `AppState::new`, a set `STATIC_DIR` passes `static_files::check` or the start is refused, and the built client is served beside the API (`with_static`; [main.rs:93-167](../server/src/main.rs#L93)); `server setup` (`bot_setup` :60) registers the bot with Telegram and opens no database. As merged (LPH `d423cb3`, RULINGS 106): both subcommands check the bot texts right after the configuration (`bot_texts_ok` :38), so a text file that does not parse, or a draft under `TELEGRAM_ENV=prod`, refuses the start before anything is opened ("Startup refuses bad content", below the table). As merged (LRF `a93fe54`, RULINGS 130): `run` (:147) spawns the automatic refund sweep, the server's one background task, once the listener is bound; when serving ends it aborts the sweep and awaits it (:156-165), before `serve` closes the pool (:134) ([Payments](#payments-as-built)). As merged (LBI `fe996a0`, RULINGS 145): the check also reads the client build's id, which `serve` logs (`static dir checked`, :112) and `run` hands to the app (`server::app`, :153) |
| [lib.rs](../server/src/lib.rs) | `AppState` (one constructor, `AppState::new` :72; `with_clock` / `with_catalog` / `with_gateway` seams; `share_limit` :61, the in-memory share window, LF2), `build_router` :134 (production routes only: `/api`, and `/telegram/webhook` outside it with its own 1 MiB body limit); as merged (LBI `fe996a0`), `app` :140, `server serve`'s app: the same routes with the served `STATIC_DIR`'s build id on every response of an `/api` route, then the built client behind them (`routes` :149) |
| [config.rs](../server/src/config.rs) | `Config::from_env`: secrets and settings only from the environment; the committed placeholder secrets are refused unless `TELEGRAM_ENV` is `test` and `PUBLIC_APP_URL` is a local host (:186-200) |
| [api/mod.rs](../server/src/api/mod.rs) | the routes (:62): `/health`, `/auth`, `/entitlements`, `/chapters/{chapterId}`, `/assets/{file}`, `/saves`, `/saves/{storyId}/{slot}`, `/puzzles/{puzzleId}`, `/puzzles/{puzzleId}/attempts`, `/puzzles/{puzzleId}/hints/{tier}`, `/invoices`, `/orders/{orderId}`, `/stats`, `/stats/events`, `/stories/{storyId}/card`, `/wallet`, `/gifts` (LE2), `/invites/{code}`, `/invites/{code}/request`, `/social`, `/friends/requests/{handle}/accept`, `/friends/{handle}`, `/friends/{handle}/profile` (LF2), `/invite/rotate`, `/consents/friends_profile`, `/share` (LF2), and `/privacy` from `api/legal.rs`; a 16 KB body limit (300 KB for saves) and `Cache-Control: no-store` by default; as merged (LBI `fe996a0`, RULINGS 145), with a build id `router` (:43) adds one header layer, `x-build-id` on every response of every route, its 4xx, 405 and 413 included; an unknown `/api/*` path (no route matched) is answered outside this router, without it (:38-42); as merged (GM6s2 `2815340`, RULINGS 176), `GET /chapters/{chapterId}/values` (:68, a chapter's per-player values, issued once per player) and `POST /puzzles/{puzzleId}/restart` (:80, a spent run re-drawn), both 200s and the attempt's 409 `value_changed` with `private, no-store` and `nosniff` (`sold_headers`, `api/puzzles.rs` :28) |
| `auth/*` | initData validation, the session token, the `AuthUser` extractor ([Auth](#auth-initdata-then-the-servers-own-token)) |
| `db/*` | `Repo`, the repository seam: every SQL statement; handlers never see `sqlx`. As merged (GM6k `fd62933`, RULINGS 163): every puzzle row and the hint spend's ledger keys are stored under the puzzle's storage key (`PuzzleKey`, [ids.rs:76](../server/src/ids.rs#L76)), and the erasure order is data, `ERASURE_ORDER` ([db/mod.rs:296](../server/src/db/mod.rs#L296)), held to the migrated schema by the four erasure gates of `server/tests/it/schema.rs`; as merged (GM6s1 `81a15b0`, RULINGS 168), `puzzle_values` is one of its steps (:310); as merged (GM6s2 `2815340`, RULINGS 176), [db/puzzles.rs](../server/src/db/puzzles.rs) issues and reads the `puzzle_values` rows: a chapter's rows issued once each with the primary key as the arbiter (`issue_values` :491, `chapter_values` :148), one row read under `FOR UPDATE` for an attempt, a restart or a hint text (`current_value` :277), a per-player wrong answer counted and a capped run spent (`record_attempt` :321), a spent run re-drawn on a restart (`restart_value` :427) |
| [content.rs](../server/src/content.rs) | `ContentStore`: the story index, paid chapters, the puzzle index, the gated asset index and the meta index (`load_meta` :907, LM2), loaded once at startup; as merged (M3s `a5f887b`, RULINGS 151), the gated asset index holds the half-tier files too, and a manifest-named file missing on disk refuses the start (`index_assets` :846; [Paid content](#paid-content-and-the-entitlement-check)); as merged (GM6k `fd62933`, RULINGS 163), the puzzle index reads format 1 and format 2 (the optional `key`; the `type` an opaque label, `is_type_label` :596) and refuses two puzzles on one key or a key that is another live puzzle's id (`check_keys` :980); as merged (GM6s2 `2815340`, RULINGS 176), format 2 also holds the per-player half (`Answer::PerPlayer` with `maxAttempts`, :195), a hint's `$code(..)` placeholder must fit its own puzzle (`placeholder_misfit` :534), and an `answerLen` above `MAX_ANSWER_LEN` refuses the start for every puzzle (:1041) |
| [catalog.rs](../server/src/catalog.rs) | products: every paid chapter of the story index, priced by `server/catalog.json` (prices are server-only), and the hint packs of its `economy` section (`build_economy` :405, LE1), whose gift and referral rules are bounded at startup (`GiftRules` :118, `ReferralRules` :131, LE2) |
| `puzzles/mod.rs` | answer check, attempt rate limit, puzzle status with the texts of unlocked hint tiers; as merged (GM6k `fd62933`), its rows read and written under the puzzle's `PuzzleKey`; as merged (GM6s1 `81a15b0`), an answer of at most `MAX_ANSWER_LEN` entries, 64 (:34); as merged (GM6s2 `2815340`, RULINGS 176): a per-player puzzle's attempt names the `run` it answers (`AttemptRequest.run`) and is compared with the player's own value of that run (`attempt` :210); a missing, stale or spent run is not compared and answers 409 `value_changed` with the current `PlayerValue` (`ApiError::ValueChanged`, `error.rs` :77); the server counts wrong answers and spends a capped run (`attemptsLeft`, `spent`); `player_values` (:161) and `restart` (:264) serve the two routes; `status` (:327) renders the unlocked tiers' `$code(..)` through the player's row, issuing it, and names its run (`valueRun`) |
| [puzzles/values.rs](../server/src/puzzles/values.rs) | per-player puzzle values (as merged, GM6s1 `81a15b0`, RULINGS 168): a puzzle's domain as the server holds it (`Domain::parse` :100), one uniform draw from it (`draw` :272), the renderer of the `$code(..)` placeholders (`render` :317) and the `puzzle_values` row (`ValueRow` :376, `0008_puzzle_values.sql`); pure apart from `os_rng` (:302); no route read it before GM6s2 (as merged, GM6s2 `2815340`: the values, restart, attempt, status and hint paths read it through `puzzles/mod.rs` and `db/puzzles.rs`) ([per-player §3.2](plans/per-player/03-server-half.md#32-the-domain-and-the-draw)) |
| [api/stats.rs](../server/src/api/stats.rs), [db/stats.rs](../server/src/db/stats.rs) | the player statistics: the event batch, its classification and budgets, the read of distinct facts, and the referral hook after every batch answered 200 (`referral_hook` :156, LE2) ([Player statistics](#player-statistics-as-built)) |
| [api/wallet.rs](../server/src/api/wallet.rs), [db/economy.rs](../server/src/db/economy.rs) | the economy (LE1): `GET /api/wallet` (the balances and the packs for sale); the append-only ledger and the balance rows, credited inside the grant, debited by `POST /api/puzzles/{puzzleId}/hints/{tier}` (`Repo::spend_hint`, `db/economy.rs` :385); moved between two friends by a gift (`Repo::transfer` :474, LE2) and credited by the referral grant (below) |
| [api/social.rs](../server/src/api/social.rs), [db/social.rs](../server/src/db/social.rs), [api/legal.rs](../server/src/api/legal.rs) | friends (LF1): invite codes, requests the link's owner accepts, removal and blocks, consent rows, the referral recorded at login (`Repo::auth_with_code`, `db/social.rs` :153); a friend's profile by handle (LF2, `get_friend_profile`, `api/social.rs` :333): 404 unless a friend, `visible: false` without the friend's consent grant, counts from the two grouped reads of `db/achievements.rs` (`progress` :102), titles gated as on the card; the referral's qualification (LE2, `Repo::qualify_referral`, `db/social.rs` :217); the public, versioned `GET /api/privacy`, whose page `Policy::load` fills once at startup from the operator file `PRIVACY_OPERATOR_FILE` (as merged, LPO `90e1226`; `legal.rs` :93; under `TELEGRAM_ENV=prod` a placeholder left refuses the start) |
| [api/share.rs](../server/src/api/share.rs), [server/locales/meta.json](../server/locales/meta.json) | sharing (LF2): `POST /api/share` (`post_share` :208) answers the sharer's invite link and a text of the story title and the sharer's own counts, never a title of an ending or an achievement; with `native`, a prepared inline message's id (a failed prepare answers a null id). At most `SHARES_PER_HOUR` (:37) per user, counted in memory in `AppState.share_limit`; the texts compiled in from `server/locales/meta.json` (`SHARE_TEXTS_JSON`, `api/share.rs` :43) |
| [api/gifts.rs](../server/src/api/gifts.rs) | gifts (LE2): `POST /api/gifts` (`post_gift` :37), units of a resource to a friend by handle; the friendship, the daily caps, the balance and the replay are one transaction of `Repo::transfer` ([db/economy.rs:474](../server/src/db/economy.rs#L474)); one's own handle, a non-friend and an unknown handle answer the same 404 |
| [meta.rs](../server/src/meta.rs), [api/cards.rs](../server/src/api/cards.rs), [db/achievements.rs](../server/src/db/achievements.rs) | story meta (LM2): the meta index and its rules, achievement conditions evaluated on the server (`met`, `meta.rs` :573), paid gates (`gate` :604, `visible` :637); `POST /api/stories/{storyId}/card` (`post_card`, `api/cards.rs` :48), whose unlocks are stored for display and grant nothing |
| [telegram/gateway.rs](../server/src/telegram/gateway.rs) | `BotGateway` (:54) and `FrankensteinGateway` (built by `from_config` :208 on the base of `TELEGRAM_ENV`, LF2): the Bot API through frankenstein types, no bot framework (principle 6); since LF2 also `savePreparedInlineMessage` and the bot username from `getMe`, cached after the first success (`save_prepared_inline_message` :76, `bot_username` :82) |
| [telegram/webhook.rs](../server/src/telegram/webhook.rs) | `POST /telegram/webhook` (`webhook` :63): the secret check, the decode into frankenstein's `Update`, the lenient payment probe, the dispatch ([Payments](#payments-as-built)). As merged (L9 `d837c8b`): the handler takes the raw `Body` and checks the secret before it reads the body; a `refunded_payment` goes to the revoke (also through the lenient probe), and a text message to the bot commands |
| [telegram/payments.rs](../server/src/telegram/payments.rs), [db/payments.rs](../server/src/db/payments.rs) | the pre-checkout decision and its answer under their deadlines; the grant on `successful_payment`; their SQL in `db/`. As merged (L9 `d837c8b`): the unapplied-charge notice (`notify_unapplied` :176), the admin refund (`admin_refund` :489) and the revoke (`revoke` :460, `Repo::revoke` [db/payments.rs:402](../server/src/db/payments.rs#L402)). As merged (LRF `a93fe54`, RULINGS 130): the automatic refund of an unapplied charge: `after_grant` ([telegram/payments.rs:150](../server/src/telegram/payments.rs#L150): the notice, then the first attempt), `attempt` (:245), the sweep (`sweep_auto_refunds` :407, `run_auto_refund_sweep` :432), the admins' alert (`alert_given_up` :357) and `refund_unrecorded` (:520); their SQL: the row in the grant's transaction (`schedule_auto_refund`, db/payments.rs :705), the claim (`Repo::claim_auto_refund` :515) and the failure write (`Repo::auto_refund_failed` :542) |
| [telegram/commands.rs](../server/src/telegram/commands.rs), [telegram/texts.rs](../server/src/telegram/texts.rs), [telegram/setup.rs](../server/src/telegram/setup.rs) | the bot (L9 `d837c8b`): the commands, answered in private chats only (`on_text`, [commands.rs:82](../server/src/telegram/commands.rs#L82)); the bot texts of `server/locales/bot.{ru,en}.json`, compiled in and bounded (`LangTexts::entries`, texts.rs :161; as merged, LPH `d423cb3`: checked at startup, `startup_check` :375); `server setup`'s one `BotGateway::setup` call (`run`, setup.rs :80); as merged (LRF `a93fe54`): `/refund <charge> <payer>` (`refund_args`, commands.rs :238) and `/paysupport`'s being-refunded state (`charge_text` :168) ([Payments](#payments-as-built)) |
| [api/static_files.rs](../server/src/api/static_files.rs) | the built client next to the API when `STATIC_DIR` is set (L9 `d837c8b`, PP K27): `check` (:219) at startup, before the pool opens (as merged, LPH `d423cb3`: it also refuses a dot-entry, the root's `.vite` directory excepted), and `with_static` (:329), `/assets/*` immutable for a year and everything else `no-cache` ([Paid content](#paid-content-and-the-entitlement-check)); as merged (LBI `fe996a0`, RULINGS 145), `check` reads the client build's id from `build-id.txt` (`BUILD_ID_FILE` :34, `read_build_id` :266) into `BuildId` (:46) and refuses a missing or malformed one (`BuildIdMissing` :177, `BuildIdInvalid` :183) |
| `server/dev` (`server-dev`) | the production router plus `/dev/launch` (dev-signed initData), `/dev/invoices/{slug}` and `/dev/prepared/{id}` (LF2: what a prepared share would send) on a fake gateway and `/dev/simulate-payment` through the production webhook handler (L9: also `/dev/refund`, the admin refund on the fake gateway, and `/dev/refunded-update`, Telegram's `refunded_payment` through the same handler), on a fresh database per launch ([dev/src/lib.rs:37](../server/dev/src/lib.rs#L37)); as merged (LBI `fe996a0`), `POST /dev/build-id` claims a build id that every `/api/` answer then names in `x-build-id`, as a deploy would ([dev/src/deploy.rs:1-5](../server/dev/src/deploy.rs#L1), `stamp` :87); never linked into `server` |
| `server/pgdev` | the local PostgreSQL 18 cluster per port and a database per test; a dependency of `server-dev` and a dev-dependency of `server`, never linked into the `server` binary ([server/Cargo.toml:31-33](../server/Cargo.toml#L31)) |

The configuration's variables, all read in `Config::from_env` (as merged, LPO `90e1226`: through `from_lookup`,
[config.rs:143-184](../server/src/config.rs#L143)):
`BOT_TOKEN`, `WEBHOOK_SECRET`, `TOKEN_KEY` (required secrets); `TELEGRAM_ENV`, `PUBLIC_APP_URL`, `CONTENT_DIR`,
`DATABASE_URL` (required); `TOKEN_TTL_SECS` (default 1800, 900-3600), `INITDATA_MAX_AGE_SECS` (default 86400,
1-86400), `ADMIN_TELEGRAM_IDS`, `STATIC_DIR`, `LISTEN_ADDR` (default `127.0.0.1:8787`), `PRIVACY_OPERATOR_FILE`
(LPO; required under `TELEGRAM_ENV=prod`, [config.rs:177-184](../server/src/config.rs#L177)).

**Startup refuses bad content.** `AppState::new` loads the content and builds the catalog and the gateway before it
opens the database pool, so a refusal opens no pool (as merged, LPO `90e1226`: in the order content, catalog, privacy
policy (`Policy::load`, a refusal is `StartupError::Privacy`), gateway, pool;
[lib.rs:72-94](../server/src/lib.rs#L72)). Tests pin the
refusals: `startup_fails_without_story_index`, `startup_fails_when_first_chapter_paid`,
`startup_fails_when_world_carries_solution`, and for the meta index (LM2) `startup_fails_when_meta_names_unknown_ending`,
`startup_fails_when_meta_too_large` (`server/tests/it/content.rs`). As merged (GM6k `fd62933`, RULINGS 163), the
puzzle index's format and key rules: `content_still_loads_format_1`, `content_puzzle_key_defaults_to_id`,
`content_loads_a_renamed_key`, `content_accepts_an_unknown_type_label`, `content_refuses_a_bad_key_or_format`,
`content_refuses_two_puzzles_one_key`, `content_refuses_key_equal_to_another_live_id` (`server/tests/it/content.rs`);
as merged (GM6s2 `2815340`, RULINGS 176), format 2's per-player load rules: `content_loads_format_2_per_player_puzzle`,
`content_refuses_per_player_below_floor`, `content_refuses_hint_placeholder_of_another_puzzle`,
`content_refuses_max_attempts_without_per_player`, `content_refuses_answer_len_over_64` (`server/tests/it/puzzles.rs`).

As merged (LPH `d423cb3`, RULINGS 106; LPH critique O3, O6), `server serve` runs in the order configuration, bot
texts, `STATIC_DIR`, `AppState::new` ([main.rs:93-130](../server/src/main.rs#L93)). The bot texts come first
(`bot_texts_ok` :38, `texts::startup_check`, [texts.rs:375](../server/src/telegram/texts.rs#L375)): a file that does
not parse refuses the start, and so does a non-empty `drafts` list under `TELEGRAM_ENV=prod`; under `test` the drafts
are a warning. `server setup` checks them too, right after the configuration (`bot_setup` :60). Tests:
`startup_checks_bot_texts_first`, `prod_start_refuses_draft_bot_texts` (`server/tests/it/main.rs`),
`bot_texts_startup_check_refuses_drafts_in_prod` (`server/tests/it/bot.rs`).

## One-way staging

Principle 7: story runtime → staging commands → scene controller and overlay. The scene never reads story state; the
story never touches Pixi.

```mermaid
flowchart LR
    I["ink runtime - story/runner.ts"] -->|line tags| P["parseTags - story/tags.ts"]
    P -->|"ParsedTags: lineId + StagingCommand[]"| G["GameSession - app/game.ts"]
    G -->|"bg, scene, show, hide, cg, wait, face, cam, anim, fx"| SC["SceneController.apply - scene/controller.ts"]
    G -->|"bgm, sfx"| AM["AudioManager.apply - audio/manager.ts"]
    G -->|"lineId, text, choices"| OV["overlay - ui/ view model and components"]
    G -->|"puzzle, explore"| Y["yield router - app/yields.ts"]
```

- **One parser.** `parseTags` ([tags.ts:465](../client/src/story/tags.ts#L465)) serves the story gate and the
  runtime alike; `TAG_KINDS` ([tags.ts:29](../client/src/story/tags.ts#L29)) is the tag list, and
  [dsl-doc.test.ts](../client/src/story/dsl-doc.test.ts) keeps it equal to STAGING-DSL §6.
- **GameSession routes the batch** (as merged, L15a): `splitBatch`
  ([stage-route.ts:40](../client/src/app/stage-route.ts#L40); in `app/game.ts` until SH1 `2db33c3` moved it) splits
  a step's commands into the visual and the audio half (and, since SH1, the session's `think` flag; since SH4, the
  batch's ensure reads the scene's own snapshot and the chapter's manifest, never story state,
  [stage-route.ts:83](../client/src/app/stage-route.ts#L83)); a `yield` goes
  to `app/yields.ts`, the one module that re-enters the story (`runner.enter`, [yields.ts:822](../client/src/app/yields.ts#L822); arch rule `runner-enter`).
- **The consumers are typed by command kind.** The scene controller takes the visual commands (`VisualCommand`,
  [executor.ts:41](../client/src/scene/executor.ts#L41)); the audio manager takes `AudioCommand`, the `bgm` / `sfx`
  kinds ([manager.ts:10](../client/src/audio/manager.ts#L10), `apply` :28).
- **The one channel back.** The world's outcomes reach ink only as declared projection variables (`pz_*`, `it_*`,
  `dc_*`) written before a knot is entered ([project.ts:16](../client/src/explore/project.ts#L16), PZ X2). The story
  gate's playthroughs write them the same way.
- **Literal tags, so the build sees every asset.** The story tool indexes each knot's assets and successors into
  `<ch>.meta.json` for preloading ([STAGING-DSL §8](STAGING-DSL.md#8-assets-and-preloading)).

## Texture memory and the context-loss revive

> What a texture costs, which copies of an image the client keeps, and how the scene comes back after the WebView
> loses its GPU context (as merged, M1 `f1b707d` and M2 `385d52f`; the half tier of a LOW phone as merged, M3c
> `a6365a8`; the design: [MEMORY-PLAN.md](MEMORY-PLAN.md)).

### The memory problem

Principle 4 makes texture memory the budget: steady memory under 150 MB (a target), the registry's caps of 32 MiB
(preload) and 48 MiB (visible). A WebView may drop the WebGL context at any time, most often while the Mini App is in
the background; every GPU texture is gone then, and the scene must come back without drawing a texture that is not on
the new context yet, and without keeping a decoded copy of every image just in case.

### The memory design

- **Smaller files (M1).** The asset tool cuts every `char` and `prop` image to its alpha box plus 2 px, widened to even
  sides ([encode.ts:18](../client/scripts/assets/encode.ts#L18), `encodeImage` :174). The manifest keeps the canvas it
  was cut from (`trim`, [catalog.ts:826](../client/src/story/catalog.ts#L826)), and `textureGeometry`
  ([layout.ts:35-46](../client/src/scene/layout.ts#L35)) gives Pixi the canvas as `orig` and the stored box as `trim`, so
  a trimmed sprite is sized, anchored and drawn where the full image would be. The asset tool refuses odd canvas sides
  and a character whose expressions use different canvases ([manifest.ts:273-297](../client/scripts/assets/manifest.ts#L273)).
- **One CPU copy (M2).** The loader uploads each texture at once to the renderer current at the call. When the upload
  reports a GPU generation, the decoded bitmap is closed, and the fetched file (a Blob, never given a URL) is the only
  CPU copy; on a lost context or a renderer without GL the bitmap stays open
  ([loader.ts:22-87](../client/src/scene/loader.ts#L22)). The caps count the decoded bytes plus the kept file of every
  record, in flight included ([registry.ts:1-20](../client/src/scene/registry.ts#L1)).
- **The revive.** Every upload is tagged with the controller's generation: 1 at mount, one more at each
  `webglcontextrestored` and at each rebuild ([controller.ts:314-355](../client/src/scene/controller.ts#L314)). After a
  change, `registry.revive(gen)` brings every live record to it, one at a time, the records with a visible holder
  first: a kept bitmap is uploaded, a closed one is decoded again from its file. The visible pass has one deadline of
  `REVIVE_DEADLINE_MS` = 3000 ms from its start; a record that fails or is late ends
  ([registry.ts:23-27](../client/src/scene/registry.ts#L23), :208-214, `revive` :861).
- **Frames wait for the visible pass.** The revive flow owns the running revive's AbortController and the frame
  suspension. Each pass that settles calls the executor's `reacquire`, and only the current revive's visible pass
  settling `done` resumes frames ([revive-flow.ts:1-5](../client/src/scene/revive-flow.ts#L1), `createReviveFlow` :34).
  `reacquire` removes at once a view bound to an ended record and takes its slot again; a handle is the record's
  identity, so a view never builds on an ended record's handle
  ([executor.ts:101-111](../client/src/scene/executor.ts#L101), `reacquire` :1276; [registry.ts:192-196](../client/src/scene/registry.ts#L192)).
- **A shot file's frames (SH4, as merged `768fc9d`; shots §5.1 "Ownership").** A drawn face or a figure plane draws a
  frame of the record its slot holds: `registry.frames(h, boxes)` cuts one frame per box over the record's own
  source and keeps it in that record, and refuses a handle that is not the id's current record
  ([registry.ts:927](../client/src/scene/registry.ts#L927)). The record's end disposes its frames before it
  releases its texture (:371-375), with `destroy(false)`, so the source stays the record's (`pixiFrames` :144). A
  rebind re-creates a shot root and its drawn faces from the cached frames, and a reacquire after a failed revive
  redraws them on a new record ([executor.ts:1211](../client/src/scene/executor.ts#L1211), :1276).
- **The step window and the warm form (SH5a, as merged `48489b7`; shots §5.8; RULINGS 311, 314).** Every presented
  step and room batch hands the scene its window from the chapter's look (FEATURE_MAP "Step window"). At the batch's
  swap point the scheduler releases what left the window and admits the rest under the caps: need first, warm files
  fetched and held as their Blobs ([preload.ts:584](../client/src/scene/preload.ts#L584)). A warm record keeps the
  file and no texture, so the tap that shows it decodes with no fetch, and a record whose last non-warm holder leaves
  sheds back to its file in the same turn ([registry.ts:410](../client/src/scene/registry.ts#L410)). A knot hold keeps
  only `char/` images in a chapter with a look ([game.ts:1109](../client/src/app/game.ts#L1109)), so ch1's desk view
  holds 26,712,144 B live at rest, 35,559,504 B before SH5a under the legacy knot hold (RULINGS 304 M-MEM-1, as
  revised by RULINGS 314).
- **The entry previews (SH5b, as merged `f6487fc`; shots §5.8 "Entry at the half tier"; RULINGS 330, 346).** A
  chapter entry on a full-tier session stages its first step from the half files: the stage's takes start as preview
  records ([registry.ts:628-629](../client/src/scene/registry.ts#L628)). After the entry's first swap point the
  scheduler upgrades them one at a time outside its two slots, visible records first
  ([preload.ts:462](../client/src/scene/preload.ts#L462)). Each upgrade reserves its full file and decode beside the
  half, counted in `bytes` and `pending` until it ends ([registry.ts:719](../client/src/scene/registry.ts#L719)), and
  evicts nothing. The loader swaps the full file into the same texture in place
  ([loader.ts:138](../client/src/scene/loader.ts#L138)), so no handle changes. An entry holds at most its window plus
  one half file while it sharpens (`window: an entry holds at most its window plus one half file while it sharpens`,
  `app/window.test.ts`), and no preview is left at rest (`client/e2e/memory.spec.ts`).
- **The rebuild.** A context still lost `CONTEXT_GRACE_MS` = 2000 ms after `activated` gets a new Application on the
  same host in one synchronous block; the registry's textures stay, the executor rebinds the stage, and the revive
  starts under the next generation ([controller.ts:424-461](../client/src/scene/controller.ts#L424)). The stage is sized
  only by the controller's ResizeObserver, not Pixi's `resizeTo`, whose resize could render outside the gate
  ([controller.ts:138-145](../client/src/scene/controller.ts#L138)).
- **The half tier (M3c, as merged `a6365a8`; RULINGS 127).** A LOW Android phone whose largest stage fits loads each
  public scene image's half-size file. The asset tool asks the encoder for a half pair of every public bg, cg and
  prop image and of a char on the 1536-px canvas, never of a gated image or a cover (`halfAsk`,
  [manifest.ts:142](../client/scripts/assets/manifest.ts#L142); the call, [assets.ts:573-574](../client/scripts/assets.ts#L573));
  the half is the 2 × 2 premultiplied mean of the stored file (`halfRgba`, [encode.ts:117](../client/scripts/assets/encode.ts#L117)).
  The public manifest carries it as the entry's `half`, decoded by `halfOf`
  ([catalog.ts:972](../client/src/story/catalog.ts#L972)): bg, cg, char and prop only, exactly half per side, a char's
  only on the 1536-px canvas, its files under its entry's prefix, so a gated image has none until M3s. As merged (M3s
  `a5f887b`, RULINGS 151), a gated scene image has its half too, a gated file beside its full one under its entry's
  prefix ([manifest.ts:438](../client/scripts/assets/manifest.ts#L438)), which the server indexes under the chapter's
  product and serves from `/api/assets/` only after the entitlement check
  ([content.rs:862](../server/src/content.rs#L862)); only a cover has none. At mount the
  controller fixes the session's tier: `half` only on a LOW device whose largest reachable stage passes `halfFits`,
  so no half is drawn above its stored px (`tierFor` over `stageBound(screenSize(), host)`,
  [controller.ts:502-503](../client/src/scene/controller.ts#L502); [layout.ts:56-82](../client/src/scene/layout.ts#L56)).
  The registry resolves each record's file once, the entry's half where it has one, and the record's geometry keeps
  the full file's canvas, orig and trim at resolution 0.5, so the layout does not depend on the tier
  ([registry.ts:629](../client/src/scene/registry.ts#L629), :509; `textureGeometry`, [layout.ts:37](../client/src/scene/layout.ts#L37)).
  A resize past the bound demotes the registry once: records started later load the full file, and live and
  in-flight ones keep theirs until they end ([controller.ts:329-334](../client/src/scene/controller.ts#L329); `demote`,
  [registry.ts:923](../client/src/scene/registry.ts#L923)). The flow is drawn below the revive's.

```mermaid
sequenceDiagram
    participant W as WebView canvas
    participant C as SceneController (scene/controller.ts)
    participant F as ReviveFlow (scene/revive-flow.ts)
    participant R as AssetRegistry (scene/registry.ts)
    participant L as Decoded record (scene/loader.ts)
    participant E as Executor (scene/executor.ts)
    W->>C: webglcontextlost (onLost)
    C->>F: lost() - abort the revive, suspend frames
    alt Pixi restores the context
        W->>C: webglcontextrestored (onRestored, gen + 1)
    else still lost CONTEXT_GRACE_MS after activated
        C->>C: rebuild - new Application, E.rebind, gen + 1
    end
    C->>F: start(gen), or lost() while deactivated
    F->>R: revive(gen, signal)
    R->>L: revive(gen) per record, visible holders first
    L-->>R: uploaded, or failed / late (record ends)
    R-->>F: visible pass settles
    F->>E: reacquire() - drop views of ended records
    F->>C: resume() - frames draw again (visible pass done)
    R-->>F: all settles
    F->>E: reacquire()
```

Participants: `onLost` / `onRestored` ([controller.ts:337-355](../client/src/scene/controller.ts#L337)), `rebuild`
(:429), `activated` (:463), the flow's `lost` / `start` ([revive-flow.ts:44-78](../client/src/scene/revive-flow.ts#L44)),
`AssetRegistry.revive` ([registry.ts:861](../client/src/scene/registry.ts#L861)), `Decoded.revive`
([loader.ts:103-197](../client/src/scene/loader.ts#L103)), `Executor.rebind` / `reacquire`
([executor.ts:1211](../client/src/scene/executor.ts#L1211), :1276).

The half tier's path (as merged, M3c `a6365a8`):

```mermaid
flowchart LR
    U["asset tool: halfAsk, encodeImage"] -->|"half pair, public images"| M["public manifest: entry.half"]
    M -->|"halfOf decodes"| R["AssetRegistry: tier, one file per record"]
    C["controller mount: tierFor"] -->|"tier"| R
    Z["controller onResize: halfFits fails"] -->|"demote, once"| R
    R -->|"geometry at resolution 0.5"| L["loader: the texture on the full canvas"]
```

Participants: `halfAsk` ([manifest.ts:142](../client/scripts/assets/manifest.ts#L142)), `encodeImage`
([encode.ts:174](../client/scripts/assets/encode.ts#L174)), `halfOf` ([catalog.ts:972](../client/src/story/catalog.ts#L972)),
`createAssetRegistry` and its `tier` ([registry.ts:305](../client/src/scene/registry.ts#L305)), `tierFor`
([layout.ts:80](../client/src/scene/layout.ts#L80), called at [controller.ts:503](../client/src/scene/controller.ts#L503)),
`onResize` ([controller.ts:322](../client/src/scene/controller.ts#L322)), the record's geometry
([registry.ts:509](../client/src/scene/registry.ts#L509)).

### Memory decisions

- **Keep the encoded file, not the bitmap** (MEMORY-PLAN 4.A): a file is a fraction of its decoded size, and a revive
  pays one decode per image instead of a second network fetch.
- **Trim on the canvas, not a new layout** (MEMORY-PLAN 4.B): the manifest and the texture keep the canvas, so the
  staging DSL and the layout code see the same image sizes as before; even sides keep a later halving exact (the half
  tier, M3c, planned; only the hook exists: `TextureGeometry.resolution`, always 1 on `385d52f`; as merged, M3c
  `a6365a8`: the half files are exact halves at resolution 0.5).
- **One tier per session, demoted one way** (MEMORY-PLAN 4.C; as merged, M3c `a6365a8`): the tier is fixed at mount
  from the largest stage the screen allows, so a session never swaps files under a live record; a resize past the
  bound only stops new half loads, and the layout is the same on both tiers. As merged, SH5b `f6487fc` (shots §5.8
  "Entry at the half tier"; RULINGS 330, 346): the tier still stays fixed per session, but a full-tier session's
  chapter entry starts its preview records at their half files and upgrades each live record to its full file in
  place, the same handle and texture, with a new held Blob and a source resized at the stored box
  ([registry.ts:185](../client/src/scene/registry.ts#L185), [loader.ts:138](../client/src/scene/loader.ts#L138); the
  entry previews bullet of [The memory design](#the-memory-design)). "Never swaps" holds only for the tier demotion: a
  per-record cache of a file's size or held Blob taken at acquire goes stale at an upgrade.
- **One owner per revive** (MEMORY-PLAN section 8): the next `start`, `lost()`, `abort()` or `destroy()` aborts the
  current one, so two revives never interleave.

### Memory failure modes

| Case | Behaviour | Pinned by |
|---|---|---|
| the context is lost and restored | the generation moves, the revive runs, frames resume when the visible pass is done | `revive-flow: frames resume when the visible pass is done, before all settles`; e2e `context loss recovers` |
| the context is never restored | after the grace on `activated`, the stage is rebuilt and the textures revived on it | e2e `scene: an unrestored context loss rebuilds the stage` |
| a record's revive fails or misses the deadline | the record ends; its views leave the stage, and the next batch acquires the image again | `registry: a revive that misses its deadline ends the record`, e2e `scene: a failed revive re-acquires the visual` |
| a loss while deactivated | the revive waits for `activated` (the generation still moves) | [controller.ts:344-355](../client/src/scene/controller.ts#L344) |
| a decoded bitmap after its upload | closed; the e2e finds none open | e2e `scene: no decoded bitmap outlives its upload` |
| a LOW phone's host grows past the half bound (as merged, M3c `a6365a8`) | the registry is demoted once: later records load the full files, what is on stage keeps its half until released | `registry: demote applies to records started later`, e2e `scene: a resize past the half bound loads full-tier files` |
| the WebView reports no usable screen size (M3c) | the stage is unbounded, so the tier is full | `layout: a screen of unknown size takes the full tier` |
| an entry preview's upgrade fails or misses `UPGRADE_DEADLINE_MS` (as merged, SH5b `f6487fc`) | the half stays live, the try counts and no frame is requested; after `UPGRADE_TRIES` (3) failed tries the record is not upgraded again ([registry.ts:652](../client/src/scene/registry.ts#L652), :670-677, :711-715); an upgrade refused over the cap (`over-cap`, :660-661) leaves the half and counts no try | `registry: a failed upgrade leaves the half live, and three failures end the tries`, `registry: an upgrade not answered within 20 s ends as a failed try and leaves the half live` |

`SceneController.stats()` reports the counters behind these (`SceneStats`,
[controller.ts:30-63](../client/src/scene/controller.ts#L30)), and under `__TG_MOCK__` the debug hook forces a
`'restorable'` or a `'hard'` loss (`debugForceContextLoss`, :93-98).

### Memory trade-offs

A revive costs one decode per live image, visible ones first; on a slow phone the visible pass may take most of its
3000 ms, and the latency is not measured on a device yet (MEMORY-PLAN section 14). A host resize during a rebuild's
`app.init` leaves the new renderer at the old size until the next resize (M2 review r1 M1, carried to the next holder of
`controller.ts`). The half tier (M3c `a6365a8`) costs a half pair (AVIF and WebP) per public scene image in
`dist/assets/` (as merged, M3s `a5f887b`: and per gated one in `server/content/assets/`), and it is verified under
emulation only: there is no LOW Android test device (owner Q54).

## Build outputs and the gates

`npm --prefix client run build` is `story → assets → vite build → budget.ts → scan-dist.ts`
([package.json](../client/package.json)). The story tool writes only on a run with no error, and deletes stale
outputs first ([story.ts:820-884](../client/scripts/story.ts#L820)). As merged (SH2 `7f45dee`), a shot pass runs
after the playthroughs when `story/shots.json` exists ([story.ts:795-815](../client/scripts/story.ts#L795)).

| Output | Written by | Read by | Public |
|---|---|---|---|
| `client/src/story-gen/catalog.json`, `free/<ch>.{story,meta,en,world}.json`, `free/<ch>.assets.json`, `covers.json` | story tool, asset tool | `app/boot.ts` (the catalog and the covers by URL) and the chapter loader `story/chapters.ts` in the engine chunk (the free files by URL), both since L15a | yes |
| `client/public/assets/` | asset tool (as merged, M3c `a6365a8`: also the half pair of each public scene image, `<ns>-<id parts>-half-<hash8>.<ext>`, `assetFileName`, [manifest.ts:338](../client/scripts/assets/manifest.ts#L338)) | `vite build` copies it to `dist/assets/` | yes |
| `client/dist/build-id.txt` (as merged, LBI `fe996a0`, RULINGS 145) | `vite build` (`buildIdFile`, [build-id.ts:69](../client/scripts/build-id.ts#L69)): the id the bundle compiles in as `__BUILD_ID__`, a hash of the build's inputs ([build-id.ts:44](../client/scripts/build-id.ts#L44)) | `server serve` (`static_files::check`, then the `x-build-id` of every response of an `/api` route) | yes |
| `server/content/chapters/<ch>/{story,meta,en,world,assets}.json` | story tool, asset tool | `ContentStore` → `GET /api/chapters/{id}` | no |
| `server/content/assets/` | asset tool (as merged, M3s `a5f887b`: also the half pair of each gated scene image) | `GET /api/assets/{file}` | no |
| `server/content/stories.json` | story tool | `ContentStore` (the story index) | no |
| `server/content/puzzles/<ch>.json` | story tool | `ContentStore` (solutions and hint texts) | no |
| `server/content/meta.json` | story tool | `ContentStore` (the meta index, `load_meta`, [content.rs:907](../server/src/content.rs#L907)) → `POST /api/stories/{storyId}/card` and the stats choice vocabulary | no |
| `server/content/build/{fingerprints.lines,usage,fingerprints.assets}.json` | story tool, asset tool | asset tool, `budget.ts`, `scan-dist.ts` | no |
| `server/content/build/shots.json` (as merged, SH2 `7f45dee`, RULINGS 207; only when `story/shots.json` exists) | story tool (`shotUsage`, [usage.ts:77](../client/scripts/story/shots/usage.ts#L77)): the shots each chapter shows with their needs, every shot file it needs, each window's lookahead and entry alternatives | nobody yet (the asset tool from the shots plan's SH3a); no server route reads `build/` | no |
| `target/art-list/<story>.{md,json}` (as merged, SH2 `7f45dee`; `npm --prefix client run story -- --art-list`) | story tool (`artList`, [art-list.ts:129](../client/scripts/story/shots/art-list.ts#L129)) | the owner (what to draw) | no |

Paths: `OUT` ([emit.ts:37](../client/scripts/story/emit.ts#L37)) and `ASSET_OUT`
([manifest.ts:47](../client/scripts/assets/manifest.ts#L47)); since SH2, `SHOT_USAGE_FILE` and `ART_LIST_DIR`
(the two rows above). All are git-ignored.

**Budgets** (principle 4) are enforced by `budget.ts`, `LIMITS` ([budget.ts:156](../client/scripts/budget.ts#L156)),
among them: the entry chunk ≤ 40 KB brotli, the engine closure ≤ 230 KB, the JS before the first line ≤ 270 KB,
all JS ≤ 290 KB brotli (as merged, LMI `3e35a7b`: 305 KB), each lazy chunk (LP2: a puzzle type ≤ 8 KB, the
puzzle host ≤ 10 KB, the explore UI ≤ 16 KB brotli; as merged, LMI `3e35a7b`, RULINGS 105: the meta UI ≤ 14 KB and the
meta controller ≤ 5 KB, whose JS the JS before the first line counts, since boot requests it beside the engine; as
merged, LEL `7b37278` (RULINGS 141): the meta controller ≤ 6 KB, [budget.ts:164](../client/scripts/budget.ts#L164); as
merged, LFL `cec347c` (RULINGS 149, 155): the JS before the first line is the entry and engine closures again, without
the controller's chunk, which boot's gate no longer requests on the path that taps Start as soon as it can
([budget.ts:638-675](../client/scripts/budget.ts#L638))), a chapter's story JSON ≤ 35 KB brotli, a knot's
working set (its stage plus its successors' assets, decoded; as merged, M2 `385d52f`: plus each image's larger file,
the copy the client keeps, and the limit is the registry's steady cap, [budget.ts:181-182](../client/scripts/budget.ts#L181))
≤ 32 MiB, images at most 2048 px a side, judged on the canvas of a trimmed file (M1). At run time the
texture registry holds a steady cap of 32 MiB and a hard cap of 48 MiB, counting decoded bytes and kept files (M2)
([registry.ts:17-20](../client/src/scene/registry.ts#L17)), and the render resolution is at most 2× DPR, 1× on a
low-performance Android ([layout.ts:20-26](../client/src/scene/layout.ts#L20)). A row whose input does not exist
prints `PENDING`; since L15a none does: the engine root `ENGINE_SRC` and the lazy chunks' importer `YIELDS_SRC` exist
([budget.ts:206-208](../client/scripts/budget.ts#L206)), and since LMI the meta rows' importer `META_SRC` (:210). As merged (lever X `597dded`, RULINGS 201, 206, 208),
the first-line and engine rows count the union of the JS chunks any supported WebView requests automatically
before its first line (every Pixi renderer facade included); a chunk no path requests leaves the rows, so the
engine walk stops at Pixi's environment chunks only while the scene skips them (the basis note,
[budget.ts:548-567](../client/scripts/budget.ts#L548)), `firstLineFiles` (:581) names those rows' files for the
e2e, and all JS ≤ 365 KB (`allJsBr` :169, RULINGS 201 QS3). Measured at the L15a merge (RULINGS 85): 82 rows, 82 PASS,
0 PENDING; the entry closure 29.1 / 40.0 KB br, the engine closure 214.5 / 230.0, the JS before the first line
243.6 / 270.0. LMD's merge read the entry closure at 29.1 KB again (RULINGS 87). Measured at the LMI merge (RULINGS
110): 84 rows, 0 PENDING; the entry closure 38.9 / 40.0 KB br, the engine closure 212.2 / 230.0, the JS before the
first line 255.1 / 270.0 with the meta controller counted, the meta UI 6.4 / 14.0, the meta controller 4.0 / 5.0, all
JS 267.6 / 305. Measured at the M2 merge (RULINGS 117): 84 rows, 84 PASS, 0 PENDING; the entry closure 38.9 / 40.0 KB br,
the meta controller 4.0 / 5.0. M1's merge moved the busiest knot-set from 30.4 to 27.3 MiB of 32 (merge `f1b707d`). As merged (M3c `a6365a8`,
RULINGS 127): each image row also checks the entry's half files, present, within the kind's file limits, and
counting no more than the full file (I2; [budget.ts:939-955](../client/scripts/budget.ts#L939)), and each chapter
gets a `transfer <ch> (half)` row, what a LOW phone on the half tier downloads (`transferHalfRow`, :1255). Measured at
the M3c merge: 88 rows, 88 PASS, 0 PENDING; the entry closure 39.4 / 40.0 KB br. After LEL (RULINGS 142) the entry
closure read 38.4 / 40.0 KB br. Measured on main `3c62a86` (RULINGS 158; 88 rows, 88 PASS at the LRB merge check,
RULINGS 157): the entry closure 38,988 B br of 40,000, the engine closure 215,087 of 230,000, the JS before the first
line 254,075 of 270,000, the meta controller chunk 5,242 of 6,000, all JS 272,130 of 305,000. As merged, L1 `eec24fe`
(RULINGS 159): the entry closure 37,338 B br of 40,000 (the save service left the entry), the JS before the first line
254,288. As merged, GM1a `ef8b4dc` (RULINGS 165): the entry closure 37,278 B, the engine closure 215,042 B
(-1,908), the JS before the first line 252,320 B (-1,968), the explore-ui chunk 7,205 B of 16,000 (the rules half
moved in, from 4,912), all JS 272,628 B; as merged, GM1b `03a00bc` (RULINGS 171): the entry closure 37,245 B, the
engine closure 215,004 B, the JS before the first line 252,249 B, the explore-ui chunk 8,395 B of 16,000 (+1,190),
all JS 273,747 B of 305,000; 88 rows, 88 PASS at both merges (exact bytes, main before -> after each merge). As
merged, GM6s2 `2815340` (RULINGS 176, 178): the entry closure 37,562 B (+317 against its +90 term, a PASS by engine
§3.5's rule), the engine closure 214,987 B, the JS before the first line 252,549 B, the meta controller chunk 5,252 B,
all JS 274,076 B; as merged, GM1c `8c2fa03` (RULINGS 178): the entry closure 37,502 B, the engine closure 215,003 B,
the JS before the first line 252,505 B, the puzzle-type chunk 1,618 B (from 1,639), all JS 273,999 B; as merged, GM2a
`9b4fd25` (RULINGS 181): the entry closure 37,509 B of 40,000, the engine closure 215,336 B (+333), the JS before the
first line 252,845 B, the explore-ui chunk 8,395 B of 16,000, all JS 274,362 B of 305,000; 88 rows, 88 PASS at each of
the three merges. As merged since (RULINGS 183, 186, 188, 190, 193, 196): GM1d `794181b`, the entry closure 37,541 B
(+42, churn), the engine closure 215,472 B (+96, churn), all JS 274,557 B; GM3w `508bd36`, the entry 37,527 B, the
engine closure 215,552 B (+15.8 B, the mean of 4 builds per tree; one build read +80), all JS 274,638 B, and from
here on a row judged against a bound tighter than the chunk-hash churn uses the mean of at least 4 builds per tree;
GM6a `23e1d31`, the engine closure 216,015.8 B (mean, +469.6 against its +0.15 KB term), all JS 275,064 B; GM2b
`1782d6d`, the engine closure +400 B (term +0.1 KB), and on the merged tree the entry 37,484 B, the engine closure
216,492 B, all JS 275,580 B, with the worlds emitted compact (ch1 1,719 -> 1,506 B br); GM3m `a3f0678`, no row moves
(nothing mounted); GM3c `837b1ed`, the entry closure 37,486 B, the engine closure 217,077 B (+605 against its +0.2 KB
term), the JS before the first line 254,563 B, the explore-ui chunk 8,433 B, all JS 276,107 B of 305,000
(deterministic over 4 builds per tree); 88 rows, 88 PASS at the merge checks of GM1d, GM3w, GM2b, GM3m and GM3c.
As merged since (RULINGS 201, 204, 207, 208): SH1 `2db33c3`, the engine closure +510 B against its +0.3 KB term
(mean of 4 builds per tree); GM3s `65e10ad`, a new lazy row, the cue stage ≤ 8.5 KB brotli with a review trigger at
7.5 KB (`cueStageChunkBr`, [budget.ts:165](../client/scripts/budget.ts#L165); 6,108 B at the merge), the entry
closure 37,691 B, the engine closure 218,828 B (+1,241, accepted as GM3s's measured term on condition that lever X
came next), all JS 284,494 B; SH2 `7f45dee`, no row moves; lever X `597dded`, the engine closure 204,596 B
(-14,232), the JS before the first line 242,304 B (-14,215), the first-load rows -14,202 B each, all JS 284,488 B of
365,000; 89 rows, 89 PASS at the GM3s, SH2 and X merge checks. As merged since (RULINGS 213, 216, 217, 219, 224):
lever P `3d120bc`, a new lazy row, the purchase flow ≤ 2.0 KB brotli with a review trigger at 1.75 KB
(`purchaseFlowChunkBr`, [budget.ts:166](../client/scripts/budget.ts#L166); 1,468 B at the merge), the engine chunk
without `purchase/flow.ts`: the engine closure 203,122 B (-1,474), the JS before the first line 240,852 B; the path
rule's named exceptions, where a lazy root is requested before a first line, gain the purchase flow (a Continue into a
saved start of an unowned paid chapter, its paywall the session's first screen, D11; a locked chapter row on Home,
D17; a pack Buy on Home), bounded by its own row (the basis note,
[budget.ts:548-563](../client/scripts/budget.ts#L548)); GM3 `7082a35`, the engine closure 204,314 B (+1,192, accepted
as structural, the condition decoder's first runtime use), the explore-ui chunk 10,317 B, all JS 287,082 B; GM3k
`3131844`, type-only, its identity proved on pinned-id builds (RULINGS 219); the recovery lane `8e099ee` (Q60), the
engine as one chunk that waits on no other (G2 and G3, `pixiChunking`,
[vite.config.ts:52](../client/vite.config.ts#L52): Pixi's environment modules load empty while the scene skips them,
and the renderer chooser's three `import()`s become static imports, so the basis note's environment chunks are empty
and its renderer facades absent), the entry closure 38,219 B (+504), the engine closure 195,956 B (-8,373), the JS
before the first line 234,175 B, all JS 264,905 B in 14 files (from 23), one stylesheet; 90 rows, 90 PASS at the P,
GM3 and recovery merge checks. As merged since (RULINGS 228, 230, 234, 236; 4 builds per tree): E6 `d5e04ef`, the
engine closure 196,067 B (+111, a deterministic delta of the two trees), all JS 265,054 B; GM3u `33b4f8d`, the entry
closure 38,267 B (+27), the engine closure 196,460 B (+393), the explore-ui chunk 9,716 B (+348), all JS 265,837 B;
lever O5 `9a0ae2d`, a new lazy row, the in-play overlays ≤ 3.0 KB brotli (`overlaysChunkBr`,
[budget.ts:167](../client/scripts/budget.ts#L167), the family :277; 2,498 B at the merge), the engine chunk without the
Menu, the Backlog, the Settings and the Saves screen: the entry closure 38,296 B (+72, mean of 4), the engine closure
194,518 B (-1,939), the JS before the first line 232,814 B (-1,867), all JS 266,440 B in 15 files; the path rule's named exceptions gain the overlays (requested before a first line only by a
Menu or Backlog tap, the basis note, [budget.ts:548-563](../client/scripts/budget.ts#L548)); the Q64 fix `d820803`,
the entry closure 38,309 B (+13), the engine closure 194,715 B (+197), all JS 266,611 B; 91 rows, 91 PASS at the
Q64 merge check (90 at E6 and GM3u). As merged since (RULINGS 243, 251, 256, 258, 262, 265, 269): GM3p `d478384`, the
engine closure 195,430 B (+715), the puzzle-host chunk 2,541 B (+603), the explore-ui chunk 9,805 B (the shared
`cues/root.ts` chunk), all JS 267,725 B; the Q67 fix `4f26e8e`, the entry closure 38,416 B (+94), the cue-stage chunk
6,072 B; SH3a `efd3811`, the entry closure 38,548 B (+132), the engine closure 195,597 B (hashed names only); GM3b
`ac9cab1`, the engine closure 196,405 B (+808), the explore-ui chunk 10,448 B (+644), all JS 269,631 B; SH3b `e1e7637`,
a build tool only, every earlier row byte-equal, and the step-model rows of shots §3.4 and §5.11: `step-window <ch>`
and `step-window <ch>/r:<room>` against the registry's steady cap (32 MiB, `stepWindow`,
[budget.ts:183](../client/scripts/budget.ts#L183); ch1 23.4 MiB at the merge), `entry step images <ch>` (279,000 B,
:185; ch1 22.8 KB), the plate rule (`PLATE` :318), the loop atlas's own file limits (:198), a room-set that counts the
room's sheet, the scene-motion family PENDING until `src/scene/motion/index.ts` exists (8.0 KB, :168) and `transfer`
12 MB (:178), so 104 rows, 103 PASS, 1 PENDING; a failing step-window or entry row reports the shot lint code
`budget/step-window` or `budget/entry-step` ([lint.ts:28-30](../client/scripts/story/shots/lint.ts#L28)), which
`story` never reports; the Q69 fix `99be5c1`, the entry closure 38,517 B, the engine closure 196,515 B (+110);
per-player GM6t `a064399`, the entry closure 39,179 B of 40,000 (+662), the engine closure 196,541 B (+26, build-id
name churn, module identity unchanged), the JS before the first line 235,720 B, all JS 270,402 B. RULINGS 206's ±15 B
engine noise holds within one build id; across a build-id change the engine row is judged by module identity
([build-id.ts:23](../client/scripts/build-id.ts#L23) hashes every file under `src`, `vite-plugins` and `public`;
RULINGS 269). As merged since (RULINGS 277, 284, 290): SH3c `5d3013e`, a build tool only, every row equal (the
catalog has no `src` entry yet); GM4g `56cc302`, each `room-set` row counts the transition pair, img(R) + props(R)
+ max(the largest neighbour room's img + props, the largest close-up), every image through `imgIds`
([budget.ts:1169-1201](../client/scripts/budget.ts#L1169); a room move is a dip under black, and both rooms' sets
are resident while its batch loads), and notes how many neighbours preload, a report and never a FAIL
(`neighbourPreloads` :1126: the room arrived from and the neighbours it shares with R live first; no characters;
a wider keep set is not modelled), from the usage rooms' `neighbourRooms` in exit order
([emit.ts:362](../client/scripts/story/emit.ts#L362)); `first-load <ch>` counts the head chapter's public world and
its en table (RULINGS 172; `firstLoadRows` [budget.ts:1272](../client/scripts/budget.ts#L1272); ch1 288,371 B, ch3 267,886 B), every JS row unchanged; SH4
`768fc9d`, ch4 a shot chapter on the step model (its knot-set rows gone, its image rows the two shots' eight
files), the engine closure 200,969 B (+4,428; R 2.306), the entry closure 39,164 B, the JS before the first line
240,133 B, all JS 274,810 B, first-load ch1 292,787 B and ch3 272,302 B; 109 rows, 108 PASS, 1 PENDING. At
`48489b7` (GM4, GM4u, GM5 and SH5a; RULINGS 292, 304, 312, 314) the usage `neighbourRooms` come from `nearRooms`, a
view's parent first ([emit.ts:371](../client/scripts/story/emit.ts#L371)), and the rows read the engine closure
204,295 B, the entry closure 39,163 B, the JS before the first line 243,458 B, explore-ui 11,385 B, all JS 279,097 B,
first-load ch1 296,301 B and ch3 275,661 B; 112 rows, 111 PASS, 1 PENDING; R 2.603 (n 18). At `f6487fc` (GM5q, GM5f,
GM7r and SH5b; RULINGS 326, 334, 341, 346) the rows read the engine closure 206,708 B, the entry closure 39,172 B, the
JS before the first line 245,880 B, explore-ui 12,593 B (GM5q +485, GM5f +723; equal by module identity at GM7r's and
SH5b's merges), puzzle-host 2,652 B (GM7r +112), all JS 282,846 B, first-load ch1 298,732 B and ch3 278,092 B; 112
rows, 111 PASS, 0 FAIL, 1 PENDING; R 2.551 (n 21).
FEATURE_MAP's build row has each lane's before -> after.

**The leak scan** `scan-dist.ts` reads every file of `client/dist/` (with decoded `data:` URIs) against fingerprint
sections built from the sources: paid line IDs and paid line text samples, paid en values, paid asset names and
bytes, hint IDs and texts, paid world IDs and texts, and the meta texts. The trade-offs below give each section's
floor. Each section fails closed when its fingerprints
are empty while its sources exist ([scan-dist.ts:1-9](../client/scripts/scan-dist.ts#L1)).
As merged (LFU2 `6d77329`, RULINGS 103): a text is also found inside a JS string literal (Vite's `JSON.parse("…")` of
a JSON module, a requoted literal), in its escaped forms: each base needle and its JSON escape as the body of a `"`,
`'` and backtick literal, with quotes, backslashes, backticks and `${` escaped. The forms are computed once per
section, from the base needles only; such a finding is `via: 'js-string'`
([scan-dist.ts:172-206](../client/scripts/scan-dist.ts#L172)). As merged (the recovery lane `8e099ee`, Q60 R1, G2, G3),
the scan also checks the build's shape (`scanBuild`, [scan-dist.ts:299](../client/scripts/scan-dist.ts#L299)): no
preload list and no modulepreload link (WebKit keeps a failed preload past a reload), one stylesheet linked from
`index.html`, and at most `ENGINE_STATIC_DEPS_MAX` (0, :265) static JS chunks behind the engine's import; the dev
canaries gain `__novelChunks`. As merged (SH3a `efd3811`, RULINGS 254, 256; shots §4.5): with a shot list the scan
reads `build/shots.json` (a missing or undecodable one fails `shots-missing`, `shotUsageOf`,
[scan-dist.ts:449](../client/scripts/scan-dist.ts#L449)), the paid-only shot files join the paid asset names
(`paidOnlyAssets` :440), and every file of a shot-family name in dist must parse by its namespace's segments and be a
public id, else a `paid-asset` finding `via: 'whitelist'` (`scanShotFiles` :406); the dev canaries gain the cue
stage's debug attributes `data-cues-played`, `data-cue-orphans` and `data-cue-fallbacks` (:91-94).

The CLAUDE.md gate commands map to: `check` (svelte-check, tsc), `test` (vitest projects `unit` and `dom`,
[vite.config.ts:117-141](../client/vite.config.ts#L117); Changed by RULINGS 229, 232 (as of `0b91acc`; docs lane `docs-errata-15`, group A):
with Vitest's on-disk module cache off, `fsModuleCache: false` in the root `test` block,
[vite.config.ts:121](../client/vite.config.ts#L121), which both projects inherit through `extends: true`, since a
cached transform of a test file that uses `import.meta.glob<T>(` hid a newly added source file from a glob-driven
gate, Q63, the fix `340f47c`; pinned by `test gate: no project reuses a cached module transform`,
[test-config.test.ts:31](../client/scripts/test-config.test.ts#L31)), `story`, `build` (above), `e2e` (Playwright on
`server-dev` and the mock), and the cargo `fmt`, `clippy` and `test` over the workspace (`server`, `server/dev`,
`server/pgdev`).

## Paid content and the entitlement check

Principle 0: paid content never reaches a client without an entitlement. It is held at three points.

**1. The build routes it.** A paid chapter's story, meta, en table and world go only to
`server/content/chapters/<ch>/` (`chapterPaths`, [emit.ts:151-157](../client/scripts/story/emit.ts#L151)). An asset
only paid chapters use goes only to `server/content/assets/` (`ASSET_OUT.paid`). Puzzle solutions and hint texts go
only to `server/content/puzzles/<ch>.json`; the public world carries the hint count (`toPublic`,
[decode.ts:855](../client/src/world/decode.ts#L855)); as merged (GM1d `794181b`), a source puzzle's `clues` stay in
the source world (`emit: clues never reach the public world`). Meta texts go only to `server/content/meta.json`.
As merged (SH4 `768fc9d`, RULINGS 290), ch4's lamp room ships the first gated shot files: its two shots' plates,
sheets, face and talk files, full and half, AVIF and WebP, only under `server/content/assets/` (the paid asset
fingerprints 21 -> 49 files), served by `get_asset` after the entitlement check below; the public assets and
`story-gen/` stay byte-identical.

**2. The build checks the route.**
- The source lint rejects a free chapter that includes a paid chapter's file (`ink/include`,
  [lint.ts:696](../client/scripts/story/lint.ts#L696)).
- After the write, the story tool reads `story-gen/` back for paid line IDs, text samples and hint texts
  (`paid/leak`, `paidLeak` [emit.ts:501](../client/scripts/story/emit.ts#L501)).
- The leak scan checks `dist/` (above). Vite inlines nothing as a `data:` URI and ships no source map
  ([vite.config.ts:102-108](../client/vite.config.ts#L102)). The dev server refuses a `/@fs` path to paid content
  (`dev server refuses /@fs paid path`, [dev-server.test.ts](../client/scripts/dev-server.test.ts)).
- As merged (SH3c `5d3013e`, RULINGS 271, 273, 277; fix3 I-0), the asset tool checks its own plan before it sweeps
  or writes anything: a file planned under `server/content/assets/` with the bytes of one planned under
  `client/public/assets/` stops the run, exit 1, with nothing written (`gatedCopies`,
  [manifest.ts:305](../client/scripts/assets/manifest.ts#L305); the guard, [assets.ts:607-613](../client/scripts/assets.ts#L607)).
  A gated `src` file carries its own id as EXIF ImageDescription (+281 B AVIF and +232 to +250 B WebP per file;
  `mark: tier === 'paid'`, :552), so its bytes differ from every public file's. A motion state is masked per file,
  so a public sheet or face file does not change with a paid-only expression; per-file masking leaves three
  residual channels, accepted: the shared silent / speaking file, the plateau union and the speech union (RULINGS
  273).

**3. The server checks the entitlement per request.**

```mermaid
sequenceDiagram
    participant C as Client (Mini App)
    participant S as Server (axum)
    participant DB as PostgreSQL
    C->>S: GET /api/chapters/{chapterId} (Authorization: Bearer)
    S->>S: AuthUser - verify_token
    S->>S: ContentStore::paid_chapter (free, unknown or malformed: 404)
    S->>DB: Repo::is_entitled(user, product)
    alt no entitlement row
        S-->>C: 403 not_entitled
    else entitled
        S-->>C: 200 story, meta, assets, en, world (Cache-Control: private, no-store)
    end
```

Participants: `get_chapter` ([api/content.rs:29-56](../server/src/api/content.rs#L29)), `AuthUser`
([extract.rs:20](../server/src/auth/extract.rs#L20)), `paid_chapter` ([content.rs:319](../server/src/content.rs#L319)),
`is_entitled` ([db/entitlements.rs:23](../server/src/db/entitlements.rs#L23)). `GET /api/assets/{file}`
(`get_asset` :59) does the same per file: a name the asset index lacks is 404 (the name is a map key, never a path),
and the file is served only if the user owns one of the chapter products whose manifests name it. As merged (M3s
`a5f887b`, RULINGS 151), the asset index holds each gated image's half-tier files under the same rules as its full
file, and a manifest-named file missing on disk, a half included, refuses the start
([content.rs:846-890](../server/src/content.rs#L846); `startup failed: content: cannot read <path>: ...`, :39). So the
server binary and the build's `server/content/` ship together: a pre-M3s binary given newer content answers 404 for a
gated half on a LOW phone, where that image fails and nothing leaks (M3s cut Q4;
[deploy.md "Steps"](runbooks/deploy.md#steps), step 1). M3s's tests: `half_tier_gated_file_served_to_owner`,
`half_tier_gated_file_refused_without_entitlement`, `startup_fails_when_manifest_names_missing_half_file`. The tests:
`paid_chapter_403_without_entitlement`, `paid_chapter_200_with_entitlement`, `free_chapter_not_served_by_api`,
`asset_path_traversal_404`, `paid_responses_private_no_store` (`server/tests/it/content.rs`). Puzzle attempts and
hint texts of a paid chapter need the same entitlement (`attempt_paid_chapter_403_without_entitlement`,
`hint_text_403_for_unowned_paid_chapter`, `server/tests/it/puzzles.rs`); so do a paid chapter's per-player values
(as merged, GM6s2 `2815340`: `GET /api/chapters/{id}/values` issues or reads no value before the entitlement row,
`player_values`, [puzzles/mod.rs:161](../server/src/puzzles/mod.rs#L161), `values_paid_chapter_403_without_entitlement`)
and a restart (`POST /api/puzzles/{id}/restart` checks the entitlement before the per-player 404, `post_restart`,
[api/puzzles.rs:89](../server/src/api/puzzles.rs#L89), `restart_paid_puzzle_403_before_per_player_404`, both in
`server/tests/it/puzzles.rs`); and so does a hint bought from the balance (LE1, `hint_spend_paid_chapter_403`,
`server/tests/it/economy.rs`). The completion card (LM2) lists an ending title or
an achievement gated on a paid chapter only for a user who owns that chapter now (`visible`,
[meta.rs:637](../server/src/meta.rs#L637); `card_paid_titles_need_entitlement`, `server/tests/it/cards.rs`). A
friend's profile (LF2) shows a title only when both found it and the viewer owns every chapter it is gated on
(`friend_profile_paid_titles_need_viewer_entitlement`, `server/tests/it/social.rs`), and a share's text holds no title
at all (`share_text_has_no_titles`, `server/tests/it/share.rs`).

**The served client holds no paid content** (as merged, L9 `d837c8b`; PP K27). With `STATIC_DIR` set, `server serve`
serves the built client next to the API, and `static_files::check` runs first, before the pool opens
([static_files.rs:219-283](../server/src/api/static_files.rs#L219); [main.rs:106-120](../server/src/main.rs#L106)). It
refuses the start when `STATIC_DIR` and `CONTENT_DIR` are the same tree or one lies inside the other, and when an
entry of `STATIC_DIR` (a link or a junction) resolves outside it (`walk` :291). As merged (LPH `d423cb3`, RULINGS 106;
LPH critique O9): the walk also refuses any dot-entry before it resolves it, since `GET /.env` would serve a host
file; only the root's `.vite` directory, a real directory where the build writes its manifest, is let through
(`StaticDirError::DotEntry` :162, `VITE_DIR` :286, :302-308). `/assets/*` is cached for a year and
everything else is revalidated; an unknown path is 404, with no SPA fallback (`with_static` :329). Tests:
`static_dir_must_not_contain_content_dir`, `static_dir_serves_client_with_cache_headers`, LPH's
`static_dir_refuses_dot_entries` (`server/tests/it/main.rs`), unit
`api::static_files::tests::static_dir_disjoint_rules`.

Only the `entitlements` table unlocks: its rows reference a payment by `charge_id`, UNIQUE
([0001_init.sql:52-60](../server/migrations/0001_init.sql#L52)). Nothing is ever unlocked from client state
(principle 1).

## Auth: initData, then the server's own token

Principle 3. The client sends the raw signed `initData` once; the server verifies it and answers with its own
short-lived token, which every later request carries in the `Authorization` header (WebView cookies are unreliable).

```mermaid
sequenceDiagram
    participant C as Client (Mini App)
    participant S as Server (axum)
    participant DB as PostgreSQL
    C->>S: POST /api/auth {initData}
    S->>S: validate_init_data - HMAC-SHA256, constant-time compare, auth_date freshness
    S->>DB: Repo::auth_with_code - the users upsert, a newcomer's referral
    S->>S: issue_token (TOKEN_KEY, TOKEN_TTL_SECS)
    S-->>C: {token, expiresAt, user}
    C->>S: any /api route, Authorization: Bearer token
    S->>S: AuthUser - verify_token (401 token_missing, token_invalid, token_expired)
```

- **Verification** (`validate_init_data`, [initdata.rs:76-120](../server/src/auth/initdata.rs#L76)): decode, refuse
  duplicate keys, then the HMAC check before any field is read. The key is `secret_key` = HMAC-SHA256 keyed
  `WebAppData` over the bot token ([initdata.rs:141](../server/src/auth/initdata.rs#L141)); the data-check-string is
  every pair but `hash`, sorted, `key=value` joined by `\n` (:125); `verify_slice` compares in constant time. Then
  `auth_date`: older than `INITDATA_MAX_AGE_SECS` is `Expired`, more than 60 s ahead is `FromFuture`. initData over
  4 KB is refused (`post_auth`, [api/auth.rs:20](../server/src/api/auth.rs#L20)).
- **The user** comes only from the verified initData; anything else in the body is ignored
  (`auth_ignores_body_user_id`). So does a newcomer's referral (LF1): only the signed `start_param`, and only in an
  invite code's shape, reaches `Repo::auth_with_code` ([api/auth.rs:39-42](../server/src/api/auth.rs#L39)). `initDataUnsafe` is never trusted: the client may not even name it (arch rule
  `init-data-unsafe`).
- **The token** is `v1.<user_id>.<exp>.<hex HMAC-SHA256(TOKEN_KEY, "v1.<user_id>.<exp>")>`, not a JWT
  ([token.rs:1](../server/src/auth/token.rs#L1)); `AuthUser` reads it as a `Bearer` credential
  ([extract.rs:20-38](../server/src/auth/extract.rs#L20)).
- **Dev.** `server-dev`'s `/dev/launch` signs initData with the dev bot token through the same `data_check_string` and
  `secret_key` ([launch.rs:101](../server/dev/src/launch.rs#L101)).
- **The client side** (as merged, L10 `34b7f13`; wired since L15a: `startApp`'s first boot read is `http.auth()`,
  [boot.ts:727](../client/src/app/boot.ts#L727)): the token lives only in the session store's
  closure ([session.ts:38](../client/src/api/session.ts#L38)); `createHttp`
  ([http.ts:159](../client/src/api/http.ts#L159)) re-auths once on a `401 token_*`, single flight, with the same
  initData, and an `initdata_*` refusal ends the session for the page (`http: concurrent 401s share one auth`,
  `http: only a token 401 re-auths`, `http: initdata expired ends the session once`, `api/http.test.ts`).

Tests: `server/tests/it/auth.rs` (`initdata_tampered_field`, `initdata_expired`, `initdata_from_future`,
`initdata_duplicate_key`, `token_expired_401`, `auth_initdata_over_4k_400`).

## Payments as built

Principle 2: Stars only, correct or absent. Built: invoices and orders (L8a); the webhook, the pre-checkout and the
grant (L8b); hint packs, priced by the catalog's `economy` and credited inside the grant (LE1); the client's purchase
flow (L10; created by GameSession since L15a, [game.ts:2213](../client/src/app/game.ts#L2213); as merged, LMI `3e35a7b`, a hint pack
bought from the wallet has the meta controller's own flow, [meta.ts:495](../client/src/app/meta.ts#L495)). Refunds and the bot
commands are L9 refunds-bot's (as merged, L9 `d837c8b`: built; the refund below). The invoice:

```mermaid
sequenceDiagram
    participant C as Client (Mini App)
    participant S as Server (axum)
    participant DB as PostgreSQL
    participant T as Telegram Bot API
    C->>S: POST /api/invoices {productId} (Bearer)
    S->>S: Catalog::product (unknown: 404 unknown_product)
    S->>DB: Repo::is_entitled (owned: 409 already_owned)
    S->>DB: Repo::create_order - payer row locked, unpaid orders of the hour counted, insert committed before the call
    alt 10 unpaid orders in the rolling hour
        S-->>C: 429 rate_limited + Retry-After (at most 3600 s)
    else a new order (every POST)
        S->>T: createInvoiceLink (XTR, empty provider_token, one price, 5 s deadline)
        T-->>S: invoice link (or failure: 502 telegram_unavailable, the order kept without a link)
        S->>DB: Repo::set_invoice_url
        S-->>C: {orderId, invoiceUrl}
    end
    C->>T: TelegramClient.openInvoice(url) - the result is a hint, never a grant
    C->>S: GET /api/orders/{orderId} (Bearer) - product and status
```

Participants: `post_invoice` ([api/orders.rs:39-84](../server/src/api/orders.rs#L39)), `Repo::create_order`
([db/orders.rs:133](../server/src/db/orders.rs#L133), `OPEN_ORDER_WINDOW_SECS` = 3600 :16, `OPEN_ORDERS_PER_WINDOW` =
10 :20; as merged, LPH `d423cb3`, RULINGS 97 Q2: it replaced `reuse_or_create_order` and `ORDER_REUSE_SECS`, so no
order is handed out again), `invoice_params`
([gateway.rs:299-311](../server/src/telegram/gateway.rs#L299)), `CALL_DEADLINE`
([gateway.rs:38](../server/src/telegram/gateway.rs#L38)), `get_order` ([api/orders.rs:89](../server/src/api/orders.rs#L89)),
`openInvoice` ([telegram/index.ts:56](../client/src/telegram/index.ts#L56); its contract comment at :3). On the client,
`createPurchaseFlow` ([purchase/flow.ts:79](../client/src/purchase/flow.ts#L79)) polls the order after the sheet, then
confirms a chapter through `GET /api/entitlements` (`chapterDelivered` :61); a pack's `paid` order is the confirmation
(`packDelivered` :72). As merged (LFU3 `48bc82a`, RULINGS 121), the client shows the 429: the flow enters `limited`
with the server's `Retry-After`, clamped to 1 to 3600 s and 60 s without a usable header (`LIMIT_FALLBACK_S`,
`LIMIT_MAX_S`, [purchase/flow.ts:53-58](../client/src/purchase/flow.ts#L53); :324-329), counts it down by the
minute and is `idle` again at zero (`tickLimit` :157); the paywall shows the minutes with Buy disabled and the
wallet holds its Buy, so the player asks again only after the wait. As merged (lever P `3d120bc`, RULINGS 213), the
flow's module loads lazily: the Game prefetches it when the paywall opens (`openPaywall`,
[game.ts:1266](../client/src/app/game.ts#L1266)), so Buy waits for it only when the prefetch has not landed; a waiting
Buy (`Offer.waiting`, :387) leaves the paywall idle, holds a skew reload and a chunk restart, and a failed load shows
`toast.purchase_failed` and loads again at the next Buy (`buy`, :2213-2236) (Changed by RULINGS 213, 214, 224 (as of
`0b91acc`; docs lane `docs-errata-15`, group A): where the module map lets it; Chromium-based WebViews before 156 keep
the failed `import()`, so the next Buy fails again without a request, and a load that fails again after the evidence
restarts the page once per build at a safe point, Q60's `createPageRecovery`, RULINGS 213 Q7). As merged (E6
`d5e04ef`, RULINGS 215, 225, 228), the wallet's pack Buy holds the same way: a Buy before the module is in sets the meta
view's `purchaseWaiting` ([meta.ts:50](../client/src/app/meta.ts#L50); `buyPack` :759, set :764, cleared :778 once the
flow has started or the load failed), which `metaHold` names as a purchase hold
([reload.ts:22](../client/src/app/reload.ts#L22)), so every restart path waits for it: the Game's reload blocker
([game.ts:1930](../client/src/app/game.ts#L1930)) and, with no Game, boot's recovery
([boot.ts:504](../client/src/app/boot.ts#L504)). Nothing about the grant changes: it stays the webhook's on
`successful_payment`.

- **Prices are server-only**: `server/catalog.json` prices every paid chapter of the story index
  ([catalog.rs:291](../server/src/catalog.rs#L291)); the invoice title is the chapter's title in the user's language,
  1-32 code points by the story gate (`catalog/stories` rule 9).
- **Each POST is a new order, bounded** (as merged, LPH `d423cb3`, RULINGS 97 Q2; K9). No order is handed out again:
  each POST commits a new `created` order and asks its own link, so a retry never gets a link TWA has opened
  ([db/orders.rs:129-132](../server/src/db/orders.rs#L129)). `Repo::create_order` first locks the payer's `users` row
  (`FOR NO KEY UPDATE`, the pre-checkout's mode), so one user's POSTs run one after another and the count below is no
  check-then-insert race (:146-149). Then it counts the user's unpaid (`created` or `checkout`) orders made in the
  rolling hour; at 10 it rolls back, and the handler answers 429 `rate_limited` with `Retry-After`: the seconds until
  the oldest counted order leaves the window, 1 to 3600 (:150-166;
  [error.rs:171-174](../server/src/error.rs#L171)). An order whose link call failed keeps no link and still counts.
- **The schema is the idempotency.** `payments` has the primary key `telegram_payment_charge_id`; `orders.charge_id`
  and `entitlements.charge_id` are UNIQUE and reference it ([0001_init.sql:12-60](../server/migrations/0001_init.sql#L12),
  test `schema_charge_id_unique`). The grant (below) writes through the primary keys `payments_pkey` and
  `entitlements_pkey` (user, product), never a check-then-insert; the UNIQUE charge-id columns back them. As
  merged (LRF `a93fe54`): `0007_auto_refunds.sql` adds `auto_refunds`, keyed by the charge id and referencing
  `payments` ([0007_auto_refunds.sql:7-21](../server/migrations/0007_auto_refunds.sql#L7)), and
  `unrecorded_refunds`, with no FK (:24-31); test `auto_refund_schema_constraints`.

Tests: `server/tests/it/payments.rs` (`invoice_price_from_catalog`, `invoice_each_post_is_a_new_order` (renamed from
`invoice_reuses_recent_order` by LPH `d423cb3`, RULINGS 97 Q3),
`invoice_order_committed_before_gateway_call`, `invoice_gateway_error_502_order_kept`, `invoice_already_owned_409`,
`order_other_user_404`, and LPH's `invoice_retry_of_open_order_gets_fresh_link`, `invoice_open_orders_bounded`,
`invoice_bound_serialized_by_payer_lock`).

The payment reaches the server only as Telegram's updates on the webhook:

```mermaid
sequenceDiagram
    participant T as Telegram Bot API
    participant S as Server (axum)
    participant DB as PostgreSQL
    T->>S: POST /telegram/webhook (X-Telegram-Bot-Api-Secret-Token)
    S->>S: secret_ok - exactly one header value, constant time (else 401)
    alt pre_checkout_query
        S->>DB: Repo::pre_checkout - lock the payer row, order to checkout (2 s budget)
        S->>T: answerPreCheckoutQuery - ok, or a refusal text (5 s deadline)
        S-->>T: 200
    else message with successful_payment
        S->>DB: Repo::grant - payment row, order paid, entitlement or pack credit, auto_refunds row if unapplied (one transaction)
        alt committed
            opt unapplied (as merged, LRF a93fe54)
                S->>T: sendMessage - the payer's and the admins' notices
                S->>DB: Repo::claim_auto_refund - the row due, its 60 s lease
                S->>T: refundStarPayment - the first attempt, inside the same 5 s deadline
                S->>DB: Repo::revoke settles the row, or Repo::auto_refund_failed - due again
            end
            S-->>T: 200
        else database error
            S-->>T: 500 - Telegram redelivers
        end
    else message with refunded_payment
        S->>DB: Repo::revoke - payment refunded, order, entitlement re-keyed or deleted, clawback (one transaction)
        alt committed
            S-->>T: 200
        else database error
            S-->>T: 500 - Telegram redelivers
        end
    else any other update
        S-->>T: 200 (an admin /refund whose database step fails - 500)
    end
```

Participants: `webhook` ([webhook.rs:63](../server/src/telegram/webhook.rs#L63)), `secret_ok` (:80), `dispatch`
(:196), `pre_checkout` (:281), `on_pre_checkout` ([telegram/payments.rs:70](../server/src/telegram/payments.rs#L70)),
`Repo::pre_checkout` ([db/payments.rs:191](../server/src/db/payments.rs#L191)), `answer_pre_checkout`
([telegram/payments.rs:100](../server/src/telegram/payments.rs#L100)), `message` (webhook.rs :213), `grant`
(webhook.rs :254), `Repo::grant` ([db/payments.rs:269](../server/src/db/payments.rs#L269)); as merged (LRF
`a93fe54`): `after_grant` ([telegram/payments.rs:150](../server/src/telegram/payments.rs#L150), called at webhook.rs :257),
`Repo::claim_auto_refund` (db/payments.rs :515), `Repo::auto_refund_failed` (:542); the `refunded_payment`
branch (since L9; docs-errata-6, RULINGS 107 N1): `refund`
([webhook.rs:267-277](../server/src/telegram/webhook.rs#L267), 500 on a database error), `Repo::revoke`
([db/payments.rs:402](../server/src/db/payments.rs#L402)); an admin `/refund` whose database step fails is retried
too (`message` :240-246, `on_text`'s `Err`; `Retry` is 500, :74).

- **The route.** `POST /telegram/webhook` sits outside `/api` with its own body limit of 1 MiB
  (`WEBHOOK_BODY_LIMIT`, [webhook.rs:29](../server/src/telegram/webhook.rs#L29);
  [lib.rs:147-160](../server/src/lib.rs#L147)). The handler answers 401
  unless exactly one `X-Telegram-Bot-Api-Secret-Token` value equals `WEBHOOK_SECRET`. It compares in constant time,
  before anything is parsed ([webhook.rs:63-66](../server/src/telegram/webhook.rs#L63), `secret_ok` :80-87). As merged
  (L9 `d837c8b`): the handler takes the raw `Body` and checks the secret before it reads the body, so a forged update
  is refused before it is buffered; only then does it read at most the limit, and one byte more is 413
  ([webhook.rs:67-71](../server/src/telegram/webhook.rs#L67); `webhook_secret_checked_before_body_read`,
  `server/tests/it/main.rs`). Logs never carry the body,
  the headers or the secret; they carry the charge id, a body field that is no secret (webhook.rs :151, :188, :217,
  :261, :273).
- **Pre-checkout under the payer-row lock.** `Repo::pre_checkout` is one READ COMMITTED transaction
  ([db/payments.rs:179-251](../server/src/db/payments.rs#L179)). It locks the payer's `users` row
  (`FOR NO KEY UPDATE`), so one payer's pre-checkouts run one after another. Then one conditional UPDATE moves the
  order to `checkout`: the payer's own order, at its amount, in `XTR`, younger than 24 h, not owned, and no order of
  the payer for the product in `checkout` within the last 120 s (`CHECKOUT_LOCK_SECS`, :24), this one included. With
  no row back, one read classifies the refusal: unknown order, mismatch, already owned, in progress or expired
  (`classify` :732). The pre-checkout grants nothing.
- **Answered within its deadline.** The database step is cut at 2 s (`PRECHECKOUT_DB_DEADLINE`,
  [telegram/payments.rs:30](../server/src/telegram/payments.rs#L30)); running out of it is a `Temporary` refusal. The
  answer is cut at `CALL_DEADLINE`, 5 s ([gateway.rs:38](../server/src/telegram/gateway.rs#L38)). A compile-time
  assertion keeps the two below Telegram's 10 s (payments.rs :34). A refusal carries its text in the payer's Telegram
  language (`reject_text` :585, `payer_lang` :569). A failed or timed-out answer is logged, and the webhook still
  answers 200: Telegram cancels an unanswered checkout.
- **The grant only on `successful_payment`, in one transaction** (`Repo::grant`,
  [db/payments.rs:253-366](../server/src/db/payments.rs#L253)). First the payment row,
  `ON CONFLICT ON CONSTRAINT payments_pkey DO NOTHING`: no row back is `Duplicate`, so a redelivery or its concurrent
  twin changes nothing. Then the order turns `paid`, and a chapter product gets its entitlement
  (`ON CONFLICT ON CONSTRAINT entitlements_pkey DO NOTHING`). A pack (LE1) gets the credit of the kind and amount its
  order bound at invoice time, never the catalog's current values, keyed `pay:<charge>` in the ledger (`credit_in_tx`,
  [db/economy.rs:135](../server/src/db/economy.rs#L135)). The time recorded is the server's receipt time, never
  Telegram's message date.
- **Unapplied and unknown products are recorded.** Every outcome commits, and a payment that cannot be applied is
  still a payment row, logged with its charge id (`GrantOutcome`,
  [db/payments.rs:77-94](../server/src/db/payments.rs#L77); `on_successful_payment`,
  [telegram/payments.rs:116-141](../server/src/telegram/payments.rs#L116)). `OrderMismatch`: no payable order of this
  payer at this amount in `XTR`. `UnknownProduct`: the order is paid, with no entitlement and no credit. `AlreadyEntitled`: the
  payer owned the product already.
- **Unapplied charges are refunded automatically** (as merged, LRF `a93fe54`; owner Q9, RULINGS 120, 130; PP K19).
  For `OrderMismatch`, `AlreadyEntitled` and `UnknownProduct` the grant commits an `auto_refunds` row in its own
  transaction, due at once (`schedule_auto_refund`, [db/payments.rs:705](../server/src/db/payments.rs#L705), called
  at :310 and :362); a redelivery (`Duplicate`) schedules nothing. After the commit the webhook's `grant` calls
  `after_grant` ([telegram/payments.rs:150](../server/src/telegram/payments.rs#L150); webhook.rs :257): the notice
  first (`notify_unapplied` :176, the payer in their payment message's language, each admin in Russian), then one
  attempt; a sweep pass may claim the row first, and the claim lets only one refund. The notice and the attempt's
  `refundStarPayment` call share one `CALL_DEADLINE`; the attempt's claim, revoke (and, after an `AlreadyRefunded`
  revoke, `settle_auto_refund`) and failure write are database steps outside it, each bounded by the pool's acquire
  timeout 5 s ([db/mod.rs:26](../server/src/db/mod.rs#L26)) and the session's `lock_timeout` 2 s and
  `statement_timeout` 15 s ([db/mod.rs:43-44](../server/src/db/mod.rs#L43)), so the webhook's answer can wait past
  one deadline (LRF review M1). An attempt the deadline leaves no room for stays due, and the sweep takes it.
  A refund that fails is retried, never
  answered 500 (`grant`'s doc, webhook.rs :249-253).
- **One attempt at a time** (`attempt`, telegram/payments.rs :245). The claim is one guarded `UPDATE`
  (`Repo::claim_auto_refund`, db/payments.rs :515): only a due row is claimed, its `due_at` moved to the end of a
  60 s lease (`AUTO_REFUND_LEASE_SECS`, telegram/payments.rs :39) and its attempts counted; a twin claimer gets no row.
  Then `refundStarPayment` to the payment row's payer, with no transaction open, cut at the deadline; on success or
  `CHARGE_ALREADY_REFUNDED` the guarded `revoke` records the refund and settles the row. Any other answer is the
  failure write (`Repo::auto_refund_failed`, db/payments.rs :542), which only that attempt's claim can write, and
  only while the row is pending: due again after the backoff, 60 s doubling to 1 h (`auto_refund_backoff`,
  telegram/payments.rs :448). Only a refusal (`Api` or `Disabled`) counts toward the bound of 8
  (`AUTO_REFUND_MAX_REFUSALS` :55); a timeout or a transport break is retried on the same backoff without bound
  (:269-276). The eighth refusal gives the row up (`due_at` NULL), and its attempt alone alerts the admins
  (`alert_given_up` :357, `admin_auto_refund_failed`); the refund is then the admin's `/refund <charge>`. An attempt
  that dies after its claim leaves the row due again at its lease's end, and the retry meets
  `CHARGE_ALREADY_REFUNDED` if the first call went through.
- **The sweep, the server's one background task** (`run_auto_refund_sweep`, telegram/payments.rs :432). A pass reads
  at most 20 due rows, the longest due first (`sweep_auto_refunds` :407, `AUTO_REFUND_SWEEP_BATCH` :61;
  `Repo::due_auto_refunds`, db/payments.rs :578), and attempts each in turn, each call cut at its own
  `CALL_DEADLINE`; then it sleeps 30 s (`AUTO_REFUND_SWEEP_INTERVAL`, telegram/payments.rs :58), so passes never
  overlap. A pass that cannot read its rows is logged, and the loop goes on. `server serve` owns it: `run` spawns it
  once the listener is bound and, when serving ends, aborts it and awaits it, before `serve` closes the pool
  ([main.rs:156-165](../server/src/main.rs#L156), :134). An abort lands at an `.await`; an attempt cut after its
  claim is retried after its lease. Two servers side by side (a deploy's overlap) both sweep, and the claim
  arbitrates.
- **Every refund path settles the row.** `Repo::revoke` clears the charge's `due_at` in its own transaction,
  whichever path refunded: the attempt, the admin's `/refund` or Telegram's `refunded_payment` (db/payments.rs :501).
  So a pending row always means an unrefunded payment
  ([0007_auto_refunds.sql:4-6](../server/migrations/0007_auto_refunds.sql#L4)). `/paysupport` shows a charge whose
  row is pending as being refunded (`charges_of`, db/payments.rs :662; `charge_text`, commands.rs :168), and one
  whose row was given up, or one recorded before `0007`, as not applied.
- **A refund of a charge the database does not hold** (as merged, LRF `a93fe54`; D2's restore gap). The admin's
  `/refund <charge> <payer>` (`refund_args`, commands.rs :238): a charge the database holds keeps the admin refund,
  whatever payer was typed; an unknown one is refunded to the named payer and recorded in `unrecorded_refunds`
  (`refund_unrecorded`, telegram/payments.rs :520; `Repo::record_unrecorded_refund`, db/payments.rs :613), so a
  repeat answers `refund_already` with no Bot API call. It grants and revokes nothing.
- **The lenient payment probe.** A body that frankenstein's `Update` does not decode is read again as plain JSON
  (`probe`, [webhook.rs:97-168](../server/src/telegram/webhook.rs#L97)). A present `message.successful_payment`
  whose money fields and payer read goes through the same grant; one that does not read is 500, never acknowledged
  away. Anything else is acknowledged (200). An undecodable pre-checkout stays unanswered, so Telegram cancels it and
  no money moves.
- **Database failures are redelivered or refused.** A grant that fails on the database is 500, so Telegram
  redelivers and the idempotent grant runs again (`grant`,
  [webhook.rs:249-265](../server/src/telegram/webhook.rs#L249)). A pre-checkout whose database step fails is answered
  as a `Temporary` refusal (:279-290).
- **Telegram strings** are bound through `without_nul` ([db/mod.rs:48](../server/src/db/mod.rs#L48)): PostgreSQL
  `text` cannot hold U+0000, so it becomes U+FFFD, the same key on every redelivery.
- **Dev: simulated payments take the production path.** `server-dev`'s `POST /dev/simulate-payment` builds
  Telegram's update JSON: the `pre_checkout_query` and, when that was answered ok, the `successful_payment`. It feeds
  each through the production `webhook` handler with the configured secret header (`run` :211, `feed` :341,
  [simulate.rs:211-352](../server/dev/src/simulate.rs#L211)).
- **Refunds** (as merged, L9 `d837c8b`, RULINGS 96; until then a `refunded_payment` was acknowledged and logged, and
  nothing called `refund_star_payment`). The admin's `/refund <charge>` (`admin_refund`,
  [telegram/payments.rs:489](../server/src/telegram/payments.rs#L489)) reads the payment row, calls
  `refund_star_payment` with no transaction open, cut at `CALL_DEADLINE`, then revokes on success or on
  `CHARGE_ALREADY_REFUNDED`. A `refunded_payment` update, read by frankenstein or by the lenient probe (`ProbeRefunded`,
  the charge id only, [webhook.rs:48](../server/src/telegram/webhook.rs#L48)), revokes too. Both end in
  `payments::revoke(st, charge)` at the state's clock (:460) and `Repo::revoke`
  ([db/payments.rs:402](../server/src/db/payments.rs#L402)): one transaction keyed by the charge's own rows; the
  `refunded_at IS NULL` guard (set to `GREATEST(now, paid_at)`) makes a repeat `AlreadyRefunded`. As merged (LPH
  `d423cb3`; RULINGS 96, 97 Q10, 100): a chapter's entitlement is deleted only when the payer has no other
  unrefunded charge whose own order of the chapter is `paid` and which keys no entitlement (a K18 double payment,
  recorded `AlreadyEntitled`); otherwise it is re-keyed to the oldest such charge, `granted_at` kept (:434-484). The
  candidates are read `FOR SHARE`, so one whose own refund is in flight is dropped. The residual (RULINGS 100,
  accepted; the doc at :396-401): an admin `/refund` whose successor read falls inside a concurrent grant of another
  charge of the chapter leaves that charge paid and unapplied; both of its unapplied notices fired, and an admin
  `/refund` of it recovers it. As merged (LRF `a93fe54`, RULINGS 130 Q5): the residual is closed: that charge's
  grant committed its `auto_refunds` row, so it is refunded automatically, and the successor read skips every
  charge with such a row (:442-443). Every command
  (`/start`, `/terms`, `/support`, `/paysupport`, `/privacy`, `/refund`) is answered in private chats only
  ([commands.rs:82](../server/src/telegram/commands.rs#L82)).
- **Bot commands and `server setup`** (as merged, L9 `d837c8b`; PP "Bot commands"). A command is answered in the
  sender's Telegram language (`payer_lang`), in that chat: `/start` with a button that opens the Mini App, `/terms`,
  `/support`, `/privacy` (the policy's URL), and `/paysupport` with the sender's newest charges, each flagged refunded
  or not applied, or, as merged (LRF `a93fe54`), being refunded while its automatic refund is pending
  (`PAYSUPPORT_CHARGES` = 20, [commands.rs:23](../server/src/telegram/commands.rs#L23)). As merged (LPH
  `d423cb3`, RULINGS 97, 106; L9 review M2): the newest twenty, newest first,
  and the total of the same statement (`Repo::charges_of`,
  [db/payments.rs:662](../server/src/db/payments.rs#L662)). `/refund` is
  the admins' (`ADMIN_TELEGRAM_IDS`); anyone else gets the unknown-command reply before any lookup (:93, :113-116). Each
  reply is one `sendMessage` cut at `CALL_DEADLINE`; a command whose database step fails is answered 500, so Telegram
  redelivers it ([webhook.rs:240-246](../server/src/telegram/webhook.rs#L240)). As merged (LPH `d423cb3`; LPH critique
  O2): only an admin `/refund` still fails that way. A `/paysupport` whose read fails is logged and answered with the
  intro, which carries the support contact, and `paysupport_unavailable`, and the webhook answers 200: a 500 would
  hold the chat's later updates, the payer's `successful_payment` included (`paysupport`,
  [commands.rs:217-234](../server/src/telegram/commands.rs#L217); `message`'s doc, webhook.rs :208-212). An admin
  `/refund` whose Bot API call timed out or broke in transport answers `refund_unknown_outcome`: not confirmed, Telegram
  may already have returned the Stars, and a repeat is safe; a refusal or a disabled gateway answers `refund_failed`;
  neither revokes (`refund_reply`, [commands.rs:251-304](../server/src/telegram/commands.rs#L251)). The texts live in
  `server/locales/bot.{ru,en}.json`, compiled in; each text is checked against its Telegram bound and its placeholders
  (`LangTexts::entries`, [texts.rs:161](../server/src/telegram/texts.rs#L161)); as merged (LPH), a draft refuses a
  production start ("Startup refuses bad content"). `server setup` (`bot_setup`,
  [main.rs:60](../server/src/main.rs#L60)) opens no database: one `BotGateway::setup` call registers the webhook with
  its secret, the command menus (English by default, Russian for `ru`, `uk`, `be`, `kk`) and the Russian menu button,
  every URL derived from `PUBLIC_APP_URL` (`spec`, [setup.rs:41](../server/src/telegram/setup.rs#L41)).

Tests: `server/tests/it/webhook.rs` (`webhook_missing_secret_401`, `webhook_wrong_secret_401`,
`webhook_undecodable_200`, `webhook_body_over_1mb_413`, `webhook_payment_undecodable_by_frankenstein_still_recorded`,
`webhook_payment_fields_unreadable_500`, `webhook_database_error_retries_payment_and_refuses_precheckout`);
`server/tests/it/payments.rs` (`precheckout_ok`, `precheckout_wrong_payer`, `precheckout_other_order_in_checkout`,
`precheckout_same_order_twice_refused`, `precheckout_concurrent_two_orders_one_passes`,
`precheckout_answer_times_out_at_5s`, `precheckout_lock_timeout_temporary`, `precheckout_grants_nothing`,
`successful_payment_grants_once`, `successful_payment_duplicate_concurrent`,
`successful_payment_unknown_order_recorded_no_grant`, `successful_payment_unapplied_recorded_no_grant`,
`successful_payment_nul_in_strings_recorded_replaced`); `server/tests/it/economy.rs`
(`precheckout_pack_refusal_in_query_language`, `pack_grant_credits_in_the_grant_transaction`,
`pack_credit_once_on_duplicate_payment`, `pack_credit_uses_amount_bound_at_order`); `server/dev/tests/dev.rs`
(`simulate_payment_goes_through_webhook_handler`, `simulate_paid_twice_grants_once`,
`simulate_payment_delay_answers_first`). Refunds and the bot (L9 `d837c8b`): `server/tests/it/refunds.rs`
(`refund_revokes`, `refund_repeat_safe`, `refund_concurrent_revokes_once`, `refund_gateway_error_keeps_entitlement`,
`refunded_payment_update_revokes_idempotent`, `webhook_refund_undecodable_by_frankenstein_still_revokes`,
`webhook_refund_charge_unreadable_500`, `paid_chapter_403_after_refund`, `refund_pack_claws_back_unspent`,
`refund_spent_pack_records_debt`, and six more), `server/tests/it/bot.rs` (`refund_command_admin_only`,
`bot_commands_reply_in_sender_language`, `paysupport_flags_unapplied_charge`,
`unapplied_charge_notifies_payer_and_admin`, `bot_setup_registers_webhook_commands_and_menu`, and six more),
`webhook_secret_checked_before_body_read` (`server/tests/it/main.rs`). LPH `d423cb3`:
`refund_rekeys_entitlement_to_other_paid_charge`, `refund_rekey_skips_charge_refunded_concurrently` (`refunds.rs`),
`paysupport_lists_newest_twenty_with_total`, `paysupport_db_error_answers_200`,
`refund_timeout_reply_says_outcome_unknown`, `bot_texts_startup_check_refuses_drafts_in_prod` (`bot.rs`),
`startup_checks_bot_texts_first`, `prod_start_refuses_draft_bot_texts` (`main.rs`). LRF `a93fe54`: eight names in
`auto_refunds.rs` (`auto_refund_unapplied_outcomes_refunded_once`, `auto_refund_claim_exactly_once`,
`auto_refund_bound_alerts_admins`, and five more), `refund_rekey_skips_auto_refund_charge`,
`refund_rekey_race_new_charge_auto_refunded` (`refunds.rs`), `refund_command_unrecorded_charge`,
`paysupport_shows_auto_refund_state` (`bot.rs`), `serve_runs_auto_refund_sweep` (`main.rs`), unit
`auto_refund_backoff_bounded`. Every name: FEATURE_MAP "Refunds and the bot" (LRF's: "Automatic refunds").

## Player statistics as built

STORIES-PLAN Y8-Y12 and META-PLAN M1-M3, built by LS3 server-stats, with the choice vocabulary check of LM2
meta-server and the referral hook of LE2 gifts-referrals (META-PLAN M23). The server records what a player did (a
chapter started or completed, an ending reached, a puzzle ended, a choice made) and reads it back as distinct facts.
The client side (as merged, L15a): `startApp` creates the reporter (LS4 stats-client, `createStatsReporter`,
[stats/reporter.ts:229](../client/src/stats/reporter.ts#L229)) after auth and flushes its kept queue
([boot.ts:952](../client/src/app/boot.ts#L952)), and GameSession records the events (`chapter_started`,
`ending_reached`, `chapter_completed`, `choice_made`; [game.ts:997](../client/src/app/game.ts#L997)). A session starts
only from Home, which `ui/App.svelte` renders (as merged, L15b `fbcfd38`).

```mermaid
sequenceDiagram
    participant C as Client (Mini App)
    participant S as Server (axum)
    participant DB as PostgreSQL
    C->>S: POST /api/stats/events {events: 1-32} (Bearer)
    S->>S: structural checks (else 400), repeated event ids dropped
    opt the batch names a paid chapter
        S->>DB: Repo::entitlements(user)
    end
    S->>S: classify each event - unknown_chapter, not_entitled, then the subject
    S->>DB: Repo::record_events - one count of facts and choices in the last hour
    alt facts over 600 in the hour
        S-->>C: 429 rate_limited, Retry-After 600 - nothing written
    else within the facts budget
        S->>DB: UNNEST insert ON CONFLICT ON CONSTRAINT stat_events_event_key DO NOTHING
        S->>DB: referral hook - Repo::qualify_referral (a failure leaves the answer unchanged)
        S-->>C: recorded, duplicates, rejected (private, no-store)
    end
    C->>S: GET /api/stats (Bearer)
    S->>DB: Repo::stat_facts - the user's distinct facts
    S-->>C: per story and for the game, no endings total (private, no-store)
```

Participants: `post_events` ([api/stats.rs:68-148](../server/src/api/stats.rs#L68)), `check_event` (:246),
`classify` (:305), `Repo::record_events` ([db/stats.rs:174](../server/src/db/stats.rs#L174)), `referral_hook`
([api/stats.rs:156](../server/src/api/stats.rs#L156)), `Repo::qualify_referral`
([db/social.rs:217](../server/src/db/social.rs#L217)), `get_stats` ([api/stats.rs:178](../server/src/api/stats.rs#L178)),
`Repo::stat_facts` ([db/stats.rs:282](../server/src/db/stats.rs#L282)).

- **The classify order.** Per event: a chapter outside the story index is `unknown_chapter`; a paid chapter whose
  product the user does not own is `not_entitled`; only then is the subject judged (`unknown_ending`,
  `unknown_puzzle`, or `unknown_choice` for a choice whose chapter part is not the event's chapter or whose option
  is outside the chapter's vocabulary in the meta index, LM2: `MetaIndex::is_option`,
  [meta.rs:114](../server/src/meta.rs#L114)). So an unowned
  chapter's ending names are never confirmed or denied (`stats_not_entitled_hides_ending_check`; the unit test
  `classify_order`). A rejected event is answered in `rejected`. The server derives the story; the
  request never names it.
- **Two budgets per rolling hour** (`StatCaps`, [db/stats.rs:122](../server/src/db/stats.rs#L122); 600 each,
  [api/stats.rs:42-45](../server/src/api/stats.rs#L42)), counted in one statement. Facts: a batch carrying a fact that
  would pass 600 fact rows is 429, and nothing of it is written. Choices: past 600 choice rows only a first pick of an
  option is written; a repeat pick is rejected `rate_limited`, and a choice-only batch is never a 429
  ([db/stats.rs:197](../server/src/db/stats.rs#L197)). Both budgets are soft by up to one batch per concurrent
  request: the statements are autocommit, with no row lock ([db/stats.rs:6](../server/src/db/stats.rs#L6)).
- **Idempotent on the event key.** `stat_events_event_key` is UNIQUE (user, event id)
  ([0003_stats.sql:22](../server/migrations/0003_stats.sql#L22)); the insert skips a known id, so a resent batch
  counts as duplicates and changes nothing (`stats_event_replay_counts_once`, `stats_replayed_batch_answers_duplicates`).
  The table's CHECKs mirror the structural checks, so a malformed event is a 400 before any SQL
  (`stats_malformed_event_400`).
- **Statistics never unlock (ST4, principle 1).** Only `db/stats.rs` and `api/stats.rs` name the statistics
  repository, in `server` and `server-dev` alike (`stats_repo_called_only_from_stats_api`). The two other readers of
  `stat_events` name the table and no item of the repository: the completion card's display read in
  `db/achievements.rs` (LM2), and the referral's evidence read in `db/social.rs` (LE2). Rows saying a paid chapter was
  played leave it 403 and unowned (`stats_do_not_unlock_paid_chapter`).
- **The referral, the one grant that reads statistics by design** (as merged, LE2 `ec3b29f`; META-PLAN M23). After
  every batch answered 200, never a 4xx or a 429, `referral_hook` asks `Repo::qualify_referral` whether the user's
  referral now qualifies. The evidence is re-read from `stat_events` on every call, by the server's receipt times
  only: a recorded completion of some story's first chapter whose earliest `chapter_started` came at least
  `minPlaySecs` before the batch's receipt (`now`), not before the completion
  (`referral_fast_reader_qualifies_on_a_later_batch`). Under both `users` rows' locks the inviter's caps per day and
  in total decide `granted` or `capped`; the credits of the catalog's referral kind are keyed `ref:<invitee>:inviter` (only when granted) and
  `ref:<invitee>:invitee` in the ledger. A
  failure rolls back and the next batch evaluates again (`referral_grants_both_once`,
  `referral_concurrent_batches_grant_once`, `referral_qualifies_after_hook_failure`, `server/tests/it/referrals.rs`).
- **No endings total.** `GET /api/stats` gives each story's started flag, completed chapters (a reached ending
  completes its chapter), chapter total and the endings reached, and the game's stories started, stories total and
  endings reached; there is no endings total at either level (META-PLAN M8; `stats_response_has_no_endings_total`).
  A fact counts only while the current index holds it (`stats_retired_ending_not_counted`).
- **The choice vocabulary** (as merged, LM2 `5a33183`). A choice is checked against the chapter's option vocabulary
  in `server/content/meta.json`, so a first pick past the choice budget is written only for an option of that
  vocabulary (`stats_unknown_choice_rejected`, `stats_first_picks_bounded_by_vocabulary`).

## WebView constraints

Principle 5, as far as it is built:

| Constraint | Where |
|---|---|
| height and safe areas from Telegram, never `100vh` | `applyInsetVars` ([viewport.ts:28](../client/src/telegram/viewport.ts#L28)); arch rule `vh-unit`; as merged (the Q67 fix `4f26e8e`), one phone-shaped column inside the window's horizontal safe area, its layers drawn at `--col-scale` with the insets divided by the scale: `#app` ([index.html:17-30](../client/index.html#L17)), the design box ([App.svelte:327-338](../client/src/ui/App.svelte#L327)), `fitColumn` ([viewport.ts:45](../client/src/telegram/viewport.ts#L45)) |
| no vertical swipe-to-close | `disableVerticalSwipes` in `boot` ([main.ts:17](../client/src/main.ts#L17)) |
| audio only after a gesture | `unlockAudio` resumes the one `AudioContext` inside the tap ([unlock.ts:12](../client/src/audio/unlock.ts#L12)); the manager reports `needs-gesture`; `TapToStart` calls back first and synchronously inside the click, so the caller's `unlockAudio()` runs in the tap ([TapToStart.svelte:1-4](../client/src/ui/TapToStart.svelte#L1)); wired (L15a): each of Home's actions in `startApp` calls `unlockAudio()` first and synchronously ([boot.ts:850-851](../client/src/app/boot.ts#L850)), and the audio manager is created at the first start; Home is rendered by `ui/App.svelte` since L15b (`fbcfd38`), whose capture-phase listener also resumes sound that needs a gesture on any tap in play ([App.svelte:52-65](../client/src/ui/App.svelte#L52)); e2e `tap-to-start unlocks audio only after the gesture` |
| pause on `deactivated`, check WebGL on `activated` | `TelegramClient.onLifecycle`; `AudioManager` suspend / resume; `SceneController.onActivated` rebuilds a context still lost after `CONTEXT_GRACE_MS` = 2000 ([controller.ts:105](../client/src/scene/controller.ts#L105)); wired (L15a): `startApp` subscribes `onLifecycle` ([boot.ts:1006](../client/src/app/boot.ts#L1006)), and GameSession's `onLifecycle` suspends the audio on `deactivated` and resumes the scene and calls `onActivated` on `activated` ([game.ts:2175-2205](../client/src/app/game.ts#L2175)); as merged (LMI `3e35a7b`), boot passes the event to the meta controller too, whose pack purchase flow takes it ([meta.ts:846-852](../client/src/app/meta.ts#L846)); as merged (E6 `d5e04ef`, RULINGS 215, 228), a Game made while the app is in the background starts paused: boot's background bit (`createBackgroundBit`, [boot.ts:609](../client/src/app/boot.ts#L609)) takes every lifecycle event first (:971) and tells the Game `engineOf` makes the `deactivated` it missed (`bit.join`, :814), so it is paused before anything reads it, a session started while paused starts its audio suspended ([game.ts:561-565](../client/src/app/game.ts#L561)), and `activated` resumes both through the same code |
| `BackButton`, not browser history | the screen stack `createScreens` ([screens.ts:71](../client/src/ui/screens.ts#L71)) owns `TelegramClient.backButton`: visible iff an overlay is open or, at the game root, a root-back is set; a press pops the top overlay, else runs the root-back. Arch rule `history`. Created by `startApp` with the facade's `backButton` (L15a, [boot.ts:627](../client/src/app/boot.ts#L627)) |
| no Service Worker, no `window.open` / `alert` | arch rules `service-worker`, `window-open`, `dialog`; e2e `no window.open or alert`. As merged (LMI `3e35a7b`, F28): the privacy link opens through the facade's `openLink` inside the tap; a policy tap before the meta chunk lands only starts its import ([boot.ts:926](../client/src/app/boot.ts#L926)); the share's fallback goes through `openTelegramLink`; `meta: policy opens through openLink from the tap`, e2e `meta: privacy link opens through openLink` |
| every SDK call from the main origin | the dev and preview servers proxy `/api/`, `/dev/`, `/telegram/` to `server-dev` on one origin ([vite.config.ts:86-88](../client/vite.config.ts#L86)) |

## Failure modes

| Case | Behaviour | Pinned by |
|---|---|---|
| content directory missing or inconsistent | the server does not start; no pool opened | `startup_fails_*` (`content.rs` tests) |
| `STATIC_DIR` the same as `CONTENT_DIR`, one inside the other, or holding a link that resolves outside it; as merged (LPH `d423cb3`), or holding a dot-entry other than the root's `.vite` directory | `server serve` exits before the pool opens (L9; the dot-entry: LPH) | `static_dir_must_not_contain_content_dir`, `api::static_files::tests::static_dir_disjoint_rules`, `static_dir_refuses_dot_entries` |
| a placeholder left in the privacy policy under `TELEGRAM_ENV=prod`, or an operator file with a content or unknown key | the server does not start (`StartupError::Privacy`; LPO) | `privacy_placeholder_refuses_prod_start`, `privacy_operator_content_key_refused`, `privacy_operator_unknown_key_refused` |
| a bot text file that does not parse, or a `drafts` list left under `TELEGRAM_ENV=prod` | neither `server serve` nor `server setup` starts: the bot texts are checked first, right after the configuration; drafts under `test` are a warning (as merged, LPH `d423cb3`) | `prod_start_refuses_draft_bot_texts`, `startup_checks_bot_texts_first`, `bot_texts_startup_check_refuses_drafts_in_prod` |
| Bot API slow or down at invoice time | 502 `telegram_unavailable`; the order stays `created` without a link and is never reused, and it still counts toward the bound (as merged, LPH `d423cb3`; `api/orders.rs:36`) | `invoice_gateway_error_502_order_kept` |
| a repeat Buy after the first invoice link was stored | a new order with its own link (as merged, LPH `d423cb3`, RULINGS 97 Q2; until then the newest linked order of the hour was handed out again) | `invoice_each_post_is_a_new_order` (renamed from `invoice_reuses_recent_order`, RULINGS 97 Q3; sequential requests), `invoice_retry_of_open_order_gets_fresh_link` |
| an eleventh unpaid order inside a rolling hour, or a POST racing the insert of the tenth | 429 `rate_limited` with `Retry-After` of 1 to 3600 s, no order and no Bot API call; the count runs under the payer-row lock, so a racing POST waits for the tenth and counts it (as merged, LPH `d423cb3`); the client shows the wait on the paywall or the wallet and offers Buy again at zero (as merged, LFU3 `48bc82a`) | `invoice_open_orders_bounded`, `invoice_bound_serialized_by_payer_lock`; `flow: a 429 on the invoice waits its Retry-After, then Buy again`, `meta: a pack's 429 shows the wait and holds Buy` |
| two Buy taps while the first link call is still running | every POST makes its own order (as merged, LPH `d423cb3`; [db/orders.rs:129-132](../server/src/db/orders.rs#L129); until then an order without a link was never reused), so the second tap makes a second order and a second link. Paying the second is refused `InProgress` at pre-checkout while the first is in `checkout` (120 s); a payment past that window is recorded as `AlreadyEntitled`, not applied | the two orders: `invoice_each_post_is_a_new_order` (LPH; until then not pinned); the refusal: `precheckout_other_order_in_checkout`, `precheckout_concurrent_two_orders_one_passes`; the record: `successful_payment_unapplied_recorded_no_grant` |
| one order paid from two devices | the second pre-checkout within 120 s is refused `InProgress` | `precheckout_same_order_twice_refused`, `precheckout_concurrent_same_order_one_passes` |
| the same `successful_payment` delivered twice, or twice at once | `Duplicate`: one payment, one entitlement | `successful_payment_grants_once`, `successful_payment_duplicate_concurrent` |
| the database fails during a payment update, or is slow at pre-checkout | a failed grant answers 500 and Telegram redelivers; the pre-checkout is refused `Temporary`, at the latest when its 2 s database budget runs out | `webhook_database_error_retries_payment_and_refuses_precheckout`, `precheckout_lock_timeout_temporary` |
| a forged webhook update with an oversized body | 401 before the body is read; only with the right secret does the 1 MiB limit answer 413 (L9) | `webhook_secret_checked_before_body_read` |
| a refund repeated, raced, or its `refunded_payment` delivered twice | one revoke; a repeat is `AlreadyRefunded` and changes nothing (L9) | `refund_repeat_safe`, `refund_concurrent_revokes_once`, `refunded_payment_update_revokes_idempotent` |
| a refund of the charge that keys a chapter's entitlement while the payer paid that chapter again (a K18 double payment, the later charge `AlreadyEntitled`) | the entitlement is re-keyed to the payer's oldest other unrefunded paid charge of the chapter, `granted_at` kept, so access stays; with none it is deleted; a candidate whose own refund is in flight is skipped (`FOR SHARE`). Residual (RULINGS 100, accepted): an admin `/refund` racing a concurrent grant of another charge of the chapter leaves that charge paid and unapplied, both unapplied notices sent; an admin `/refund` of it recovers it (LPH `d423cb3`); as merged (LRF `a93fe54`, RULINGS 130 Q5): closed, that charge is refunded automatically, and a charge with an `auto_refunds` row is never a successor | `refund_rekeys_entitlement_to_other_paid_charge`, `refund_rekey_skips_charge_refunded_concurrently`, `refund_rekey_race_new_charge_auto_refunded`, `refund_rekey_skips_auto_refund_charge` |
| the Bot API refuses or times out on `/refund` | nothing is revoked and the entitlement stays; the admin's reply carries the failure (L9). As merged (LPH `d423cb3`): a timeout or a transport break answers `refund_unknown_outcome` (not confirmed, the Stars may be back, a repeat is safe), a refusal `refund_failed` | `refund_gateway_error_keeps_entitlement`, `refund_timeout_reply_says_outcome_unknown` |
| a payment recorded but not applied: `OrderMismatch`, `AlreadyEntitled`, `UnknownProduct` (as merged, LRF `a93fe54`; owner Q9) | refunded automatically, once: the payer and the admins are told, the first attempt normally runs right after the notice (a sweep pass may claim the row first), its `refundStarPayment` call sharing the notice's deadline and its database steps outside it, the sweep retries; `/paysupport` shows it being refunded meanwhile; a redelivery changes nothing | `auto_refund_unapplied_outcomes_refunded_once`, `paysupport_shows_auto_refund_state` |
| the automatic refund's call refused, timed out or hung (as merged, LRF `a93fe54`) | a hung call is cut at its deadline; the row is due again after 60 s doubling to 1 h; only refusals count, and the eighth gives the row up and alerts the admins once, the refund is then the admin's `/refund`; a timeout or a transport break never gives up | `auto_refund_failure_retried_with_backoff`, `auto_refund_hung_call_cut_at_deadline`, `auto_refund_bound_alerts_admins`, `telegram::payments::tests::auto_refund_backoff_bounded` |
| two attempts at one due row, or the attempt's answer lost, or the server gone after the claim (as merged, LRF `a93fe54`) | the guarded claim lets one attempt through; a lost answer or a dead attempt leaves the row due at its lease's end, and the retry meets `CHARGE_ALREADY_REFUNDED` and revokes once | `auto_refund_claim_exactly_once`, `auto_refund_lost_answer_or_crash_revokes_once` |
| an unapplied charge refunded first by the admin's `/refund` or by Telegram's `refunded_payment` (as merged, LRF `a93fe54`) | the revoke settles its row, and it is never attempted again | `auto_refund_settled_by_admin_or_telegram_refund` |
| `server serve` stops while the sweep runs (as merged, LRF `a93fe54`) | the sweep is aborted and awaited before the pool closes; an attempt cut after its claim is retried after its lease | the sweep in the real binary: `serve_runs_auto_refund_sweep`; the shutdown: no test (LRF review M3) |
| a restore lost charges paid after its backup (as merged, LRF `a93fe54`) | the admin's `/refund <charge> <payer>` refunds the named payer and records it in `unrecorded_refunds`; a repeat changes nothing; a charge the database holds keeps the admin refund | `refund_command_unrecorded_charge` |
| the database fails on a `/paysupport` read | the intro and `paysupport_unavailable` are sent and the webhook answers 200, so the chat's later updates are not held; an admin `/refund`'s database failure is still 500 (as merged, LPH `d423cb3`) | `paysupport_db_error_answers_200` |
| a `refunded_payment` whose charge id does not read | 500, so Telegram redelivers; one that frankenstein cannot decode still revokes through the probe (L9) | `webhook_refund_charge_unreadable_500`, `webhook_refund_undecodable_by_frankenstein_still_revokes` |
| the Bot API hangs on `answerPreCheckoutQuery` | the call is cut at 5 s, the webhook answers 200, and the order stays `checkout` | `precheckout_answer_times_out_at_5s` |
| an update the pinned types cannot decode | a payment is still granted through the probe, or answered 500; anything else is acknowledged | `webhook_payment_undecodable_by_frankenstein_still_recorded`, `webhook_payment_fields_unreadable_500`, `webhook_undecodable_200` |
| expired or tampered token | 401 `token_expired` / `token_invalid` | `token_expired_401`, `token_rejects_tampered_parts` |
| WebGL context lost | restored: the textures revived under the new generation; never restored: rebuilt on `activated` after the grace period, then revived (as merged, M2 `385d52f`: [Texture memory](#texture-memory-and-the-context-loss-revive)) | `SceneController.onActivated`, called by GameSession's `onLifecycle` (L15a); e2e `context loss recovers` (L15b; since LFU2 it observes the loss before the recovery) and M2's `scene: an unrestored context loss rebuilds the stage`, `scene: a failed revive re-acquires the visual` |
| a CloudStorage / DeviceStorage callback that never comes | the call settles as a `timeout` error after `STORAGE_TIMEOUT_MS` (5 s); a later callback changes nothing; a `setItem` answered "not stored" is an error (L15a) | `storage: a callback that never fires settles as a timeout`, `storage: a late callback after the timeout changes nothing`, `storage: setItem not stored is an error` |
| a resume that fails after the chapter swap, or a deactivated / pagehide autosave during a step | GameSession writes no autosave while the session `mixes` two steps (the new chapter over the old runner at rest); an outside autosave waits for the step on screen, and one over a pending chapter start is written at once, that start being one complete body (LFU1) | `game: a resume that fails after the chapter swap writes no autosave`, `game: an outside autosave over a pending start is written at once` |
| "Load it" or a manual load whose read fails | "Load it": the error notice, whose action exits to the stories (an expired session: the reopen notice); a manual load stays at the shown line with no notice (LFU1); as merged, LFU3 `48bc82a`: the reopen notice's Close closes the Mini App through the facade | `game: a failed load it read shows the error notice`, `game: a failed manual load stays at the shown line without a notice`, `game: the reopen notice of an ended session closes the app`, `menus: reopen offers close, which calls its port` |
| "Return to last save" with no save yet | exits to the stories and writes nothing, so the server's copy stays (LFU1) | `game: return to last save with no save exits to the stories` |
| "Return to last save" after a continue (as merged, LFU3 `48bc82a`) | resumes the continued save: a resume records the body it runs from as the last save | `game: return to last save after a continue resumes the continued save` |
| a manual save tapped while a step is in flight | the slot shows `saving` at once; the write waits for the step and saves the line on screen (LFU1) | `game: a manual save with a step in flight waits for that step` |
| a 409 on a manual save answered within a double tap | the conflict ask is held until `CONFLICT_HOLD_MS` (500 ms) after the tap, so the second tap of a double tap cannot reach its Yes (K31, principle 1); a newer answer replaces a held ask (LFU1); as merged, LFU3 `48bc82a`: each slot holds its own ask, the ask shown is the slot asked first, and an answer or a No applies to its own slot only | `game: a 409 on a manual save asks only after the double-tap window`, `game: the hold of a 409 counts from the tap, not from the end of the step wait`, `game: a 409 after a round trip asks when the window since the tap closes`, `game: a late answer of an earlier manual save replaces a held conflict ask`, `game: an answer on one slot keeps another slot's held conflict ask`, `game: no on one slot's conflict ask keeps another slot's held ask` (renamed from LFU1's "game: no on a shown conflict ask drops the ask a later 409 holds", LFU3 cut C2, Q2) |
| a transient save failure with a huge `Retry-After` | the retry waits an hour at most, never `setTimeout`'s overflow (LFU1, K24) | `saves: a huge Retry-After waits at most an hour` |
| `savePreparedInlineMessage` fails at a share | the share still answers the link and the text, with a null prepared id (LF2) | `share_prepare_failure_falls_back_to_link` |
| the referral hook fails (a lock timeout on a `users` row a gift holds) | rolled back and logged without ids; the batch's answer is unchanged, and the next batch evaluates again (LE2) | `referral_qualifies_after_hook_failure` |
| a gift replayed after a lost answer, or with another body | the same request id moves once; another body under it is 400 (LE2) | `gift_replay_moves_once`, `gift_replay_with_other_body_400` |
| the meta controller's chunk does not load | nothing waits for it: Home and play run on, and no timer imports it again; the next meta tap does (one import in flight), with `meta.action_failed` when it fails again; an ending reached meanwhile waits for the import in flight and, when it fails, keeps `the_end` with its card action and shows `meta.card_later`; the puzzle hint port stays `null` until it lands (as merged, LMI `3e35a7b`, RULINGS 105; as merged, LFL `cec347c`, RULINGS 149: the port is boot's forwarding one, never null, and a hint use waits for the import, answers a network error when it fails and imports again at the next use); a tap waiting for it is dropped when the screen stack's root changed meanwhile, and an ending left meanwhile still marks its card (as merged, LFU3 `48bc82a`); Changed by RULINGS 213, 214, 224 (as of `52e328e`; docs lane `docs-errata-14`, group A): the next tap's import reaches the network only where the module map lets it (Chromium-based WebViews before 156 keep a failed `import()`), and a load that fails again after the evidence restarts the page once per build at a safe point (Q60, the recovery lane `8e099ee`, `createPageRecovery`) | `boot: meta chunk import retried by the next tap, single flight`, `game: an ending while the meta chunk loads gets its card`, `boot: a waiting meta tap is dropped when the root changes`, `boot: an ending left before the meta chunk lands still marks its card`, LFL's `boot: the hint port waits for the meta chunk` |
| the stats do not settle within 3 s at an ending, or the card request fails | no card: `the_end` stays with its card action, which asks again, and `meta.card_later` shows (as merged, LMI `3e35a7b`; META F16), except after an `auth` failure: `http.ts` has re-authorized once, and an expired session shows the reopen notice (`client/src/app/meta.ts:560-562`; RULINGS 113) | `meta: ending settles stats for 3 s before the card`, `game: card failure keeps the end` |
| a gift's answer lost on the client's side | the dialog's retry sends the same request id, so the server moves the gift once, and the wallet is read again so a debit shows; a definitive answer drops the id (as merged, LMI `3e35a7b`); a gift's success closes only the dialog opened for its own friend (as merged, LFU3 `48bc82a`) | `wallet: gift retry keeps its request id`, `meta: gift outcome closes the dialog or shows a new error`, `meta: a gift's success closes only its own friend's dialog` |
| a double tap on Accept, Decline or Remove, or the tap that opened Friends landing on a button | one call at a time, and a 404 reads the friends again; a pointer click on Accept, Decline or the new invite link counts only after a pointerdown on that button while the list is shown (rule (b); as merged, LMI `3e35a7b`) | `meta: accept and remove are single-flight and a 404 refreshes`, `friends: accept and decline count only an armed tap` |
| a deploy while a page is open, the build skew (as merged, LBI `fe996a0`, RULINGS 145) | the next `/api` answer names the new build; at the next safe point the Game autosaves the step on screen, shows the update notice and reloads once into the new build, and a tab already reloaded for that build keeps today's error states (the latch in the URL's fragment); a lazy chunk or a chapter file the deploy removed makes the page probe `/api/health` first; as merged (LRB `3c62a86`, RULINGS 157), a wallet pack flow the player left does not hold the reload; no recovery while no Game exists (LBI cut Q4, accepted); as merged (the recovery lane `8e099ee`, Q60 F-5), without a Game, once the engine import failed, the page recovery reloads for the skew itself, after the background, a wallet pack purchase on screen and a gift being sent; the latch has two kinds since, the skew's build id and the chunk restart's `chunk:<build>` ([reload.ts:33](../client/src/app/reload.ts#L33)) | `game: skew reloads at a safe point with the step autosaved`, `game: skew latch keeps today's handling in a reloaded tab`, `game: a chapter that fails to load probes the build id`, LRB's `game: skew does not wait for a pack purchase delayed after the wallet closed`; e2e `deploy skew reloads once at a safe point and resumes the saved line`, `a chunk gone after a deploy probes the build id`, LRB's `deploy skew does not wait for a delayed pack purchase the player left`; the recovery lane's `recovery: a skew after the engine import failed waits for a wallet pack purchase on screen and for activated, then reloads with the update notice` |
| the in-play overlays' chunk does not load (as merged, lever O5 `9a0ae2d`; Changed by RULINGS 229, 234 (as of `0b91acc`; docs lane `docs-errata-15`, group A)) | a silent prefetch failure shows nothing and is not requested again until a tap; a Menu, Backlog, Settings or Saves open waiting on a failed load shows `meta.action_failed`, opens nothing and keeps the game playable, and the next tap loads again where the module map lets it; Terms opens from the paywall whatever the chunk does (it is the engine's); a waiting open never holds a chunk restart, and a load that fails again after the evidence restarts the page once per build at a safe point (Q60) | `game: an overlays module that fails to load is noted at the tap, opens nothing, and the next tap loads again`, `game: a failed overlays prefetch is not requested again until a tap`, `game: terms open from the paywall while the overlays module fails to load`, `game: a chunk restart is not held by an overlay open waiting for its module`; e2e `overlays: a chunk that fails to load leaves the game playable and the next tap opens the menu`, `overlays: terms open from the paywall after the chunk failed to load`, `overlays: a chunk that keeps failing while the server serves it restarts the page once, and the menu opens after` |
| a lazy chunk or the stylesheet that keeps failing while the server serves it (as merged, the recovery lane `8e099ee`, Q60; RULINGS 213-215, 218, 224) | the build keeps a failed chunk a module-map failure only: no preload list, no modulepreload link, one stylesheet (R1), and the engine is one chunk that waits on no other (G2, G3); each failure feeds the page recovery ([boot.ts:446](../client/src/app/boot.ts#L446)), keyed by its URL (else one page-wide key), and counts only after the evidence that the network and the server deliver it: `/api/health` answers with no skew and the URL answers 2xx, so a deploy's missing chunk stays LBI's and a lossy link arms nothing; a key that fails again restarts the page once per build at a safe point: a Game takes it as a skew (`Game.restart`: the autosave, the `restart` notice, the reload with the chunk latch appended); without a Game the page waits while the engine import is in flight or landed, and once it failed reloads itself after the background, a wallet pack purchase on screen and a gift being sent ([reload.ts:22](../client/src/app/reload.ts#L22)); a stylesheet with no readable rules once the document loaded restarts at its first answered evidence (D6); a page latched for this build keeps today's error states, so a second stuck chunk never loops; the dev server and vitest have no build id, so nothing restarts there. Not covered: an `import()` that never settles and an offline reload (E3); telemetry before a player-facing release (E2) (Changed by RULINGS 228 (as of `0b91acc`; docs lane `docs-errata-15`, group A): a purchase-flow `import()` that never settles also holds every restart, with or without a Game, while a Buy waits on it: a chapter Buy's `Offer.waiting` (lever P) and, since E6 `d5e04ef`, a wallet pack Buy's `purchaseWaiting` (E6 cut O4; beside E3's hung `import()`)) | `recovery:` and `reload:` tests (`client/src/app/game.test.ts`), e.g. `recovery: a second failure of an armed URL restarts through the game`, `recovery: a chunk the server does not serve arms nothing`, `recovery: the chunk latch for this build keeps today's error states`, `recovery: without a game the restart waits for activated`; e2e `a chunk that keeps failing while the server serves it restarts the page once at a safe point, and the Buy works after`, `a stylesheet that failed at launch restarts the page once, styled after`, `sticky: the engine failed once at launch restarts the page before any tap, and Start works after`; the build's shape: the `scan-dist:` names (FEATURE_MAP's "Lazy-chunk recovery" and `build` gate rows list all 51) |
| a reach puzzle's post answered wrong after a deploy: the content changed under an open page (as merged, GM7r `9516951`; RULINGS 335, 341; Changed by RULINGS 335 (as of `f6487fc`; docs lane `docs-errata-19`, group A)) | the session reports a `mismatch`, not a wrong attempt: no attempt counted, no `attempt-failed` dispatch, no autosave; the device returns to its start answer with its one `reset` cue, the sticky `mech.content_updated` toast asks for a restart, and the console keeps `yields: reach-mismatch` (no report) ([app/yields.ts:1189-1197](../client/src/app/yields.ts#L1189)) | `session: a wrong reply to a reach post is a mismatch and counts no attempt` (`puzzles/session.test.ts`), `yields: a mismatch resets the device and shows the update toast` (`app/yields.test.ts`) |
| a story edit that breaks a soft-lock proof | the story gate fails with the action path | `softlock:` tests, [AUTHORING.md](AUTHORING.md#world-lint-codes-and-soft-lock-counterexamples) |

## Trade-offs

- The free chapters' text ships in the bundle by design: only paid content is protected. Chapter titles, speaker
  names, story titles and teasers are public too, paid chapters' titles included (STAGING-DSL §4).
- The leak scan proves absence only for the fingerprints it builds, and the floor differs per section:
  - paid ink line texts are **samples**: every 10th eligible line of 24+ code points, plus each paid chapter's
    longest line (`SAMPLE_MIN_CODE_POINTS`, `SAMPLE_EVERY`, [emit.ts:133-135](../client/scripts/story/emit.ts#L133);
    `fingerprints` :405). Most paid lines have no ink-text needle: a paid line's ink text copied into the bundle without
    its `#id:` tag is caught only if it is a sample (its en value is a needle from 12 code points up, next item);
  - paid en values, world and hint texts and meta texts are needles from 12 code points up
    (`TEXT_NEEDLE_MIN_CODE_POINTS`, [world.ts:455](../client/scripts/story/world.ts#L455)); a shorter text has none;
  - line IDs, paid asset names and asset bytes are matched exactly.
- The session token has no revocation list: it lives at most `TOKEN_TTL_SECS` (≤ 1 h).
- The share window (LF2) lives in memory in `AppState.share_limit`, per process: a restart forgets it, accepted
  ([share.rs:9-11](../server/src/api/share.rs#L9)).

## See also

- [FEATURE_MAP.md](FEATURE_MAP.md) - every built feature with its files and tests, and what is not built yet.
- [AUTHORING.md](AUTHORING.md) - the writers' side of the story tool.
- [STAGING-DSL.md](STAGING-DSL.md) - the tag language and the lint table.
- [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) - open owner questions.
