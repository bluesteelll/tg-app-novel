//! The meta index and its rules (META-PLAN M2, M4-M7): `meta.json` checked against the story and puzzle indexes at
//! startup — per story the ending titles and the achievements, per chapter the choice vocabulary — and the
//! achievement conditions over facts the server has, with the gate that keeps a paid item from a viewer who does not
//! own its chapter.
//!
//! Principle 0 (M7): every text here is server-only. The gate of an item is the set of paid chapters its condition
//! names, computed once from the story index; an item reaches a viewer only if every gated chapter is owned now. No
//! type here derives `Debug`, and a startup refusal names ids, never a text.
//!
//! Achievements are display only (M6, principle 1): evaluating one grants nothing.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::Deserialize;

use crate::content::{Localized, PuzzleDef, StoryDef, is_ending_name, is_line_id};
use crate::ids::{ChapterId, ProductId, PuzzleId, StoryId};

/// The meta index: the choice vocabulary of every chapter of the story index, and per story its ending titles and
/// achievements. Immutable for the process lifetime.
pub struct MetaIndex {
    choices: HashMap<ChapterId, HashMap<String, String>>,
    stories: HashMap<StoryId, StoryMeta>,
}

/// One story's meta.
pub struct StoryMeta {
    /// Every ending the story index declares, by name: its title and gate.
    pub endings: BTreeMap<String, EndingMeta>,
    /// The achievements in display order (M4).
    pub achievements: Vec<AchievementDef>,
    /// The puzzles the achievements' conditions name, once each, in display order: what a card reads facts of.
    pub puzzles: Vec<PuzzleId>,
}

/// An ending's title and gate: an ending title is gated on its chapter (M7).
pub struct EndingMeta {
    /// The title.
    pub title: Localized,
    /// The ending's chapter when it is paid; empty for a free one.
    pub gate: HashSet<ChapterId>,
}

/// An achievement of a story.
pub struct AchievementDef {
    /// `^[a-z][a-z0-9_]{0,31}$`, unique in the story.
    pub id: String,
    /// Reserved for a later "all achievements" list (M4); the card shows unlocked items only.
    pub hidden: bool,
    /// What unlocks it.
    pub when: Condition,
    /// The paid chapters `when` names ([`gate`]).
    pub gate: HashSet<ChapterId>,
    /// The name.
    pub name: Localized,
    /// The description.
    pub desc: Localized,
}

impl MetaIndex {
    /// The index `file` describes, checked against the story index `stories` and the puzzle index `puzzles`; the
    /// reason of a refusal names ids and counts only.
    pub(crate) fn build(
        file: MetaFile,
        stories: &[StoryDef],
        puzzles: &[PuzzleDef],
    ) -> Result<MetaIndex, String> {
        if file.format != 1 {
            return Err(format!("format {}, expected 1", file.format));
        }
        let choices = vocabulary(file.choices, stories)?;
        let mut entries = file.stories;
        for key in entries.keys() {
            if !stories.iter().any(|s| &s.id.0 == key) {
                return Err(match StoryId::parse(key) {
                    Some(id) => format!("stories: {} is not a story of the index", id.0),
                    None => "stories: a key is not a story id".to_owned(),
                });
            }
        }
        let mut metas = HashMap::with_capacity(stories.len());
        for story in stories {
            let Some(entry) = entries.remove(&story.id.0) else {
                return Err(format!("stories: no entry for story {}", story.id.0));
            };
            let ctx = Ctx {
                story,
                choices: &choices,
                puzzles,
            };
            let meta =
                story_meta(entry, &ctx).map_err(|reason| format!("{}: {reason}", story.id.0))?;
            metas.insert(story.id.clone(), meta);
        }
        Ok(MetaIndex {
            choices,
            stories: metas,
        })
    }

    /// The meta of story `id`.
    pub fn story(&self, id: &StoryId) -> Option<&StoryMeta> {
        self.stories.get(id)
    }

    /// The vocabulary of chapter `ch` (M2): each option's line ID with its point's id.
    pub fn choices(&self, ch: &ChapterId) -> Option<&HashMap<String, String>> {
        self.choices.get(ch)
    }

    /// Whether `option` is an option of chapter `ch` in this build.
    pub fn is_option(&self, ch: &ChapterId, option: &str) -> bool {
        self.choices
            .get(ch)
            .is_some_and(|options| options.contains_key(option))
    }
}

/// `meta.json` as the story tool writes it (META-PLAN "Server formats"); the fixture is the contract.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MetaFile {
    format: u32,
    choices: BTreeMap<String, BTreeMap<String, String>>,
    stories: BTreeMap<String, StoryFile>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoryFile {
    endings: BTreeMap<String, Localized>,
    achievements: Vec<AchievementFile>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AchievementFile {
    id: String,
    hidden: bool,
    when: ConditionFile,
    name: Localized,
    desc: Localized,
}

/// A condition as written: every kind optional and every number signed, so a wrong count of kinds or a number out of
/// range is a rule with a reason, not a parse fault.
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ConditionFile {
    ending: Option<String>,
    endings: Option<i64>,
    all_endings: Option<bool>,
    choice: Option<String>,
    chapter: Option<String>,
    puzzle: Option<String>,
    hints: Option<i64>,
    all: Option<Vec<ConditionFile>>,
}

/// The most achievements of one story (M4).
pub const MAX_ACHIEVEMENTS: usize = 50;

/// The longest ending title and achievement name, in code points (M4).
pub const MAX_NAME_CHARS: usize = 40;

/// The longest achievement description, in code points (M4).
pub const MAX_DESC_CHARS: usize = 140;

/// How many conditions an `all` holds (M5).
const ALL_LEN: std::ops::RangeInclusive<usize> = 2..=4;

/// What one story's conditions are judged against.
struct Ctx<'a> {
    story: &'a StoryDef,
    choices: &'a HashMap<ChapterId, HashMap<String, String>>,
    puzzles: &'a [PuzzleDef],
}

impl Ctx<'_> {
    fn on_chain(&self, ch: &str) -> bool {
        self.story.chapters.iter().any(|c| c.id.0 == ch)
    }
}

/// The choice vocabulary (M2): exactly the index's chapters, each option a line ID of its own chapter, each point an
/// option of the same chapter.
fn vocabulary(
    file: BTreeMap<String, BTreeMap<String, String>>,
    stories: &[StoryDef],
) -> Result<HashMap<ChapterId, HashMap<String, String>>, String> {
    let chapters: Vec<&ChapterId> = stories
        .iter()
        .flat_map(|s| &s.chapters)
        .map(|c| &c.id)
        .collect();
    for key in file.keys() {
        if !chapters.iter().any(|ch| &ch.0 == key) {
            return Err(match ChapterId::parse(key) {
                Some(ch) => format!("choices: {} is not a chapter of the story index", ch.0),
                None => "choices: a key is not a chapter id".to_owned(),
            });
        }
    }
    let mut file = file;
    let mut choices = HashMap::with_capacity(chapters.len());
    for ch in chapters {
        let Some(options) = file.remove(&ch.0) else {
            return Err(format!("choices: no entry for chapter {}", ch.0));
        };
        for (option, point) in &options {
            if !is_line_id(option) {
                return Err(format!("choices.{}: an option is not a line ID", ch.0));
            }
            if id_chapter(option).as_ref() != Some(ch) {
                return Err(format!(
                    "choices.{}: option {option} is not of {}",
                    ch.0, ch.0
                ));
            }
            if !options.contains_key(point) {
                return Err(format!(
                    "choices.{}: the point of {option} is not an option of {}",
                    ch.0, ch.0
                ));
            }
        }
        choices.insert(ch.clone(), options.into_iter().collect());
    }
    Ok(choices)
}

/// The language of `text` that is blank or longer than `max` code points.
fn misfit(text: &Localized, max: usize) -> Option<&'static str> {
    [("ru", &text.ru), ("en", &text.en)]
        .into_iter()
        .find(|(_, t)| t.trim().is_empty() || t.chars().count() > max)
        .map(|(lang, _)| lang)
}

/// One story's entry: the endings are exactly the index's, each titled; at most [`MAX_ACHIEVEMENTS`] achievements
/// with unique ids, texts within the M4 limits and conditions the index can meet.
fn story_meta(entry: StoryFile, ctx: &Ctx<'_>) -> Result<StoryMeta, String> {
    let story = ctx.story;
    let mut titles = entry.endings;
    for name in titles.keys() {
        if !story.endings.contains_key(name) {
            return Err(if is_ending_name(name) {
                format!("endings: {name} is not an ending the index declares")
            } else {
                "endings: a key is not an ending name".to_owned()
            });
        }
    }
    let mut endings = BTreeMap::new();
    for name in story.endings.keys() {
        let Some(title) = titles.remove(name) else {
            return Err(format!("endings: no title for {name}"));
        };
        if let Some(lang) = misfit(&title, MAX_NAME_CHARS) {
            return Err(format!(
                "ending {name}: the {lang} title is not 1 to {MAX_NAME_CHARS} code points of text"
            ));
        }
        let gate = gate(&Condition::Ending(name.clone()), story);
        endings.insert(name.clone(), EndingMeta { title, gate });
    }
    if entry.achievements.len() > MAX_ACHIEVEMENTS {
        return Err(format!(
            "{} achievements, at most {MAX_ACHIEVEMENTS}",
            entry.achievements.len()
        ));
    }
    let mut achievements: Vec<AchievementDef> = Vec::with_capacity(entry.achievements.len());
    let mut named_puzzles = Vec::new();
    for (at, a) in entry.achievements.into_iter().enumerate() {
        if !is_ending_name(&a.id) {
            return Err(format!(
                "achievement {}: the id is not an achievement id",
                at + 1
            ));
        }
        if achievements.iter().any(|seen| seen.id == a.id) {
            return Err(format!("achievement {} is listed twice", a.id));
        }
        for (field, text, max) in [
            ("name", &a.name, MAX_NAME_CHARS),
            ("desc", &a.desc, MAX_DESC_CHARS),
        ] {
            if let Some(lang) = misfit(text, max) {
                return Err(format!(
                    "achievement {}: the {lang} {field} is not 1 to {max} code points of text",
                    a.id
                ));
            }
        }
        let when = condition(a.when, ctx, false)
            .map_err(|reason| format!("achievement {}: {reason}", a.id))?;
        puzzles_named(&when, &mut named_puzzles);
        achievements.push(AchievementDef {
            gate: gate(&when, story),
            id: a.id,
            hidden: a.hidden,
            when,
            name: a.name,
            desc: a.desc,
        });
    }
    Ok(StoryMeta {
        endings,
        achievements,
        puzzles: named_puzzles,
    })
}

/// The puzzles `c` names, added to `out` once each.
fn puzzles_named(c: &Condition, out: &mut Vec<PuzzleId>) {
    match c {
        Condition::Puzzle { puzzle, .. } => {
            if !out.contains(puzzle) {
                out.push(puzzle.clone());
            }
        }
        Condition::All(parts) => {
            for part in parts {
                puzzles_named(part, out);
            }
        }
        Condition::Ending(_)
        | Condition::Endings(_)
        | Condition::AllEndings
        | Condition::Choice(_)
        | Condition::Chapter(_) => {}
    }
}

/// One condition (M5): exactly one kind, `hints: 0` only beside `puzzle`, each naming what the story has; an `all` of
/// 2 to 4 conditions, none an `all` (`nested`).
fn condition(raw: ConditionFile, ctx: &Ctx<'_>, nested: bool) -> Result<Condition, String> {
    let ConditionFile {
        ending,
        endings,
        all_endings,
        choice,
        chapter,
        puzzle,
        hints,
        all,
    } = raw;
    let kinds: Vec<&str> = [
        ("ending", ending.is_some()),
        ("endings", endings.is_some()),
        ("allEndings", all_endings.is_some()),
        ("choice", choice.is_some()),
        ("chapter", chapter.is_some()),
        ("puzzle", puzzle.is_some()),
        ("all", all.is_some()),
    ]
    .into_iter()
    .filter_map(|(kind, present)| present.then_some(kind))
    .collect();
    let [kind] = kinds.as_slice() else {
        return Err(format!(
            "the condition has {} kinds ({}), expected exactly one",
            kinds.len(),
            kinds.join(", ")
        ));
    };
    if let Some(n) = hints {
        if *kind != "puzzle" {
            return Err(format!("hints beside {kind}: hints only beside puzzle"));
        }
        if n != 0 {
            return Err(format!("hints {n}, expected 0"));
        }
    }
    let story = ctx.story;
    let id = &story.id.0;
    if let Some(name) = ending {
        return if story.endings.contains_key(&name) {
            Ok(Condition::Ending(name))
        } else if is_ending_name(&name) {
            Err(format!("ending {name} is not an ending of {id}"))
        } else {
            Err("the ending is not an ending name".to_owned())
        };
    }
    if let Some(n) = endings {
        let count = story.endings.len();
        return match u32::try_from(n) {
            Ok(n) if n >= 1 && usize::try_from(n).is_ok_and(|n| n <= count) => {
                Ok(Condition::Endings(n))
            }
            _ => Err(format!(
                "endings {n} is outside 1 to {count}, the endings of {id}"
            )),
        };
    }
    if let Some(all_endings) = all_endings {
        return if !all_endings {
            Err("allEndings is not true".to_owned())
        } else if story.endings.is_empty() {
            Err(format!("allEndings: {id} declares no ending"))
        } else {
            Ok(Condition::AllEndings)
        };
    }
    if let Some(option) = choice {
        if !is_line_id(&option) {
            return Err("the choice is not a line ID".to_owned());
        }
        let known = id_chapter(&option).is_some_and(|ch| {
            ctx.on_chain(&ch.0)
                && ctx
                    .choices
                    .get(&ch)
                    .is_some_and(|o| o.contains_key(&option))
        });
        return if known {
            Ok(Condition::Choice(option))
        } else {
            Err(format!(
                "choice {option} is not an option of a chapter of {id}"
            ))
        };
    }
    if let Some(ch) = chapter {
        return match ChapterId::parse(&ch) {
            Some(ch) if ctx.on_chain(&ch.0) => Ok(Condition::Chapter(ch)),
            Some(ch) => Err(format!("chapter {} is not on the chain of {id}", ch.0)),
            None => Err("the chapter is not a chapter id".to_owned()),
        };
    }
    if let Some(p) = puzzle {
        let Some(p) = PuzzleId::parse(&p) else {
            return Err("the puzzle is not a puzzle id".to_owned());
        };
        let known = ctx
            .puzzles
            .iter()
            .any(|def| def.id == p && ctx.on_chain(&def.chapter.0));
        return if known {
            Ok(Condition::Puzzle {
                puzzle: p,
                no_hints: hints.is_some(),
            })
        } else {
            Err(format!(
                "puzzle {} is not a puzzle of a chapter of {id}",
                p.0
            ))
        };
    }
    if let Some(parts) = all {
        if nested {
            return Err("an all inside an all".to_owned());
        }
        if !ALL_LEN.contains(&parts.len()) {
            return Err(format!(
                "all holds {} conditions, expected 2 to 4",
                parts.len()
            ));
        }
        return parts
            .into_iter()
            .map(|part| condition(part, ctx, true))
            .collect::<Result<Vec<_>, _>>()
            .map(Condition::All);
    }
    Err("the condition has no kind".to_owned())
}

/// What an achievement asks for (M5): one kind over facts the server has.
pub enum Condition {
    /// That ending of the story was reached.
    Ending(String),
    /// At least that many distinct endings of the story were reached (1 to the story's ending count).
    Endings(u32),
    /// Every ending the story declares was reached.
    AllEndings,
    /// That option (its line ID) was picked at least once.
    Choice(String),
    /// That chapter was completed: a `chapter_completed`, or an ending in it.
    Chapter(ChapterId),
    /// The puzzle is solved; with `no_hints` (`hints: 0`), no hint tier of it was unlocked either.
    Puzzle {
        /// The puzzle.
        puzzle: PuzzleId,
        /// Whether a hint unlock misses the condition.
        no_hints: bool,
    },
    /// 2 to 4 conditions of the kinds above, every one met.
    All(Vec<Condition>),
}

/// What the server knows of one puzzle of a user.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct PuzzleFact {
    /// `puzzle_progress.solved_at` is set.
    pub solved: bool,
    /// The `hint_unlocks` rows of the puzzle.
    pub hints_unlocked: u32,
}

/// One user's facts in one story, counted only where the current index still holds them (STORIES-PLAN ST6).
#[derive(Default)]
pub struct Facts {
    /// Each reached ending's name, with the first time it was reached (server clock).
    pub endings: BTreeMap<String, i64>,
    /// The completed chapters.
    pub chapters: HashSet<ChapterId>,
    /// The picked options, by line ID.
    pub choices: HashSet<String>,
    /// The facts of the story's puzzles; a puzzle without a row is absent.
    pub puzzles: HashMap<PuzzleId, PuzzleFact>,
    /// The endings reached, counting every reach of one ending.
    pub runs: u32,
}

/// Whether `f` meets `c` in `story`. Pure. Endings are counted by name, so one ending reached twice is one ending.
pub fn met(c: &Condition, f: &Facts, story: &StoryDef) -> bool {
    match c {
        Condition::Ending(name) => f.endings.contains_key(name),
        Condition::Endings(n) => {
            let reached = story
                .endings
                .keys()
                .filter(|name| f.endings.contains_key(*name))
                .count();
            usize::try_from(*n).is_ok_and(|n| reached >= n)
        }
        Condition::AllEndings => {
            !story.endings.is_empty()
                && story
                    .endings
                    .keys()
                    .all(|name| f.endings.contains_key(name))
        }
        Condition::Choice(option) => f.choices.contains(option),
        Condition::Chapter(chapter) => f.chapters.contains(chapter),
        Condition::Puzzle { puzzle, no_hints } => f
            .puzzles
            .get(puzzle)
            .is_some_and(|p| p.solved && !(*no_hints && p.hints_unlocked > 0)),
        Condition::All(parts) => parts.iter().all(|part| met(part, f, story)),
    }
}

/// The paid chapters of `story` that `c` names (M7): an ending's chapter, an option's chapter, the chapter itself, a
/// puzzle's chapter, every chapter holding an ending for `allEndings`, none for `endings: n`, the union for `all`.
/// Option and puzzle ids carry their chapter, so the story index alone decides the gate.
pub fn gate(c: &Condition, story: &StoryDef) -> HashSet<ChapterId> {
    let mut named = Vec::new();
    named_chapters(c, story, &mut named);
    named
        .into_iter()
        .filter(|ch| story.chapters.iter().any(|sc| &sc.id == ch && sc.paid))
        .collect()
}

/// Every chapter `c` names, free or paid, repeats kept.
fn named_chapters(c: &Condition, story: &StoryDef, out: &mut Vec<ChapterId>) {
    match c {
        Condition::Ending(name) => out.extend(story.endings.get(name).cloned()),
        Condition::Endings(_) => {}
        Condition::AllEndings => out.extend(story.endings.values().cloned()),
        Condition::Choice(option) => out.extend(id_chapter(option)),
        Condition::Chapter(chapter) => out.push(chapter.clone()),
        Condition::Puzzle { puzzle, .. } => out.extend(id_chapter(&puzzle.0)),
        Condition::All(parts) => {
            for part in parts {
                named_chapters(part, story, out);
            }
        }
    }
}

/// The chapter part of a line ID or a puzzle id (`ch<N>.…`).
fn id_chapter(id: &str) -> Option<ChapterId> {
    id.split('.').next().and_then(ChapterId::parse)
}

/// Whether an item gated on `gate` may be shown to a viewer owning `owned`: every gated chapter's product is owned. A
/// gated chapter `story` does not hold is never visible.
pub fn visible(gate: &HashSet<ChapterId>, owned: &HashSet<ProductId>, story: &StoryDef) -> bool {
    gate.iter().all(|ch| {
        story
            .chapters
            .iter()
            .find(|sc| &sc.id == ch)
            .is_some_and(|sc| sc.product.as_ref().is_none_or(|p| owned.contains(p)))
    })
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::content::ContentStore;
    use crate::ids::StoryId;

    async fn fixture() -> ContentStore {
        let dir = Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/content"
        ));
        match ContentStore::load(dir).await {
            Ok(content) => content,
            Err(e) => panic!("the fixture content: {e}"),
        }
    }

    fn story<'a>(content: &'a ContentStore, id: &str) -> &'a StoryDef {
        match content.story(&StoryId(id.to_owned())) {
            Some(story) => story,
            None => panic!("the fixture has no story {id}"),
        }
    }

    fn chapter(id: &str) -> ChapterId {
        ChapterId(id.to_owned())
    }

    fn puzzle(id: &str, no_hints: bool) -> Condition {
        Condition::Puzzle {
            puzzle: PuzzleId(id.to_owned()),
            no_hints,
        }
    }

    /// Facts with these endings (name, first time), completed chapters, picked options, puzzles (id, solved, hints)
    /// and runs.
    fn facts(
        endings: &[(&str, i64)],
        chapters: &[&str],
        choices: &[&str],
        puzzles: &[(&str, bool, u32)],
        runs: u32,
    ) -> Facts {
        Facts {
            endings: endings
                .iter()
                .map(|&(name, at)| (name.to_owned(), at))
                .collect(),
            chapters: chapters.iter().map(|&ch| chapter(ch)).collect(),
            choices: choices.iter().map(|&o| o.to_owned()).collect(),
            puzzles: puzzles
                .iter()
                .map(|&(id, solved, hints_unlocked)| {
                    (
                        PuzzleId(id.to_owned()),
                        PuzzleFact {
                            solved,
                            hints_unlocked,
                        },
                    )
                })
                .collect(),
            runs,
        }
    }

    /// A case of `visible`: its name, the gate, the products owned, the story, and the verdict.
    type Visibility<'a> = (
        &'a str,
        &'a HashSet<ChapterId>,
        &'a HashSet<ProductId>,
        &'a StoryDef,
        bool,
    );

    fn report(failures: &[String]) {
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    /// Each of the seven kinds against facts that meet it and facts that miss it, on the fixture's stories: manor
    /// (endings truth and ashes, both in paid ch2) and tide (drowned in ch3, dawn in paid ch4).
    #[tokio::test]
    async fn conditions_evaluate() {
        let content = fixture().await;
        let (manor, tide) = (story(&content, "manor"), story(&content, "tide"));
        let both = facts(&[("truth", 1), ("ashes", 2)], &["ch2"], &[], &[], 2);
        let truth_twice = facts(&[("truth", 1)], &["ch2"], &[], &[], 2);
        let dawn_and_walk = facts(&[("dawn", 1)], &["ch4"], &["ch3.shore.s002"], &[], 1);
        let rows: Vec<(&str, Condition, &StoryDef, Facts, bool)> = vec![
            (
                "ending truth: reached",
                Condition::Ending("truth".to_owned()),
                manor,
                truth_twice,
                true,
            ),
            (
                "ending truth: ashes only",
                Condition::Ending("truth".to_owned()),
                manor,
                facts(&[("ashes", 1)], &["ch2"], &[], &[], 1),
                false,
            ),
            (
                "endings 2: truth and ashes",
                Condition::Endings(2),
                manor,
                both,
                true,
            ),
            (
                "endings 2: truth reached twice",
                Condition::Endings(2),
                manor,
                facts(&[("truth", 1)], &["ch2"], &[], &[], 2),
                false,
            ),
            (
                "endings 1: truth",
                Condition::Endings(1),
                manor,
                facts(&[("truth", 1)], &["ch2"], &[], &[], 1),
                true,
            ),
            (
                "endings 1: none",
                Condition::Endings(1),
                manor,
                facts(&[], &["ch1"], &["ch1.hall.c001"], &[], 0),
                false,
            ),
            (
                "allEndings: truth and ashes",
                Condition::AllEndings,
                manor,
                facts(&[("truth", 1), ("ashes", 2)], &["ch2"], &[], &[], 2),
                true,
            ),
            (
                "allEndings: truth twice",
                Condition::AllEndings,
                manor,
                facts(&[("truth", 1)], &["ch2"], &[], &[], 2),
                false,
            ),
            (
                "choice ch1.hall.c002: picked",
                Condition::Choice("ch1.hall.c002".to_owned()),
                manor,
                facts(&[], &[], &["ch1.hall.c002"], &[], 0),
                true,
            ),
            (
                "choice ch1.hall.c002: the other option",
                Condition::Choice("ch1.hall.c002".to_owned()),
                manor,
                facts(&[], &[], &["ch1.hall.c001"], &[], 0),
                false,
            ),
            (
                "chapter ch4: completed",
                Condition::Chapter(chapter("ch4")),
                tide,
                facts(&[], &["ch4"], &[], &[], 0),
                true,
            ),
            (
                "chapter ch4: ch3 only",
                Condition::Chapter(chapter("ch4")),
                tide,
                facts(&[("drowned", 1)], &["ch3"], &[], &[], 1),
                false,
            ),
            (
                "puzzle ch1.drawer: solved with hints",
                puzzle("ch1.drawer", false),
                manor,
                facts(&[], &[], &[], &[("ch1.drawer", true, 2)], 0),
                true,
            ),
            (
                "puzzle ch1.drawer: unsolved",
                puzzle("ch1.drawer", false),
                manor,
                facts(&[], &[], &[], &[("ch1.drawer", false, 0)], 0),
                false,
            ),
            (
                "puzzle ch1.drawer: no row",
                puzzle("ch1.drawer", false),
                manor,
                facts(&[], &[], &[], &[("ch2.cabinet", true, 0)], 0),
                false,
            ),
            (
                "puzzle ch1.drawer hints 0: solved, no hint",
                puzzle("ch1.drawer", true),
                manor,
                facts(&[], &[], &[], &[("ch1.drawer", true, 0)], 0),
                true,
            ),
            (
                "puzzle ch1.drawer hints 0: solved, one hint",
                puzzle("ch1.drawer", true),
                manor,
                facts(&[], &[], &[], &[("ch1.drawer", true, 1)], 0),
                false,
            ),
            (
                "all [ending dawn, choice ch3.shore.s002]: both",
                Condition::All(vec![
                    Condition::Ending("dawn".to_owned()),
                    Condition::Choice("ch3.shore.s002".to_owned()),
                ]),
                tide,
                dawn_and_walk,
                true,
            ),
            (
                "all [ending dawn, choice ch3.shore.s002]: the choice missing",
                Condition::All(vec![
                    Condition::Ending("dawn".to_owned()),
                    Condition::Choice("ch3.shore.s002".to_owned()),
                ]),
                tide,
                facts(&[("dawn", 1)], &["ch4"], &["ch3.shore.s001"], &[], 1),
                false,
            ),
        ];
        let failures: Vec<String> = rows
            .iter()
            .filter(|(_, c, story, f, want)| met(c, f, story) != *want)
            .map(|(case, _, _, _, want)| format!("{case}: expected met = {want}"))
            .collect();
        report(&failures);
    }

    /// The gate is the paid chapters a condition names, on the fixture's index (ch2 and ch4 paid); `visible` asks for
    /// every gated chapter's product.
    #[tokio::test]
    async fn gates_name_paid_chapters() {
        let content = fixture().await;
        let (manor, tide) = (story(&content, "manor"), story(&content, "tide"));
        let rows: Vec<(&str, Condition, &StoryDef, &[&str])> = vec![
            (
                "ending dawn",
                Condition::Ending("dawn".to_owned()),
                tide,
                &["ch4"],
            ),
            (
                "ending drowned",
                Condition::Ending("drowned".to_owned()),
                tide,
                &[],
            ),
            ("endings 1", Condition::Endings(1), tide, &[]),
            (
                "choice ch3.shore.s002",
                Condition::Choice("ch3.shore.s002".to_owned()),
                tide,
                &[],
            ),
            (
                "choice ch2.archive.k001",
                Condition::Choice("ch2.archive.k001".to_owned()),
                manor,
                &["ch2"],
            ),
            (
                "chapter ch4",
                Condition::Chapter(chapter("ch4")),
                tide,
                &["ch4"],
            ),
            ("chapter ch3", Condition::Chapter(chapter("ch3")), tide, &[]),
            ("allEndings on tide", Condition::AllEndings, tide, &["ch4"]),
            (
                "puzzle ch2.cabinet",
                puzzle("ch2.cabinet", false),
                manor,
                &["ch2"],
            ),
            (
                "puzzle ch1.drawer hints 0",
                puzzle("ch1.drawer", true),
                manor,
                &[],
            ),
            (
                "all [ending dawn, choice ch3.shore.s002]",
                Condition::All(vec![
                    Condition::Ending("dawn".to_owned()),
                    Condition::Choice("ch3.shore.s002".to_owned()),
                ]),
                tide,
                &["ch4"],
            ),
        ];
        let mut failures = Vec::new();
        for (case, c, story, want) in &rows {
            let mut got: Vec<String> = gate(c, story).into_iter().map(|ch| ch.0).collect();
            got.sort_unstable();
            if got != *want {
                failures.push(format!("{case}: expected the gate {want:?}, got {got:?}"));
            }
        }
        let ch4: HashSet<ChapterId> = [chapter("ch4")].into();
        let ch2: HashSet<ChapterId> = [chapter("ch2")].into();
        let owns_ch4: HashSet<ProductId> = [ProductId("chapter:ch4".to_owned())].into();
        let visibility: [Visibility<'_>; 5] = [
            (
                "gate {} without products",
                &HashSet::new(),
                &HashSet::new(),
                tide,
                true,
            ),
            (
                "gate {ch4} without chapter:ch4",
                &ch4,
                &HashSet::new(),
                tide,
                false,
            ),
            ("gate {ch4} with chapter:ch4", &ch4, &owns_ch4, tide, true),
            (
                "gate {ch2} with chapter:ch4 only",
                &ch2,
                &owns_ch4,
                manor,
                false,
            ),
            (
                "gate {ch4} on manor, which has no ch4",
                &ch4,
                &owns_ch4,
                manor,
                false,
            ),
        ];
        for (case, gate, owned, story, want) in visibility {
            if visible(gate, owned, story) != want {
                failures.push(format!("visible, {case}: expected {want}"));
            }
        }
        report(&failures);
    }
}
