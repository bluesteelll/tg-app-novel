## 15. Readiness checklist

- [x] Goal names budgets (32 / 48 MiB, 279,000 B derived at the half tier, 6 s, 800 KB, 270 KB first line, 305 KB
      all JS) and correctness targets (no stall at a cut, inside room events too; every paid-only shot file gated;
      layers registered under motion); every decision in §0 has why / rejected.
- [x] TS types for every new JSON (rigs, look, build/shots.json, shots.json via its decoder). No Rust or SQL changes.
      No new endpoint; the paid manifest is served by the existing route.
- [x] Tags for STAGING-DSL §6 and §14; one parser for the gate and the runtime. The scene reads no story state (step
      keys are opaque; talk is a call). Line IDs untouched.
- [x] Paid: tier per file through the existing `tierOf` (rev. 4: face and talk files, no `gsheet`); scan-dist derives
      the paid-only shot files itself, owes their fingerprints and whitelists `dist/`'s shot files, seen red by a
      mutation inside the asset tool (M-SH3y, SH3a). No grant or purchase changes (N/A).
- [x] Audio unchanged (N/A). `deactivated` / `activated` (§5.10). No new Telegram API (N/A).
- [x] Textures <= 2048; resolution <= 2x DPR (unchanged); a release point per texture (§14); long BGM unchanged;
      memory arithmetic §5.9.
- [x] Duplicate webhook (N/A); double tap, reload, token expiry, story update, context loss (§5.10).
- [x] Red-first per commit with test names; mutations per new gate (§9); budget numbers enforced by the build (§10).
- [x] (rev. 2) The owner's rulings are not narrowed: every visible face has its full set (S30), rooms parallax during
      explore (S25), state loops follow the world (S21); every reduction is an owner question with its cost (OQ13,
      OQ15).
- [x] (rev. 3) No lever and no fail column narrows a ruling: the entry row's levers are `q` and the chapter files,
      never face states or framings (C1); no device result turns motion off on a class without OQ16 (C2); hair locks
      and figure masks on every cast member are required by R9 (W4); a CG drifts while shown (W8).
- [x] (rev. 4; corrects round 3's item, which did not hold for `step-window`, critique r3 C1) **Branches and explore
      events open on distinct shots, close-ups included, with no restaging:** openers are held as bytes (S32), rooms
      have their own windows (S33), and the expressions per shot are bound by no memory row or file limit (§2.6). The
      levers still printed (§5.9) act on a CG's dismissal timing or a plate's width (pan slack), never on an angle, a
      face state or a branch's own shot; the one residual authoring rule (a cut from under a CG wants the CG dismissed
      one line earlier, else a 1080 plate) costs no angle, so no owner question is needed for it.
- [x] (rev. 4) Every new gate seen failing by a named mutation: M-SH2i / j / k, M-SH3h (re-aimed), M-SH3y, M-SH3z,
      M-SH3aa, M-SH4e, M-SH5h / i / j, M-SH9c.
- [x] (rev. 5) The gate and the runtime count one set at every step: EN's `room:*` set is outside every window and
      evictable at any step (W2); the runtime window type is the one `ShotWindow` that SH3a ships and SH5a / SH9
      import (W1); every lock holds every reader of what it removes (W3: SH12a 15 files, SH12b 11). New mutations:
      M-SH2l / m / n, M-SH3ab, M-SH4f, M-SH5k / l, M-SH6f; M-SH5h's e2e signal fixed (m5).
- [x] (rev. 6; corrects rev. 5's item, which did not hold for `next:*`, critique r5 W1) **Every image family on the
      path has a gate row or an evictor** (S35): the window's holders are gate-counted; `hope` with the event room's
      tail, EN's `room:*` and the next chapter's `next:*` are counted by no gate and evicted in that order by a refused
      `need` item or `warm` fetch; legacy `preload:<knot>` images exist only for a manifest without `look` (§5.8
      "Missing key"), where `knot-set` counts them. **The eviction order is implemented, not assumed** (W2: recency in
      `preload()`, the event room in `hope`; the false cite corrected). **Every e2e and integration test has a
      fixture-ledger row** whose creating lane holds the file at or before the test's lane (W3, S34, §10.1); one
      latent shape defect found while building it is fixed (SH5b's pixel assertion, F5). The image-generation sections
      are marked not adopted (RULINGS 136). New mutations: M-SH2o, M-SH5m / n / o / p / q; M-SH5b and M-SH5k restated.
- [x] (rev. 7) This corrects rev. 6's items, which did not hold at a handover or for an event room that only the
      window held (critique r6 W1, W2). **Every family is evicted or released in the stated order, whoever holds
      it:**
      - the event's room is the window's own `eventRoom` class, evicted after every other family (S35, §5.8 step
        6 (d));
      - a landed `next:<id>` is joined by its chapter's first window before the scheduler releases it (S36), and
        joins take no slot.

      Every fixture shape is stated by window class where a staging choice could make a mutation unfireable (F16,
      F17), and every read point is named (F18). New mutations: M-SH5r / s / t / u / v. M-SH5k and M-SH5p are
      restated. M-SH5c's e2e red is withdrawn; its unit red stands.
