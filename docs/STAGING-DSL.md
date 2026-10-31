# Staging DSL — the ink tag language

Version: **DSL v2** (prototype). Status: DSL v1 was designed in [PROTOTYPE-PLAN.md](PROTOTYPE-PLAN.md) and
implemented by lanes L3a (parser + lint) and L3b (story build). DSL v2 adds the `puzzle` / `explore` yield tags and
the narrowed `-> DONE` ([PUZZLES-PLAN.md](PUZZLES-PLAN.md), lane LW1). §9 also describes the story list
`story/stories.json` ([STORIES-PLAN.md](STORIES-PLAN.md), lane LS1); the tag language is unchanged. The rules marked
"from LW3" in §8 and §11 are the contract lane LW3 implements.

- **One parser.** `client/src/story/tags.ts` (`parseTags`) is used by the story gate (`npm --prefix client run
  story`) and by the runtime. Nothing else parses tags (CLAUDE.md principle 7; enforced by `client/src/arch.test.ts`).
- **Two-way check.** `client/src/story/dsl-doc.test.ts` reads this file: the `### \`<kind>\`` headings under
  [§6](#6-tags) must equal the parser's tag kinds (`TAG_KINDS` in `tags.ts`), and every tag inside an ` ```ink ` block must parse against
  `assets/catalog.json` — except a block preceded by the comment `<!-- dsl: invalid -->` (counter-examples). Change
  the parser and this file in the same commit, or the test is red.
- **Who reads this:** the narrative-designer and writers (what to type), the developer (what to implement), the
  doc-writer (AUTHORING.md mirrors it, never extends it).

Examples below use English placeholder text; real chapters are written in Russian (CLAUDE.md "Communication").

---

## 1. Model

```text
ink line + its tags ──parseTags──> { lineId, commands: StagingCommand[] }   (one batch per displayed step)
                                              │
                    GameSession splits the batch by kind
              ┌───────────────┼───────────────────────┐
     scene controller     audio manager           overlay (Svelte)
  bg / scene / show /     bgm / sfx            text, speaker plate, choices
  hide / cg / wait                              (reads lineId + speaker)
```

- The story never touches Pixi or audio; the scene and the overlay never read ink variables (principle 7). The only
  story→presentation channel is the typed command list below, plus the line text and its ID.
- **One displayed step = one batch.** All tags attached to the step (the line's own tags, tag lines above it,
  knot-level tags on a knot's first line, tag-only steps merged forward — §3.5) form one batch with one execution
  order (§7).
- Every staging tag is **literal** (no `{...}` inside a tag) so the build can index every asset of every knot for
  preloading (§8). There are no dynamic staging tags in the DSL.
- There are **no EXTERNAL functions** in the DSL (lint `ink/forbidden`). Effects are tags, never function calls.
- **Yields hand control to the host.** A `puzzle` or `explore` tag line followed by `-> DONE` (§6) stops the story.
  GameSession runs the puzzle or the rooms and re-enters ink only at the top of a knot (PUZZLES-PLAN X1). Yield
  commands carry data only: the story still never touches Pixi.

---

## 2. Tag syntax

ink delivers each tag as a string without the leading `#` (`# bg: cafe` → `"bg: cafe"`). The parser trims it and
applies this grammar:

```text
tag      = kind [ ws? ":" ws? args ]
kind     = lower ( lower | digit | "_" )*            ; lowercase only: "Bg" is a syntax error
args     = token ( ws token )*
token    = positional | option
positional = ( lower | digit ) ( lower | digit | "_" )*
option   = name "=" value                              ; no spaces around "="
name     = lower+
value    = ( lower | digit | "_" )+                    ; integers are plain digits: ms=500, vol=80
ws       = one or more spaces or tabs
```

Rules:

| Rule | Detail |
|---|---|
| Case | Kinds, ids and option names are lowercase ASCII. `# BG: Cafe` → `tag/syntax`. |
| Numbers | Integers only, no units, no decimals: `ms=500`, `vol=80`. Ranges are per tag (§6). |
| Positional args | Exact count per tag; missing → `tag/missing-arg`, extra → `tag/bad-arg`. |
| Options | Each at most once (`tag/bad-arg: duplicate option`); unknown option → `tag/bad-arg`. Order is free. Options are optional, except `then` of `puzzle` (§6): missing → `tag/missing-arg`. |
| Literal only | A `{` anywhere in a tag → `tag/dynamic` (source lint). |
| Reserved words | `all` (hide), `off` (cg), `stop` (bgm) are not valid asset ids (catalog lint). |
| Escaping | A literal `#` in story text is written `\#` (ink rule); tags never contain `#`. |
| Several tags | One line may carry several tags: `Text #sfx: door #id:ch1.cafe.k3x9`. Order does not matter. |

---

## 3. Where tags go

### 3.1 Line tags
A tag at the end of a text line belongs to that line.

```ink
=== cafe ===
# scene: cafe
ally: You came after all. #show: ally smile #id:ch1.cafe.k3x9
```

### 3.2 Tag lines above a line
Tags on their own line(s) directly above a text line belong to that text line (ink semantics). This is the preferred
style for staging; it keeps text lines readable.

```ink
=== street ===
# scene: street
# show: stranger neutral at=right
# bgm: tension
stranger: You dropped this. #id:ch1.street.m2r8
```

### 3.3 Knot-level tags
Tags between a `=== knot ===` (or `= stitch`) header and the knot's first content line are **knot-level tags**. ink
exposes them twice — through `TagsForContentAtPath("knot")` and again in the first line's `currentTags`. The runtime
reads **only** the line tags, so a knot-level tag is applied **exactly once**, with the first line's batch. The
preloader does not call `TagsForContentAtPath` at all: it uses the build-time knot index (§8), which sees every tag of
the knot, not only the header. Convention (not a lint rule): put scene-setting tags (`scene`, `bg`, `show`, `bgm`) at
the top of the knot so a reader sees the set at a glance. It also counts for the budget: only these opening tag lines
clear what an earlier knot left on stage (§8).

### 3.4 Choices: inside `[...]` vs after
- The choice's **line ID goes inside the brackets**: `* [Show her the letter #id:ch1.cafe.c4tz]`. A tag inside
  `[...]` belongs to the choice (`Choice.tags`).
- **Only `id` is allowed inside the brackets.** A staging tag there → `tag/in-choice`.
- **Nothing but a divert may follow `]` on the choice line.** Text after `]` (`* [Go] You go.`) → `choice/text-after`
  (it would echo a second string with no ID); a tag after `]` → `tag/after-choice-bracket`. Put the consequence on the
  next line, with its own tags:

```ink
=== cafe_choice ===
ally: Did you bring it? #id:ch1.cafe.a81c
* [Show her the letter #id:ch1.cafe.c4tz]
    # cg: letter
    ally: So it is true. #id:ch1.cafe.n5bd
    -> letter
* [Say you lost it #id:ch1.cafe.c9qd]
    # show: ally angry
    ally: Of course you did. #id:ch1.cafe.f0wd
    -> street
```

- Bracket-only text means the choice text is never printed into the output; the backlog records the chosen choice by
  its ID.
- Conditional (`* {g_trust_ally > 1} [...]`), sticky (`+ [...]`) and fallback (`* -> knot`, no text, no ID) choices
  are allowed.

### 3.5 Tag-only steps
If ink yields a step with tags but no text (for example tag lines directly before a choice block or a divert), the
runtime does not show an empty line: it **merges those commands into the next displayed step** (the next line or the
next choice set) and executes them in that step's batch. A tag-only step that ends at a yield block's `-> DONE` (§6)
is not merged forward: it is the yield step, and its staging commands run (§7 steps 1–4) before the host takes over.

### 3.6 Global tags
Tags before the first knot (ink "global tags") are forbidden → `tag/global`. A chapter's identity comes from
`story/chapters.json`, not from tags.

---

## 4. Line IDs (localization and position — principle 8)

**Format** — the `id` tag (§6.1): `#id:<chapter>.<knot>.<suffix>`

```text
lineId  = chapter "." knotpart "." suffix
chapter = "ch" nonzero-digit digit*        ; the chapter that owns the line: ch1, ch2, ch10
knotpart= lower ( lower | digit | "_" )*   ; the knot name when the ID was assigned (never updated later)
suffix  = ( lower | digit ){4}             ; random, assigned once
regex:    ^ch[1-9][0-9]*\.[a-z][a-z0-9_]*\.[0-9a-z]{4}$
```

| Rule | Detail |
|---|---|
| Required on | every text line (narration or dialogue) and every choice with text. Not on tag-only lines, logic, diverts, fallback choices (`id/on-non-text`). |
| Exactly one | per line or choice (`id/multiple`). |
| Unique | across **all** chapters of all stories (`id/duplicate`). |
| Chapter prefix | must equal the chapter whose entry file includes the source file (`id/chapter-prefix`). Moving a line to another chapter means a new ID. |
| Knot part | only a readability hint; moving a line to another knot keeps its ID; the lint does not compare it with the current knot. |
| Stable | Editing a line's text keeps its ID. IDs are never derived from position or text and never renumbered. |
| Never reused | A deleted line's ID is appended to `story/retired-ids.txt` (one per line); an ID in that file appearing in ink → `id/retired`. The en entry of a deleted line becomes an orphan (`loc/orphan-en`) until removed — that error is the reminder to retire the ID. |
| Assignment | `npm --prefix client run story -- --fix-ids` adds a fresh ID to every text line and choice that lacks one (writes the `.ink` source in place, never touches an existing ID), then lints. Hand-written IDs in the format are equally valid. |

**Localization tables** (Russian is the ink text; English is a table — research R3 option A):

- `story/locales/en/<chapter>.json`: `{ "<lineId>": { "ru": "<Russian source at translation time>", "en": "<English>" } }`.
  The text is stored **without** the speaker prefix.
- `npm --prefix client run story -- --sync-locales` adds an entry `{ "ru": <current source>, "en": "" }` for every
  new ID. An empty `en` → `loc/empty-en` (error); a missing entry → `loc/missing-en` (error); an entry whose `ru` no
  longer equals the current source → `loc/stale-en` (warning: update `en`, then copy the new `ru`).
- The build ships only `{ "<lineId>": "<en>" }`; paid chapters' tables are delivered with the paid chapter, never in
  the public bundle (principle 0).
- Speaker names, chapter titles, story titles and story teasers: `story/locales/<lang>/story.json` →
  `{ "names": { "<speakerId>": "…" }, "chapters": { "<chapterId>": "…" }, "stories": { "<storyId>": "…" },
  "teasers": { "<storyId>": "…" } }`, every key of every section required in both languages (`loc/missing-name`).
  A teaser is one sentence for the story's card. All four sections are public by design: the public chapter catalog
  carries them, paid chapters' titles included.
- Runtime: language `ru` shows the ink text; `en` shows the table entry; a missing entry falls back to the Russian
  text and is counted and logged (never a crash).

---

## 5. Speakers

A dialogue line starts with a **speaker prefix**: the speaker ID, a colon, one space, the text.

```ink
=== cafe_talk ===
ally: You came after all. #id:ch1.cafe.k3x9
The rain had not stopped since noon. #id:ch1.cafe.p2m7
voice: Is anyone there? #id:ch1.cafe.v1q3
```

| Rule | Detail |
|---|---|
| Grammar | `^([a-z][a-z0-9_]*): (.+)$` on the line text. No prefix = narration (no name plate). |
| Registry | The ID must exist in `story/cast.json` (`speaker/unknown`). `cast.json` maps a speaker to its sprite character (or none): `{ "ally": { "char": "ally" }, "voice": { "char": null } }`. |
| Name plate | Display name from `story/locales/<lang>/story.json` `names`, never from the prefix. |
| Expression | The prefix does **not** change the sprite. Use a `show` tag on the same line (§6.4). |
| Not in choices | A choice text never has a prefix (`speaker/in-choice`). |
| Why a prefix | Readable in Inky and in review; one tag fewer on two thirds of the lines; Russian narration starts with Cyrillic, so a Latin `id:` prefix is unambiguous, and the registry check catches the rest. |

---

## 6. Tags

Defaults apply when an option is omitted. "Consumer" is the module that executes the command. "Assets" says whether
the tag names an asset the build indexes for preloading (all tags are literal, so every asset-bearing tag is
preload-visible).

| Kind | Syntax | Consumer | Assets | Typed command `kind` |
|---|---|---|---|---|
| `id` | `id:<lineId>` | overlay / i18n / saves | — | (not a command: `ParsedTags.lineId`) |
| `bg` | `bg:<bg> [t=crossfade\|fade\|cut] [ms=N]` | scene | `bg/<bg>` | `bg` |
| `scene` | `scene:<bg> [t=fade\|cut] [ms=N]` | scene | `bg/<bg>` | `scene` |
| `show` | `show:<char> <expr> [at=left\|center\|right] [t=fade\|cut] [ms=N]` | scene | `char/<char>/<expr>` | `show` |
| `hide` | `hide:<char>\|all [t=fade\|cut] [ms=N]` | scene | — | `hide` |
| `cg` | `cg:<cg>\|off [t=fade\|cut] [ms=N]` | scene | `cg/<cg>` | `cg` |
| `bgm` | `bgm:<track>\|stop [fade=N] [vol=N]` | audio | `bgm/<track>` | `bgm` |
| `sfx` | `sfx:<sfx> [vol=N]` | audio | `sfx/<sfx>` | `sfx` |
| `wait` | `wait:<ms>` | scene (batch timing) | — | `wait` |
| `puzzle` | `puzzle:<puzzle> then=<knot>` | GameSession → PuzzleSession | — (the close-up comes from world data) | `puzzle` |
| `explore` | `explore:<section>` | GameSession → ExploreController | — (rooms come from world data) | `explore` |

### `id`

- **Syntax:** `id:<lineId>` (§4). **Arguments:** one positional, the line ID.
- **Placement:** end of a text line, or inside choice brackets.
- **Validation:** `id/format`, `id/missing`, `id/multiple`, `id/duplicate`, `id/chapter-prefix`, `id/retired`,
  `id/on-non-text`.
- **Typed result:** `ParsedTags.lineId: LineId`.

```ink
=== id_example ===
The door was open. #id:ch1.room.d00r
* [Go inside #id:ch1.room.c1in]
    -> inside
```

### `bg`

- **Syntax:** `bg:<bg> [t=crossfade|fade|cut] [ms=N]`
- **Arguments:** `<bg>` — a key of `bg` in `assets/catalog.json`.
- **Options:** `t` default `crossfade`; `ms` default `500`, range 0–10000.
  - `crossfade`: the new background fades in **over** the old one (no dip), then the old one is destroyed.
  - `fade`: through black — black fades in (ms/2), the background is swapped, black fades out (ms/2).
  - `cut`: instant.
- **Effect:** replaces the background; characters and CG stay.
- **Validation:** `tag/unknown-asset`; `batch/conflict` with another `bg` or a `scene` in the same batch.
- **Typed:** `{ kind: 'bg'; bg: BgId; t: 'crossfade' | 'fade' | 'cut'; ms: number }`

```ink
=== bg_example ===
# bg: street
We walked out into the rain. #id:ch1.street.w4lk
# bg: room t=fade ms=900
Home, finally. #id:ch1.room.h0me
```

### `scene`

- **Syntax:** `scene:<bg> [t=fade|cut] [ms=N]`
- **Arguments:** `<bg>` as for `bg`.
- **Options:** `t` default `fade` (through black); `ms` default `800`, range 0–10000.
- **Effect:** a location change — hides every character and the CG, sets the background. With `t=fade`, everything
  else in the same batch (`show`, `bg` is forbidden) is applied while the screen is black, so it appears with the
  fade-in.
- **Validation:** `tag/unknown-asset`; `batch/conflict` with `bg`, another `scene`, a `hide`, or a `cg` in the same
  batch.
- **Typed:** `{ kind: 'scene'; bg: BgId; t: 'fade' | 'cut'; ms: number }`

```ink
=== scene_example ===
# scene: cafe
# show: ally neutral at=left
ally: Sit down. #id:ch1.cafe.s1t0
```

### `show`

- **Syntax:** `show:<char> <expr> [at=left|center|right] [t=fade|cut] [ms=N]`
- **Arguments:** `<char>` — a key of `chars` in the catalog; `<expr>` — one of that character's `exprs`.
- **Options:**
  - `at`: default — the character's current slot if visible, else `center`.
  - `t`: default `fade`; `cut` is instant.
  - `ms`: default per case, range 0–10000 — 300 to appear, 200 to change expression (new sprite over the old one,
    never a symmetric dip), 400 to move to a new slot.
- **Effect:** shows the character, changes its expression, and/or moves it. One sprite per character; the character
  ID is the slot key.
- **Validation:** `tag/unknown-asset` (character or expression); `batch/conflict` with another `show` or a `hide` of
  the same character.
- **Typed:** `{ kind: 'show'; char: CharId; expr: ExprId; at: Slot | null; t: 'fade' | 'cut'; ms: number | null }`
  (`null` = use the per-case default).

```ink
=== show_example ===
# show: ally neutral at=left
# show: stranger serious at=right
stranger: We need to talk. #id:ch1.street.t4lk
ally: Not here. #show: ally worried #id:ch1.street.n0th
```

### `hide`

- **Syntax:** `hide:<char>|all [t=fade|cut] [ms=N]`
- **Options:** `t` default `fade`; `ms` default `300`, range 0–10000.
- **Effect:** removes one character, or every character (`all`). Hiding a character that is not shown is a no-op at
  runtime.
- **Validation:** `<char>` must be in the catalog or `all`; `batch/conflict` with a `show` of the same character or a
  `scene`.
- **Typed:** `{ kind: 'hide'; char: CharId | 'all'; t: 'fade' | 'cut'; ms: number }`

```ink
=== hide_example ===
stranger: Goodbye. #hide: stranger #id:ch1.street.by3s
```

### `cg`

- **Syntax:** `cg:<cg>|off [t=fade|cut] [ms=N]`
- **Options:** `t` default `fade`; `ms` default `500`, range 0–10000. A CG replacing another CG fades in over it.
- **Effect:** a full-screen illustration above the characters; `off` removes it. The CG stays until `cg: off`,
  `scene`, or the chapter end. (A CG gallery is later work.)
- **Validation:** `tag/unknown-asset`; `batch/conflict` with another `cg` or a `scene`.
- **Typed:** `{ kind: 'cg'; cg: CgId | null; t: 'fade' | 'cut'; ms: number }` (`null` = off)

```ink
=== cg_example ===
# cg: letter
The letter was addressed to me. #id:ch1.room.l3tt
# cg: off
I put it away. #id:ch1.room.aw4y
```

### `bgm`

- **Syntax:** `bgm:<track>|stop [fade=N] [vol=N]`
- **Options:** `fade` default `1000` ms, range 0–10000 (crossfade from the current track, or fade-out for `stop`);
  `vol` default `100`, range 0–100 (percent of the BGM bus).
- **Effect:** starts a looping track. Re-issuing the playing track does not restart it; only a changed `vol` is
  tweened. Music continues across lines, knots and saves (it is part of the staging snapshot) until `bgm: stop` or the
  chapter end.
- **Validation:** `tag/unknown-asset`; `batch/conflict` with another `bgm`.
- **Typed:** `{ kind: 'bgm'; track: TrackId | null; fadeMs: number; vol: number }` (`null` = stop)

```ink
=== bgm_example ===
# bgm: calm
It was a quiet evening. #id:ch1.room.qu1e
# bgm: tension fade=2000 vol=80
Then the phone rang. #sfx: phone #id:ch1.room.r1ng
# bgm: stop fade=1500
Silence. #id:ch1.room.s1l3
```

### `sfx`

- **Syntax:** `sfx:<sfx> [vol=N]`
- **Options:** `vol` default `100`, range 0–100 (percent of the SFX bus).
- **Effect:** plays a one-shot sound when the batch starts. Not part of the snapshot (a load does not replay it).
  Several `sfx` in one batch are allowed.
- **Validation:** `tag/unknown-asset`.
- **Typed:** `{ kind: 'sfx'; sfx: SfxId; vol: number }`

```ink
=== sfx_example ===
Someone knocked. #sfx: door #id:ch1.room.kn0c
```

### `wait`

- **Syntax:** `wait:<ms>` — one positional integer, range 50–10000.
- **Effect:** after the batch's visual transitions finish, hold for `ms` before the text starts. A tap skips the
  wait; skip mode ignores it.
- **Validation:** at most one per batch (`batch/conflict`).
- **Typed:** `{ kind: 'wait'; ms: number }`

```ink
=== wait_example ===
# scene: archive
# wait: 1200
The archive was colder than I remembered. #id:ch2.archive.c0ld
```

### `puzzle`

- **Syntax:** `puzzle:<puzzle> then=<knot>` — `then` is required (`tag/missing-arg` without it).
- **Arguments:** `<puzzle>` — a puzzle of the chapter's world (`story/<chapter>/world.json`); `then=<knot>` — a knot
  of the chapter. Both have the id shape `[a-z][a-z0-9_]*`, stricter than §2's positional and value (no leading digit
  or `_`): else `tag/bad-arg`. No other option.
- **Placement (the yield block):** the tag stands alone on a tag-only line, and the next source line is `-> DONE`, with
  no blank or comment line between them. Staging tag lines above it join the yield step's batch (§3.5).
- **Effect:** the story stops at the `-> DONE`. GameSession runs the puzzle, then enters the `then` knot at its top.
  Before that, it writes the puzzle's outcome variables, each only if the chapter declares it:
  - `pz_<puzzle>` (int) — 0 none, 1 solved, 2 failed, 3 abandoned;
  - `pz_<puzzle>_hints` (int) — the hint tiers opened in this run.
- **Validation:** `tag/missing-arg`, `tag/bad-arg`, `tag/syntax`, `yield/shape`, `batch/conflict`; from LW3 also
  `puzzle/unknown`, `puzzle/then-unknown`, `puzzle/in-section`.
- **Typed:** `{ kind: 'puzzle'; puzzle: PuzzleLocalId; then: KnotName }`

```ink
=== archive ===
The drawer has four brass dials. #id:ch2.archive.d1al
# sfx: door
# puzzle: cabinet then=archive_after
-> DONE
```

### `explore`

- **Syntax:** `explore:<section>`
- **Arguments:** `<section>` — an exploration section of the chapter's world, id shape `[a-z][a-z0-9_]*` (else
  `tag/bad-arg`). No options.
- **Placement (the yield block):** as for `puzzle` — alone on a tag-only line, and the next source line is `-> DONE`.
- **Effect:** the story stops at the `-> DONE`, and GameSession hands control to the section's rooms. Ink is
  re-entered only at the top of a knot the section's data names (an event knot or an exit knot). An event knot ends
  with its own `explore: <section>` yield block, which hands control back to the rooms.
- **Validation:** `tag/missing-arg`, `tag/bad-arg`, `tag/syntax`, `yield/shape`, `batch/conflict`; from LW3 also
  `explore/unknown-section`, `explore/event-return`, `explore/event-escape`.
- **Typed:** `{ kind: 'explore'; section: SectionId }`

```ink
=== hall_return ===
ally: Let us look around. #id:ch1.hall.l00k
# explore: manor
-> DONE
```

---

## 7. Batches and execution order

All commands of one step form one batch. The order of tags in the source does not matter; the order of execution is
fixed:

1. **Audio** — `bgm` and `sfx` start at batch start (in parallel with the visuals).
2. **`scene`** — with `t=fade`: fade to black (ms/2); while black: hide all characters, remove the CG, set the
   background, and apply every `show` of the batch instantly; then fade from black (ms/2). With `t=cut`: all instant.
3. **Visual commands** — `bg`, `show`, `hide`, `cg` start **together** (one GSAP timeline) and the batch waits for the
   longest one.
4. **`wait`** — holds after step 3.
5. **Text** — the overlay starts the typewriter (or shows the choices). A yield step (§6 `puzzle`, `explore`) has no
   text: after steps 1–4, GameSession hands control to the puzzle or the rooms.

- **Tap during steps 2–4** completes every active transition instantly (timelines jump to their end state); the next
  tap advances as usual.
- **Skip mode and loading a save** run every transition with duration 0.
- **The logical stage state changes at batch start**, so a save taken mid-transition records the end state.
- **Conflicts** (`batch/conflict`, error) — two commands for the same target in one batch: two `bg`; `bg` + `scene`;
  `scene` + `hide` or `cg`; two `show`, or `show` + `hide`, of one character; two `cg`; two `bgm`; two `wait`; two
  yields (`puzzle` and `explore`, two `puzzle`, two `explore`).

---

## 8. Assets and preloading

- **Asset IDs** (`assets/catalog.json`, one namespace per kind):
  - `bg/<bg>`
  - `char/<char>/<expr>`
  - `cg/<cg>`
  - `bgm/<track>`
  - `sfx/<sfx>`
  - `prop/<prop>` — named only by world data, never by a tag. The scene receives a room's props in a `props`
    command built by GameSession, and a `bg` or `scene` clears them (PUZZLES-PLAN X11; a catalog namespace from L5).

  Each name is `[a-z][a-z0-9_]*`. A tag can only name an asset the catalog lists (`tag/unknown-asset`). Writers do
  not edit the catalog; a missing asset is an asset request in the narrative report.
- **Knot index** — at build time the story tool records, per knot:
  - every asset its literal tags name;
  - its successor knots: every `-> knot` written inside it. The DSL has no tunnels, and a divert into another knot's
    stitch or labelled gather is `graph/entry-below-top` (§10), so every knot is entered at its top. A `-> knot.stitch`
    inside the same knot is not a successor.
  - `ending`: whether a `-> END` divert is written inside it (the next-chapter trigger below).
  - **Yield edges** (from LW3):
    - `puzzle: … then=K` — K is a successor (preload and reachability).
    - `explore: S` — every knot named by S's effects and exits is a reachability edge, but not in the preload
      `next`: the room controller preloads per room, so a hub never preloads every event.
    - An event knot's carried stage (the budget below) is seeded with the background and props of every room that
      triggers it.
  - **Output:** `<chapter>.meta.json` → `knots.<name> = { assets, next, ending }`, plus `endings: { <knot>: <name> }`:
    the chapter's declared story endings (§9), `{}` when it has none.
- **Preload** — on entering knot K the runtime asks the scene and audio to load `assets(next(K))` in the background
  (cancellable; released if the story goes elsewhere). Knot K's own assets are already resident: they were preloaded
  when its predecessor was entered, or loaded at chapter start for the first knot. This is why tags must be literal and
  diverts must name knots — both are lint rules, not style.
- **Next chapter** — when a knot with `ending: true` is entered (a `-> END` is written inside it; a knot that only
  leads to such a knot does not count) and the next chapter is free (or already owned), its first knot's assets are
  preloaded at low priority. Entering a knot without `-> END` releases them again, so they never hold memory while the
  story continues in this chapter; the next `ending` knot requests them again. A paid chapter that is not owned is
  never preloaded: its manifest arrives only with the entitled chapter payload (principle 0). A knot that is a
  declared story ending (§9, the meta's `endings`) never preloads the next chapter: the story ends there.
- **Budget** — for every knot K, the decoded size of the **carried stage** plus `assets(K) ∪ assets(next(K))` must
  stay within the knot working-set budget (PROTOTYPE-PLAN.md "Budgets"); the build fails otherwise. The carried stage
  is what an earlier knot may leave on screen (background, CG, characters) that K's opening tag lines do not clear and
  that K and its successors do not name.
  - **Opening tag lines.** These are the tag-only lines between `=== K ===` and K's first other line (§3.3). They are
    the only clears the build credits. They run in K's first batch on every entry, because ink delivers them with the
    first line, the runtime merges tag-only steps forward (§3.5), and every knot is entered at its top (§10).
  - **What clears.** There, a `scene` tag clears it all, and `bg`, `cg`, `cg: off`, `show` and `hide` replace or clear
    their own slot. Every other tag in a knot only adds, including a clear written at the end of the first line.
  - **Writing for the budget.** Reuse a background rather than introducing a new one per knot. When a knot's
    successors bring new art, open it with a `scene` tag line, or clear a CG (`cg: off`) and characters (`hide`) on
    its opening tag lines.

---

## 9. Chapters and stories

- **Layout:**
  - `story/chapters.json` — the list `{ id, entry, paid, productId?, next }` in play order: a chapter's `next` is
    a later chapter of the list, or `null`.
  - `story/stories.json` — the story list (below).
  - Each chapter has one entry file, `story/<chapter>/main.ink`, and optional sibling files it INCLUDEs.
  - `story/common/globals.ink` holds the shared declarations.
- **Entry file top level** — only `INCLUDE`s, chapter-local `VAR`/`CONST` declarations and one divert to the first
  knot (`ink/entry`). The first line is `INCLUDE ../common/globals.ink`.
- **Globals = the carry set.** Every `VAR` in `globals.ink`:
  - is named `g_<name>`;
  - is a scalar (int, float, bool, string; no `LIST`).
  - `globals.ink` has no text and no knots except `=== function ... ===` definitions; functions are pure (no output,
    no tags).
  - At a chapter's end the runtime reads every `g_` variable and writes those values into the next chapter's story
    before its first line.
  - The prefix `g_` is forbidden outside `globals.ink` (`vars/global-prefix`).
- **Chapter end.** A chapter ends at `-> END` (one or several endings). What follows comes from `story/chapters.json`
  (`next`), unless the knot is a declared story ending (below); if the next chapter is paid and not owned, the client
  shows the paywall. **There is no paywall tag**: the story signals nothing about prices or purchase (narrative rule).
- **Stories** (`story/stories.json`; checked by `catalog/stories`, §11):

  ```jsonc
  // the array order is the Home order
  [ { "id": "manor", "first": "ch1", "cover": "cover/manor",
      "endings": { "truth": { "chapter": "ch2", "knot": "archive_truth" } } } ]
  ```

  - **Membership.** A story is the `next` chain from its `first` chapter; every chapter of `story/chapters.json` lies
    on exactly one story's chain. `chapters.json` keeps tier, product and `next`; `stories.json` adds only which chain
    is a story, its cover and its endings. Story ids match `^[a-z][a-z0-9_]{0,23}$`.
  - **First chapter.** The first chapter of every story is free, and no chapter's `next` names it.
  - **Title, teaser, cover.** The story's title and teaser are the `stories` / `teasers` entries of
    `story/locales/<lang>/story.json` (§4); the cover is a `cover/<name>` of `assets/catalog.json`.
  - **Endings.** `"endings": { "<name>": { "chapter": "<ch>", "knot": "<knot>" } }`, names
    `^[a-z][a-z0-9_]{0,31}$`. The chapter lies on the story's chain (a mid-story bad end is allowed). The knot writes
    `-> END`, has no successor knot and carries no `puzzle` / `explore` tag, so entering it is reaching the ending; one
    ending per knot. A chapter with a `next` keeps at least one `-> END` knot that is not a story ending: otherwise no
    playthrough could reach its successor.
  - **Story end.** After a declared ending's END the player sees "The End", not the next chapter; such a run carries
    nothing into the next chapter (the seeded playthroughs drop it too, §11).
  - **Shared cast and globals.** `story/cast.json` and `globals.ink` serve every story; the carry flows only along a
    story's chain, and the first chapter of a story starts from the declared defaults. New globals are named
    `g_<story>_<name>` (a convention, not linted).
  - **Never move a shipped chapter to another story:** its saves are keyed by story.
- **Isolation (principle 0):**
  - no divert into another chapter's knot — it is a different compiled story;
  - a chapter may INCLUDE only files in its own directory and `story/common/`;
  - a free chapter including a file of a paid chapter → `ink/include` (error) — that text would compile into the
    public JSON.
- **Saves and story edits** (from research R3 §2.4) — a resume after a story update falls back to the start of the
  knot, so prefer these edits:
  - add lines rather than delete them;
  - disable a choice with `{false}` rather than delete it;
  - keep knots as the unit of structure;
  - never rename a knot that shipped — renaming forces players back to the chapter start.

---

## 10. The ink subset

| Construct | DSL v2 |
|---|---|
| Knots, stitches, labelled gathers; diverts to a knot, and to a stitch or labelled gather of the same knot | allowed |
| A divert from one knot to a stitch or labelled gather of another (`-> k.s`, `-> k.g`, `-> k.s.g`) | forbidden (`graph/entry-below-top`) — every knot is entered at its top, so its opening tag lines run on every entry (the carried-stage budget, §8), and a resume after a story update restarts the saved knot at its top, where the player entered it. Split a scene that must be entered in the middle into its own knot |
| Tunnels (`-> k ->`, `->->`); knot or stitch parameters (`=== k(x) ===`, `= s(x)`) | forbidden (`ink/forbidden`) — a resume after a story update restarts the saved knot from its top with an empty call stack, so a tunnel return or a missing argument would be an ink error (PROTOTYPE-PLAN.md "Save format and resume") |
| Choices `*` / `+`, conditional choices, fallback choices | allowed (bracket-only text, §3.4) |
| `VAR`, `CONST`, `~` logic, `temp`, multi-line conditionals and multi-line sequences (`{ stopping: … }`, `{ cycle: … }`, `{ shuffle: … }`, `{ - cond: … }`), each branch's text on its own line with its own ID | allowed |
| `LIST` | forbidden (`ink/forbidden`) — saved scene state and the carry set hold scalars only; use `VAR` flags or counters |
| Functions | only in `globals.ink`, pure |
| Inline logic in a text line or choice: `{var}`, `{a\|b}`, `{flag: x}`, `{~a\|b}` | forbidden (`text/inline-logic`) — write whole alternative lines, each with its own ID |
| Glue `<>` | forbidden (`text/glue`) — a line is one translatable unit |
| Text and a divert on the same source line | forbidden (`text/divert-on-line`) — put `-> x` on its own line |
| `-> DONE` | allowed only directly after a `puzzle` / `explore` line (the yield block, §6): a hand-off to the host, not an ending; forbidden anywhere else (`ink/forbidden`), since chapters end at `-> END` |
| Divert to a variable target, threads `<-`, `EXTERNAL` | forbidden (`ink/forbidden`) — they defeat the static knot index or bypass the DSL |
| Global tags, dynamic tags | forbidden (§3.6, §2) |
| Knot / stitch names | `[a-z][a-z0-9_]*` (`ink/name`) |

---

## 11. What the story lint enforces

`npm --prefix client run story` runs, in order: catalog checks → source lint → compile (inkjs compiler, build time
only) → knot graph → localization → seeded playthroughs → emit. It prints every finding (it never stops at the first)
and exits non-zero if any **E** remains. `--strict` turns every **W** into an **E** (release builds). From LW3 the knot
graph also checks the yield edges, and each chapter's `world.json` is checked by the world lint and the soft-lock
check (the second table below).

| Code | Sev | Rule |
|---|---|---|
| `catalog/chapters` | E | `story/chapters.json`: ids `ch<N>` unique; `entry` exists; `paid` ⇒ `productId`; `next` names a later listed chapter or `null` (the list is in play order, §9); at least one chapter compiled (a run with 0 chapters is an error, not a green) |
| `catalog/assets` | E | `assets/catalog.json` keys well-formed; reserved words (`all`, `off`, `stop`) not used as ids; every `cast.json` `char` exists |
| `catalog/stories` | E | `story/stories.json` (§9), judged once `chapters.json` decoded in play order and `assets/catalog.json` decoded: (1) it exists and is a non-empty array whose entries have exactly `id`, `first`, `cover`, `endings`; (2) each `id` matches `^[a-z][a-z0-9_]{0,23}$` and is unique; (3) `first` is a listed free chapter that no `next` names; (4) the chain from `first` along `next` visits no chapter twice; (5) every listed chapter lies on exactly one story's chain; (6) `cover` is a `cover/<name>` that `assets/catalog.json` lists; (7) each ending name matches `^[a-z][a-z0-9_]{0,31}$` and its `chapter` lies on the story's chain; (8) its `knot` is in that chapter's graph with `-> END`, no successor knot and no `puzzle` / `explore` tag, no two endings name one knot, and a chapter with a `next` keeps a `-> END` knot that is no story ending; (9) a paid chapter's title in `story.json` is 1–32 code points in `ru` and in `en` (it is the invoice title) |
| `tag/syntax` | E | tag does not match the grammar (§2) |
| `tag/unknown-kind` | E | kind not in §6 |
| `tag/missing-arg` / `tag/bad-arg` | E | positional count, unknown/duplicate option, value out of range or not an integer; a `puzzle` without `then=`; a puzzle or section id or a knot name not `[a-z][a-z0-9_]*` (§6) |
| `tag/unknown-asset` | E | asset id not in the catalog (or expression not in that character's list) |
| `tag/dynamic` | E | `{` inside a tag |
| `tag/global` | E | tag before the first knot |
| `tag/in-choice` | E | staging tag inside choice brackets |
| `tag/after-choice-bracket` | E | tag after `]` on a choice line |
| `batch/conflict` | E | §7 conflicts within one batch |
| `id/missing` | E | text line or choice without an `id` |
| `id/format` | E | ID does not match `^ch[1-9][0-9]*\.[a-z][a-z0-9_]*\.[0-9a-z]{4}$` |
| `id/multiple` | E | more than one `id` on a line or choice |
| `id/duplicate` | E | ID used twice anywhere in `story/` |
| `id/chapter-prefix` | E | ID prefix differs from the owning chapter |
| `id/retired` | E | ID listed in `story/retired-ids.txt` |
| `id/on-non-text` | E | `id` on a tag-only line, logic line, divert, or fallback choice |
| `speaker/unknown` | E | prefix not in `story/cast.json` |
| `speaker/in-choice` | E | speaker prefix in choice text |
| `choice/text-after` | E | text after `]` on a choice line |
| `choice/too-many` | W | more than 4 choices in one choice block (portrait UI) |
| `text/inline-logic` | E | `{` in a text line or choice text |
| `text/glue` | E | `<>` anywhere in a chapter |
| `text/divert-on-line` | E | text and `->` on one source line |
| `text/long` | W | line longer than 160 graphemes (about four phone lines) |
| `ink/compile` | E | inkjs compiler error **or warning** (warnings are errors in this project) |
| `ink/todo` | W | ink `TODO:` author message |
| `ink/forbidden` | E | `EXTERNAL`, `<-`, `-> DONE` not directly after a yield line, divert to a variable, a tunnel (`-> k ->` or `->->`), a knot or stitch parameter, `LIST` |
| `yield/shape` | E | a `puzzle` / `explore` tag not alone on a tag-only line, or the next source line not `-> DONE` (§6) |
| `ink/include` | E | INCLUDE outside the chapter dir and `story/common/`; a free chapter including a paid chapter's file; a file included by two chapters |
| `ink/entry` | E | entry top level holds anything but INCLUDE / declarations / one divert; first line not `INCLUDE ../common/globals.ink` |
| `ink/name` | E | knot/stitch name not `[a-z][a-z0-9_]*` |
| `vars/global-prefix` | E | a `globals.ink` VAR not `g_`-prefixed or not scalar; a `g_` VAR declared elsewhere; text or non-function knots in `globals.ink` |
| `vars/write-only` | W | a VAR assigned but never read |
| `graph/unreachable-knot` | E | knot not reachable from the entry divert (static graph) |
| `graph/no-end` | E | the chapter has no path to `END` |
| `graph/entry-below-top` | E | a divert from one knot to a stitch or labelled gather of another knot (§10); enter the knot at its top |
| `play/runtime-error` | E | a seeded playthrough hit an ink error or warning (`onError` fails the run) |
| `play/step-cap` | E | a playthrough exceeded 5,000 steps (a loop is a failure, not a timeout) |
| `play/knot-not-visited` | E | a knot no seeded run entered, unless listed with a reason in `story/lint-allow.json` |
| `play/ending-not-reached` | E | a knot containing `-> END` that no seeded run reached |
| `play/line-without-id` | E | a line emitted at runtime without an `id` (cross-check of the source lint) |
| `loc/missing-en` / `loc/empty-en` | E | no English entry / empty English entry for an ID |
| `loc/orphan-en` | E | an English entry whose ID no longer exists in ink (retire it, §4) |
| `loc/stale-en` | W | the entry's `ru` differs from the current Russian text |
| `loc/missing-name` | E | a cast speaker, a chapter or a story without its name, title or teaser in `ru` and `en` |
| `budget/knot-set` | E | knot working set over budget (§8). Needs decoded sizes, so it is enforced by `npm --prefix client run build` (`budget.ts`), not by `story` |
| `paid/leak` | E | a paid chapter's ID or text fingerprint found under `client/src/story-gen/` (the build's input); from LW3 also a hint line ID or hint text |

**Enforced from LW3** (puzzle worlds and yield edges; [PUZZLES-PLAN.md](PUZZLES-PLAN.md) "Staging DSL additions"):

| Code | Sev | Rule |
|---|---|---|
| `puzzle/unknown`, `explore/unknown-section` | E | the id is not in the chapter's world |
| `puzzle/then-unknown` | E | `then=` names no knot of the chapter |
| `puzzle/in-section` | E | a puzzle both yielded and attached to a lock |
| `explore/event-return` | E | an event knot (named by a `story` effect of S) has no `explore: S` yield |
| `explore/event-escape` | E | an event knot contains `-> END` or diverts to a knot that is not an event knot of S |
| `world/schema` | E | `decodeWorldSource` issues (unknown key, missing field, bad id, wrong type) — every issue, never the first only |
| `world/duplicate-id`, `world/id-reserved` | E | rooms collide across sections; a puzzle id ends in `_hints` |
| `world/unknown-asset` | E | room `bg`, `prop`, `closeup` (cg), section `bgm`, exit `sfx` not in the catalog |
| `world/unknown-ref` | E | an item, doc, puzzle, room or hotspot key referenced but not defined; an effect knot not in the chapter |
| `world/one-way-exit` | E | a room→room exit without a reverse exit |
| `world/hotspot-frame` | E | a rect outside the safe frame `x 80–1000, y 160–1760` |
| `world/hotspot-small` / `world/hotspot-overlap` | W | a rect under 150×150 source px (44 CSS px at a 0.296 scale, 320×568); overlapping rects |
| `world/props-per-room` | E | more than 8 props in a room |
| `world/solution`, `world/solution-initial` | E | `PUZZLE_RULES[type].validateSolution` fails; the solution equals the initial state |
| `world/order-pieces` | E | an `order` puzzle in a lock whose `pieces` differ from the lock's slot items |
| `world/hint-count` | E | more than 3 hint tiers; a hint without an `id` |
| `world/title-long` | E | a puzzle title over 18 graphemes (the invoice title `Подсказка 3: <title>` must fit 32 chars) |
| `world/giveup-in-section`, `world/linear-requires`, `world/cross-section-item` | E | `giveUp` on a puzzle attached to a lock (Give up is for linear puzzles only); a linear puzzle with `requires`; an item obtained in one section and required (by a slot or a puzzle) in another |
| `world/cross-section-effect` | E | an `{ unlock: key }` in a room's `onEnter` or a hotspot's `then` / `onOpen` / `onFail` whose key is a hotspot of another section; an item or doc given (`gives`, `{ give }`) in more than one section |
| `world/puzzle-multi-lock` | E | a puzzle named by the `puzzle` field of more than one lock, in one section or in several; prints every lock that names it |
| `world/cross-section-exit` | E | a room→room exit whose `to.room` is a defined room of another section than the exit's own; prints every such exit, so a crossing pair is two findings. A room that is not defined stays `world/unknown-ref` |
| `world/fail-without-effect` | E | a lock puzzle with `maxAttempts` and an empty `onFail` |
| `world/var-type` | E | a declared projection VAR with the wrong type (`pz_*` int, `it_*` / `dc_*` bool) |
| `world/softlock` | E | the model checker found a reachable state (over `successors`, closed puzzles included) with no path to a `leave` effect; prints the action path |
| `world/unreachable` | W | an item, doc, room or puzzle no reachable state touches |
| `world/state-cap` | E | the checker exceeded `RESUME_STATE_CAP` (5,000) states: the section is too large to prove at resume (PUZZLES-PLAN X9); split it |
| `play/event-no-return` | E | a seeded run entered an event knot and stopped without its explore yield |

From LW3, world texts follow §4: `id/*` and `loc/*` apply to them, and IDs are unique across ink and world.

**Seeded playthroughs:**
- **Runs** — 200 runs per chapter (seeds 1–200, mulberry32), random choice index, step cap 5,000.
- **Paid chapters** — seeded with the carry values from the free chapter's runs, so ch2 is exercised with the states
  ch1 can produce. A run that ended in a declared story ending of its chapter (§9) carries nothing: the story ends
  there.
- **Each step** — tags parse, the line has an ID, the ID has an English entry, and the speaker is in the cast.
- **Report** — the seeds and the visited/ending coverage per chapter.
- **At a `puzzle` yield** (from LW3) — an outcome uniformly from {solved; failed if `maxAttempts`; abandoned if
  `giveUp`} and 0..tiers hints; then the outcome variables are written and the run enters the `then` knot.
- **At an `explore` yield** (from LW3) — a random walk over the section's `successors` (a closed puzzle included),
  with puzzle outcomes random as above. A `story` effect runs the event knot until its yield; a `leave` effect
  continues the story. The step cap stays 5,000.

---

## 12. Complete example

```ink
INCLUDE ../common/globals.ink
VAR ch1_asked_twice = false
-> cafe

=== cafe ===
# scene: cafe
# show: ally neutral at=left
# bgm: calm
The rain had not stopped since noon. #id:ch1.cafe.p2m7
ally: You came after all. #show: ally smile #id:ch1.cafe.k3x9
# show: ally worried
ally: Did you bring it? #id:ch1.cafe.a81c
* [Show her the letter #id:ch1.cafe.c4tz]
    ~ g_trust_ally += 1
    # cg: letter
    ally: So it is true. #id:ch1.cafe.n5bd
    -> street
* [Say you lost it #id:ch1.cafe.c9qd]
    ~ g_lied_to_ally = true
    # show: ally angry
    ally: Of course you did. #id:ch1.cafe.f0wd
    -> street

=== street ===
# scene: street
# show: stranger neutral at=right
# bgm: tension fade=2000
stranger: You dropped this. #sfx: steps #id:ch1.street.m2r8
{ g_lied_to_ally:
    ally: He knows you lied. #id:ch1.street.l1ed
- else:
    ally: Who is he? #id:ch1.street.wh0h
}
-> END
```

<!-- dsl: invalid -->
```ink
=== broken ===
# BG: Cafe
ally: Hi, {player_name}! #show: ally grin
* [Leave #sfx: door] You leave.
```

Each line of the counter-example fails:
- `tag/syntax` — uppercase `BG: Cafe`.
- `text/inline-logic` and `id/missing` — `{player_name}`, no ID.
- `tag/unknown-asset` — `grin` is not an expression of `ally`.
- `tag/in-choice` — `sfx` inside the brackets.
- `choice/text-after` — text after `]`.
- `id/missing` — the choice has no ID.

---

## 13. Changing the DSL

A new tag, option or default is a design change:
1. A DSL change request (narrative report or owner).
2. An architect note.
3. In one commit:
   - the parser (`tags.ts`) and its tests;
   - the lint table;
   - this file — the §6 heading, the table row and an example;
   - AUTHORING.md.
4. The doc test (`dsl-doc.test.ts`) proves the two-way match.

Bump the DSL version line at the top. Removing or renaming a tag requires migrating every chapter in the same lane.
