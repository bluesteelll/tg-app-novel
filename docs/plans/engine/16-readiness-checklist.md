## 16. Readiness checklist

- [x] Goal names budgets and correctness targets (§2); every decision states why, alternatives and trade-off (§0, §3-§8).
- [x] TS types for every new shape (§3-§8); no new HTTP JSON or Rust types in this track (per-player.md owns the routes;
      `ritual` / `setting` solutions use the existing static content path); no SQL (none here).
- [x] Tags: no new ink tag; STAGING-DSL unchanged (the props command's `at` is an internal command field, documented
      in the adoption docs lane). Every new world text is a `WorldText` with a line ID.
- [x] Payments: untouched. Hints keep the existing grant path; no paid data public: `clues`, `ritual` / `setting`
      solutions server-only; carry tier lint (§6.6).
- [x] Platform: no new API; Back through the screens stack; reduced motion; `deactivated` (§8.6); GSAP stays in the
      executor; no Service Worker, `window.open`, `alert`.
- [x] Memory: textures <= 2048 px (bg 1080 x 2048); view pair arithmetic and the transition-pair gate (§6.3); the half
      tier via the `bg` namespace; release points as built.
- [x] Failure: duplicate taps, reload, token expiry, content update, context loss, stale tab; round 2 adds the live
      chapter transition, the paywall start, overlays over a device, a removed control, the cue-stage chunk failure, a
      neighbour past the preload cap: §9.
- [x] Red-first per commit with predicted reds; test names; every new gate seen failing on a named mutation (M-R3,
      M-I5a-i, the `rules-lazy` and `waapi` fixtures, the seeded lint worlds, the transition-pair fixture, the cue-stage
      family fixture) (§12).
- [x] Owner questions are values only (§13); engineering forks decided or sent to the orchestrator (§15).
- [x] Interface requests to per-player.md and answers to its requests (§14), round 2 included.
- [x] Every Critical and Important remark of `critique_engine_r1.md` resolved in the body; each change logged as a
      patch with the removed text quoted (§17).
- [x] Round 3: W1-W3 of `critique_engine_r2.md` resolved in the body (device views inside the room layer with
      `coversStage` as App's one seam; `failLocal` on the session's own count; `world/answer-len` with a `<=` server
      pin and per-type decode bounds), m1-m13 and O1-O2 taken, the critic's open questions answered, none refuted;
      each new gate has a named mutation (M-I5j, M-I5k, M-W1a, M-W1b, M-W1c, the answer-pin mutation, the gesture-style
      deletion); per-player round 3's R-E14 accepted; each change logged in §18.
- [x] Round 4: W1-W3 of `critique_engine_r3.md` resolved in the body, none refuted: W1 one value (the session starts
      from `PuzzleInstance.start(run)`, `run.work` is written from the session's answer only, `restartWork` for the
      re-draw and the full commit); W2 a real content lane (GM8d, «Прилив» ch3) that carries every device / path / grid /
      sequence e2e with its named mutation (M-I5h, M-W1a, M-W1c, the `start` mutation, the countdown mutation, the bar
      anchor mutation, M-R4b); W3 the placement lint `world/view-type-site` (plus `world/device-type`) pinned through a
      fixture and through `levers`. m1-m11 and O1 taken; the found-while-resolving gap (no legal home for a new lint
      code: `LINT_CODES` is pinned at 86) closed by per-file `codes` and a uniqueness test, with STAGING-DSL §11 and
      `dsl-doc.test.ts` untouched. Tags: GM8d's yield is the existing `# explore:` tag and every new line gets its line
      ID from the story tool (principle 8). Paid content: ch3 is free (`story/chapters.json`), so GM8d moves no paid
      byte. Per-player round 4's R-E15-R-E21 answered (§14.2), E-P12-E-P14 sent (§14.1); the animation and shot holders
      written as A(f) invariants (RULINGS 132). Each change logged in §19.
- [x] Round 5: W1-W3 of `critique_engine_r4.md` resolved in the body, none refuted: W1 the beacon section on option 1
      of a new choice set, off the paywall e2e's path, with `stories.spec.ts` as the byte-identical pin and the
      option-swap mutation; W2 `world/device-closeup` seen red on a fixture; W3 one posting rule per reply kind
      (`reachEdge`, `Open.reach`, `postReach`, the countdown hook, the device bar's Try), with M-R5a / M-R5b seen red in
      GM7r and GM8d. m1-m9 taken (m1 the `work` branch in GM8h and the `types` seam; m2 three locks; m3 `KEY_SCRIPTS`;
      m4 2.97; m5 the safe frame and the derived 280 px band; m6 four holder rows; m7 the conditional commit; m8 the own
      bg; m9 the moving dispatch's cues at `started`, M-R5c). Found while resolving: `puzzle:offline` and
      `puzzle:rate-limited`, M-R5d. Payments, principle 0 and the save format untouched; no new owner question beyond
      Q15g's restatement; per-player E-P12 re-sent and E-P15 sent; per-player round 5's R-E22 (the `WorldLint` union),
      R-E23 (five shared rows) and R-E24 (GM8h's commit (7)) accepted (§14.2). Each change logged in §20.
- [x] Round 6: W1-W3 and m1 of `critique_engine_r5.md` resolved in the body, none refuted: W1 one walk for every world
      text (`WorldTextLine`, `MECHANIC_TEXTS` in the lint registry file, the kernel roles as data, `DecodeCtx.text` for
      module line IDs, the structural gate `world/text-unwalked`) in GM3c, with **M-R6b** / **M-R6c** and the
      `loc/orphan-en` red the critic traced; W2 the join is the new knot `lighthouse_radio` with its own opening stage,
      `t008`-`t011` moved with their IDs (STAGING-DSL §4), the dotted divert seen red as `graph/entry-below-top`, the W1
      pin and its option swap kept; W3 `puzzle:ready` at every wait's end with nothing posted, **M-R6a** and GM7r's
      two-cue mutation; m1 the three-row bar, `DEVICE_BAR_CSS_H` 120, band 496 in integer form, the pin at 320 x 569 in
      the fullest state. Found while resolving: the no-outcome reply branch's stale `checking`. Maximum animation: one
      key added, none removed, no text narrows motion. Principles: 0 (module texts of a paid world become paid needles;
      no answer moves), 8 (every module text a line of the walk), 7 and 1 untouched; payments and the save format
      untouched. Per-player round 6's R-E25 (adopted with two changes) and R-E26 (accepted) answered (§14.2), E-P16 sent
      (§14.1). Each change logged in §21.
- [x] Round 7: W1 and m1-m6 of `critique_engine_r6.md` resolved in the body, none refuted: W1 `setLadder` (one writer
      of the ladder, its `busy` edges as the wait hold, a cue per answer), `puzzle:ladder` / `puzzle:hint-failed` /
      `puzzle:load-failed`, a Retry that keeps its notice, App's Retry cue from yields, and the **state gate** over every
      reply kind with **M-R7a** / **M-R7b**; m1 `WorldLintInput.moduleLines`, type-only imports in `texts.ts` with a
      source test, `HOTSPOT_MIN_SOURCE_PX` in `geom/cover.ts`; m2 `--fix-ids`' reach restated and pinned; m3 `busy`
      writes nothing; m4 the cue-target table, `MotionSpec.with`, `data-cue-part`, resolve tests (**M-R7c**); m5 the
      bar's 44 px / 18 px rules asserted; m6 the figures (+1.47, per-player +2.85, 8.48). Found while resolving: a status
      answer after Back re-opens the ladder on main; the cue-name tuples were over-booked on the engine. Maximum
      animation: three keys and one gate added, none removed, no text narrows motion. Principles 0, 1, 2, 7, 8 and the
      save format untouched; no new string, so no new owner question. Per-player round 7's R-E27 accepted (§14.2), E-P17
      sent (§14.1). Each change logged in §22.
- [x] Round 8: W1, W2, m1-m3 and O1 of `critique_engine_r7.md` resolved in the body, none refuted: W1 one meaning per
      frame flag (`busy`; the new `retrying`, landed by GM3w with both `disabled` bindings), the chunk write limited to
      its own fields, neither wait winning (**M-R8a**); W2 the alert kept through a repeat Hint and cleared by a
      re-read with `puzzle:ladder` (**M-R8b**); m1 the end cues at `dropPuzzle`, called by `onEnd`, and a screenless
      frame's `panel-open` (**M-R8d**); m2 the state gate by value, with its silent hold, `SETTLE_KEYS` and seven steps;
      m3 the `ui-state` rows in the frame's resolve test and the in-view notice's panel marker (**M-R8c**); O1 the
      150 px boundary pair. Per-player R-E28 accepted with `post(o)` in GM3p; E-P18 sent. Maximum animation: no key
      removed, every new emission adds motion, no text narrows it. Principles 0-3, 7, 8 and the save format untouched;
      no new string, so no new owner question. Engine +1.50 at the 1.5 target (orchestrator Q12). Each change logged
      in §23.
- [x] Round 9: W1 and m1-m4 of `critique_engine_r8.md` resolved in the body as RULINGS 135 (b) rules, none refuted
      (§0 rows): W1 one resolve rule per target lifetime, owned by GM3s (`resolveAt`, capture / one `tick()` / run, the
      leave watch, the outroing-root skip), the end cues on the frame wrapper under `frameOut` with its coupling gate,
      no cue target a family root, the critic's four real-flush component tests plus GM3s's own, each seen red on
      **M-R9a** and **M-R9b**, [§8.1 The cue union and the bus](08a-cue-union-and-bus.md#81-the-cue-union-and-the-bus) restated; m1 `hideFrame` at an X8 Back and no `puzzle` kind in the screens
      diff (**M-R9k**, **M-R9j**); m2 `endFrame`'s Retry `waited` and the state gate's hold balance (**M-R9i**); m3 the
      hold on the panel's notice (**M-R9e**); m4 `panel-open` at every frame write, GM8h's narrowing dropped. Found
      while resolving: the intent microtask (**M-R9h**), the `lock` double, the held-cue invariant (a STOP item if a
      future effect breaks it), four drift fixes. Maximum animation: no key removed, no motion shortened below its
      round-8 length (the frame's leave grows 300 -> 480 ms), every new rule makes a motion land where it was lost.
      Principles 0-3, 7, 8 and the save format untouched; no new string, so no new owner question. Locks unchanged.
      Engine +1.53, 0.03 past the target (Q12 restated with a recommendation); headroom 8.27 with per-player's +3.00.
      Per-player R-E29 answered and R-E30 answered ahead of its row; E-P19 sent. Each change logged in §24.
- [x] Round 10: W1, W2 and m1-m3 of `critique_engine_r9.md` resolved in the body under RULINGS 135, none refuted (§0
      rows): W1 a frame cue waits for its frame to be on screen (`shownFrame()`, `appear(o)`, `Open.appeared`; **M-R10a**,
      **M-R10b**; the first-puzzle e2e on the real App); W2 a `ribbon` target with no live ribbon lands at the defined
      `edge` box (**M-R10c**; the take-then-knot real-flush test); the class guard, `fallbacks()` / `data-cue-fallbacks`
      at 0 in every real-flush test and mechanics e2e (**M-R10g**; orchestrator Q13); m1 `frameOut.reduced.ms` 480
      (**M-R10h**); m2 `holdEnd` (**M-R10e**); m3 **M-R10d**. Taken from the critic's questions: hit areas paint
      (`data-cue-hit`, **M-R10f**); the re-tap after an X8 Back accepted and stated. Found while resolving: no device
      under an `onEnter` event (GM8i), and the first-line row re-based (257.9, both tracks' entry terms). Maximum
      animation: no key, row or motion removed; a hotspot tap and a device part now move visible pixels, a gift whose
      rooms leave flies to the edge instead of the stage centre, the end motions hold to the outro's end; the only cues
      dropped are those of a frame nobody has seen. Principles 0-3, 7, 8 and the save format untouched; no new string,
      so no new owner question. Locks unchanged. Engine +1.56 (Q12 restated); first-line headroom 7.14 before the shot
      design. E-P20 sent. Each change logged in §25.
- [x] Round 11: W1, m1-m6 and O1 of `critique_engine_r10.md` resolved in the body under RULINGS 135, none refuted (§0
      rows): W1 as a class invariant, every wait of the explore and puzzle views holds a motion (§8.1 point 11's rows:
      the frame's load hold `holdLoad` from its write, **M-R11a** / **M-R11c**; the close-up's load, **M-R11f**; a
      section's first explore import, **M-R11g**; `puzzle:checking` looping until its frame settles, **M-R11e**), with
      one guard (`yields: every wait of the views holds a motion`, the state gate's hold balance on `loading(frame)`,
      the first-puzzle e2e's `ui-state:waiting@puzzle`) and the resume prefetch (**M-R11k**); m1 hotspots that paint are
      pressed as themselves (**M-R11b**); m2 the `{ box }` rule and the edge skip (**M-R11i**); m3 `holdEnd` as a fill
      rule (**M-R11h**); m4 the predicted red restated; m5 the drop order (**M-R11d**); m6 E-P21; O1 the DOM-branch
      count (**M-R11j**). From the critic's questions: documents fly to the Inventory control (`inventory` target,
      **M-R11l**); §7.5's demo selector `[data-cue-part]`. Maximum animation: no key, row or motion removed; every wait
      that sat still (an unshown frame, a close-up's load, a section's first import, a long answer) now moves, and an
      exit's glyph and a revealed outline move as themselves. Principles 0-3, 7, 8 and the save format untouched; no
      new string, so no new owner question (§13: `centre`, the loop's pace, the document flight are CLAIM defaults).
      Locks unchanged (§12). Engine +1.61 (Q12 restated, 1.7 recommended); first line 262.91 (7.09 left) before the
      shots and 269.16 / 270.0 with design-shots' approved rev. 7 (found at the round's end, with main's move to
      `a9f28e3`). E-P21 sent. Each change logged in §26.
- [x] Round 12: W1 and m1-m5 of `critique_engine_r11.md` resolved in the body under RULINGS 135, none refuted (§0
      rows): W1 as the class's guard made complete, one batch site `held` (every visual batch holds by construction,
      **M-R12a**; the state batch's ring at its anchor) and the await map (`yields: every await of the views names its
      wait`, an unlisted wait red, **M-R12b**, **M-R12c**), plus the room's state images resident while it is current
      (`state:<room>`, **M-R12i**, **M-R12j**; bytes stated, memory already in the room-set row) and the e2e with the
      picture held; m1 one chunk-write order (**M-R12f**); m2 the scoped overlap clause (**M-R12g**); m3 the loop
      cancelled at the key's run (**M-R12d**, **M-R12e**); m4 the resume prefetch's trade stated; m5 `ahead` at every
      yield step (**M-R12h**) with the residual stated. The critic's two questions answered (both residency and the
      hold; no lint refuses a first-step yield). Maximum animation: no key, row or motion removed; the state picture's
      wait now moves on its anchor, and `checking`'s end motions start without delay. Principles 0-3, 7, 8 and the save
      format untouched (the state preload uses the existing asset routes; a paid state image is fetched through the
      entitled path as any paid prop). No new owner question. Locks unchanged (§12). Engine +1.62 (Q12 restated, 1.7
      recommended); first line 262.92 (7.08 left) before the shots and 269.17 / 270.0 with design-shots' rev. 7. E-P22
      sent; §15 Q13 carries the class's recurrence to the orchestrator. Each change logged in §27.
- [x] Round 13: W1, W2, m1 and O1 of `critique_engine_r12.md` resolved in the body as **RULINGS 148** rules them, under
      RULINGS 135 (the class back at the orchestrator, then one guard over it), none refuted (§0 rows): W1 every request
      start a declared site (`requests: every request start is a declared site`, fail closed over `client/src`, by
      declaration; **M-R13a**-**M-R13g**, the four the ruling names first; the await map retired with its one unique
      case confined, scene loads only in `app/game.ts` / `scene/**`; the `Pick` self-test; E-P22 (a)'s author step
      withdrawn, E-P23); W2 `state:<m>` with `room:*`'s keep set (**M-R13h**; the close-up's other rooms' release,
      **M-R13i**; bytes in both formats; memory in GM4g's pair term and admission); m1 the first drawing anchor and no
      hold for none (**M-R13j**, **M-R13k**); O1 moot. The critic's questions answered. Maximum animation: no key, row
      or motion removed; a state change's crossfade plays in every case, its wait's ring moves to the anchor that loads,
      and a zoom-out's state changes crossfade at once (resident). Principles 0-3, 7, 8 and the save format untouched
      (no new route, byte or grant path; the walk is a test). No new owner question. Locks: GM3p 11 -> 12 (§12). Engine
      +1.62; explore-ui ~12.51; first line unchanged (262.92 / 269.17 on 257.9; 263.82 / 270.07 on RULINGS 145's 258.8,
      re-based by `design-reconcile` and LFL). Each change logged in §28.
- [x] Round 14: W1 and m1-m4 of `critique_engine_r13.md` resolved in the body under RULINGS 135 / 148, none refuted
      (§0 rows): W1 the batch site checked by declaration in the walk (`BATCH_MEMBER`; GM3s's spelling pin retired by
      GM3p; what round 12's map alone saw stated; **M-R14a**-**M-R14c**); m1 the transport a start by its type (11 new
      `other` rows) and a re-typed guarded member red at its value flow, `.svelte` scripts banned from naming a guarded
      type (**M-R14d**, **M-R14e**, **M-R14l**); m2 the current room's state set requested at every `roomShown`
      (**M-R14k**), the admission order stated, eviction and refusal described as they are; m3 `'no-load'` honoured
      only while no revive runs (**M-R14j**); m4 one fixture mutation per unexercised clause (**M-R14f**-**M-R14i**). The
      critic's two questions go to the orchestrator as §15 Q14 with recommendations. Maximum animation: no key, row or
      motion removed; a state change during a revive gains a hold. Principles 0-3, 7, 8 and the save format untouched
      (no route, byte or grant path; the walk is a test). No new owner question. Locks unchanged (§12). Engine +1.62
      (1.624); explore-ui ~12.51; first line unchanged. Each change logged in §29.
- [x] **Reconcile r1 (RULINGS 152-156):** R1 every design-shots request I-1-I-18 answered in §14.4 (17 adopted,
      two with a change, two with a precision; I-17 not applicable by RULINGS 154; none refused), each in its body
      place with its test and named mutation (**M-RCk**-**M-RCs**); R2 one order for the GM, GM6 and SH lanes (§12:
      A(f) retired, §9.14 adopted with I-2's `budget.ts` change, merged lanes shown merged, LFL merged as `cec347c`,
      LRB merged (`3c62a86`, at the adoption); every shared file of two lanes of either design in one row, never two holders at once); R3
      RULINGS 152 as worded: the predicate `stats().stale === 0 && !stats().reviving` with M-R14j's new fixture and
      **M-RCa**, Q14 (b) accepted with the preload-priority lane carried in the `scene/*` tail, the batch site bound to
      `held`'s declaration, `HOST_WAITS`, the constraint comparison and the widening (**M-RCb**-**M-RCj**,
      **M-RCt**), blind spots B1 and B2 named, the text restated to what the walk sees (§0 [§0 Decision table](00-decision-table.md#0-decision-table), §8.7, §8.1 point
      11, §15 item 13), O1's re-location on `acc4e0d` (§1); R4 §11.1's four ledgers on main's MEASURED rows, without
      and with LFL, with the L1 / L2 line (§15 items 15, 16); R5 §14.3 E-P25-E-P28. Maximum animation: no key, row or
      motion removed; a stale-record batch gains a hold, a translucent frame keeps the room moving (I-7), the scene
      role gets every cue. Principles 0-3, 7, 8 untouched (no route, byte path or grant path; `cam` is a field of the
      save body, which the server does not parse: Grep `staging` in `server/src` finds only an env value,
      `config.rs:633`). No new owner question. GM locks unchanged. Engine **+1.69**;
      explore-ui ~12.51; cue stage ~3.28. Each change logged in §31; shots errata in §30.
- [x] **Reconcile r2 (`design/reconcile/critique_engine_r1.md`; per-player R-E31-R-E35):** every Important remark
      taken (RC-W1 one ledger input per design, RC-W2 `roomFor` with R-E32 adopted and R-E33 confirmed, RC-W3 four SH
      edges and the `story/shots.json` row, RC-W4 the host-wait walk's exact reach with **M-RCu**, **M-RCv** and B3,
      RC-W5 the frame-on-screen edge and SH7's one cancellable cover with **M-RCw**-**M-RCy**, **M-SH7f**,
      **M-SH7g** and a §10 row), every minor taken (RC-m1-RC-m7), RC-O1 noted; R-E34 adopted with a change
      (**M-RCz**), R-E35 adopted; R1-R5 rows of §0 restated; §11.1 one total per row (with LFL: 265.48 / 270.0,
      39.46 / 40.0 at 0.038 above the L1 / L2 line, 301.63 / 305.0, 226.02 / 230.0). Maximum animation: no motion
      removed; the room keeps moving through every frame entrance and is covered only behind a fully shown opaque
      frame; `roomFor` brings a room back with its labels. Principles 0-3, 7, 8 untouched (`roomFor` is pure over the
      yields' world and store; no route, grant or byte path). Red-first and a named mutation per new test; every new
      gate clause (the reach self-test, the site-member list, the frame edge) seen failing by name. Locks unchanged
      (GM3p, GM3b, GM8h, GM3w hold the files already). Engine **+1.71**; cue stage ~3.78 with SH10. No owner
      question. Each change logged in §32; shots errata in §30.
