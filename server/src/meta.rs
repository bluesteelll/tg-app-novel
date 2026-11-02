//! The meta rules (META-PLAN M5-M7): achievement conditions over facts the server has, and the gate that keeps a paid
//! item from a viewer who does not own its chapter.
//!
//! Principle 0 (M7): the gate of an item is the set of paid chapters its condition names, computed from the story
//! index; an item reaches a viewer only if every gated chapter is owned now. No type here derives `Debug`.
//!
//! Achievements are display only (M6, principle 1): evaluating one grants nothing.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::content::StoryDef;
use crate::ids::{ChapterId, ProductId, PuzzleId};

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
