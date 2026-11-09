## 11. Where M3c changes a contract this design relies on

**M3c merged at `a6365a8` (RULINGS 127).** The contracts below hold on the merged tree (CODE, re-read for round 3, and
the critic's r2 check).

| M3c change | This design relies on it for | Where on `a6365a8` |
|---|---|---|
| `createAssetRegistry({ load, variant, tier })`, `tier` required; `demote()` sets `'full'` | a generated record takes the registry's tier at acquire; after a demote the next labels command draws full-tier labels | `client/src/scene/registry.ts:173`, `:116`, `:573` |
| `textureGeometry(entry, tier)` with resolution 0.5 for `'half'` | the label canvas resolution | `client/src/scene/layout.ts:35-44` |
| `scene/controller.ts` mount and `pixiAdapter` edits | GM6a's `anchor()` lands in the adapter after M3c | re-located at GM6a's cut |
| `budget.ts` rows moved (M3c, then MD1 / GM3s, then GM4g's transition pair) | the room-set formula location | `roomRows` `client/scripts/budget.ts:869-899` |
| `executor.test.ts` `tier: 'full'` hunk | GM6a / GM6d1 edit the same file after M3c | re-located at GM6a's cut |
| the entry row 39.4 / 40.0 KB br and the lever rule | GM6s2 and GM6t add entry code after the lever (m8); 0.35 KB br in all (r3 W1) | `RULINGS.md` 127 |

### 11.1 Where LFL changes a contract this design relies on (reconcile P4; RULINGS 145, 152)

This file is designed against main `acc4e0d`. LFL (`lfl-first-line`, cut
`D:/tmp/novel-orch/lfl-first-line/cut.md:94-153`) was in flight when this revision started and merged as main
`cec347c` while it was written (lane HEAD `7338d77`, test round 2 GREEN, `test_r2.md`); RULINGS 145 ordered it before
the first lane that adds first-line bytes, so every client lane of this file cuts on a parent that holds it. Where it
changes what this file relies on (cites on `cec347c` marked so):

| LFL change (its cut) | This design relies on it for | Consequence here |
|---|---|---|
| T1: `GameMeta.stepShown()` (`game.ts:176` on `cec347c`), called by `present()` (`:726`) right after its `switch` (`:776`) and in the D11 paywall branch (`:982`); on `acc4e0d` `present()` is `:721-804`, its `switch` `:744-768` | GM6c3's `revalue` never re-presents the line: no talker call, no second `lineShown` | `revalue` calls neither `present` nor `stepShown`; GM6c3's pin `game: a value change neither talks nor reports the line again` also counts `stepShown` (§9 GM6c3); GM6c2's `chapterLeft()` replaces the restore beside the D11 branch's new `stepShown` (`cec347c` `:978`, `:982`) and leaves that call in place; `stage()` (`cec347c` `:716`; `acc4e0d` `:711-718`) is unchanged by LFL |
| the meta chunk loads after the first line; boot's `hintPort()` is a forwarder that is never null, whose `use()` awaits the chunk's `ready()` (`client/src/app/boot.ts:306-320` on `cec347c`) | the session's hint port (`hints: () => meta?.hintPort() ?? null`, `game.ts:1360`; `cec347c` `:1371`); a tier text's run tag; a `useHint` answer after a run change is dropped by comparing `run()` at the request's start and end (§5.5) | `HintPort`'s type is unchanged; the start / end comparison still brackets the whole `use()`, the chunk wait included, so a run change during that wait drops the answer as designed; no GM6 lane holds `app/meta.ts` or `app/boot.ts` |
| `JS before the first line (br)` becomes "entry + engine closures" (the meta controller chunk leaves the row) | §10's ledger | GM6s2's `META_KINDS` row (+0.004) leaves the first-line term; the ledgers show both definitions (§10 "Ledgers") |
| entry +265 B (MEASURED, `test_r2.md:65`; round 1 read +312) | the entry headroom of GM6s2 / GM6t | 0.55 KB br after every planned lane: 48 B above L1 / L2's return line; the per-lane quote decides (§10 "Ledgers"); reconcile r3: 0.538, 38 B above, with engine.md r2's GM3w +0.01 (§11.1 Ledger 2, [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13) as last read) |
| F1 (round 1 RED): unguarded boot wirings, fixed in round 2 | nothing here | none; its fix touches no file of a GM6 lock |
| every `game.ts` line below `:890` moves by 8-11 lines (`cec347c`: `s.ch = ch` `:899`, the paywall restore `:978`, the resumed restore `:1000`, `dispose` `:1476` / `:1519`, `setLang`'s assignment `:2127`) | GM6c2's five hunks and §14 Q15's audit | the cuts re-locate by symbol on their parent; the audit's result is unchanged (still two `s.ch` assignments, two `restore` sites, Grep on `cec347c`) |

The shot lanes before GM6c2 (SH1, SH5a, SH5b, SH7 on `game.ts`, shots §9.14) rework `stage()` / `present()` after
LFL; GM6c2's five `game.ts` hunks (§9 GM6c2) are outside both functions, so their cut re-locates them by symbol.
**Reconcile r3 (critique_perplayer_r2 W1):** one property of those two functions is a premise here: a step's batch
is applied (`scene.apply`, the snapshot move) inside the step's intent, since `present()` awaits `stage()` (`:743`)
and the batch's end (`:788`) inside `run` / `after`, and `scene.apply` is called only in `stage()` (`:722`; all on
`cec347c`, which LFL left as on `acc4e0d`: T1 adds one call after the `switch`, `:776`). The labels producer's job
runs after the intent in flight (§6.2 "Producer"), so a rework that ends a step's intent before its batch applies
would let a cut back apply older labels after the job. R-S3 asks the shot lanes to keep the property (beside engine.md
§30 item 12's `stepShown` contract), GM6d1 pins it (`game: a tap while a step's batch loads completes it and starts no
step`, M-PR3c) and GM6d2's cut re-checks it. **Reconcile r4 (LRB merged as `3c62a86`):** the property holds unchanged
there: `scene.apply` only in `stage()` (`game.ts:723`), `present()` awaits `stage()` (`:744`) and the batch's end
(`:789`), the host's `apply` awaits both (`:1380`, `:1385`), `run` / `after` at `:474-492`, `tap` / `queue` at
`:1414-1421` (critique_perplayer_r3: +1 in this region, +13 at the intent entry points; `yields.ts` unchanged); LRB's
`reloadBlocker` counts any intent (`:1752`), so the labels job holds a skew reload for at most one crossfade.
