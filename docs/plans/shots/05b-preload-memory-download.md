### 5.8 Preload policy for cuts (SH5a windows, SH5b entry)

**At each presented step `s`** (text line, choice set, yield return, knot entry, resume), GameSession:
1. computes `stepWindow(look, key(s))` (rev. 5, W1: a `ShotWindow` `{ need, warm, near, hope }`, §4.5; SH5a imports
   it and edits nothing in `story/shots.ts`; rev. 7, W2: wrapped into a `StageWindow` by `withEventRoom`, "The event's
   room" below);
2. passes it **with the step's batch**: `scene.apply(visual, { instant, window })` (rev. 2, W7; rev. 4, C1: §3.4;
   rev. 5: `need` = cur ∪ certain, `warm` = possible, `hope` = d2 then d3, folded by the asset tool); a step whose
   batch is empty still passes it (the swap point is the batch start).

**At each room batch** (rev. 4, W2; rev. 5, m7: keyed by room): the yields host `apply`
(`client/src/app/game.ts:1281-1290`, which every room batch of `client/src/app/yields.ts:365-393` reaches) passes the
window of `r:<room>` for the room the yields' world state is in (`worldOf(s)`, `game.ts:641`; read at the call, after
the action's state was adopted, `yields.ts:277-285`; its `section` / `room` fields verified at SH5a's cut), for a room
batch, an empty batch (`yields.ts:375-377`), a take crossfade (`:416`) and a close-up's clear (`:530`, `:553`) alike:
`stage-route.ts` `roomWindowKey(visual, at, look)`, pure, returns `r:<at.room>` when a section is current, the batch
sets no CG and `look` has the key, else null. A batch that sets a CG (a puzzle close-up, `yields.ts:587-588`) gets
null and passes `{ need: <its own images>, warm: [], near: 0, hope: [], eventRoom: [] }`, so the room's window holders leave as EN's
controller releases its `room:*` there (`controller.ts:157-159`). The start room's records therefore leave the window at the first move, the
window's `cur` is always the room on stage, and the controller's invariant "a move keeps only R and its neighbours"
(`controller.ts:143-161`) holds again.

**The order** (rev. 2, W7): the executor calls its new dep `swapped(window)` at the batch's **swap point** (§5.5),
i.e. after the old shot's holders are released, and the controller forwards it to the scheduler's `want(window)`;
so the old shot never competes with the new window. The executor stays free of the scheduler (it holds the registry
and the adapter only, `executor.ts:94-105`).

**The scheduler** (`client/src/scene/preload.ts`; rev. 5: `want(w: ShotWindow)`, the type from `story/shots.ts`; rev.
7, W2: `want(w: StageWindow)`, `type StageWindow = ShotWindow & { readonly eventRoom: readonly AssetId[] }`, declared in
`preload.ts`, so `story/shots.ts` stays SH3a's alone):
1. releases the window holders (`preload:win:*`, `preload:warm:*`) whose ids are outside `need ∪ warm ∪ hope ∪
   eventRoom` (rev. 7, W2: the event room's class), and aborts their in-flight fetches (rev. 5, m2: round 4 wrote
   `need ∪ hope`, which would drop and re-fetch every held Blob a new window keeps, ~0.5 MB per CU opener per step in a
   `no-store` paid chapter);
1b. (rev. 7, W1) **joins at once**, inside the call and outside the two slots:
   - every `need`, `hope` and `eventRoom` item whose record is decoded or in flight to be decoded
     (`registry.state(id)` is `'live'` or `'pending'`, new in SH5a);
   - every `warm` item whose record exists in any state.

   A join costs no bytes and no fetch and is never refused (`client/src/scene/registry.ts:89-91`), and the holder is
   added synchronously (`:475-480`). A `need` item whose record is held only as bytes is a decode, admitted at step 2.
   `preload(tag, ids)` joins the same way. Today every item waits for a slot (`preload.ts:57-76`), so one call joins
   at most `PRELOAD_IN_FLIGHT` records before its caller's next statement (QO19). `window.pending` counts every `need`
   item whose record is not live, joined ones included;
1c. (rev. 7, W1) at the first `want` after `setChapter(m)`, the scheduler then releases the **entry tag**
   `next:<m.chapterId>` (the tag `setChapter` keeps, `preload.ts:99-104`), whatever the window lists. What 1b joined
   stays; the tag's other records end ("The handover", below). Later `want`s find no entry tag;
2. admits `need` first under STEADY (records only, CH D14);
3. (rev. 4, C1) admits `warm` next: each file is acquired with the holder priority `'warm'` (`preload:warm:<id>`), so
   the registry fetches it and keeps its Blob with no decode, counted at its file bytes under STEADY; once every
   warm file is held, warm files are decoded **in their look order while they fit** (a second holder at `'preload'`
   on the same record, `preload:win:<id>`), so the first branch decodes ahead when memory allows; (rev. 6, m2) a
   decode that does not fit **stops the decodes and evicts nothing**: step 6 runs for a `need` item and a `warm`
   *fetch* only, since a decode is best effort (the branch taken decodes from its held Blob at the tap, S32). So ch1's
   hall with the study resident (29.140 MiB) keeps the gate event's CU opener as bytes (29.140 + 12.226 = 41.366 > 32)
   and keeps `room:study`, as the hall row below assumes;
4. then admits `hope`, then (rev. 7, W2) `eventRoom`, each in order while it fits (best effort, counted by no gate);
5. keeps `PRELOAD_IN_FLIGHT = 2` (`preload.ts:10`) over one ordered queue (rev. 5, m3; round 4 left the order between
   window items and `preload(tag, ids)` callers to the FIFO): `need`; the `warm` fetches `warm[0, near)` (this room's
   own openers; every warm file of a story step, §3.4); **the tag queue** (EN's `room:*`, legacy `preload:<knot>`,
   FIFO among themselves); the `warm` fetches `warm[near..)` (the neighbours' `onEnter` openers); warm decodes;
   `hope`; (rev. 7, W2) `eventRoom`; (rev. 6, W1) **`next:*` last** (rev. 7, W1: joins take no slot, step 1b). Why `next:*` left the tag queue (round 5 put it there, ahead of warm decodes
   and `hope`): under step 6 (c) every refused `need` item or `warm` fetch may evict it and no gate counts it
   (RULINGS 138 (a)), so link time spent on it ahead of the window's own items buys bytes the next exchange may
   discard, while the window's items serve the cuts §1 guarantees; its loss has a designed outcome, the half-tier
   entry at the handover (S23: the first line over half files, sharp ~2.6 s later on the e2e link, R5.4). The cost of
   the move: on a slow link the next chapter's opening lands later in the ending knot (one 1080 CU, 317,515 B, is
   ~1.6 s + its RTTs on the e2e link after the window's items, A), and a player who reaches the handover first gets
   that entry. The scheduler classes a tag by its `next:` prefix, as `setChapter` already does (`preload.ts:101`).
   Why the rest of the order (A, R5.4, ch1's hall on the e2e link): with this order the hall's own openers are held at ~3.3 s, the
   study neighbour at ~4.9 s, the cellar's opener at ~6.8 s; with EN first, the study at ~1.6 s and the openers at
   ~4.8 s. A move has a designed wait (EN's `ui-state:waiting` motion from `WAIT_DELAY_MS`, engine.md §6.3 "Preload",
   as read) and a story cut has none (§1), so the move takes the delay; on a 2 MB/s link (E) the whole set lands in
   ~0.9 s either way;
6. (rev. 3, W2; rev. 4: `warm` too; rev. 5, W2: every step; rev. 6, m2: a `warm` fetch, never a warm decode) **a
   `need` item or a `warm` fetch refused `over-cap` evicts, then retries:** (a) every resident `hope` holder of this
   window, last first (d3, then d2; rev. 7, W2: the event room's files are not `hope`, they go at (d)), then the decode holders of
   decoded warm files, last first (the record **sheds** back to its held Blob, see below): one holder per item
   (`preload:win:<id>`), released with `releasePreload`, so `setChapter`'s `preload:` family release still covers
   them; (b) if still refused, **at any step** (a room window, a story step inside a room event, any other), the
   `room:<r>` holders none of whose ids is in `need ∪ warm ∪ eventRoom` (rev. 7, W2): first those none of whose ids is in `hope` either, then
   the rest; within each group **the most recently requested first**, skipping a tag that holds no record (its own
   acquire was refused). Rev. 6 (W2, RULINGS 138 (b)): the recency is SH5a's to implement, not a property of today's
   code. The scheduler's tag order is `const tags = new Set<string>()` (`preload.ts:42`) and `preload()` calls
   `tags.add(tag)` (`:113`); a re-added element keeps its first position, so round 5's "`preload(tag, ...)` moves its
   tag to the end ... `preload.ts:42`, `:109-126`" stated a property the code lacks (critique r5 W2). SH5a writes
   `tags.delete(tag)` before `tags.add(tag)` in `preload()`: the one `tags` structure that `setChapter` (`:100-104`),
   `releasePreload` (`:84-88`) and `destroy` (`:153-156`) iterate keeps its role, and none of them depends on its order.
   On the hall -> study path EN requests `room:study`, then `room:hall` at the study (`controller.ts:172-177`), so the
   order is [study, hall] and the hall goes first. Recency alone cannot rank the event's room on every path: EN's
   `roomShown` returns while a story is pending (`controller.ts:169`), so at an `onEnter` event the event's room was
   last requested as a neighbour of the previous room, after it ([hall, cellar] at the cellar's voice event), and
   would go first. Therefore **inside a room event GameSession passes the event room's files as the window's
   `eventRoom`** ("The event's room", below; rev. 6 appended them to `hope`, critique r6 W2), so (b) skips that room's
   holder on every path and (d) takes it last; recency orders the rooms inside each group of (b), and at a room window
   (where `hope` and `eventRoom` are empty) it decides which neighbour a refused far `warm` fetch evicts. At a room
   window the room on stage is in `need` (its `cur`), so it is never evicted there; inside an event its holder is, at
   (d). (c) (rev. 6, W1, RULINGS 138 (a)) If still refused, the
   **`next:<id>` holders** none of whose ids is in `need ∪ warm`, a whole tag at a time (`releasePreload(tag)`, as (b)
   does per room): the next chapter's first window, requested at an ending knot's entry (`game.ts:1038-1044`), is
   counted by no gate and reclaimed here, so the gate and the runtime count one set in an ending knot too (critique r5
   W1: round 5's (a) and (b) could not reach it, and the closing wide fetched at its tap). `preloadNext` re-requests it
   only at the next ending-knot entry; a handover whose `next:` holder was evicted enters the next chapter at the half
   tier (S23, designed for "a handover whose preload did not land"). (d) (rev. 7, W2) If still refused, **the
   event's room, last**: the window's `eventRoom` holders (`preload:win:<id>`), last first, then the `room:<r>`
   holders with an id in `eventRoom` and none in `need ∪ warm`, most recently requested first. Rev. 6 put these
   files at the end of `hope`, so (a) released them first. Where the window's holders alone held the room, the event's
   room went first, not last (critique r6 W2). That is ch1's cellar: `room:cellar` was refused at the hall, and
   `roomShown` stays silent during the event (`controller.ts:169`). (c) precedes (d) because the event room serves this
   event's return, and the next chapter's files serve only its entry, whose loss has a designed outcome (S23). Round 4 scoped (b) to "an explore room" and "never the current room's", which left EN's
   ~22.5 MiB resident under a room event's exchange and refused its every cut (critique r4 W2). EN's next `roomShown`
   re-requests every evicted holder as an idempotent join (`client/src/explore/controller.ts:163-179`; its `tracked`
   set only lists names, and `releasePreload` is idempotent, `preload.ts:78-91`); a move to an evicted neighbour
   loads on tap under its waiting motion, as a third neighbour does today (EN §6.3 "Preload", as read); interface
   request I-14. Evicted `hope` and `eventRoom` items are re-queued after every `need` and re-admitted only while they fit;
7. **a `need` (or `warm`) item still refused is deferred**, not dropped (today a refused preload is dropped,
   `preload.ts:67-73`): it is re-tried, ahead of `hope`, at every later `want` and at every `retry()`, which the controller calls when the
   executor's dep `released()` reports a sweep that dropped a holder (`sweep`, S4 §1.2); a deferred item outside a
   newer window is forgotten. A refused `hope` or `eventRoom` item is dropped (today's rule).

**The warm form** (rev. 4, C1; the registry and the loader, SH5a). `Priority` gains `'warm'`
(`client/src/scene/registry.ts:67`):
- a record whose holders are all `warm` is **held**: the loader fetched the file and keeps its Blob, nothing is
  decoded; it counts `ref.bytes` (the file) under STEADY like a preload's reservation (`registry.ts:189-194`);
- a `visible` or `preload` holder joining a held record **decodes it from the Blob**, with no fetch: the loader's
  existing decode-from-kept path (`createImageBitmap(kept)`, `client/src/scene/loader.ts:42-45`, the same call
  `revive` makes at `:95-98`); admission is for the decoded bytes, as today;
- a live record whose last `visible` / `preload` holder leaves while a `warm` holder remains **sheds**: its texture is
  destroyed and its bitmap closed, its Blob kept, so it counts its file bytes again;
- visible admission evicts every `preload` holder first (today, `registry.ts:344-351`), then the `warm` holders of
  other records; a warm record has no texture, so a context loss revives nothing for it;
- the last holder leaving drops the Blob, as `release()` does today (`loader.ts:114-122`);
- (rev. 5, m5) stats: `warm` = the records that have a `warm` holder, held or decoded ahead; `warmBytes` = the file
  bytes of the held ones (the e2e's signals; `overCap` counts only visible refusals past HARD, `registry.ts:344-353`).

**The branch cut** (C1): at a choice tap the next step's batch `ensure`s its opener at visible priority. A decoded warm
file is live (0 wait); a held one decodes from memory (S-D (1c): E <= 250 ms p95 for a CU's plate, sheet and face
file); a file whose fetch had not finished is joined in flight (today's join, `registry.ts:356-379`).

**The event's room** (rev. 6, W2; rev. 7, W2: its own class). It applies at a presented step that meets both
conditions:
- its world state has a current section and room (`worldOf(s)`, `game.ts:641`; SH5a's STOP-verify);
- its window key is not that room's `r:` key (a story step inside a room event, an `onEnter` one included).

There GameSession passes `withEventRoom(w, stepWindow(look, 'r:' + room))` (`stage-route.ts`, pure), a
`StageWindow`. It is `w` with `eventRoom` = the room window's `need` files that `w` does not already list in any
class, in order. With no current section, at the room's own window, or with no `r:` key, `eventRoom` is empty. A
leave knot's steps get none, since a leave sets `section` to null (`client/src/explore/reduce.ts:413-415`).

How the scheduler treats `eventRoom`:
- it is fetched and decoded best effort after `hope` and counted by no gate, so the gate's set does not change;
- step 1 keeps its holders, and step 6 (b) skips the room's `room:<r>` holder;
- step 6 (d) evicts the class and that holder **after every other family**. Rev. 6 appended these files to `hope`,
  which step 6 (a) evicted first, so the event's room went first wherever the window's holders alone held it
  (critique r6 W2);
- a file that is not live is fetched while it fits. That is an `onEnter` room whose neighbour preload was refused at
  the previous room, with the room batch's holders gone: the ch1 cellar's case at 29.140 + 11.262 > 32. So the return
  can land before the event's last step, where it is `certain` and charged (§3.4);
- a live file stays live, because its window holder survives every swap of the event (each step's window uses the
  same `preload:win:<id>` name).

Exposure: an `eventRoom` file evicted at (d) under an exchange and re-admitted at a lighter later step re-fetches in a
paid chapter (`no-store`). That happens at most once per such pair of steps, the same exposure d2 / d3 `hope` has
today.

The critic's sequences (A, §5.9 rows; rev. 3 replaces round 2's paragraph, which assumed the wide was released):
- **wide -> CU A -> CU B -> wide** (a re-establishing wide, S3 F3). At CU A's swap the wide's scene holders go, but its
  `preload:win:` holder stays (it is `hope` d2 of this window): live = 10.169 + 12.703 = 22.872; `need` CU B ->
  35.575, refused; step 5 (a) releases the wide -> 25.406, CU B admitted; the wide is re-queued and refused (harmless).
  At CU B's swap the window is `need {CU B, wide}`, `hope {CU A}`: CU A (resident, hope) is evicted the same way and
  the wide admitted (22.872). No cut waits. Round 2 kept the wide and froze the line ~1.6 s + RTT at CU B.
- **An explore room** whose events cut first to an OTS (rev. 4): live = room 16.562 + one neighbour 11.262 = 27.824;
  the OTS opener is `warm` at 0.391 -> 28.215, held with no eviction; at the event's tap it decodes (visible,
  under HARD: 28.215 + 10.694 = 38.909 <= 48). Round 3 evicted the neighbour for a decoded `need`.
- (rev. 4, C1) **A choice at CU A whose replies open on CU B and CU C:** `need` = CU A (live 12.703); `warm` = CU B,
  CU C at 0.477 each -> 13.657; CU B decodes ahead (26.360 <= 32), CU C stays held (39.063 > 32). Tap B: 0 wait; tap
  C: visible decode from memory (evicts CU B's decode holder, which sheds to its Blob). Round 3's gate failed this at
  38.109.
- (rev. 4, C1) **ch1's `manor` hall** (`story/ch1/world.json:66-96`): `r:hall` = room 16.562 + `warm` {`street` wide
  of the leave knot `manor_out` (`story/ch1/main.ink:75`), the opener of `manor_gate_forced` (`world.json:89`), the
  opener of `manor_cellar_voice` (the cellar's `onEnter`, `world.json:122`, one exit away)} = 0.362 + 2 x 0.477 ->
  17.878 MiB with CU openers; with the neighbour resident 29.140 <= 32. Moving to the study hands `r:study` (the hall's
  two knots one exit away, the study's none): 16.562 + 0.362 + 0.477 = 17.401; the hall's window holders leave.
- (rev. 5, W2) **An exchange inside a room event** (the critic's sequence: the hall with the study resident, a hotspot
  event cutting CU A -> CU B -> CU A -> CU B, then the return; §5.9 rows):
  - the tap: CU A decodes from its held Blob (visible): 27.824 + 1.316 + 12.703 = 41.843 <= 48 (rev. 6, m8: 41.366
    exact, since CU A's decode replaces its own held 0.477; the rows keep 41.843 as the conservative figure);
  - CU A's swap: the hall's `scene:*` holders go (props, labels, the plate's scene holder; `executor.ts:292-322`), the
    `r:hall` window's warm holders go (step 1); rev. 6 (W2): the hall's own files (shot, props, decor) stay under
    `preload:win:` as the window's event-room files (rev. 7: its `eventRoom` class, "The event's room"), and
    `room:hall` and `room:study` keep the two room shots: 11.262 + 11.262 + ~3.3 (the hall's props, E) + 12.703 =
    38.527 (round 5, without them: 35.227);
  - the step's window: `need` {CU A, CU B (certain, distance 1)}: CU B -> 51.230 refused; (a) nothing resident in
    `hope`; (b) first group: `room:study` (outside every class; `room:cellar` holds nothing: it was refused over STEADY
    at the hall) -> 39.968, still refused; no second group, no (c); (d) rev. 7: the event's room, the `eventRoom`
    holders last first (the props go, -3.3 -> 36.668; the hall's bg and sheet stay under `room:hall`), then
    `room:hall` -> 25.406, CU B admitted (rev. 6 reached the same 25.406 through (a) and (b)'s second group). Every
    later cut of the exchange is 25.406 at its swap, the gate's own row;
  - the event's last line (on CU B): `need` {CU B, the hall's shot, props, decor (certain, the return, §3.4)}: CU A
    leaves at step 1 (or, if hope, at (a)) -> 12.703 + 16.562 = 29.265, admitted; the hall's evicted files come back
    while the last line is read (public files from the HTTP cache plus a decode; a paid chapter's ~348 KB over the
    network, ~2.2 s on the e2e link with one RTT per file, A: 0.45 + 1.74 = 2.19; rev. 6, m1: round 5 printed ~2.0 s);
    a tap before that waits under the room batch's
    `ui-state:waiting` motion (EN §6.3 "Preload", as read), the same wait a move to an unloaded room has;
  - the return: the room batch finds the hall resident (0 wait) and hands `r:hall`; `roomShown` re-requests `room:hall`
    (a join) and `room:study` (a fetch, ~1.6 s on the e2e link in a paid chapter; a move before it lands waits under
    EN's motion).
  Round 4 left EN's 22.5 MiB resident: CU B was deferred and every cut of the exchange fetched at visible priority
  (~1.8 s each on the e2e link, critique r4 W2).
- (rev. 6, W2; rev. 7, W2: ch1's own case) **An `onEnter` event** (ch1's cellar voice, `story/ch1/world.json:122`):
  - at the move EN keeps {cellar, hall} and `roomShown` returns early (`controller.ts:169`), so the tags stay [hall,
    cellar] in the order the hall's `roomShown` gave them;
  - in ch1 `room:cellar` holds nothing (refused at the hall, 29.140 + 11.262 > 32). The cellar's shot and props are
    live under the room batch's scene holders and `r:cellar`'s window holders only;
  - at the event's opening cut the scene holders go, and the window's `eventRoom` holders alone keep the cellar:
    live = cellar shot 11.262 + props ~3.3 + `room:hall` 11.262 + CU A 12.703 = 38.527;
  - a face change's file (1.633) -> 40.160, refused; (a) nothing; (b) `room:hall` (outside every class) -> 28.898, the
    face file admitted. The cellar stays: it would go only at (d);
  - rev. 6's (a) dropped the tail first (-14.562 -> 25.598): the cellar went, the hall stayed, and the return
    re-fetched the cellar (critique r6 W2);
  - where `room:cellar` also holds records (rooms smaller than ch1's): 35.227 -> 36.860 -> (b) `room:hall` -> 25.598.
    (b) skips `room:cellar` because it has ids in `eventRoom`; recency alone would have taken it, as the most recently
    requested.
- (rev. 6, W1) **An ending knot** (the critic's sequence: a final choice at CU A, the next chapter owned, §5.9 row):
  - the choice: `need` CU A, `warm` CU B, CU C held: 13.657; the next chapter's load returns and `next:ch2` lands its
    opening wide at the queue's tail: 23.826;
  - reply B: CU B decodes from its Blob (visible): 12.703 + 12.703 + 0.477 + 10.169 = 36.052 <= 48; at B's swap CU C's
    warm holder goes (step 1): 35.575;
  - the step before the closing wide: `need` {CU B, wide (certain)}; CU A left at step 1: 12.703 + 10.169 = 22.872;
    the wide -> 33.041 refused; (a) nothing; (b) no `room:*` holder; **(c) `next:ch2`** -> 12.703, the wide admitted at
    22.872; the closing cut waits nothing (round 5: deferred, fetched at the tap, ~1.4 s on the e2e link, critique r5
    W1);
  - had `next:ch2` landed both opening shots (22.872), every new shot of the ending knot would read one CU + 22.872 +
    the next CU = 48.278 and evict it the same way;
  - the handover: `next:ch2` holds nothing, so the next chapter's first step enters at the half tier (S23; on the e2e
    link the first line over the half files, sharp ~2.6 s later, R5.4).
- (rev. 7, W1) **The handover** (the critic's sequence: ch3 -> ch4, ch4 owned, `next:ch4` fully landed. It holds
  `k:lamp`'s `need`: `lamp_wide`'s files and `lamp_keeper_cu`'s, 10.169 + 12.703 = 22.872 <= 32):
  - `setChapter(ch4)` releases ch3's `preload:*` holders and keeps `next:ch4` as the entry tag (`preload.ts:94-107`);
    `restore(EMPTY_SNAPSHOT)` (`game.ts:834-835`) releases ch3's scene holders and passes no window;
  - the first `present`: `ensure` joins `lamp_wide`'s live files, and `apply` takes their scene holders
    synchronously (`executor.ts:259`). `enterKnot` runs (`game.ts:708-710`) and, rev. 7, releases nothing (`:1018`
    removed);
  - at black, ~400 ms later, the swap point's `want` runs (`scene:` defaults to `fade`, 800 ms,
    `client/src/story/tags.test.ts:48`; the command type `staging.ts:31`; `executor.ts:439-452`, `:527-530`). Step 1b joins all of `k:lamp`'s `need`, since both shots' files are live.
    Step 1c releases `next:ch4`: no record ends, nothing is fetched, and `previews` stays 0 (entry step 1);
  - a cut opener (`t=cut`) swaps in the chained build (`executor.ts:667-694`), also after `enterKnot`, so the order
    is the same;
  - round 6 (critique r6 W1): `:1018` ended the CU's records before the swap. The window re-fetched 119,068 B of half
    files, then 317,515 B of full files (436,583 B, paid, `no-store`), and the CU stayed soft for at least 2.2 s on
    the e2e link.

**Images per shot:** a shot in a window means `bg/<s>` + `sheet/<s>` + (rev. 4) the face files in effect and (rev. 5,
m1) their talk files (§2.6, §5.2); a room in effect adds its props and decor state images (usage `props`); labels are drawn, not fetched, and the gate counts their
bound (§3.4).

**Room props on a story cut** (rev. 2, W8): `stage()` (`game.ts:647-654`) passes the visual batch through
`stage-route.ts`' `withRoomProps(batch, roomFor)`: a batch whose `bg` / `scene` names the bg of a room of the current
section gets the list `roomFor(bg)` appended verbatim (GM3b's `props`, then per-player GM6d2's `labels`), from `Yields.roomFor(bg): readonly VisualCommand[] |
null` (I-11: today's `roomProps`, `yields.ts:158-169`, and after GM3b `visualsOf`). So a cut back to the room inside an
event shows its drawers, items and decor states as the world has them; `imageIds` then ensures them.

**Resume order** (rev. 2, W5): `restore(snapshot)` awaits only the visible top image (the CG when the snapshot has one,
else the shot's drawn files); the covered shot under a CG loads at visible priority without blocking the first line.

**Entry at the half tier** (rev. 3, C1; S23). The first step after every `enterChapter` (a fresh start from Home, a
resume, a handover) and its `restore` pass `{ preview: true }`:
1. `ensure(ids, signal, { preview: true })`: an id whose record is neither live nor in flight starts a **preview
   record** from its entry's `half` file (when it has one and the session tier is `full`); a live or in-flight record is
   joined as it is (a handover whose `next:` preload landed costs nothing; rev. 7, W1: the first window joins those
   records before the scheduler releases the tag, S36). On LOW the session tier is already `half`
   (`layout.ts:79-82`), so `preview` changes nothing there.
2. The batch applies; the first line shows over the half files. They lay out on the full file's canvas at resolution
   0.5 (`layout.ts:32-46`), so the shot view, frames and hotspots are identical to the full tier's.
3. At the batch's swap point the controller upgrades every preview record, top image first (CG, then plate, then
   sheet), **one at a time at visible priority**: `registry.upgrade(id, signal)` fetches the full file, decodes it,
   sets it as the same `ImageSource`'s `resource` and calls `source.resize(canvas.w, canvas.h, 1)` (Pixi documents
   `resize(width?, height?, resolution?)` and a settable `resolution`,
   https://pixijs.download/release/docs/rendering.TextureSource.html, read 2026-11-03; verify on 8.22 at SH5's cut, the
   way `revive` already swaps `resource` in place, `client/src/scene/loader.ts:80-113`). The texture object, its frames
   and every display object stay; the record's counted bytes rise from half to full, admitted under HARD (visible).
   Fallback if 8.22 cannot change a source's resolution in place: the registry replaces the record's `Texture` and the
   executor re-points the shot's nodes at the new handle (one pass; the layout is unchanged by I4).
4. (rev. 4, W1; round 3 admitted the window only after every upgrade) **At the same swap point the step's window is
   admitted beside the upgrades**, with `{ preview: true }` for its `need` items: each `need` file not live or in
   flight starts as a preview record from its half file at preload priority (the scheduler's two slots), so the
   first cut's half files travel beside the visible upgrade. `warm` and `hope` follow once the visible upgrades and the
   `need` previews are done. Each `need` preview is upgraded in place after the visible records (the same
   `registry.upgrade`, one at a time). Link order on the e2e link (two transfers sharing 200,000 B/s, A): the CU's
   visible full files 317,515 B and the first cut's CU half files 119,068 B start together; the half files land at
   0.15 + 119,068 / 100,000 = **1.34 s**, the visible shot is sharp at 1.34 + (317,515 - 119,068) / 200,000 = **2.33 s**
   (round 3: 1.74 s), and the first cut is sharp at 2.33 + 0.15 + 317,515 / 200,000 = **4.07 s** (round 3: resident
   at ~3.5 s at the earliest, critique r3 W1). A tap before 1.34 s waits for the half files at visible priority. The
   cost is ~0.6 s more of the soft entry picture (OQ15). **Rev. 5 (m6) supersedes these three times:** they count one
   RTT per stream, but the visible upgrades run one file at a time (plate 225,000, sheet 48,907, face 43,608 B, each
   after its own 150 ms RTT) and the four need previews (half plate 84,375, sheet 18,340, face 16,353, talk 2,049 B)
   share the two slots, each after its RTT. Per-file model, every transfer in flight taking an equal share of
   200,000 B/s (A, timeline in R5.4): the first cut's half files land at **~1.18 s**, the visible shot is sharp at
   **~2.64 s**, the first cut sharp at **~4.68 s** (its upgrades after the visible ones; its talk file, motion, at
   ~4.86 s); on a 2 MB/s link with a 50 ms RTT (E) ~0.15, ~0.37 and ~0.68 s. A tap before ~1.2 s waits for the half
   files at visible priority.
5. An upgrade that fails (offline, 401 after one re-auth) leaves the preview record valid at half; it is retried at
   the next swap point, at most 3 times per chapter; `__novelDebug.stats().scene.previews` counts live preview
   records for the e2e.
Memory: during an upgrade a record holds its half texture (CU 3.19 MiB) and the full decode in flight (12.7 MiB): the
peak is the full shot plus 3.19 MiB (A, §5.9); rev. 4: plus the first cut's previews (a CU 3.19 MiB), 19.08 MiB.

**Other paths:**
- **Next chapter** (`preloadNext`, `game.ts:980-1006`): the next chapter's `k:<firstKnot>` window from its
  manifest's `look` (its `need`, under `next:<id>`). Rev. 6 (W1, RULINGS 138 (a)): queued after `hope` (step 5) and
  evictable by step 6 (c) at every step of the ending knot; the gate charges nothing for it; the handover joins what
  landed and enters at the half tier for what did not. Rev. 7 (W1, S36) replaces round 6's "the handover's order is
  today's ... verify at SH5a's cut", which fails: `enterKnot` released the tag before every swap point (critique r6
  W1). Now:
  - the scheduler ends the tag at the first window of its chapter, after step 1b joined it (step 1c, "The handover"
    above);
  - GameSession's `releasePreload('next:' + ch.id)` at the handover (`game.ts:1018`) is removed;
  - `hold` there keeps its sounds and, in a chapter without `look`, its knot images, which step 1b's rule for
    `preload()` joins at once.
- **Audio** stays knot-level (`hold`, `game.ts:965-977`, sounds only).
- **Missing key** (an old manifest): falls back to the knot index.

**Skip mode** still awaits each `ensure` (link-bound; S4 §3.5: 150 unseen 225 KB shots ~169 s at 200,000 B/s, A).
D1-D3 prefetch overlaps it.

**Ruled since: RULINGS 295, 297, 299, 301, 302, 309, 311, 314** — as built (SH5a `48489b7`, lock 15; cut r4 and its
Addendum (RULINGS 302)). Where this section and the points below differ, the points hold.
- **Every presented step hands a `ShotWindow`** (D1, `client/src/app/game.ts:732-747`, `windowOf`): a line by its ID,
  a choice set by its first choice's ID, else `k:<knot>`, through `windowFor` (`client/src/app/stage-route.ts:143`),
  which adds the event's room inside a room event (`withEventRoom` `:133`, the `StageWindow` of
  `client/src/scene/preload.ts:22`). An **end step hands the empty window** (`EMPTY_WINDOW`), and so does a chapter
  without a decoding `look`, so the entry tag still ends; a **yield step hands none** (D13), so the previous window
  stays through it; `restore` hands none.
- **Every room batch hands `r:<room>`'s window** (`roomWindow`, `game.ts:750-759`, keyed by `roomWindowKey`,
  `stage-route.ts:160`): while a section is current and the batch sets no CG; a room's props come back on a story cut
  (`withRoomProps` `:172`).
- **The swap point:** the executor reports a batch's window once, at its swap point, after the old shot's holders
  are released (`swapped`, `client/src/scene/executor.ts:445`); any other sweep that freed a holder reports
  `released` (`:447`), and the controller forwards both to the scheduler's `want` / `retry` through one seat
  (`windowDeps`, `preload.ts:62-64`). A batch settled by the executor's `destroy` reports no swap (IMPL-2, carried to
  the next `game.ts` holder).
- **Steps 1-6 and step 6's eviction order** (`want` `preload.ts:458`, `retry` `:497`, `evictFor` `:256`, `shedFor`
  `:289`, `readmit` `:225`): a refused `need` item or `warm` fetch evicts (a) the window's resident `hope`, then its
  warm decodes, shed back to their held files; (b) EN's `room:` and `state:` holders (`EN_TAG`, `preload.ts:83`;
  RULINGS 297 D4) with no id in need, warm or the event's room (none in `hope` first, the most recently requested
  first); (c) the `next:*` holders; (d) the event's room, last. `need ∪ warm` is spared.
  A visible ask never evicts its own warm holder, a refused warm fetch runs step 6, and no step outside a section has
  an `eventRoom` (the three rules fix4 pinned, RULINGS 311).
- **The warm form** (`client/src/scene/registry.ts`, priority `'warm'` `:82`, state `'held'` `:110`, `state(id)`
  `:163`): a warm file is fetched and held as a Blob with no decode, counted at its file bytes; at the tap a visible
  ensure decodes it from the held Blob with no fetch. The Blob stays as the record's `keptBytes` while it lives
  (`:45`, `:280`), for revive after a context loss, as on main.
- **Joins take no slot:** a request for a record that is live or decoding joins inside the call, outside the
  `PRELOAD_IN_FLIGHT` slots (`preload.ts:14`); a held record's decode is queued as a decode.
- **The entry tag** `next:<id>` ends at the chapter's first window, after that window joined its files (step 1c).
  **S36's handover:** GameSession no longer releases `next:<id>` at the handover (`enterKnot`, `game.ts:1133-1148`),
  and `preloadNext` (`:1100-1131`) asks the next chapter's `k:<first>` window from its own `look` (need, warm, then
  hope, each id once) plus its first knot's `char/` sprites.
- **`hold` keeps only `char/`:** with a decoding `look`, a knot hold keeps its sprites and sounds and no bg, CG or prop
  (`game.ts:1084-1097`); the windows ask for those. Without a decoding `look` it keeps every image, as before.
- **Ruled: RULINGS 302** — Q9: SH5a's engine STOP was judged on the **net** delta: the measured engine delta minus
  the measured share of `story/shots.ts`'s `decodeLook` + `stepWindow`, which land here without a term (SH3a's
  decoders' 1.0 was booked at SH4), against +3.112 KB; a raw delta above +3.612 KB stays a STOP; the 230,000 B row and
  the ledgers bind on the raw figures; the R sample is net / 1.3. MEASURED: +2,211 B raw on `aac7a97`, +1,657 B net,
  sample 1.27; on the merge tree +2,286 B ([engine §11.1](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)).
- **P-entry (RULINGS 309, 269):** the entry row's +119 B br (two hashed chunk names, the texts byte-identical after
  normalising) is no entry change: an entry row is judged by module identity across a build-id change.
- **Open, carried with owners (`carry.md` "SH5a carries"):**
  - **gap (i)'s bound is false on built ch1** (memory lens F1): a runtime window exceeds its own row by a whole
    decoded plate (arrival a001-a012 8,853,770 B, `bg/hall`; street s001-s004 8,855,284 B, `cg/letter`), masked at the
    chapter level; owners the next `client/scripts/budget.ts` holder and SH11;
  - **a room's warm openers are fetched again on every room entry** (player lens V1; real ch1 25 vs 15 GETs; a paid
    explore chapter pays it in full, `no-store`); owners the preload-priority lane (RULINGS 152 Q14 (b)) and SH5b;
  - **no preemption:** a need queued behind in-flight hope or warm fetches waits for them (player lens V2, the same
    class as main's FIFO knot preloads); owners the preload-priority lane and SH5b;
  - with them: a warm decode may refill the room step 6 (a) freed for a deferred need (memory lens F2), and ch2's
    opening bg is not resident at the ch1 -> ch2 handover (V5, as on main), both to the preload-priority lane and SH5b.

**Ruled since: RULINGS 320-325, 330, 332, 336, 340, 343, 346** — the half-tier entry as built (SH5b `f6487fc`, lock 14;
cut r1-r8, `sh5b-shot-entry/cut.md`; as of `f6487fc`; docs lane `docs-errata-19`, group A). Where it differs from
"Entry at the half tier" above, this text wins:
- **Which steps preview.** `Session.entry` (`client/src/app/game.ts:375`): `'entered'` by `enterChapter` (:953), `'first'`
  at the next `present` (:782), `'none'` after it; a resume inside the current chapter is no entry (:1051, the full
  tier). So a fresh start, a resume, a handover and an in-session chapter load stage their first step, and the
  `restore` before it, from the half files (`ensure` / `apply` / `restore` with `preview`, the registry's
  `previewing`, `scene/registry.ts:174`, :814; `AcquireOptions.preview` :103). A step's preview arm, the executor's
  options and the holders at return are `applyStep` / `restoreStep` (`scene/controller.ts:279`, :296).
  Changed by RULINGS 324 (as of `f6487fc`; docs lane `docs-errata-19`, group A, fix round 1): the entry has three ends, whichever comes first
  (fork r3-1, `Session.entry`'s doc `game.ts:370-374`): its first windowed stage (`stage`, :729-731; a windowless
  entry stage hands `KEEP_WINDOW` and keeps the entry), the next `present` (:782), or a resume inside the current
  chapter (:1051).
- **Step 3 as built: the chain runs in the scheduler, not the controller, and starts at the swap point** (RULINGS 330).
  `scene/preload.ts`'s `kick` (:462) upgrades one preview at a time, outside the scheduler's two slots (`upgrade`
  :435-451): visible records first, then the others, each by `UPGRADE_ORDER` (:104: cg, bg, sheet, face, talk, char,
  prop), then in start order. The first upgrade of an entry starts at its first swap point (`swapSeen`, :151, set in
  `want` :590, cleared by `setChapter` :531); a settle, a join settle, a release `retry` or a knot hold before it only
  carries the chain ("upgrades start at the swap point; settles only carry the chain"). On a fresh ch1 start the first
  full file moves from just after the line to the `scene:` dip's black, about 400 ms after `apply`; at a handover or an
  in-session load no full file starts while the first step's halves are awaited.
- **R1, a warm decode kept across step 1c** (Changed by RULINGS 321, 322, 324 (as of `f6487fc`; docs lane `docs-errata-19`, group A, fix round 1); RULINGS 302 Q8,
  RULINGS 322 O3, 324 r3-4; commit `f166f21`). When `want` ends the entry tag (`scene/preload.ts:627-641`, only while
  `entry !== null`), each warm file of the window that the entry tag holds and that is still `live` joins its window
  holder at decode rank, so the release never sheds it to its file for step 3 to decode again. Only the entry tag's
  own records, and only at that release.
- **Step 3's swap.** `registry.upgrade(id, signal)` (`scene/registry.ts:185`) through the loader's in-place
  `upgrade` (`scene/loader.ts:138-166`): the same texture, its `resize` at the full canvas, and the stored box checked
  against the decoded size (a mismatch is a `decode` failure and the half stays). Upgrade admission evicts nothing: it
  is admitted under HARD while a visible holder holds the record, else under STEADY.
- **Step 4's gate.** `want` closes the entry gate only when the window is an entry's and the session tier is `full`
  (`gated`, `preload.ts:601`): a half-tier session (LOW, or one demoted) is never gated. The gate opens once no visible
  preview is untried or upgrading and no NEED item is queued, in flight or joining. A windowless entry stage hands
  `KEEP_WINDOW` (:35), whose `want` is a `retry` and whose swap counts as a release.
- **Step 5 as built.** `UPGRADE_TRIES` 3 per record (`registry.ts:31`, the refusal :652), not per chapter; an upgrade
  not answered within `UPGRADE_DEADLINE_MS` 20 s (:39, :670-677) is aborted and counts a failed try, the half stays
  (C-r6-1: a full file that needs longer on a slow link is retried and the half kept). Every successful upgrade asks
  the on-demand render loop for one frame (`sharpened`, `preload.ts:122`, :448; `controller.ts:530`, D-r6-1); a
  failure, an abort, a chapter change, a revive or a call after destroy asks none.
- **The refund rider.** A resume into a paid chapter refunded since its save: the server's 403 (`not-entitled`)
  opens D11's paywall over an empty stage with the save body kept whole (`game.ts:1023`, `pendingPaid` :1367); a
  purchase resumes it as saved (`startPending` :1302); every other failure shows the chapter error notice
  (`chapterFailed`). No paid byte is fetched after a refund (Principle 0).
- **Memory (review M1, memory F2; F5's label).** `RegistryStats.bytes` counts the full file and decode an upgrade in
  flight reserves, so `liveBytes` (`bytes - keptBytes`) includes upgrade reservations (`registry.ts:104-109`); e2e
  F5 logs `shots F5: entry reservation peak liveBytes ...` (`client/e2e/shots.spec.ts:619`). Changed by RULINGS 321 (as of `f6487fc`; docs lane `docs-errata-19`, group A, fix round 1):
  F5 asserts the at-rest bound (RULINGS 321 Q2): once `previews === 0` (`shots.spec.ts:600-612`), `liveBytes` at rest
  is at least the full decodes of the wide shot's plate and sheet (`:631-632`); the rise from the line to rest is only
  logged (`:627-629`), not asserted. MEASURED at ch4's a001:
  the reservation peak 23,497,523 B (22.41 MiB), the GPU textures 22,637,784 B (21.59 MiB), above this section's
  19.08 MiB model and the ≈ 20.6 MiB model row (the step-window row plus the one half); the runtime a001 bound is
  F5's measured peak, beside SH5a's memory F1 (the step model does not see the entry's one-half transient; carried to
  the next `client/scripts/budget.ts` holder and SH11).
- **e2e.** perf.spec G2's batch rule: the stage awaits the halves, the full files are the upgrades, with an ordering
  guard (the first full file starts at or after the halves' end); memory.spec's two tests amended (RULINGS 321).
  FYI-7: the TTFL model does not see a handover's halves.
- **Open, carried with owners (`carry.md` "SH5b carries"):** P3, a failed full-tier window need asked again at every
  step, and FYI-9, the stale `window.pending` under the paywall (`preload.ts:653`), to the preload-priority lane;
  FYI-6, G2's guard on a cut-opened ch1, to the next `perf.spec.ts` holder; FYI-9 (refund lens), a refunded chapter's
  read-line text in its save, to the next `save-codec.ts` holder or the security pass. SH5a's V1, V2 and V5 above stay
  with the preload-priority lane.

### 5.9 Memory ledger and arithmetic (gate counts = decoded + the larger kept file, `budget.ts:806-808`)

**Inputs** (E unless noted; rev. 2 re-computes the sheets for the per-expression model of S3, the full small-face set
of S30 and an ambient allowance):
- plate 1080 x 2048 x 4 = 8,847,360 B (A) + WebP kept 340,000 B (E; AVIF 225 KB) = **8.762 MiB**;
- plate 1440 x 2048 x 4 = 11,796,480 B (A) + WebP kept 453,000 B (E, 340 KB x 1440 / 1080) = **11.682 MiB** (m10);
- close-up sheet, rest + one expression `x`, both spoken in, 2 hair locks: rest set `half` 52,000 + `closed` 52,000 +
  `talk1`, `talk2` 2 x 19,800 + `accent` 32,000 = 175,600 px; `x`: layer 180,000 (a 400 x 450 face box) + its own
  `half`, `closed`, `talk1`, `talk2`, `accent` 175,600 = 355,600 px (the upper bound: `x` changes every box); hair
  2 x 109,200 = 218,400 px. Total 749,600 + 15 % packing = 862,040 px: 3,448,160 B + 160,000 kept = **3.441 MiB**;
- OTS sheet (one face at 0.36 of the CU area, rest + `x`, + 2 locks of 60,000 px): 311,232 + 15 % = 357,917 px:
  1,431,668 B + 70,000 kept = **1.432 MiB**;
- two-character wide sheet (two small faces, each rest set 27,000 + `x` 52,000 px, + 2 locks of 20,000 px): 198,000
  + 15 % = 227,700 px: 910,800 B + 40,000 kept = **0.907 MiB** (round 1's 0.384 was blink only, C1);
- ambient allowance per shot: one flicker member (~300 x 300) + a particle sprite = **0.5 MiB**; each frame loop
  (8 x 256 x 256) **+2.0 MiB**; a loop prop (12 x 512 x 512 at most) up to 12 MiB, typically 8 x 256 x 256 = 2.0 MiB.
- (rev. 4, §2.6; the same pixels split by file, kept WebP at round 3's 0.186 B per packed px):
  - CU sheet: rest blink 104,000 + rest accent 32,000 + 2 locks 218,400 = 354,400 px + 15 % = 407,560 px: 1,630,240 B
    + 75,806 kept = **1.627 MiB** (AVIF ~48,907 B);
  - CU face file `x` (upper bound: own blink and accent, or copies of the rest ones): layer 180,000 + 104,000 +
    32,000 = 316,000 px + 15 % = 363,400 px: 1,453,600 B + 67,592 kept = **1.451 MiB** (AVIF ~43,608 B);
  - CU talk file: 39,600 px + 15 % = 45,540 px: 182,160 B + 8,470 kept = **0.182 MiB** (AVIF ~5,465 B);
  - a CU in `x`, speaking: 8.762 + 1.627 + 1.451 + 0.182 + 0.5 = **12.522 MiB**; the rows below keep round 3's
    **12.703** (and 10.694 / 10.169) as upper bounds;
  - **one more expression of the same shot** costs nothing while another is in effect, and **1.633 MiB** (face + talk)
    while it is the next appearance;
  - **kept bytes** (the gate's `possible` term, the larger file): CU 340,000 + 160,000 = 500,000 B = **0.477 MiB**;
    OTS 410,000 B = **0.391**; wide 380,000 B = **0.362**; a CG at its file limit 450,000 B = 0.429; a room's shot
    ~590,000 B = ~0.563 (E: plate 340,000 + loop frames ~100,000 + props ~150,000).

| Record (gate count) | MiB |
|---|---|
| CU shot (plate + sheet + ambient) | 8.762 + 3.441 + 0.5 = **12.703** |
| CU shot on a 1440 plate | 11.682 + 3.441 + 0.5 = **15.623** |
| OTS shot | 8.762 + 1.432 + 0.5 = **10.694** |
| wide two-character shot | 8.762 + 0.907 + 0.5 = **10.169** |
| room shot, no cast, one loop | 8.762 + 2.0 + 0.5 = 11.262, + props ~3.3 + labels 2.0 = **16.562** |
| half tier (rev. 4, m7: the plate's half kept file is the WebP 0.375 x 340,000 = 127,500 B, not 90 KB): plate 540 x 1024 x 4 = 2,211,840 B + 127,500 = 2.231; CU shot (+ sheet and face decoded / 4 = 770,960 B (rev. 5, m9: was 771,960), their halves' kept 53,774 B, talk 0.045, ambient / 4 0.125) | 2.231; **3.19** |

**Busiest steps of a cinematic dialogue** (`cur` + Σ D1 at the swap point, W7; current + next shots + transition):

| Step pattern | cur + Σ D1 | vs 32 MiB | D2 best-effort |
|---|---|---|---|
| wide -> CU A | 10.169 + 12.703 = **22.872** | fits | CU B -> 35.575: refused (hope); it is CU A's D1 one line later, admitted after the wide's release |
| CU A <-> CU B (shot / reverse shot) | **25.406** | fits | D2 = A (resident) |
| OTS A <-> OTS B | **21.388** | fits | + wide 10.169 = 31.557: fits |
| CU on a 1440 plate <-> CU (1080) | 15.623 + 12.703 = **28.326** | fits | - |
| (rev. 4, C1) choice at CU A, replies open on CU B and CU C | 12.703 + 2 x 0.477 = **13.657** (round 3: 38.109, failed) | fits | the first reply decodes ahead: 26.360 |
| (rev. 4) choice at a wide, replies open on CU A and CU B | 10.169 + 0.954 = **11.123** (round 3: 35.575) | fits | one decodes ahead: 23.826 |
| (rev. 4) choice at a wide, replies open on OTS A and OTS B | 10.169 + 0.782 = **10.951** | fits | both decode ahead: 32.339 -> one: 21.645 |
| (rev. 4) event choice in a room, replies open on OTS A and OTS B (W8) | 16.562 + 0.782 = **17.344** (round 3: 37.950) | fits | one decodes ahead: 28.038 |
| (rev. 4, W2) explore room `r:hall` of ch1: the `street` leave + two CU event openers | 16.562 + 0.362 + 0.954 = **17.878** | fits | EN's neighbour (`room-set`): + 11.262 = 29.140 |
| (rev. 4) the critic's fixture: one room, three events with distinct CU openers + a scene-changing leave knot | 16.562 + 3 x 0.477 + 0.362 = **18.355** | fits | - |
| (rev. 5, W2) inside a room event, CU A <-> CU B (gate row: EN's `room:*` set is outside every window) | **25.406** | fits | runtime (rev. 6-7: the hall's props held as event-room files) 38.527 + 12.703 = 51.230 at the first `need` -> (b) `room:study` 39.968 -> (d) the event room 25.406 (§5.8; round 5: 35.227 -> 47.930) |
| (rev. 5, W2) an event's last step on CU B, the return to the hall certain at distance 1 | 12.703 + 16.562 = **29.265** | fits | with the last line on a 1440 CU: 15.623 + 16.562 = **32.185**, **fails**: lever 2 (a 1080 plate) -> 29.265 |
| (rev. 5, W2) the event's opening dissolve on Desktop (target 9.0 MiB at batch start, the hall still on stage) | 41.843 + 9.0 = 50.843 > 48: the reservation evicts preload holders first (`room:study` 11.262, the other warm holders 0.839) -> **38.742** | <= 48 HARD | phone (5.02 MiB target): 46.863, no eviction needed |
| (rev. 6, W1) an ending knot's step before its closing wide, the next chapter's opening wide held under `next:ch2` (gate row: `next:*` is outside every window) | 12.703 + 10.169 = **22.872** | fits | runtime 22.872 + 10.169 = 33.041 at the wide's `need` -> step 6 (c) evicts `next:ch2` -> 22.872; with both opening shots held, 48.278 -> 25.406; the handover enters at the half tier (S23) |
| (rev. 6, W2; rev. 7, W2: ch1's case) an `onEnter` event's first cut, the cellar's files held by the window's `eventRoom` alone (`room:cellar` refused at the hall), `room:hall` resident, a face change due | 12.703 + 1.633 = **14.336** | fits | runtime 38.527 + 1.633 = 40.160 -> (b) evicts `room:hall` -> 28.898, the cellar kept (it goes only at (d)); with `room:cellar` holding records (rooms that fit) 35.227 + 1.633 = 36.860 -> 25.598, the same order |
| (rev. 7, W1) the handover's first window, `next:ch4` landed (`k:lamp`'s `need`) | 10.169 + 12.703 = **22.872** | fits | runtime: the same records, joined at the swap (step 1b), then `next:ch4` released (1c): 22.872, nothing fetched (round 6: the CU's records ended before the swap and were re-fetched) |
| (rev. 5, m1) a 1440 CU after any number of face changes | 15.623 (+ 1.633 while the next expression is due) | fits | round 4 without a release point: 15.623 + 4 x 1.633 = 22.155 after four, 34.858 with its reverse CU |
| (rev. 4, W4) CU A <-> CU B, any number of expressions per side: a step whose next appearance is A's next face | 12.703 + 1.633 = **14.336** | fits | the cut: 25.406 as above |
| (rev. 4) a linear step under a CG whose dismissal shares the next cut's batch: CG + CU A + CU B | 8.762 + 12.703 + 12.703 = **34.168** | **fails**: lever 1 (dismiss the CG one line earlier) -> 25.406 | - |
| (rev. 4) a story step in a room's shot (props, labels) whose next cut is a 1440 CU | 16.562 + 15.623 = **32.185** | **fails**: lever 2 (that CU on a 1080 plate) -> 29.265; or lever 1 (cut from a non-room shot) | - |
| (rev. 3, C1) entry into a CU at the half tier, then the upgrade | preview 3.19 -> full 12.703, peak 15.893 before the window | fits | the window after the upgrade |
| during a dissolve (phone): the window <= 32 + target 780 x 1688 x 4 = 5,266,560 B (5.02 MiB); the old records already released (S14) | <= 37.0 | <= 48 HARD, the transient <= 16 band | - |
| during a dissolve (Desktop, capped 1152 x 2048) 9.0 MiB | <= 41.0 | <= 48 | - |
| face patch, CU, `x` layer box 180,000 px x 4 + the old layer's box (union <= 2 x 180,000 px) | <= 1.37 transient | - | - |
| warp buffers: 1,175 x 16 B + 24 x 46 x 6 x 2 B | ~32 KB, the displayed shot only | ledger, not caps (< 64 KiB, CH D14) | - |

**Authoring levers when `step-window` fails** (rev. 4, C1: each changes the gated number under §3.4's definition;
printed in the row's note with the failing step key, in order):
1. **Hold less at the step before the cut:** dismiss a CG one line before the cut instead of in the cut's batch, or
   reach the close-up from a non-room shot of the scene (the room's props and labels leave a step earlier). It acts on
   `cur` at the step whose certain term is due (CG case: 34.168 -> 25.406).
2. **Draw the larger shot on a 1080 plate** instead of 1440 (−2.920 MiB decoded; the frame, the angle and every face
   state stay; the cost is pan slack: 495 -> 135 source px, S11).
3. (possible files) none is needed in practice: an opener costs its kept bytes (CU 0.477 MiB), so a room fails on
   its openers only past 32 distinct CU openers and a choice at a CU past 40 (A: (32 - 16.562) / 0.477 = 32.4;
   (32 - 12.703) / 0.477 = 40.5).
Round 3's levers 1 and 4 (delay a branch's cut, split the knot) changed nothing under its own definition, and its
lever 3 (an OTS or a wide for a branch) narrowed the framing (critique r3 C1); all three are withdrawn. No printed lever
removes an angle, a face state or a branch-specific shot.

LOW (half tier) has 4x headroom on every row (A).

**Ruled since: RULINGS 304, 311, 314** — MEASURED on built content (SH5a `48489b7`, its memory lens on the real ch1 and
ch3): no sample over the steady or the hard cap; the runtime window's maximum equals the `step-window ch1` row
(24,538,074 B) and the `step-window ch3` row. ch1's hall holds 32,655,862 B counted at rest (the window's need, EN's
two neighbour bgs and the legacy knot hold's two sprites; no row bounds that total, the M-MEM-2 class). **The desk view
holds 26,712,144 B** (35,559,504 B on main before SH5a, under the legacy knot hold), because `hold` keeps only `char/`
images; the knot hold's off-stage `char/ally/neutral` (3,044,496 B) remains. The gap (i) bound is open (§5.8 above).

**150 MB model** (rev. 2, m1): the texture caps are unchanged. MEMORY-PLAN's steady model is **106.6 MiB** with the
32 MiB steady cap and its hard-cap transient **122.6 MiB**, both under 143.05 MiB (`docs/MEMORY-PLAN.md:190-191`, S4
§3.9); this design adds ~32 KB of mesh buffers and the lazy motion chunk's parsed code (~5.2 KB br, E < 0.1 MiB of
heap). The knot-set gate today admits <= 3 full-screen images per knot plus successors (S4 §3.4); `step-window`
replaces it for images (S22).

### 5.10 deactivated, reduced motion, e2e freeze, failure states

| Situation | Behaviour |
|---|---|
| `deactivated` | `pauseAll()` + loop pause (`executor.ts:26-32`, `game.ts:1818-1820`); clocks exclude paused time; audio pauses (unchanged) |
| `activated` | resume; `isContextLost()` check -> M2 revive. A shot is 2-5 records (plate, sheet, the face and talk files in effect; rev. 4) vs up to 27 sprite records (S4 §3.5); held (`warm`) records have no texture and revive nothing. Visible records first, under `REVIVE_DEADLINE_MS = 3000` (`registry.ts:23`). Meshes and targets are re-created by `rebind` |
| reduced motion (`boot.ts:276`) | off: the parallax drive (drift), breathing, sway, hair, particles, plane sway, `anim:`, `fx: shake`. Instant: camera moves (end framing). Kept: cuts and dissolves (opacity), blinks, brows, mouth flaps (nominal `forMs`), flicker at half amplitude. Loops hold frame 0; `fx: flash` becomes a soft fade (CH D22 + camera rows; OQ8) |
| e2e build | frozen by default (D21); `__novelDebug.setAnimation('live')` in animation specs only |
| double tap | the first completes the running batch (cut, dissolve, camera, patch); the second advances (today) |
| reload mid-chapter | `restore(snapshot)`: shot, faces, camera end state, instant |
| a sheet fails to load (404, 401 after one silent re-auth) | drawn: the visual is skipped with `onSkip` and the line continues (today's rule, `executor.ts:103-104`); motion: faces show rest, no blink or talk until `reacquire` (the shot is the identity unit; CH D16 adapted) |
| (rev. 4) a face file fails to load | that character shows the rest face (the plate) and the line continues; its next `face:` or cut retries; a talk file that fails leaves that mouth still (motion), nothing else |
| (rev. 4) a held (`warm`) file's fetch fails or is refused | refused: evicts, then deferred like a `need` (§5.8 steps 6-7); failed: reported, retried at the next window; the branch cut, if it comes first, fetches at visible priority as today |
| (rev. 4) a choice is tapped while its opener is still held | the batch's `ensure` decodes it from the Blob (S-D (1c)); a second tap meanwhile is GameSession's queued intent, as today |
| story update between sessions | an unknown shot in a save is skipped and the next `bg:` / `scene:` re-stages; an unknown expression shows rest (logged); resume's chapter-hash fallback is unchanged |
| the motion chunk fails to load (offline after the first line) | faces rest, nothing moves; retried at the next shot build, at most 3 times per chapter (§5.3); the story and the cuts are unaffected |
| a refused `need` (a visible load took the room) | resident `hope` (d3, d2), then decoded `warm`, then (rev. 5, W2: at any step) EN's `room:*` holders whose files the window neither needs, warms nor names as its event room (rev. 6, W2: most recently requested first), then (rev. 6, W1) the next chapter's `next:*` holders, then (rev. 7, W2) the event's own room (its `eventRoom` holders, then its `room:<r>` holder) are evicted, in that order (rev. 3, W2); a warm *decode* that does not fit evicts nothing (rev. 6, m2); still refused: deferred, re-admitted at the next release or window (§5.8); the cut to it, if it comes first, `ensure`s it at visible priority as today |
| (rev. 5, W2) a room event runs while EN holds the room and its neighbours | the event's windows evict EN's holders as their items need the bytes (the event's room last); the return to the room is the last step's certain appearance, loaded while the last line is read; after the return EN's `roomShown` re-requests its set; a tap on the last line before the room is back waits under the room batch's `ui-state:waiting` motion |
| (rev. 6, W1) an ending knot's cut needs the bytes the next chapter's preload took | step 6 (c) evicts `next:<id>`; the cut waits nothing; at the handover the first line shows over the next chapter's half-tier files and sharpens in place (S23; ~2.6 s for a CU on the e2e link, R5.4); `preloadNext` re-requests only at the next ending-knot entry (`game.ts:1038-1044`) |
| (rev. 7, W1) a handover whose `next:` preload landed | the first window joins every landed file at its swap point (step 1b), then the scheduler releases `next:<id>` (1c); the first cut waits nothing; files that did not land (evicted at (c), or still queued) start as half previews (S23); a session that leaves before that swap releases the tag through `dropNext` (`game.ts:874-882`), `setChapter` or `destroy` |
| (rev. 5, W2) a dissolve's target is refused under HARD | the reservation first evicts preload-priority holders (never visible ones) and retries once; still refused: container alpha, counted `flatRefused` (CH D15) |
| (rev. 3, C1) a session enters at a step (fresh start, resume, handover without its preload) | the first line shows over the half-tier files; each record sharpens in place one at a time; a failed upgrade keeps the half and retries at the next swap point (<= 3 per chapter); `deactivated` during an upgrade pauses nothing of the fetch (the registry's loads run in the background as today) and the swap lands at the next drawn frame |
| (rev. 3, C1) context loss while a record is a preview | revive re-uploads the half from its kept file (today's path); its upgrade is retried at the next swap point |
| WebGL context lost mid-transition | the batch completes, targets drop, rebind or revive as today |

### 5.11 Download per chapter and first load (KB = 1,000 B, as `budget.ts`)

**Per chapter** (A on E, ~20 distinct shots; Stretch: ~4.6 images per scene, a ratio S3 DERIVED from store-page
counts and flags as unverified until played, S3 :74-77, [S1] https://kirishimashoichi.itch.io/stretch-en; rev. 2, m3):
- plates: 20 x 225 KB = 4,500 KB;
- sheets (rev. 2: ~0.12 B AVIF per packed px, the round-1 ratio): 12 dialogue sheets x ~75 KB (CU ~104, OTS ~43) +
  8 wide / insert sheets x ~20 KB = 1,060 KB, + ~10 frame loops x ~60 KB = 600 KB: **1,660 KB**;
- images **6,160 KB**; audio: 2 BGM ~2,880 KB + SFX ~200 KB (CLAIMED, S4 :340);
- total **~9,240 KB** vs `transfer` 6,000 KB: OQ5, default raise to 12,000 KB;
- (rev. 5, m4) the lines above count one non-rest expression per face per shot. Each further expression of a face
  adds its face file and talk file: at CU size 43,608 + 5,465 = **49,073 B** (§5.9's AVIF; an OTS face is ~0.36 of
  that). Over the 12 dialogue shots' ~18 faces (1.5 per shot) at the CU size (an upper bound), A:
  - OQ17's typical count (2.5 non-rest per face): + 18 x 1.5 = 27 uses -> +1,325 KB: images ~7,485 KB, total
    **~10,565 KB**, inside OQ5's 12,000 KB default;
  - the critic's example (36 uses): +1,767 KB: total ~11,007 KB;
  - OQ17's maximum (5) on every face: + 18 x 4 = 72 uses -> +3,533 KB: images ~9,693 KB, total **~12,773 KB**,
    over 12,000 KB, so the `transfer` row fails that chapter; its printed levers are `q` and the owner's own count
    (OQ5 and OQ17 are asked together, §12);
- at 200,000 B/s that is ~46 s of background download over a ~15-25 min chapter (A on E).

**Paid replays:** `no-store` (`content.rs:22`) re-downloads ~6.16 MB of images per paid session (A; rev. 3, m1).
Orchestrator question QO3.

**First load** (rev. 3, C1): ch1 today 307.5 KB with 19.5 KB of first-knot images (MEASURED, S4 :178). With real art
the first line awaits the first step's half-tier files: 288.0 + <= ~151 (a 1440 close-up at the half tier, the worst
median) + manifest growth ~11 = **<= ~450 KB** of 800 KB (A on E). Rev. 4: 288.0 + ~147 (the face file in effect
replaces the whole sheet) + ~16 (manifest growth with the face and talk entries and the `r:` windows) = **~451 KB**. The `first-load` row counts the first step's
half-tier images (SH3b).

**TTFL and the `entry step images` limit** (rev. 3, C1 and W1 replace round 2's table; the row prints this
derivation in its note):

| Term | ms | Source |
|---|---|---|
| budget | 6,000 | `client/e2e/perf.spec.ts:34` |
| measured TTFL, fresh start (its first batch, `street` + `ally` placeholders, and its chapter files are inside it; **credited 0**, so the row charges them again: the safe side, <= ~150 ms, A) | - 4,059 | M-e2e, S4 :16-17 |
| the TWA fixture, served outside the throttle (16.2 KB br at 200 B/ms = 81 ms + one 150 ms RTT) | - 231 | `perf.spec.ts:139-145` |
| first-line JS growth to its row limit, (270,000 - 257,900) B at 200 B/ms | - 61 | `budget.ts:108`; S4 :171 |
| a resume's extra sequential request: the chapter is fetched only after the save body arrives (`begin`, `client/src/app/game.ts:1487-1511`; `resumeBody`, `:885-917`), while a fresh start fetches it beside the mount (`:1469-1471`); one RTT | - 150 | `perf.spec.ts:38` (the emulated latency) |
| decode + upload of the entry's half-tier files (a quarter of the full tier's pixels; full-tier E 250) | - 100 | E; S-D criterion 1 measures the half tier too |
| left for the row's bytes | 1,399 | A |

`limit = 1,399 ms x 200 B/ms = 279,800 B`, floored to **279,000 B** (A). The row's value per chapter =
max over steps and entry alternatives of (**half-tier** AVIF bytes of the alternative's files) + (the chapter files
the first line awaits: story, meta, manifest, public world and the en table, br; `client/src/story/chapters.ts:210-216`).
This charges the manifest's growth (rigs, `look`, plateaus; ~11 KB br, §4.5) that round 2's table left out
(critique r2 W1: 6,048.5 ms at its limit). At the limit with every term at its bound, TTFL = 4,059 + 231 + 61 + 150 +
100 + 279,000 / 200 = **5,996 ms** (A).

Entry values at the medians (A on E: half = 0.375 x full; chapter files at their row limits: story 35,000 B
`budget.ts:118`, world 8,000 B `:121`, en ~15,000 B, meta ~2,000 B, manifest ~14,000 B, together **~74,000 B**):

| Entry | Full tier (round 2's row) | Half tier + chapter files (this row) | vs 279,000 B |
|---|---|---|---|
| CU (1080 plate 225,000 + CU sheet 103,445) | 328,445: failed 299,000 | 123,167 + 74,000 = **197,167** | passes, 81,833 left |
| CU on a 1440 plate (300,000 + 103,445) | 403,445 | 151,292 + 74,000 = **225,292** | passes, 53,708 left |
| OTS (225,000 + 42,950) | 267,950 | 100,481 + 74,000 = **174,481** | passes |
| a CG step (a CG <= 300,000) | 300,000 | 112,500 + 74,000 = **186,500** | passes |
| 1440 shot at both file limits (400,000 + 200,000) | 600,000 | 225,000 + 74,000 = **299,000** | fails by 20,000: lever `q` |

Rev. 4 (§2.6): the entry awaits the plate, the sheet and the face files in effect (talk files are motion and are not
awaited), and the manifest carries ~55 more entries (+~5,000 B with the `r:` windows, so the chapter files are
~79,000 B). Recomputed (A, half = 0.375 x full): CU (225,000 + 48,907 + 43,608 = 317,515 -> 119,068) + 79,000 =
**198,068**; 1440 CU (392,515 -> 147,193) + 79,000 = **226,193**; OTS (225,000 + 23,316 + 15,699 = 264,015 -> 99,006)
+ 79,000 = **178,006**; CG 112,500 + 79,000 = **191,500**. Every verdict above stands; TTFL at the limit is unchanged
(5,996 ms).

- The row is the maximum over every step's `entry` alternatives (§3.6): a fresh start awaits the first step's batch
  images; a resume at any step awaits the visible top image only (§5.8), so a CG step costs the CG and a shot step its
  drawn files (plate, and the sheet when the shot has cut-outs or a non-rest face, CH D27); a legacy chapter adds
  the sprites in effect (rev. 3, W5).
- **Levers** (printed with the failing step key; rev. 3: none removes a face state, a close-up or a framing):
  `shot.json` `q` (default 50, floor 40) for that shot, both tiers; the chapter's own files (they already have their
  rows). OQ15 states the cost of the soft picture and the alternative.
- What the half tier costs the player (A): the first line shows over a half-resolution picture until the upgrade
  lands: a 1080 CU's full files are 328 KB = 1.64 s + one RTT ~1.8 s on the e2e link; a 1440 CU 2.17 s ~2.2 s; on a
  2 MB/s link (E) ~0.3 s. LOW phones see no change (their session tier is half). Rev. 4 (W1): the first cut's half
  files share the link from the swap point (§5.8 entry step 4), so the soft picture lasts **~2.3 s** for a 1080 CU
  (~2.7 s for a 1440 CU: 147,193 + (392,515 - 147,193) at the two-stream model, A) and the first cut is resident at
  the half tier **~1.3 s** after the first line and sharp at **~4.1 s**; on a 2 MB/s link with a 50 ms RTT (E)
  ~0.27 s, ~0.17 s and ~0.48 s. **Rev. 5 (m6), one RTT per file (supersedes the rev. 4 times):** soft picture
  **~2.6 s** for a 1080 CU (~3.0 s for a 1440 CU: + 75,000 B of plate at 200,000 B/s, A), first cut at the half tier
  **~1.2 s**, sharp **~4.7 s**; on the 2 MB/s link ~0.37, ~0.15 and ~0.68 s (R5.4).
