# Authoring guide

> How to write chapters, puzzle worlds, stories and story meta for tg-app-novel, and get
> `npm --prefix client run story` green.

This guide is the writers' contract. The tag reference is [STAGING-DSL.md](STAGING-DSL.md): this guide links to it
for every tag and lint rule and never adds a rule of its own. Where it restates a rule, it names the DSL section.
Facts here describe the tree at `4d8a9ec`; where a game screen is not built yet, the guide says "planned" and names
the lane.

Examples use English placeholder text. Real chapters are written in Russian (the ink text *is* the Russian text).
Every snippet the guide calls valid passes the story gate: it is part of one small story whose files are listed in
full under [Complete example](#complete-example), or it is a change to that story the text describes. Every snippet
the guide calls invalid is such a change, shown with the exact findings the gate prints for it.

## Before you start

### What you edit and what you do not

| You edit | You do not edit |
|---|---|
| `story/chapters.json`, `story/stories.json`, `story/meta.json` | `assets/catalog.json` (an asset you need is an asset request in your narrative report) |
| `story/<ch>/*.ink`, `story/<ch>/world.json`, `story/common/globals.ink` | anything under `client/`, `server/`, `docs/` |
| `story/cast.json`, `story/locales/**`, `story/retired-ids.txt`, `story/lint-allow.json` | the generated `client/src/story-gen/` and `server/content/` (the gate rewrites them) |

### Running the story gate

Install the client packages once, then run the gate from the repository root:

```powershell
npm --prefix client ci
npm --prefix client run story
```

Three flags rewrite or tighten the run ([story.ts:9](../client/scripts/story.ts#L9)):

```powershell
npm --prefix client run story -- --fix-ids        # write a fresh ID into every line that lacks one
npm --prefix client run story -- --sync-locales   # add an empty en entry for every new ID
npm --prefix client run story -- --strict         # every warning (W) becomes an error (E)
```

The gate prints every finding, never only the first, and exits 1 while any error remains
([story.ts:795-800](../client/scripts/story.ts#L795)). It writes its outputs only on a run with no error
([story.ts:728-729](../client/scripts/story.ts#L728)).

## Part 1: chapters and ink

### Chapters and `story/chapters.json`

A chapter is one compiled ink story. `story/chapters.json` lists every chapter in play order
([STAGING-DSL §9](STAGING-DSL.md#9-chapters-and-stories)):

```json
[
  { "id": "ch1", "entry": "ch1/main.ink", "paid": false, "next": "ch2" },
  { "id": "ch2", "entry": "ch2/main.ink", "paid": true, "productId": "chapter:ch2", "next": null }
]
```

The decoder ([catalog.ts:447](../client/src/story/catalog.ts#L447)) and the gate enforce, all as `catalog/chapters`:
- `id` is `ch<N>` (`ch1`, `ch2`, `ch10`) and unique; `entry` is exactly `<id>/main.ink`;
- a paid chapter has a `productId`, a free chapter has none, and no two chapters share one;
- `next` names a later chapter of the list, or is `null` ([story.ts:570-573](../client/scripts/story.ts#L570)).

**Free and paid.** A free chapter compiles into the public app bundle. A paid chapter compiles only into
`server/content/`, which the server hands out after an entitlement check (CLAUDE.md principle 0). Two rules keep a
paid chapter's text out of the bundle:
- write a paid chapter's text only in its own directory, never in a free chapter's file;
- a free chapter may never `INCLUDE` a file of a paid chapter: that text would compile into the public JSON. The
  gate stops it with `ink/include` (below, and [STAGING-DSL §9](STAGING-DSL.md#9-chapters-and-stories) "Isolation").

There is no paywall tag. The story never mentions prices or purchase; the game shows the paywall when the next
chapter is paid and not owned (planned: L14b overlay-menus).

### The entry file and the ink subset

Each chapter has one entry file, `story/<ch>/main.ink`. Its top level holds only `INCLUDE`s, chapter-local `VAR` /
`CONST` declarations and one divert to the first knot, and its first line is `INCLUDE ../common/globals.ink`
(`ink/entry`, [STAGING-DSL §9](STAGING-DSL.md#9-chapters-and-stories)). The example's paid chapter:

```ink
INCLUDE ../common/globals.ink
-> archive

=== archive ===
# scene: archive
# bgm: mystery
The archive smells of old paper. #id:ch2.archive.p4pr
{ g_trust_ally > 0:
    ally: I knew I could count on you. #id:ch2.archive.c0nt
- else:
    ally: Let us see what your word is worth. #id:ch2.archive.w0rd
}
* [Tell her the truth #id:ch2.archive.t3ll]
    -> archive_truth
* [Keep quiet #id:ch2.archive.q01t]
    -> archive_silence

=== archive_truth ===
ally: Thank you for telling me. #id:ch2.truth.th4k
-> END

=== archive_silence ===
ally: Then we are done here. #id:ch2.silence.d0ne
-> END
```

The project uses a subset of ink. The full table, with the reason for each ban, is
[STAGING-DSL §10](STAGING-DSL.md#10-the-ink-subset). The bans a writer meets first:
- no inline logic in a line (`{var}`, `{a|b}`): write whole alternative lines, each with its own ID (`text/inline-logic`);
- no glue `<>` (`text/glue`); no text and a divert on one line (`text/divert-on-line`);
- no tunnels, threads, `LIST`, `EXTERNAL`, knot parameters or variable diverts (`ink/forbidden`);
- `-> DONE` only directly after a `puzzle` / `explore` tag line ([the yield block](#the-yield-block)); a chapter ends
  at `-> END`;
- never divert into a stitch or labelled gather of another knot: enter every knot at its top
  (`graph/entry-below-top`).

Shared variables live in `story/common/globals.ink`. Every `VAR` there is a `g_`-prefixed scalar, and the prefix is
forbidden anywhere else (`vars/global-prefix`). Declaring `VAR g_seen_box = false` in `ch1/main.ink` prints:

```text
E story/ch1/main.ink:3 vars/global-prefix 'g_seen_box': the g_ prefix belongs to common/globals.ink only (§9)
```

At a chapter's end the runtime carries every `g_` value into the next chapter of the story
([STAGING-DSL §9](STAGING-DSL.md#9-chapters-and-stories) "Globals = the carry set").

### Line IDs and `--fix-ids`

Every text line and every choice with text carries exactly one line ID: `#id:<chapter>.<knot>.<suffix>`, for example
`#id:ch2.archive.p4pr` ([STAGING-DSL §4](STAGING-DSL.md#4-line-ids-localization-and-position--principle-8), regex
[tags.ts:40](../client/src/story/tags.ts#L40)). The ID is the line's identity for translation, saves and
statistics:
- the chapter part is the chapter whose files hold the line (`id/chapter-prefix`);
- the knot part is only a hint, assigned once: moving the line to another knot keeps its ID;
- the suffix is 4 characters of `0-9a-z`, assigned once;
- IDs are unique across every chapter of every story (`id/duplicate`), and a deleted line's ID is never reused
  ([Removing a line](#removing-a-line-retired-ids)).

A choice's ID goes **inside** the brackets: `* [Keep quiet #id:ch2.archive.q01t]`
([STAGING-DSL §3](STAGING-DSL.md#3-where-tags-go)).

A line without an ID fails the gate. Adding `Dust hangs in the light.` under the archive's first line prints:

```text
E story/ch2/main.ink:8 id/missing a text line needs an id tag (§4)
```

`--fix-ids` writes a fresh ID into every line the lint reports as `id/missing`, then lints
([story.ts:243-296](../client/scripts/story.ts#L243)). It never touches an existing ID. On that line it reports
`fix-ids: 1 ids added in 1 files` and leaves `Dust hangs in the light. #id:ch2.archive.<new suffix>`, followed by
`loc/missing-en` until the en table has the entry ([Locale tables](#locale-tables-ru-and-en)).

Two limits to know:
- **Move a misplaced ID first.** `--fix-ids` does not move an ID you wrote in the wrong place; it adds a second one.
  `* [Keep quiet] #id:ch2.archive.q01t` (the ID after `]`) fails with `id/missing`, `tag/after-choice-bracket` and
  `loc/orphan-en`. Run `--fix-ids` on it and the line becomes
  `* [Keep quiet #id:ch2.archive.<new>] #id:ch2.archive.q01t`, and the gate prints `tag/after-choice-bracket` (the
  old ID), `loc/missing-en` (the new one) and `loc/orphan-en` (the old one's entry). Move the ID inside the brackets
  by hand, then run the tool.
- **A file no chapter includes is not checked.** A `.ink` file that no chapter's entry file reaches through
  `INCLUDE` is not compiled, and a duplicate ID inside it is not reported. A copy of `#id:ch2.archive.p4pr` in an
  unincluded `story/ch1/spare.ink` passes with `0 errors`. Included by `ch1/main.ink`, the same file prints
  `id/duplicate`, `id/chapter-prefix`, `graph/unreachable-knot` and `loc/missing-en`. Delete scratch files, or include
  them.

`--fix-ids` also writes IDs into world texts that lack one ([The world file](#the-world-file)). A text lacks one
when it has no `id` key at all, `{ "ru": "…" }` ([fix.ts:210](../client/scripts/story/fix.ts#L210)); an empty
`"id": ""` is `id/format`, and `--fix-ids` leaves it alone (`fix-ids: 0 ids added in 0 files`): delete the key, or
write the text's old ID back if it had one. The tool cannot know an old ID: a text that lost its ID gets it back by hand
([The world file](#the-world-file), "A world text that lost its ID"). A
world file the tool adds an ID to comes back as two-space JSON, one value per line
([fix.ts:220-222](../client/scripts/story/fix.ts#L220)): the example's 65-line `ch1/world.json` becomes 260 lines,
so expect a large diff. The IDs it treats
as taken are every ID-shaped string of the ink files, the world files, the en tables and `retired-ids.txt`
([story.ts:248-260](../client/scripts/story.ts#L248)); `story/meta.json` is not read (see
[Choices are statistics](#choices-are-statistics)).

### Speakers and `story/cast.json`

A dialogue line starts with a speaker prefix: the speaker ID, a colon, one space, the text. A line without a prefix
is narration ([STAGING-DSL §5](STAGING-DSL.md#5-speakers)):

```ink
=== study_voice ===
voice: Is anyone there? #id:ch1.study.v01c
# explore: house
-> DONE
```

Every speaker is a key of `story/cast.json`, which maps it to its sprite character or to `null`:

```json
{
  "ally": { "char": "ally" },
  "stranger": { "char": "stranger" },
  "voice": { "char": null }
}
```

The prefix does not change the sprite (use a `show` tag), a choice never has a prefix (`speaker/in-choice`), and the
name plate comes from the locale table `names`, never from the prefix. `keeper:` is a character in
`assets/catalog.json` but not a speaker in `cast.json`, so `keeper: Is anyone there?` prints:

```text
E story/ch1/main.ink:32 speaker/unknown speaker 'keeper' is not in story/cast.json (§5)
```

A new speaker needs a `cast.json` entry and its name in both `story/locales/ru/story.json` and
`story/locales/en/story.json` (`loc/missing-name`). Its `char`, if not `null`, must be a character of the asset
catalog (`catalog/assets`).

### Staging tags

Tags stage the scene: `scene`, `bg`, `show`, `hide`, `cg`, `bgm`, `sfx`, `wait`, plus the two yield tags `puzzle`
and `explore`. The parser's list is `TAG_KINDS` ([tags.ts:27](../client/src/story/tags.ts#L27)); the syntax, options,
defaults and conflicts of each are in [STAGING-DSL §6](STAGING-DSL.md#6-tags) and
[§7](STAGING-DSL.md#7-batches-and-execution-order). The habits that keep a chapter green and cheap:
- put scene-setting tags on their own lines at the top of a knot, as `archive` does above
  ([STAGING-DSL §3](STAGING-DSL.md#3-where-tags-go));
- tags are literal and lowercase: `# BG: Cafe` is `tag/syntax`, a `{` inside a tag is `tag/dynamic`;
- only the line ID goes inside choice brackets (`tag/in-choice`), and nothing but a divert follows `]`
  (`choice/text-after`, `tag/after-choice-bracket`);
- reuse backgrounds, and open a knot that brings new art with a `scene` tag line: the build checks each knot's
  working set against the memory budget (`budget/knot-set`, [STAGING-DSL §8](STAGING-DSL.md#8-assets-and-preloading)).
  `npm --prefix client run build` enforces it, not `story`.

### Pacing on a phone

The game is read in portrait on a phone. Two warnings of
[STAGING-DSL §11](STAGING-DSL.md#11-what-the-story-lint-enforces) set the limits:
- `text/long`: a line over 160 graphemes, about four phone lines, prints `text/long 161 graphemes (over 160)`. Split it
  into two lines, each with its own ID;
- `choice/too-many`: a choice block of more than 4 options prints
  `choice/too-many more than 4 choices in one block (portrait UI)`.

Both are warnings, so `story` stays green, but `--strict` (release builds) turns them into errors. The gate has no
rule for Russian typography (quotes, dashes, `ё`).

### Locale tables (ru and en)

Russian is the ink text; English lives in one table per chapter, `story/locales/en/<ch>.json`
([STAGING-DSL §4](STAGING-DSL.md#4-line-ids-localization-and-position--principle-8)). Each entry keys a line ID to the
Russian source it was translated from and the English text, without the speaker prefix:

```json
{
  "ch2.archive.p4pr": { "ru": "The archive smells of old paper.", "en": "The archive smells of old paper." },
  "ch2.archive.t3ll": { "ru": "Tell her the truth", "en": "Tell her the truth" }
}
```

In the example the source is an English placeholder, so `ru` and `en` read the same; in a real chapter `ru` holds the
Russian line. The real tables are [story/locales/en/ch1.json](../story/locales/en/ch1.json) beside
[story/ch1/main.ink](../story/ch1/main.ink).

The workflow for a new line:
1. Write the line with its ID (or run `--fix-ids`). The gate prints `loc/missing-en … (run --sync-locales)`.
2. Run `--sync-locales`. It appends `{ "ru": "<current source>", "en": "" }` for each new ID and reports
   one line per chapter, here `sync-locales: ch1 +0 entries` and `sync-locales: ch2 +1 entries`; the gate now prints
   `loc/empty-en`. The tool rewrites the table as two-space
   JSON ([fix.ts:278](../client/scripts/story/fix.ts#L278)).
3. Fill in `en`.

The checks ([locales.ts:175-201](../client/scripts/story/locales.ts#L175)):

| Code | Sev | When | Fix |
|---|---|---|---|
| `loc/missing-en` | E | an ID has no entry | `--sync-locales`, then fill `en` |
| `loc/empty-en` | E | `en` is blank | write the translation |
| `loc/stale-en` | W | the entry's `ru` differs from the current ink text | update `en`, then copy the new text into `ru` |
| `loc/orphan-en` | E | an entry whose ID no line uses | retire the ID ([Removing a line](#removing-a-line-retired-ids)) |
| `loc/missing-name` | E | a speaker, chapter or story without its name, title or teaser in ru or en | add it to both `story.json` tables |

Editing `The archive smells of old paper.` to `The archive smells of dust and old paper.` keeps the ID and prints a
warning, not an error:

```text
W story/locales/en/ch2.json:2 loc/stale-en 'ch2.archive.p4pr': the entry's ru "The archive smells of old paper." is not the source "The archive smells of dust and old paper." (update en, then copy the new ru)
```

Names, chapter titles, story titles and teasers live in `story/locales/ru/story.json` and
`story/locales/en/story.json`, sections `names`, `chapters`, `stories`, `teasers`; every key is required in both
languages. These four sections are public by design: the public chapter catalog carries them, paid chapters' titles
included.

### Assets and `assets/catalog.json`

A tag names an asset by its catalog name, never by a file: `# bg: hall`, `# show: ally neutral at=left`,
`# bgm: calm`. The namespaces are `bg`, `char/<char>/<expr>`, `cg`, `bgm`, `sfx`, plus `prop` (named only by world
data) and `cover` (named only by `stories.json`) ([STAGING-DSL §8](STAGING-DSL.md#8-assets-and-preloading),
[catalog.ts:388](../client/src/story/catalog.ts#L388)). A name the catalog lacks fails:

```text
E story/ch2/main.ink:7 tag/unknown-asset 'bg: garden': bg 'garden' is not in assets/catalog.json
```

Writers do not edit [assets/catalog.json](../assets/catalog.json). A missing background, sprite, expression, sound,
prop or cover is an asset request in your narrative report.

### Removing a line: retired IDs

An ID is never reused, because saves, translations and statistics point at it
([STAGING-DSL §4](STAGING-DSL.md#4-line-ids-localization-and-position--principle-8)). To remove a line:
1. Delete the line from the ink. The gate prints
   `loc/orphan-en 'ch2.archive.p4pr' names no line of ch2: retire it (§4)`.
2. Append the ID to `story/retired-ids.txt`, one per line:

   ```text
   ch2.archive.p4pr
   ```

3. Delete its entry from `story/locales/en/<ch>.json`. The gate is green again.

An ID in `retired-ids.txt` that still appears in ink fails:

```text
E story/ch2/main.ink:7 id/retired 'ch2.archive.p4pr' is in story/retired-ids.txt: a retired ID is never reused (§4)
```

A line in `retired-ids.txt` that is not a line ID is `id/format` ([locales.ts:157](../client/scripts/story/locales.ts#L157)).
To keep saves working after a story update, prefer adding lines to deleting them, disable a choice with `{false}`
rather than delete it (but not the last way into an `-> END` knot: see `play/ending-not-reached` under
[Reading the story gate's output](#reading-the-story-gates-output)), and never rename a knot that shipped
([STAGING-DSL §9](STAGING-DSL.md#9-chapters-and-stories) "Saves and story edits").

### Reading the story gate's output

A green run of the [complete example](#complete-example) prints:

```text
story: ch1 free knots 5 lines 9 version f909db9e3c3cc824
story: ch2 paid knots 3 lines 7 version cdaeb1ee4149c609
world: ch1: 1 section, 2 rooms, 2 puzzles, softlock OK (14 states)
world: ch2: none
stories: manor (ch1 → ch2), endings 2
meta: manor endings 2, achievements 3; choices ch1 2/1, ch2 2/1
play: ch1: 200 runs, knots 5/5, endings 1/1 (seeds 1-200, defaults; ended 200, yielded 0, failed 0; pz_box 1,3; pz_desk 1)
play: ch2: 200 runs, knots 3/3, endings 2/2 (seeds 1-200, ch1 carries; ended 200, yielded 0, failed 0)
story: 0 errors, 0 warnings
```

The lines, in print order ([story.ts:771-799](../client/scripts/story.ts#L771)):

| Line | Says |
|---|---|
| `fix-ids:` / `sync-locales:` | what the two flags wrote (only with the flag) |
| `story: <ch> <tier> knots N lines N version <hex>` | the chapter compiled; `story: <ch> failed` when it did not |
| `world: <ch>: …` | the world: `none`, `not checked (world/schema)`, `not checked (catalog/assets)` (the asset catalog did not decode), or its sections, rooms, puzzles and the soft-lock verdict ([World lint codes](#world-lint-codes-and-soft-lock-counterexamples)) |
| `stories: <id> (<chain>), endings N` | one per story: its chapters in order and its declared endings |
| `meta: …` | per story its titled endings and achievements, then per chapter `<options>/<points>` ([Choices are statistics](#choices-are-statistics)); `meta: not checked (catalog/stories)` or `meta: invalid (catalog/meta)` instead |
| `play: <ch>: …` | the seeded playthroughs (below) |
| `E` / `W <file>:<line> <code> <message>` | one finding; line `0` means the whole file |
| `story: N errors, N warnings` | the total; exit 1 when N errors > 0 |

**Seeded playthroughs** ([STAGING-DSL §11](STAGING-DSL.md#11-what-the-story-lint-enforces) "Seeded playthroughs" and its `play/*`
rows). The gate plays each chapter 200 times (seeds 1-200), choosing at random, with a cap of 5,000 steps per run
([playthrough.ts:35-37](../client/scripts/story/playthrough.ts#L35)). In a chapter with a world, a run plays through
each yield with a random puzzle outcome or a random walk over the rooms. The `play:` line reads
`runs, knots visited/total, endings reached/total (seeds, start; ended, yielded, failed; pz_<puzzle> outcomes seen)`
([playthrough.ts:622-630](../client/scripts/story/playthrough.ts#L622)):
- the start is `defaults`, or `<previous chapter> carries` when the chapter continues from the one before it, or
  `defaults: <previous chapter> left no carry` when no run of the previous chapter carried values into this one, for
  example because every run ended in a declared ending
  ([playthrough.ts:624](../client/scripts/story/playthrough.ts#L624));
- `ended` counts the runs that reached an `-> END`, `yielded` the runs that stopped at a yield because the chapter has
  no world, and `failed` the runs that hit an error or the step cap
  ([playthrough.ts:4-5](../client/scripts/story/playthrough.ts#L4)). In a healthy chapter `ended` equals the run
  count, so `yielded 0` is normal: a chapter with a world plays through its yields, and a yield in a chapter without
  a world is already `puzzle/unknown` or `explore/unknown-section`, which keeps the chapter from being played
  ([The play gate](#reading-the-story-gates-output), below);
- `pz_<puzzle> 1,3` lists the outcome codes the runs saw (1 solved, 2 failed, 3 abandoned, [Projection variables](#projection-variables)).

Each run checks that tags parse, the line has an ID with an en entry and the speaker is in the cast. Two coverage
findings follow the runs ([playthrough.ts:594-602](../client/scripts/story/playthrough.ts#L594)):
- a knot no run entered is `play/knot-not-visited`, unless `story/lint-allow.json` lists it with a reason;
- a knot that writes `-> END` and in which no run ended is `play/ending-not-reached`. `story/lint-allow.json` cannot
  silence it.

An allowlist entry has this shape (in the example every knot is visited, so this entry changes nothing; it shows the
format):

```json
{ "play/knot-not-visited": { "ch1.study_voice": "entered only through the study's onEnter event" } }
```

Each key is `<chapter>.<knot>` of a listed chapter, and each reason a non-empty string; a malformed entry is itself a
`play/knot-not-visited` finding ([playthrough.ts:138-192](../client/scripts/story/playthrough.ts#L138)).

An ending knot that no run can reach keeps the gate red. Disabling the archive's only way into `archive_silence`,
`* {false} [Keep quiet #id:ch2.archive.q01t]`, prints:

```text
E story/ch2/main.ink:22 play/knot-not-visited knot 'archive_silence': no seeded run entered it (200 runs; story/lint-allow.json lists a knot with a reason)
E story/ch2/main.ink:22 play/ending-not-reached knot 'archive_silence' writes -> END, but no seeded run ended in it (200 runs)
```

An allowlist entry for `ch2.archive_silence` removes the first line only. Keep at least one live path into every
knot that writes `-> END`.

**The play gate.** A chapter is played only when it compiled and the earlier stages left no error in its files or its
world, and its predecessor was played ([story.ts:479-500](../client/scripts/story.ts#L479)). Otherwise its line reads
`play: <ch>: not played (<reason>)`, the reason being `not compiled`, `errors in its sources` or
`<previous chapter> was not played`. It is not a finding of its own: fix the errors above it and the chapter plays
again. A `play/…` finding therefore always means a problem only a run can see.

## Part 2: worlds (puzzles and exploration)

A chapter may have a world, `story/<ch>/world.json`: items, documents, puzzles and exploration sections (rooms with
hotspots). Ink hands control to the world with a yield tag and gets it back at the top of a knot. The format is
PUZZLES-PLAN "World data"; the decoder is [world/decode.ts](../client/src/world/decode.ts) and the lint is
[scripts/story/world.ts](../client/scripts/story/world.ts).

### The world file

The example's world (in full under [Complete example](#complete-example)) has one item, one document, two puzzles
and one section of two rooms. The top level has exactly five keys:

```text
{ "format": 1, "items": { … }, "docs": { … }, "puzzles": { … }, "sections": { … } }
```

Its `items` and `docs` (JSON snippets in this part are fragments of that file):

```json
"items": {
  "key": { "name": { "id": "ch1.key.n4me", "ru": "Brass key" },
           "desc": { "id": "ch1.key.d3sc", "ru": "A small key with a worn ring." }, "glyph": "key" }
},
"docs": {
  "note": { "title": { "id": "ch1.note.t1tl", "ru": "A folded note" },
            "body": [ { "id": "ch1.note.b0dy", "ru": "The desk opens with the year the house was built." } ] }
}
```

The decoder's rules ([decode.ts:1-5](../client/src/world/decode.ts#L1); the `world/schema`, `world/duplicate-id` and
`world/unknown-asset` rows of [STAGING-DSL §11](STAGING-DSL.md#11-what-the-story-lint-enforces), second table):
- `format` is `1`. Every key of the format is required, except `take.then` and `lock.onOpen` (default `[]`).
  Nullable keys are still written: `"sfx": null`, `"prop": null`, `"look": null`, `"lock": null`,
  `"puzzle": null`, `"closeup": null`, `"maxAttempts": null`, `"bgm": null`.
- An unknown key is an error, so a typo such as `onenter` is `world/schema`, not a silently empty trigger.
- Ids (items, docs, puzzles, sections, rooms, hotspots) match `[a-z][a-z0-9_]*`. Room ids are unique across the
  chapter's sections (`world/duplicate-id`); a hotspot id is unique within its room.
- An item's `glyph` is one of `sun`, `moon`, `star`, `key`, `letter`, `book`, `gear`, `coin`
  ([types.ts:33](../client/src/world/types.ts#L33)).
- Every player-facing text is `{ "id": "<line ID>", "ru": "<text>" }`. The ID's knot part is the id of the item,
  document, puzzle or section that owns the text, which is what `--fix-ids` writes
  ([fix.ts:225](../client/scripts/story/fix.ts#L225)). World texts get en entries like ink lines; `--sync-locales`
  covers them, and `id/*` and `loc/*` apply to them (STAGING-DSL §11, the line under the second table, and
  [§4](STAGING-DSL.md#4-line-ids-localization-and-position--principle-8)).
- Asset names come from the catalog: room `bg`, hotspot `prop`, puzzle `closeup` (a `cg`), section `bgm`, exit `sfx`
  (`world/unknown-asset`).

**Fix the world's own error first.** A world that does not decode is not checked further: the `world:` line reads
`not checked (world/schema)`, its yields add no edges to the knot graph and its texts count as no lines
([story.ts:304-330](../client/scripts/story.ts#L304)). Any of the decoder's four codes stops the decode
([world.ts:210-225](../client/scripts/story/world.ts#L210)):
- `world/schema`. A stray `"requires": ["key"]` on a puzzle prints
  `world/schema puzzles.box.requires: unknown key …`;
- `world/hint-count`, more than 3 hint tiers. A fourth hint on `box` prints
  `E story/ch1/world.json:16 world/hint-count puzzles.box.hints: 4 hints: at most 3 tiers (X18)`;
- `id/missing` or `id/format` on a world text. Removing the clock label's ID prints
  `E story/ch1/world.json:41 id/missing sections.house.rooms.hall.hotspots.2.label.id: missing: every world text carries a line ID (STAGING-DSL §4)`.

The last two print no `world/schema` finding, but the `world:` line still reads `not checked (world/schema)`. In the
example each one is followed by `graph/no-end`, two `graph/unreachable-knot` and a `loc/orphan-en … retire it` for
each of the world's en entries. Those findings vanish with the world's error. **Do not retire those IDs**: the lines
still exist.

**A world text that lost its ID: put the old ID back.** The text's entry is among those orphans, with the same `ru`.
For the clock label it is `'ch1.house.l6ck'`, the entry `{ "ru": "Clock", … }`. Write that ID back into the text by
hand. Do not run `--fix-ids` on it: the tool gives the text a fresh ID, and the gate then prints
`loc/missing-en 'ch1.house.<new>'` and `loc/orphan-en 'ch1.house.l6ck' … retire it`. The text would lose its en
translation, and its old ID would be retired for nothing. If you already ran the tool, replace `ch1.house.<new>` with
`ch1.house.l6ck` in the world file: the gate is green again. Use `--fix-ids` only for a text that never had an ID.

### Hotspot kinds

A room is `{ bg, title, onEnter, hotspots }`. A hotspot is `{ id, kind, rect, label, … }`; its kind decides the rest
([decode.ts:321-372](../client/src/world/decode.ts#L321)):

| Kind | Extra keys | On tap |
|---|---|---|
| `look` | `look` (a text), `then` | shows the text; runs `then` once |
| `take` | `gives` (`{ "item": … }` or `{ "doc": … }`), `prop`, optional `then` | once: into the inventory; the prop disappears; runs `then` once |
| `exit` | `to` (`{ "room": … }` or `{ "story": "<knot>" }`), `lock`, `sfx` | locked: the lock; open: move to the room, or leave the section into the knot |
| `object` | `lock`, `then`, `look`, `prop` | locked: the lock; open: runs `then` once |

The study's three hotspots: an exit, an object and a take (the hall's `clock` is the example's `look`):

```json
{ "id": "to_hall", "kind": "exit", "rect": [100, 1200, 250, 400],
  "label": { "id": "ch1.house.l3th", "ru": "Back to the hall" },
  "to": { "room": "hall" }, "lock": null, "sfx": null },
{ "id": "desk", "kind": "object", "rect": [450, 1100, 400, 300],
  "label": { "id": "ch1.house.l4dk", "ru": "Desk" }, "look": null, "prop": null,
  "lock": { "slots": [], "puzzle": "desk",
            "locked": { "id": "ch1.house.k2lk", "ru": "The drawer has a dial lock." }, "onFail": [] },
  "then": [ { "give": "key" } ] },
{ "id": "note", "kind": "take", "rect": [500, 500, 200, 200],
  "label": { "id": "ch1.house.l5nt", "ru": "A note" },
  "gives": { "doc": "note" }, "prop": "note" }
```

Exits between rooms come in pairs: a room→room exit needs an exit back (`world/one-way-exit`), and stays inside its
own section (`world/cross-section-exit`; both are rows of [STAGING-DSL §11](STAGING-DSL.md#11-what-the-story-lint-enforces), second
table). An exit `{ "story": "<knot>" }` is how the player **leaves** the section; every section needs one the player
can always reach (the soft-lock check, below).

### Locks and slots

A lock sits on an `exit` or an `object`: `{ slots, puzzle, locked, onOpen?, onFail }` (PUZZLES-PLAN "Lock"):
- `slots` (each `{ "accepts": "<item>" }`) fill in any order, and each fill stays;
- when every slot is filled, the lock's `puzzle` (if any) opens; solved opens the lock, failed runs `onFail`;
- `locked` is the text the lock panel shows;
- `onOpen` runs once when the lock first opens, whatever opened it.

The example's front door is a one-slot lock without a puzzle:

```json
{ "id": "front_door", "kind": "exit", "rect": [420, 700, 300, 600],
  "label": { "id": "ch1.house.l2fd", "ru": "Front door" },
  "to": { "story": "house_out" }, "sfx": "door",
  "lock": { "slots": [ { "accepts": "key" } ], "puzzle": null,
            "locked": { "id": "ch1.house.k1lk", "ru": "Locked. The keyhole is small and brass." },
            "onFail": [] } }
```

The lint's lock rules ([world.ts:571-641](../client/scripts/story/world.ts#L571); their rows of
[STAGING-DSL §11](STAGING-DSL.md#11-what-the-story-lint-enforces), second table):
- a puzzle belongs to at most one lock (`world/puzzle-multi-lock`), and a lock's puzzle is never also yielded by a
  `puzzle` tag (`puzzle/in-section`);
- a lock's puzzle has no Give up (`world/giveup-in-section`);
- a lock's puzzle with `maxAttempts` needs a non-empty `onFail` (`world/fail-without-effect`);
- an `order` puzzle's `pieces` are exactly the lock's slot items (`world/order-pieces`);
- an item obtained in one section is never required by a lock or puzzle of another (`world/cross-section-item`).

### Effects and the once rule

An effect is an object with exactly one key ([decode.ts:230-247](../client/src/world/decode.ts#L230); the
`world/cross-section-effect` and `world/unknown-ref` rows of STAGING-DSL §11, second table):
- `{ "give": "<item>" }`;
- `{ "unlock": "<room>.<hotspot>" }`: opens that hotspot's lock by force; only a hotspot of the same section
  (`world/cross-section-effect`);
- `{ "story": "<knot>" }`: runs that knot, an **event knot** ([Event knots](#event-knots)).

Effects live in triggers: a room's `onEnter`, the `then` of a `look`, `take` or `object` hotspot, and a lock's
`onOpen` and `onFail`. **Every trigger fires at most once** (PUZZLES-PLAN "Effects"). Re-entering the study does not
run `study_voice` again; tapping an opened desk does not give a second key. An item or document is given in one
section only (`world/cross-section-effect`).

### The safe frame and target sizes

A room is drawn from a 1080×2048 source image ([cover.ts:14](../client/src/geom/cover.ts#L14)), so hotspot rects are
`[x, y, w, h]` in those source pixels, integers with x, y ≥ 0 and w, h > 0
([decode.ts:278-289](../client/src/world/decode.ts#L278)). The lint checks each rect
([world.ts:547-569](../client/scripts/story/world.ts#L547); the same rows of
[STAGING-DSL §11](STAGING-DSL.md#11-what-the-story-lint-enforces), second table):

| Code | Sev | Rule |
|---|---|---|
| `world/hotspot-frame` | E | the whole rect lies inside the safe frame x 80–1000, y 160–1760 ([cover.ts:17](../client/src/geom/cover.ts#L17)), the part visible on every phone shape |
| `world/hotspot-small` | W | each side is at least 150 source px, about a 44 CSS px tap target |
| `world/hotspot-overlap` | W | rects of one room do not overlap |
| `world/props-per-room` | E | at most 8 props in a room |

Moving the clock's rect from `[700, 250, 250, 250]` to `[700, 100, 250, 250]` prints:

```text
E story/ch1/world.json:40 world/hotspot-frame hall.clock [700, 100, 250, 250] leaves the safe frame x 80–1000, y 160–1760
```

### Puzzles and hint ladders

A puzzle is `{ type, title, prompt, closeup, params, maxAttempts, giveUp, solution, hints }`. There are two types
([code.ts](../client/src/puzzles/rules/code.ts), [order.ts](../client/src/puzzles/rules/order.ts)):

| Type | `params` | Answer and `solution` | Start state |
|---|---|---|---|
| `code` | `{ "dials": 2..6 }` | one digit 0–9 per dial | all zeros |
| `order` | `{ "pieces": [2..5 distinct item ids] }` | the piece index per slot, a permutation | the listed order |

- `maxAttempts` is `null` or 1–9; at the limit the outcome is `failed` ([decode.ts:489-502](../client/src/world/decode.ts#L489)).
- `giveUp: true` offers Give up (outcome `abandoned`); only for a puzzle no lock carries.
- `solution` must fit the type and differ from the start state (`world/solution`, `world/solution-initial`).
  These rules and the hint, title and id rules below are rows of
  [STAGING-DSL §11](STAGING-DSL.md#11-what-the-story-lint-enforces), second table.
- `closeup` is a `cg` of the catalog or `null`.

`solution` and `hints` never reach the player's device: the build writes them only to
`server/content/puzzles/<ch>.json`, and the public world carries the hint count (PUZZLES-PLAN X7). Hint texts are
still written into the en table like any world text.

**Writing a hint ladder.** A puzzle has 0–3 hint tiers; a fourth is `world/hint-count`
([decode.ts:544-549](../client/src/world/decode.ts#L544)). Each tier is a text with an ID. A hint without an `id` is
`id/missing`, like any world text ([world.ts:196-197](../client/scripts/story/world.ts#L196)), although the
STAGING-DSL §11 `world/hint-count` row names that case too. Write them as a ladder: a nudge (where to look), a direction (what to use), the solution. The example's `box`:

```json
"box": { "type": "code", "title": { "id": "ch1.box.t1tl", "ru": "The box" },
         "prompt": { "id": "ch1.box.p1rm", "ru": "Three dials, each from 0 to 9." },
         "closeup": null, "params": { "dials": 3 }, "maxAttempts": null, "giveUp": true,
         "solution": [4, 1, 7],
         "hints": [ { "id": "ch1.box.h1aa", "ru": "The numbers are written somewhere in the hall." },
                    { "id": "ch1.box.h2bb", "ru": "Look at the clock above the stairs." },
                    { "id": "ch1.box.h3cc", "ru": "The code is 4-1-7." } ] }
```

A puzzle title has at most 18 graphemes in `ru` ([world.ts:46](../client/scripts/story/world.ts#L46)). Retitling
`desk` to `The drawer of the old oak desk` (and its en entry's `ru` with it) prints:

```text
E story/ch1/world.json:19 world/title-long puzzle 'desk': the title is 30 graphemes, at most 18 (the hint invoice title)
```

A puzzle id may not end in `_hints` (`world/id-reserved`): `pz_<id>_hints` is a projection name.

### The yield block

Ink hands control to the host with a **yield block**: a `puzzle` or `explore` tag alone on a tag-only line, and
`-> DONE` on the very next source line ([STAGING-DSL §6 `puzzle`](STAGING-DSL.md#puzzle),
[`explore`](STAGING-DSL.md#explore)). Staging tag lines above it join the yield step.

A linear puzzle, then the `then=` knot it returns to:

```ink
=== hall ===
# scene: hall
# show: ally neutral at=left
# bgm: calm
ally: Someone left a box on the stairs. #id:ch1.hall.b0x1
# puzzle: box then=hall_after
-> DONE
```

Exploration, until the player leaves through an exit `{ "story": … }`:

```ink
=== search ===
ally: The study door is open. #id:ch1.search.d00r
# explore: house
-> DONE
```

- `puzzle:` names a puzzle of the chapter's world no lock carries (`puzzle/unknown`, `puzzle/in-section`); `then=`
  names a knot of the chapter (`puzzle/then-unknown`).
- `explore:` names a section of the world (`explore/unknown-section`).
- A yield tag in a chapter without a world is `puzzle/unknown` / `explore/unknown-section`.

A blank line between the tag and `-> DONE` breaks the block twice:

```text
E story/ch1/main.ink:11 yield/shape 'puzzle: box then=hall_after': the next line must be '-> DONE' (§6)
E story/ch1/main.ink:13 ink/forbidden '-> DONE' only directly after a puzzle or explore line; chapters end at '-> END' (§10)
```

### Event knots

A `{ "story": "<knot>" }` effect names an **event knot** of the section. The game runs it, then returns to the rooms.
An event knot ([graph.ts:652-673](../client/scripts/story/graph.ts#L652);
[STAGING-DSL §6 `explore`](STAGING-DSL.md#explore) "Effect", and the `explore/*` rows of STAGING-DSL §11, second
table):
- ends in its own section's yield, `# explore: <section>` then `-> DONE` (`explore/event-return`);
- never writes `-> END`, and diverts only to other event knots of the same section (`explore/event-escape`).

`study_voice` (under [Speakers](#speakers-and-storycastjson)) is the study's `onEnter` event. Ending it with `-> END`
instead of its yield prints both codes:

```text
E story/ch1/main.ink:31 explore/event-escape event knot 'study_voice' of section house writes '-> END': it returns with '# explore: house' (§6)
E story/ch1/main.ink:31 explore/event-return event knot 'study_voice' of section house never yields '# explore: house' back to the rooms (§6)
```

A knot named by an exit `{ "story": … }` is a **leave** knot, not an event knot: it continues the chapter and may end
it with `-> END`, as `house_out` does in the example.

### Projection variables

Ink never reads the world directly. When the game re-enters ink (at a `then=` knot, an event knot, a leave knot), it
writes these values first, each only if the chapter declares a `VAR` of that name
([project.ts:15](../client/src/explore/project.ts#L15), PUZZLES-PLAN X2). The `pz_*` pair is in
[STAGING-DSL §6 `puzzle`](STAGING-DSL.md#puzzle) "Effect"; the type rule is `world/var-type`, STAGING-DSL §11, second
table:

| VAR | Type | Value |
|---|---|---|
| `pz_<puzzle>` | int | 0 none, 1 solved, 2 failed, 3 abandoned |
| `pz_<puzzle>_hints` | int | hint tiers opened in this run |
| `it_<item>` | bool | the item was ever obtained |
| `dc_<doc>` | bool | the document was found |

Declare them in the chapter's entry file with the right type, and read them like any variable:

```ink
INCLUDE ../common/globals.ink
VAR pz_box = 0
VAR dc_note = false
-> hall
```

```ink
=== hall_after ===
{ pz_box == 1:
    ally: It opened. There is a map inside. #id:ch1.hall.m4p1
- else:
    ally: Leave it. Let us look around instead. #id:ch1.hall.l3v1
}
```

A wrong type fails: `VAR dc_note = 0` prints
`world/var-type VAR dc_note is declared int: the projection writes a bool (X2)`. The seeded playthroughs write the
same projection ([playthrough.ts:414-422](../client/scripts/story/playthrough.ts#L414)), which is how
`pz_box 1,3` reaches the `play:` line. In the game the yield router (`app/yields.ts`, planned: L15 integration)
writes them through `StoryRunner.enter` (planned: L13 story-runtime).

### World lint codes and soft-lock counterexamples

The full list of `world/*`, `puzzle/*` and `explore/*` codes is the second table of
[STAGING-DSL §11](STAGING-DSL.md#11-what-the-story-lint-enforces). The one that needs reading skill is
`world/softlock`.

For each section the gate explores every state a player can reach and proves that each one can still reach a leave
([softlock.ts:58-110](../client/scripts/story/softlock.ts#L58)). The `world:` line reports
`softlock OK (<n> states)`, or `softlock FAIL (<k> of <n> sections)`. A failure prints the shortest action path to
the first stuck state.

Give the example's `desk` three attempts and an `onFail` that does not open it (`"maxAttempts": 3`,
`"onFail": [ { "story": "study_voice" } ]`):

```text
E story/ch1/world.json:25 world/softlock section house: a reachable state cannot reach a leave (stuck in study): tap hall.to_study → return from study_voice → tap study.desk → desk failed
```

Read it left to right: the player taps the hall's exit to the study, sits through the event `study_voice`, opens the
desk's puzzle and fails it. The drawer never opens, the key never appears, and the front door stays locked. Fix the
path, not the symptom: here `"onFail": [ { "unlock": "study.desk" } ]` forces the drawer open on failure, and the
gate reports `softlock OK (26 states)`. The steps are `tap <room>.<hotspot>`, `insert <room>.<hotspot> <item>`,
`return from <knot>` and `<step> → <puzzle> closed|solved|failed|abandoned`.

A section with more than 5,000 states is `world/state-cap`: split it into smaller sections
([reduce.ts:28](../client/src/explore/reduce.ts#L28)). An item, document, room or puzzle no reachable state touches is
`world/unreachable` (W). Both are rows of [STAGING-DSL §11](STAGING-DSL.md#11-what-the-story-lint-enforces), second table, like
`world/softlock`.

## Part 3: stories

### `story/stories.json`

A story is a chain of chapters. `story/stories.json` lists the stories; the array order is the order of the cards on
Home ([STAGING-DSL §9](STAGING-DSL.md#9-chapters-and-stories) "Stories"):

```json
[
  {
    "id": "manor",
    "first": "ch1",
    "cover": "cover/manor",
    "endings": {
      "truth": { "chapter": "ch2", "knot": "archive_truth" },
      "silence": { "chapter": "ch2", "knot": "archive_silence" }
    }
  }
]
```

The rules, all `catalog/stories` ([stories.ts:87](../client/scripts/story/stories.ts#L87)):
- each entry has exactly `id`, `first`, `cover`, `endings`; `id` matches `^[a-z][a-z0-9_]{0,23}$` and is unique;
- **a story is the `next` chain from `first`**: every chapter of `chapters.json` lies on exactly one story's chain;
- **the first chapter is free**, and no chapter's `next` names it;
- `cover` is a `cover/<name>` the asset catalog lists. A new cover is an asset request, like any asset.

**Chapter ids are game-unique.** A second story does not restart at `ch1`: it starts at the next free `ch<N>`. The
`stories:` line then reads `stories: tide (ch3), endings 0`. To add story `tide` after `manor`:

```json
{ "id": "ch3", "entry": "ch3/main.ink", "paid": false, "next": null }
```

appended to `story/chapters.json`, and appended to `story/stories.json`:

```json
{ "id": "tide", "first": "ch3", "cover": "cover/tide", "endings": {} }
```

plus `story/ch3/main.ink`, `story/locales/en/ch3.json`, and the `ch3` title and the `tide` title and teaser in both
`story.json` tables.

### Declaring an ending

An ending is a knot that ends the story. Declare it in `stories.json` under the story's `endings`:
`"<name>": { "chapter": "<ch>", "knot": "<knot>" }`, the name matching `^[a-z][a-z0-9_]{0,31}$`. The gate checks it
against the knot graph ([stories.ts:219](../client/scripts/story/stories.ts#L219)):
- the chapter lies on the story's chain (a mid-story bad ending is allowed);
- the knot writes `-> END`, has no successor knot and carries no `puzzle` / `explore` tag; one ending per knot;
- a chapter with a `next` keeps at least one `-> END` knot that is no ending, or no player could reach the next
  chapter.

`archive_truth` and `archive_silence` above qualify. Declaring `"silence": { "chapter": "ch2", "knot": "archive" }`
instead prints:

```text
E story/stories.json:0 catalog/stories 0.endings.silence.knot: ch2 knot 'archive' writes no -> END: an ending knot ends the chapter
E story/stories.json:0 catalog/stories 0.endings.silence.knot: ch2 knot 'archive' leads on to archive_silence, archive_truth: an ending knot has no successor
```

Every declared ending needs a title in `story/meta.json` ([Part 4](#part-4-story-meta)).

### "The End" and "To be continued"

- **A declared ending.** After its `-> END` the player sees "The End", not the next chapter, and the run carries
  nothing into a next chapter. The seeded playthroughs drop such a run's carries too
  ([story.ts:520-523](../client/scripts/story.ts#L520)).
- **An `-> END` that is no ending, in a chapter with a `next`.** The next chapter follows, or the paywall when it is
  paid and not owned.
- **An `-> END` that is no ending, in a chapter with `next: null`.** "To be continued".

The screens are planned (L14b overlay-menus, STORIES-PLAN Y14); the gate's rules above are in force now.

### Shared cast and globals

`story/cast.json` and `story/common/globals.ink` serve every story. A carry flows only along a story's chain: the
first chapter of a story starts from the declared defaults
([STAGING-DSL §9](STAGING-DSL.md#9-chapters-and-stories)). Name a new global after its story,
`g_<story>_<name>` (for example `g_tide_trust`); this is a convention, not a lint rule. A `g_` value one chapter
writes and no listed chapter reads is the warning `vars/write-only`.

### Titles, teasers and invoice titles

A story's title and teaser are its entries in the `stories` and `teasers` sections of both `story.json` tables; a
teaser is one sentence for the story's card. A chapter's title is its `chapters` entry. All are required in ru and en
(`loc/missing-name`).

**A paid chapter's title is its invoice title**: 1–32 code points in `ru` and in `en`
([stories.ts:30](../client/scripts/story/stories.ts#L30)). Renaming `ch2` to `Chapter 2: What the archive keeps`
prints:

```text
E story/locales/en/story.json:0 catalog/stories chapters.ch2: paid chapter ch2's title is 33 characters; it is the invoice title, 1-32 code points
```

### Rules that protect players' saves

- **Never move a shipped chapter to another story.** Saves are keyed by story.
- Never rename a shipped knot, and never reuse a line ID ([Removing a line](#removing-a-line-retired-ids)).
- Never reuse a shipped chapter id for different content: saves record the chapter id
  ([0001_init.sql:68](../server/migrations/0001_init.sql#L68)), and a paid chapter's product is `chapter:<id>`
  ([catalog.rs:26](../server/src/catalog.rs#L26)), so its buyers' entitlements follow the id. This is advice, not a
  lint rule.

## Part 4: story meta

### `story/meta.json`

`story/meta.json` holds, per story, the titles of its declared endings and its achievements, with their texts inline
in ru and en ([STAGING-DSL §9 "Story meta"](STAGING-DSL.md#story-meta)). No ink tag carries meta. The example's:

```json
{
  "manor": {
    "endings": {
      "truth": { "ru": "The truth is spoken", "en": "The truth is spoken" },
      "silence": { "ru": "A secret kept", "en": "A secret kept" }
    },
    "achievements": {
      "box_no_hints": {
        "hidden": false,
        "when": { "puzzle": "ch1.box", "hints": 0 },
        "name": { "ru": "Clockwatcher", "en": "Clockwatcher" },
        "desc": { "ru": "Open the box on the stairs without a hint.", "en": "Open the box on the stairs without a hint." }
      },
      "honest": {
        "hidden": false,
        "when": { "choice": "ch2.archive.t3ll" },
        "name": { "ru": "Honest answer", "en": "Honest answer" },
        "desc": { "ru": "Tell her the truth in the archive.", "en": "Tell her the truth in the archive." }
      },
      "both_ways": {
        "hidden": true,
        "when": { "allEndings": true },
        "name": { "ru": "Both ways", "en": "Both ways" },
        "desc": { "ru": "Reach every ending of the story.", "en": "Reach every ending of the story." }
      }
    }
  }
}
```

The rules, all `catalog/meta` ([meta.ts:373](../client/scripts/story/meta.ts#L373)):
- the keys are story ids of `stories.json`; each value has exactly `endings` and `achievements`. A story that
  declares no ending may be absent; a missing file counts as `{}`.
- **Every declared ending needs a title**: `endings` has exactly the story's declared ending names. Dropping the
  `silence` title prints `catalog/meta manor.endings.silence: missing`.
- An achievement has exactly `hidden` (a boolean, reserved for a later list of every achievement), `when`, `name` and
  `desc`. The object order of `achievements` is the display order.

**Meta texts are server-only.** Never put an ending title or an achievement text into ink or a locale table. The gate
writes them only to `server/content/meta.json`. The build's leak scan looks for every meta text of 12 or more code
points in the built app (`client/dist/`) and fails on a hit; it treats no meta text as public
([scan-dist.ts:298-319](../client/scripts/scan-dist.ts#L298)). The story gate does not compare meta texts with ink or
locale text.

### Conditions

`when` is one condition: an object with exactly one key. `hints` appears only beside `puzzle`, and only as `0`
([meta.ts:121-258](../client/scripts/story/meta.ts#L121)):

| Condition | Met when |
|---|---|
| `{ "ending": "<name>" }` | that ending of this story was reached |
| `{ "endings": n }` | n distinct endings of this story were reached (1 ≤ n ≤ its ending count) |
| `{ "allEndings": true }` | every ending the story declares was reached |
| `{ "choice": "<line ID>" }` | that option was picked: the ID of a choice with text in a chapter of the story's chain |
| `{ "chapter": "<ch>" }` | that chapter of the chain was completed |
| `{ "puzzle": "<ch>.<puzzle>" }`, optionally `"hints": 0` | that puzzle of a chapter of the chain was solved; with `hints: 0`, without a hint tier |
| `{ "all": [ … ] }` | 2–4 conditions of the kinds above (no nested `all`) all hold |

What the gate does not judge: a reference into a chapter that did not compile or a world that did not decode. That
chapter's own error already fails the run. A `choice` that names a narration line instead of a choice fails:
`'ch2.archive.p4pr' is not a choice with text of ch2`.

### Text limits and the build's `meta-empty` rule

Every text is `{ "ru": …, "en": … }`, both present and non-blank ([meta.ts:21](../client/scripts/story/meta.ts#L21)):

| Text | Code points |
|---|---|
| ending title | 1–40 |
| achievement `name` | 1–40 |
| achievement `desc` | 1–140 |

An `en` name of 41 code points prints `catalog/meta manor.achievements.honest.name.en: 41 code points (1-40)`.

**At least one meta text needs 12 or more code points while a story declares an ending.** The build's leak scan
fingerprints every meta text of 12+ code points and fails closed when it finds none. The story gate cannot see this
rule. With the tree's one-ending story `manor`, this `story/meta.json` passes `npm --prefix client run story`:

```json
{
  "manor": {
    "endings": { "end": { "ru": "Правда", "en": "The truth" } },
    "achievements": {}
  }
}
```

and then `npm --prefix client run build` exits 1 with:

```text
scan: fingerprints meta-empty manor declare endings and story/meta.json has no text of 12+ code points
```

([scan-dist.ts:313-317](../client/scripts/scan-dist.ts#L313)). Give at least one ending title or description 12 code
points or more; the example's `Open the box on the stairs without a hint.` is one.

### Achievement ids

- Ids match `^[a-z][a-z0-9_]{0,31}$`, at most 50 per story ([meta.ts:19-21](../client/scripts/story/meta.ts#L19)).
- **An id is never reused for a different achievement**: a player's unlock is stored under its id. To retire an
  achievement, delete its entry and never give its id to a new one. No file lists retired achievement ids, so the
  gate cannot catch a reuse.
- **Uniqueness is structural, not checked.** JSON keeps only the last of two equal keys. Two `"honest"` entries in
  one story pass the gate, and the `meta:` line counts one: `achievements 2` where you wrote three. Check that count.

### Choices are statistics

A choice's line ID is also its statistics identity: the game will record which option a player picked by that ID
(planned: LS3 server-stats, LS4 stats-client; [STAGING-DSL §9 "Story meta"](STAGING-DSL.md#story-meta), META-PLAN
M1). So:
- **keep the ID when you edit the option's text**;
- **retire the ID when you remove the option** ([Removing a line](#removing-a-line-retired-ids)), never reuse it.

This matters for `choice` achievements in particular. `--fix-ids` does not treat an ID named only in
`story/meta.json` as taken ([story.ts:248-260](../client/scripts/story.ts#L248)). If you delete an option and do
not retire its ID, a later `--fix-ids` may hand the same ID to a new line, and the achievement then silently points
at it. Retiring the ID prevents that.

A **choice point** is the options of one weave level of one knot or stitch, up to a gather of that depth or less, a
knot header or a stitch header. Deeper options form their own points, and fallback choices are no options
([meta.ts:324-333](../client/scripts/story/meta.ts#L324)). The `meta:` line counts them per chapter as
`<options>/<points>`: `choices ch1 2/1, ch2 2/1` means each chapter has two options in one point; a chapter that did
not compile shows `-` ([story.ts:366-369](../client/scripts/story.ts#L366)).

## Complete example

These files, on top of the tree's `story/cast.json`, `story/common/globals.ink`, `story/lint-allow.json`, both
`story/locales/*/story.json` tables, an empty `story/retired-ids.txt` and `assets/catalog.json` (all as at
`4d8a9ec`), pass the story gate with the output under [Reading the story gate's output](#reading-the-story-gates-output).

`story/chapters.json` and `story/stories.json`: as under [Chapters](#chapters-and-storychaptersjson) and
[`story/stories.json`](#storystoriesjson). `story/ch2/main.ink`: as under
[The entry file](#the-entry-file-and-the-ink-subset). `story/meta.json`: as under [Part 4](#storymetajson).

### `story/ch1/main.ink`

```ink
INCLUDE ../common/globals.ink
VAR pz_box = 0
VAR dc_note = false
-> hall

=== hall ===
# scene: hall
# show: ally neutral at=left
# bgm: calm
ally: Someone left a box on the stairs. #id:ch1.hall.b0x1
# puzzle: box then=hall_after
-> DONE

=== hall_after ===
{ pz_box == 1:
    ally: It opened. There is a map inside. #id:ch1.hall.m4p1
- else:
    ally: Leave it. Let us look around instead. #id:ch1.hall.l3v1
}
* [Search the house together #id:ch1.hall.s3ch]
    ~ g_trust_ally = 1
    -> search
* [Search it alone #id:ch1.hall.a1on]
    -> search

=== search ===
ally: The study door is open. #id:ch1.search.d00r
# explore: house
-> DONE

=== study_voice ===
voice: Is anyone there? #id:ch1.study.v01c
# explore: house
-> DONE

=== house_out ===
# scene: street
{ dc_note:
    I keep the note in my pocket. #id:ch1.out.n0te
- else:
    I close the door behind me. #id:ch1.out.d0or
}
-> END
```

### `story/ch1/world.json`

```json
{
  "format": 1,
  "items": {
    "key": { "name": { "id": "ch1.key.n4me", "ru": "Brass key" },
             "desc": { "id": "ch1.key.d3sc", "ru": "A small key with a worn ring." }, "glyph": "key" }
  },
  "docs": {
    "note": { "title": { "id": "ch1.note.t1tl", "ru": "A folded note" },
              "body": [ { "id": "ch1.note.b0dy", "ru": "The desk opens with the year the house was built." } ] }
  },
  "puzzles": {
    "box": { "type": "code", "title": { "id": "ch1.box.t1tl", "ru": "The box" },
             "prompt": { "id": "ch1.box.p1rm", "ru": "Three dials, each from 0 to 9." },
             "closeup": null, "params": { "dials": 3 }, "maxAttempts": null, "giveUp": true,
             "solution": [4, 1, 7],
             "hints": [ { "id": "ch1.box.h1aa", "ru": "The numbers are written somewhere in the hall." },
                        { "id": "ch1.box.h2bb", "ru": "Look at the clock above the stairs." },
                        { "id": "ch1.box.h3cc", "ru": "The code is 4-1-7." } ] },
    "desk": { "type": "code", "title": { "id": "ch1.desk.t1tl", "ru": "The desk drawer" },
              "prompt": { "id": "ch1.desk.p1rm", "ru": "Four brass dials." },
              "closeup": "drawer", "params": { "dials": 4 }, "maxAttempts": null, "giveUp": false,
              "solution": [1, 8, 4, 7], "hints": [] }
  },
  "sections": {
    "house": {
      "start": "hall", "bgm": "tension",
      "rooms": {
        "hall": {
          "bg": "hall", "title": { "id": "ch1.house.h4ll", "ru": "Hall" }, "onEnter": [],
          "hotspots": [
            { "id": "to_study", "kind": "exit", "rect": [100, 1200, 250, 400],
              "label": { "id": "ch1.house.l1st", "ru": "To the study" },
              "to": { "room": "study" }, "lock": null, "sfx": "door" },
            { "id": "front_door", "kind": "exit", "rect": [420, 700, 300, 600],
              "label": { "id": "ch1.house.l2fd", "ru": "Front door" },
              "to": { "story": "house_out" }, "sfx": "door",
              "lock": { "slots": [ { "accepts": "key" } ], "puzzle": null,
                        "locked": { "id": "ch1.house.k1lk", "ru": "Locked. The keyhole is small and brass." },
                        "onFail": [] } },
            { "id": "clock", "kind": "look", "rect": [700, 250, 250, 250],
              "label": { "id": "ch1.house.l6ck", "ru": "Clock" },
              "look": { "id": "ch1.house.c10k", "ru": "The clock stopped at 4:17." }, "then": [] }
          ]
        },
        "study": {
          "bg": "study", "title": { "id": "ch1.house.s7dy", "ru": "Study" },
          "onEnter": [ { "story": "study_voice" } ],
          "hotspots": [
            { "id": "to_hall", "kind": "exit", "rect": [100, 1200, 250, 400],
              "label": { "id": "ch1.house.l3th", "ru": "Back to the hall" },
              "to": { "room": "hall" }, "lock": null, "sfx": null },
            { "id": "desk", "kind": "object", "rect": [450, 1100, 400, 300],
              "label": { "id": "ch1.house.l4dk", "ru": "Desk" }, "look": null, "prop": null,
              "lock": { "slots": [], "puzzle": "desk",
                        "locked": { "id": "ch1.house.k2lk", "ru": "The drawer has a dial lock." }, "onFail": [] },
              "then": [ { "give": "key" } ] },
            { "id": "note", "kind": "take", "rect": [500, 500, 200, 200],
              "label": { "id": "ch1.house.l5nt", "ru": "A note" },
              "gives": { "doc": "note" }, "prop": "note" }
          ]
        }
      }
    }
  }
}
```

### `story/locales/en/ch1.json`

```json
{
  "ch1.hall.b0x1": { "ru": "Someone left a box on the stairs.", "en": "Someone left a box on the stairs." },
  "ch1.hall.m4p1": { "ru": "It opened. There is a map inside.", "en": "It opened. There is a map inside." },
  "ch1.hall.l3v1": { "ru": "Leave it. Let us look around instead.", "en": "Leave it. Let us look around instead." },
  "ch1.hall.s3ch": { "ru": "Search the house together", "en": "Search the house together" },
  "ch1.hall.a1on": { "ru": "Search it alone", "en": "Search it alone" },
  "ch1.search.d00r": { "ru": "The study door is open.", "en": "The study door is open." },
  "ch1.study.v01c": { "ru": "Is anyone there?", "en": "Is anyone there?" },
  "ch1.out.n0te": { "ru": "I keep the note in my pocket.", "en": "I keep the note in my pocket." },
  "ch1.out.d0or": { "ru": "I close the door behind me.", "en": "I close the door behind me." },
  "ch1.key.n4me": { "ru": "Brass key", "en": "Brass key" },
  "ch1.key.d3sc": { "ru": "A small key with a worn ring.", "en": "A small key with a worn ring." },
  "ch1.note.t1tl": { "ru": "A folded note", "en": "A folded note" },
  "ch1.note.b0dy": { "ru": "The desk opens with the year the house was built.", "en": "The desk opens with the year the house was built." },
  "ch1.box.t1tl": { "ru": "The box", "en": "The box" },
  "ch1.box.p1rm": { "ru": "Three dials, each from 0 to 9.", "en": "Three dials, each from 0 to 9." },
  "ch1.box.h1aa": { "ru": "The numbers are written somewhere in the hall.", "en": "The numbers are written somewhere in the hall." },
  "ch1.box.h2bb": { "ru": "Look at the clock above the stairs.", "en": "Look at the clock above the stairs." },
  "ch1.box.h3cc": { "ru": "The code is 4-1-7.", "en": "The code is 4-1-7." },
  "ch1.desk.t1tl": { "ru": "The desk drawer", "en": "The desk drawer" },
  "ch1.desk.p1rm": { "ru": "Four brass dials.", "en": "Four brass dials." },
  "ch1.house.h4ll": { "ru": "Hall", "en": "Hall" },
  "ch1.house.l1st": { "ru": "To the study", "en": "To the study" },
  "ch1.house.l2fd": { "ru": "Front door", "en": "Front door" },
  "ch1.house.k1lk": { "ru": "Locked. The keyhole is small and brass.", "en": "Locked. The keyhole is small and brass." },
  "ch1.house.l6ck": { "ru": "Clock", "en": "Clock" },
  "ch1.house.c10k": { "ru": "The clock stopped at 4:17.", "en": "The clock stopped at 4:17." },
  "ch1.house.s7dy": { "ru": "Study", "en": "Study" },
  "ch1.house.l3th": { "ru": "Back to the hall", "en": "Back to the hall" },
  "ch1.house.l4dk": { "ru": "Desk", "en": "Desk" },
  "ch1.house.k2lk": { "ru": "The drawer has a dial lock.", "en": "The drawer has a dial lock." },
  "ch1.house.l5nt": { "ru": "A note", "en": "A note" }
}
```

### `story/locales/en/ch2.json`

```json
{
  "ch2.archive.p4pr": { "ru": "The archive smells of old paper.", "en": "The archive smells of old paper." },
  "ch2.archive.c0nt": { "ru": "I knew I could count on you.", "en": "I knew I could count on you." },
  "ch2.archive.w0rd": { "ru": "Let us see what your word is worth.", "en": "Let us see what your word is worth." },
  "ch2.archive.t3ll": { "ru": "Tell her the truth", "en": "Tell her the truth" },
  "ch2.archive.q01t": { "ru": "Keep quiet", "en": "Keep quiet" },
  "ch2.truth.th4k": { "ru": "Thank you for telling me.", "en": "Thank you for telling me." },
  "ch2.silence.d0ne": { "ru": "Then we are done here.", "en": "Then we are done here." }
}
```

## Common mistakes

| Mistake | What the gate prints | Fix |
|---|---|---|
| A free chapter includes a file of a paid chapter (`INCLUDE ../ch2/notes.ink` in `ch1/main.ink`) | `ink/include` twice: the file is outside `ch1/` and `common/`, and "free chapter ch1 includes a file of paid chapter ch2; it would compile into the public JSON (principle 0)" | keep each chapter's text in its own directory; shared declarations go to `common/globals.ink` |
| A new line without an ID | `id/missing` | `--fix-ids`, then `--sync-locales`, then fill `en` |
| An ID after `]` on a choice | `id/missing`, `tag/after-choice-bracket`, `loc/orphan-en` | move the ID inside the brackets, then run the tools |
| Inline logic, `{g_trust_ally}` in a line | `text/inline-logic` (and `loc/stale-en`, since the text changed) | write whole alternative lines in a conditional block |
| A deleted line, its en entry left | `loc/orphan-en … retire it` | append the ID to `retired-ids.txt`, delete the entry |
| A meta text copied into ink or a locale table | nothing at `story` time; the build's leak scan fails once such a text of 12+ code points is in the built app | meta texts live only in `story/meta.json` |
| Only short meta texts | nothing at `story` time; `npm run build` fails with `meta-empty` | at least one meta text of 12+ code points |
| A blank line inside a yield block | `yield/shape` and `ink/forbidden` | `-> DONE` on the line right after the tag |
| A world key misspelt, a fourth hint, or a world text without a valid ID | `world/schema`, `world/hint-count`, `id/missing` or `id/format`, then graph errors and `loc/orphan-en … retire it` that follow from it | fix the world's error first; retire nothing. A text that had an ID gets that ID back by hand ([Fix the world's own error first](#the-world-file)) |

## Next steps

- [STAGING-DSL.md](STAGING-DSL.md) - every tag, the batch order, the asset and preload rules, the full lint table.
- [FEATURE_MAP.md](FEATURE_MAP.md) - where each part of the story tool and the game lives.
- [ARCHITECTURE.md](ARCHITECTURE.md) - why paid chapters, hints and meta texts never reach a free build.
- Before a release, run `npm --prefix client run story -- --strict` and `npm --prefix client run build`.
