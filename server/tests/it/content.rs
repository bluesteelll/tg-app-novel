//! The server's content (`ContentStore`, loaded by `AppState::new` from `CONTENT_DIR`): the story index, the paid
//! chapters, the puzzle index and the gated asset index of the committed fixture, the startup refusals on mutated
//! copies of it, and the paid routes that serve it only after the entitlement check (principle 0).

use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::http::Request;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, HeaderName, X_CONTENT_TYPE_OPTIONS};
use serde_json::{Value, json};
use server::config::Config;
use server::content::{ContentError, ContentStore};
use server::ids::{ChapterId, ProductId, PuzzleId, StoryId};
use server::meta::Condition;
use server::{AppState, StartupError};

use crate::catalog::{ANN, get, own, state_with_users};
use crate::common::{self, TestDb};

/// The committed content fixture every test state loads.
pub(crate) const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/content");

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// A copy of the fixture tree under `CARGO_TARGET_TMPDIR`, for a test to break; removed on drop.
pub(crate) struct FixtureCopy {
    root: PathBuf,
}

/// Copies made by this test process: the counter keeps two copies of one nanosecond apart.
static COPIES: AtomicU32 = AtomicU32::new(0);

impl FixtureCopy {
    pub(crate) fn new() -> FixtureCopy {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let n = COPIES.fetch_add(1, Ordering::Relaxed);
        let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("l6b-content-{}-{nanos}-{n}", std::process::id()));
        copy_tree(Path::new(FIXTURE), &root);
        FixtureCopy { root }
    }

    /// The copy's root: a `CONTENT_DIR`.
    pub(crate) fn path(&self) -> &Path {
        &self.root
    }

    /// Deletes the file `rel` of the copy.
    pub(crate) fn remove(&self, rel: &str) {
        std::fs::remove_file(self.root.join(rel)).unwrap();
    }

    /// Writes `value` as the file `rel` of the copy.
    pub(crate) fn write_json(&self, rel: &str, value: &Value) {
        let path = self.root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    }

    /// Rewrites the JSON file `rel` of the copy through `edit`.
    pub(crate) async fn edit_json(&self, rel: &str, edit: impl FnOnce(&mut Value)) {
        let mut value = read_json(&self.root.join(rel)).await;
        edit(&mut value);
        self.write_json(rel, &value);
    }
}

impl Drop for FixtureCopy {
    fn drop(&mut self) {
        // Best effort: a leftover copy under target/ is harmless and names its process.
        std::fs::remove_dir_all(&self.root).ok();
    }
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).unwrap();
        }
    }
}

/// A JSON file, read with `tokio::fs` (clippy denies `std::fs::read`).
pub(crate) async fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&tokio::fs::read(path).await.unwrap()).unwrap()
}

/// `AppState::new` on a fresh database with `dir` as the content. Bind the guard, never `_`.
pub(crate) async fn state_on(dir: &Path) -> (Result<AppState, StartupError>, TestDb) {
    let db = TestDb::create().await;
    let cfg = Config {
        content_dir: dir.to_path_buf(),
        ..common::test_config(&db)
    };
    (AppState::new(cfg).await, db)
}

/// The content error a start was refused with, or the failure line when it started or failed otherwise.
pub(crate) fn content_error(
    case: &str,
    started: Result<AppState, StartupError>,
) -> Result<ContentError, String> {
    match started {
        Ok(_) => Err(format!("{case}: expected a content error, got Ok(state)")),
        Err(StartupError::Content(e)) => Ok(e),
        Err(e) => Err(format!("{case}: expected a content error, got {e}")),
    }
}

/// `Content(Read)` of a missing file whose path ends in `file`, else a failure line.
fn expect_missing(
    case: &str,
    started: Result<AppState, StartupError>,
    file: &str,
) -> Option<String> {
    match content_error(case, started) {
        Ok(ContentError::Read { path, source })
            if path.ends_with(file) && source.kind() == ErrorKind::NotFound =>
        {
            None
        }
        Ok(other) => Some(format!(
            "{case}: expected Read (NotFound) of a path ending in {file}, got {other}"
        )),
        Err(failure) => Some(failure),
    }
}

fn chapter(id: &str) -> ChapterId {
    ChapterId(id.to_owned())
}

fn puzzle(id: &str) -> PuzzleId {
    PuzzleId(id.to_owned())
}

/// The fixture's two stories, their chains, endings, paid chapters, worlds and gated asset files.
#[tokio::test]
async fn story_index_loaded() {
    let (st, _db) = common::test_state().await;
    let content = &st.content;
    let mut failures = Vec::new();

    let ids: Vec<&str> = content.stories().iter().map(|s| s.id.0.as_str()).collect();
    if ids != ["manor", "tide"] {
        failures.push(format!("stories(): expected [manor, tide], got {ids:?}"));
    }
    for (ch, want) in [
        ("ch1", Some("manor")),
        ("ch2", Some("manor")),
        ("ch3", Some("tide")),
        ("ch4", Some("tide")),
        ("ch9", None),
    ] {
        let got = content.story_of(&chapter(ch)).map(|s| s.id.0.as_str());
        if got != want {
            failures.push(format!("story_of({ch}): expected {want:?}, got {got:?}"));
        }
    }
    match content.story(&StoryId("tide".to_owned())) {
        Some(tide) if tide.title.ru == "Прилив" && tide.title.en == "The Tide" => {}
        Some(tide) => failures.push(format!("story(tide): title {:?}", tide.title)),
        None => failures.push("story(tide): expected Some, got None".to_owned()),
    }
    if content.story(&StoryId("nope".to_owned())).is_some() {
        failures.push("story(nope): expected None".to_owned());
    }

    let want_chains = [
        (
            "manor",
            vec![("ch1", false, None), ("ch2", true, Some("chapter:ch2"))],
            vec![("ashes", "ch2"), ("truth", "ch2")],
        ),
        (
            "tide",
            vec![("ch3", false, None), ("ch4", true, Some("chapter:ch4"))],
            vec![("dawn", "ch4"), ("drowned", "ch3")],
        ),
    ];
    for (story, chain, endings) in want_chains {
        let Some(def) = content.story(&StoryId(story.to_owned())) else {
            failures.push(format!("story({story}): expected Some"));
            continue;
        };
        let got: Vec<(&str, bool, Option<&str>)> = def
            .chapters
            .iter()
            .map(|c| {
                (
                    c.id.0.as_str(),
                    c.paid,
                    c.product.as_ref().map(|p| p.0.as_str()),
                )
            })
            .collect();
        if got != chain {
            failures.push(format!("{story} chapters: expected {chain:?}, got {got:?}"));
        }
        let got: Vec<(&str, &str)> = def
            .endings
            .iter()
            .map(|(name, ch)| (name.as_str(), ch.0.as_str()))
            .collect();
        if got != endings {
            failures.push(format!(
                "{story} endings: expected {endings:?}, got {got:?}"
            ));
        }
    }

    for free in ["ch1", "ch3", "ch9"] {
        if content.paid_chapter(&chapter(free)).is_some() {
            failures.push(format!("paid_chapter({free}): expected None"));
        }
    }
    for (ch, version) in [("ch2", "c2c2c2c2c2c2c2c2"), ("ch4", "c4c4c4c4c4c4c4c4")] {
        match content.paid_chapter(&chapter(ch)) {
            Some(paid) => {
                if paid.story_version != version || paid.product.0 != format!("chapter:{ch}") {
                    failures.push(format!(
                        "paid_chapter({ch}): expected {version} / chapter:{ch}, got {} / {}",
                        paid.story_version, paid.product.0
                    ));
                }
                let marker = format!("FIXTURE-{}-STORY", ch.to_uppercase());
                if !paid.story.get().contains(&marker) {
                    failures.push(format!(
                        "paid_chapter({ch}).story: expected the {marker} marker"
                    ));
                }
            }
            None => failures.push(format!("paid_chapter({ch}): expected Some")),
        }
    }
    match content.chapter_world(&chapter("ch2")) {
        Some(world) if world.get().contains("FIXTURE-CH2-WORLD") => {}
        Some(_) => {
            failures.push("chapter_world(ch2): expected the FIXTURE-CH2-WORLD marker".to_owned())
        }
        None => failures.push("chapter_world(ch2): expected Some".to_owned()),
    }
    for ch in ["ch4", "ch1"] {
        if content.chapter_world(&chapter(ch)).is_some() {
            failures.push(format!("chapter_world({ch}): expected None"));
        }
    }

    // The gated asset index, derived from the paid manifests: a shared file has both owners, a public URL and an
    // unreferenced file are not in it.
    let ch2 = ProductId("chapter:ch2".to_owned());
    let ch4 = ProductId("chapter:ch4".to_owned());
    let want_assets = [
        ("bg-archive-0a1b2c3d.avif", "image/avif", vec![ch2.clone()]),
        ("bg-archive-0a1b2c3d.webp", "image/webp", vec![ch2.clone()]),
        (
            "sfx-door-2a3b4c5d.m4a",
            "audio/mp4",
            vec![ch2.clone(), ch4.clone()],
        ),
        (
            "bg-lamp_room-4e5f6a7b.avif",
            "image/avif",
            vec![ch4.clone()],
        ),
        (
            "bg-lamp_room-4e5f6a7b.webp",
            "image/webp",
            vec![ch4.clone()],
        ),
        ("bgm-storm-8c9d0e1f.m4a", "audio/mp4", vec![ch4.clone()]),
    ];
    for (file, content_type, owners) in want_assets {
        match content.asset(file) {
            Some(asset) => {
                if asset.content_type != content_type || asset.owners != owners {
                    failures.push(format!(
                        "asset({file}): expected {content_type} owned by {owners:?}, got {} owned by {:?}",
                        asset.content_type, asset.owners
                    ));
                }
                if !asset.path.ends_with(Path::new("assets").join(file)) {
                    failures.push(format!("asset({file}): path {}", asset.path.display()));
                }
            }
            None => failures.push(format!("asset({file}): expected Some")),
        }
    }
    for absent in [
        "bg-orphan-6e7f8a9b.avif",
        "bgm-hall-0e0e0e0e.m4a",
        "stories.json",
        "../stories.json",
    ] {
        if content.asset(absent).is_some() {
            failures.push(format!("asset({absent}): expected None"));
        }
    }
    report(&failures);
}

/// The fixture's puzzle index (ch1 and ch2 with three tiers, ch3 and ch4 empty), a hint-less puzzle (the producer's
/// `hintTiers` may be 0), and the index's refusals.
#[tokio::test]
async fn puzzle_index_loaded() {
    let (st, _db) = common::test_state().await;
    let content = &st.content;
    let mut failures = Vec::new();

    let ids: Vec<&str> = content.puzzles().iter().map(|p| p.id.0.as_str()).collect();
    if ids != ["ch1.drawer", "ch2.cabinet"] {
        failures.push(format!(
            "puzzles(): expected [ch1.drawer, ch2.cabinet], got {ids:?}"
        ));
    }
    match content.puzzle(&puzzle("ch1.drawer")) {
        Some(p) => {
            let got = (
                p.chapter.0.as_str(),
                p.answer_len,
                p.answer_max,
                p.solution.as_slice(),
                p.hints.len(),
            );
            if got != ("ch1", 4, 9, &[1, 8, 4, 7][..], 3) || p.title.en != "Desk drawer" {
                failures.push(format!(
                    "puzzle(ch1.drawer): got {got:?}, title {:?}",
                    p.title
                ));
            }
        }
        None => failures.push("puzzle(ch1.drawer): expected Some".to_owned()),
    }
    match content.puzzle(&puzzle("ch2.cabinet")) {
        Some(p) => {
            let got = (
                p.chapter.0.as_str(),
                p.answer_len,
                p.answer_max,
                p.solution.as_slice(),
                p.hints.len(),
            );
            if got != ("ch2", 3, 2, &[2, 0, 1][..], 3) || p.title.ru != "Шкаф в архиве" {
                failures.push(format!(
                    "puzzle(ch2.cabinet): got {got:?}, title {:?}",
                    p.title
                ));
            }
        }
        None => failures.push("puzzle(ch2.cabinet): expected Some".to_owned()),
    }
    if content.puzzle(&puzzle("ch3.drawer")).is_some() {
        failures.push("puzzle(ch3.drawer): expected None".to_owned());
    }

    let copy = FixtureCopy::new();
    copy.edit_json("puzzles/ch1.json", |v| {
        v["puzzles"]["drawer"]["hints"] = json!([])
    })
    .await;
    let (started, _db0) = state_on(copy.path()).await;
    match started {
        Ok(st) => match st.content.puzzle(&puzzle("ch1.drawer")) {
            Some(p) if p.hints.is_empty() => {}
            Some(p) => failures.push(format!(
                "hint-less drawer: expected 0 hints, got {}",
                p.hints.len()
            )),
            None => failures.push("hint-less drawer: expected Some".to_owned()),
        },
        Err(e) => failures.push(format!("hint-less drawer: expected Ok, got {e}")),
    }

    let four_hints = json!([{ "ru": "а", "en": "a" }, { "ru": "б", "en": "b" }, { "ru": "в", "en": "c" }, { "ru": "г", "en": "d" }]);
    let refusals: [(&str, &str, Value); 4] = [
        ("four hints", "hints", four_hints),
        (
            "solution shorter than answerLen",
            "solution",
            json!([1, 8, 4]),
        ),
        (
            "solution value above answerMax",
            "solution",
            json!([1, 8, 4, 10]),
        ),
        ("unknown puzzle type", "type", json!("jigsaw")),
    ];
    for (case, key, value) in refusals {
        let copy = FixtureCopy::new();
        copy.edit_json("puzzles/ch1.json", |v| v["puzzles"]["drawer"][key] = value)
            .await;
        let (started, _db) = state_on(copy.path()).await;
        match content_error(case, started) {
            Ok(ContentError::Invalid { path, .. } | ContentError::Json { path, .. })
                if path.ends_with("puzzles/ch1.json") => {}
            Ok(other) => failures.push(format!(
                "{case}: expected Invalid or Json on puzzles/ch1.json, got {other}"
            )),
            Err(failure) => failures.push(failure),
        }
    }
    let stray = FixtureCopy::new();
    stray.write_json(
        "puzzles/ch9.json",
        &json!({ "format": 1, "chapterId": "ch9", "puzzles": {} }),
    );
    let (started, _db) = state_on(stray.path()).await;
    match content_error("puzzles/ch9.json of no indexed chapter", started) {
        Ok(ContentError::Invalid { path, .. }) if path.ends_with("puzzles/ch9.json") => {}
        Ok(other) => failures.push(format!("puzzles/ch9.json: expected Invalid, got {other}")),
        Err(failure) => failures.push(failure),
    }
    report(&failures);
}

/// No `stories.json`: the server refuses to start (STORIES-PLAN Y6).
#[tokio::test]
async fn startup_fails_without_story_index() {
    let copy = FixtureCopy::new();
    copy.remove("stories.json");
    let (started, _db) = state_on(copy.path()).await;
    let failures: Vec<String> = expect_missing("no stories.json", started, "stories.json")
        .into_iter()
        .collect();
    report(&failures);
}

/// A story whose first chapter is paid (ST2): the index with ch3 sold.
#[tokio::test]
async fn startup_fails_when_first_chapter_paid() {
    let copy = FixtureCopy::new();
    copy.edit_json("stories.json", |v| {
        let ch3 = &mut v["stories"][1]["chapters"][0];
        ch3["paid"] = json!(true);
        ch3["productId"] = json!("chapter:ch3");
    })
    .await;
    let (started, _db) = state_on(copy.path()).await;
    let mut failures = Vec::new();
    match content_error("ch3 paid", started) {
        Ok(ContentError::FirstChapterPaid { story, chapter })
            if story == "tide" && chapter == "ch3" => {}
        Ok(other) => failures.push(format!(
            "ch3 paid: expected FirstChapterPaid {{ tide, ch3 }}, got {other}"
        )),
        Err(failure) => failures.push(failure),
    }
    report(&failures);
}

/// A paid chapter of the index without its content: (a) a file missing, (b) a chapter with no directory.
#[tokio::test]
async fn startup_fails_when_product_has_no_content() {
    let mut failures = Vec::new();

    let copy = FixtureCopy::new();
    copy.remove("chapters/ch4/story.json");
    let (started, _db) = state_on(copy.path()).await;
    failures.extend(expect_missing(
        "no chapters/ch4/story.json",
        started,
        "chapters/ch4/story.json",
    ));

    let copy = FixtureCopy::new();
    copy.edit_json("stories.json", |v| {
        let tide = v["stories"][1]["chapters"].as_array_mut().unwrap();
        tide.push(json!({
            "id": "ch5", "paid": true, "productId": "chapter:ch5",
            "title": { "ru": "Буря", "en": "The Storm" }
        }));
    })
    .await;
    let (started, _db) = state_on(copy.path()).await;
    failures.extend(expect_missing(
        "paid ch5 without a directory",
        started,
        "chapters/ch5/story.json",
    ));
    report(&failures);
}

/// A paid manifest naming a gated file that is not in `assets/`.
#[tokio::test]
async fn startup_fails_when_manifest_names_missing_asset() {
    let copy = FixtureCopy::new();
    copy.remove("assets/bg-lamp_room-4e5f6a7b.avif");
    let (started, _db) = state_on(copy.path()).await;
    let failures: Vec<String> = expect_missing(
        "no bg-lamp_room avif",
        started,
        "assets/bg-lamp_room-4e5f6a7b.avif",
    )
    .into_iter()
    .collect();
    report(&failures);
}

/// A paid public world carrying a puzzle's server-only `solution` or `hints` (PUZZLES-PLAN X5, X7).
#[tokio::test]
async fn startup_fails_when_world_carries_solution() {
    let mut failures = Vec::new();
    let cases: [(&str, Value); 2] = [
        ("solution", json!([2, 0, 1])),
        ("hints", json!([{ "ru": "а", "en": "a" }])),
    ];
    for (key, value) in cases {
        let copy = FixtureCopy::new();
        copy.edit_json("chapters/ch2/world.json", |v| {
            v["puzzles"]["cabinet"][key] = value
        })
        .await;
        let (started, _db) = state_on(copy.path()).await;
        let case = format!("world with {key}");
        match content_error(&case, started) {
            Ok(ContentError::Invalid { path, .. }) if path.ends_with("chapters/ch2/world.json") => {
            }
            Ok(other) => failures.push(format!(
                "{case}: expected Invalid on chapters/ch2/world.json, got {other}"
            )),
            Err(failure) => failures.push(failure),
        }
    }
    report(&failures);
}

/// A condition as one line: its kind and what it names (`all [ending dawn, choice ch3.shore.s002]`).
fn condition_text(c: &Condition) -> String {
    match c {
        Condition::Ending(name) => format!("ending {name}"),
        Condition::Endings(n) => format!("endings {n}"),
        Condition::AllEndings => "allEndings".to_owned(),
        Condition::Choice(option) => format!("choice {option}"),
        Condition::Chapter(ch) => format!("chapter {}", ch.0),
        Condition::Puzzle { puzzle, no_hints } => {
            let hints = if *no_hints { " hints 0" } else { "" };
            format!("puzzle {}{hints}", puzzle.0)
        }
        Condition::All(parts) => {
            let parts: Vec<String> = parts.iter().map(condition_text).collect();
            format!("all [{}]", parts.join(", "))
        }
    }
}

/// The chapter ids of a gate, sorted.
fn gate_ids(gate: &HashSet<ChapterId>) -> Vec<String> {
    let mut ids: Vec<String> = gate.iter().map(|ch| ch.0.clone()).collect();
    ids.sort_unstable();
    ids
}

/// The fixture's meta index (META-PLAN "Server formats"): both stories with their ending titles and gates, the
/// achievements in file order with their conditions, gates and texts, the puzzles they name, and every chapter's
/// choice vocabulary (`ch4` empty).
#[tokio::test]
async fn meta_index_loaded() {
    let (st, _db) = common::test_state().await;
    let meta = st.content.meta();
    let mut failures = Vec::new();
    type Ending<'a> = (&'a str, &'a str, &'a str, &'a [&'a str]);
    type Achievement<'a> = (&'a str, bool, &'a str, &'a [&'a str]);
    type StoryWant<'a> = (
        &'a str,
        Vec<Ending<'a>>,
        Vec<Achievement<'a>>,
        &'a [&'a str],
    );
    let stories: [StoryWant<'_>; 2] = [
        (
            "manor",
            vec![
                ("ashes", "Фикстура: пепел", "Fixture: ashes", &["ch2"]),
                ("truth", "Фикстура: правда", "Fixture: the truth", &["ch2"]),
            ],
            vec![
                ("truth_found", false, "ending truth", &["ch2"]),
                ("both_endings", false, "endings 2", &[]),
                ("every_ending", true, "allEndings", &["ch2"]),
                ("drawer_no_hints", false, "puzzle ch1.drawer hints 0", &[]),
                ("cabinet_open", false, "puzzle ch2.cabinet", &["ch2"]),
                ("kind_word", false, "choice ch1.hall.c002", &[]),
            ],
            &["ch1.drawer", "ch2.cabinet"],
        ),
        (
            "tide",
            vec![
                ("dawn", "Фикстура: рассвет", "Fixture: dawn", &["ch4"]),
                ("drowned", "Фикстура: утонувший", "Fixture: drowned", &[]),
            ],
            vec![
                ("lighthouse", false, "chapter ch4", &["ch4"]),
                (
                    "dawn_walk",
                    false,
                    "all [ending dawn, choice ch3.shore.s002]",
                    &["ch4"],
                ),
            ],
            &[],
        ),
    ];
    for (id, endings, achievements, puzzles) in stories {
        let Some(story) = meta.story(&StoryId(id.to_owned())) else {
            failures.push(format!("story({id}): expected Some"));
            continue;
        };
        let got: Vec<(&str, &str, &str, Vec<String>)> = story
            .endings
            .iter()
            .map(|(name, e)| {
                (
                    name.as_str(),
                    e.title.ru.as_str(),
                    e.title.en.as_str(),
                    gate_ids(&e.gate),
                )
            })
            .collect();
        let want: Vec<(&str, &str, &str, Vec<String>)> = endings
            .iter()
            .map(|&(name, ru, en, gate)| {
                (name, ru, en, gate.iter().map(|&g| g.to_owned()).collect())
            })
            .collect();
        if got != want {
            failures.push(format!("{id} endings: expected {want:?}, got {got:?}"));
        }
        let got: Vec<(&str, bool, String, Vec<String>)> = story
            .achievements
            .iter()
            .map(|a| {
                (
                    a.id.as_str(),
                    a.hidden,
                    condition_text(&a.when),
                    gate_ids(&a.gate),
                )
            })
            .collect();
        let want: Vec<(&str, bool, String, Vec<String>)> = achievements
            .iter()
            .map(|&(a, hidden, when, gate)| {
                (
                    a,
                    hidden,
                    when.to_owned(),
                    gate.iter().map(|&g| g.to_owned()).collect(),
                )
            })
            .collect();
        if got != want {
            failures.push(format!("{id} achievements: expected {want:?}, got {got:?}"));
        }
        let got: Vec<&str> = story.puzzles.iter().map(|p| p.0.as_str()).collect();
        if got != puzzles {
            failures.push(format!("{id} puzzles: expected {puzzles:?}, got {got:?}"));
        }
    }
    // The texts come through whole: one name and one description.
    let texts = meta
        .story(&StoryId("manor".to_owned()))
        .and_then(|s| s.achievements.first())
        .map(|a| (a.name.ru.as_str(), a.desc.en.as_str()));
    if texts
        != Some((
            "Фикстура: правда найдена",
            "Fixture: reach the ending The Truth.",
        ))
    {
        failures.push(format!("manor truth_found texts: got {texts:?}"));
    }
    if meta.story(&StoryId("nope".to_owned())).is_some() {
        failures.push("story(nope): expected None".to_owned());
    }

    let vocabulary: [(&str, &[(&str, &str)]); 4] = [
        (
            "ch1",
            &[
                ("ch1.hall.c001", "ch1.hall.c001"),
                ("ch1.hall.c002", "ch1.hall.c001"),
                ("ch1.study.c003", "ch1.study.c003"),
            ],
        ),
        (
            "ch2",
            &[
                ("ch2.archive.k001", "ch2.archive.k001"),
                ("ch2.archive.k002", "ch2.archive.k001"),
            ],
        ),
        (
            "ch3",
            &[
                ("ch3.shore.s001", "ch3.shore.s001"),
                ("ch3.shore.s002", "ch3.shore.s001"),
            ],
        ),
        ("ch4", &[]),
    ];
    for (ch, want) in vocabulary {
        match meta.choices(&chapter(ch)) {
            Some(options) => {
                let mut got: Vec<(&str, &str)> = options
                    .iter()
                    .map(|(option, point)| (option.as_str(), point.as_str()))
                    .collect();
                got.sort_unstable();
                if got != want {
                    failures.push(format!("choices({ch}): expected {want:?}, got {got:?}"));
                }
            }
            None => failures.push(format!("choices({ch}): expected Some")),
        }
    }
    if meta.choices(&chapter("ch9")).is_some() {
        failures.push("choices(ch9): expected None".to_owned());
    }
    report(&failures);
}

/// An edit of the fixture's `meta.json`.
type MetaEdit = fn(&mut Value);

/// `Invalid` on `<dir>/meta.json` (the meta index, not a paid chapter's `meta.json`), else a failure line.
fn expect_meta_invalid(
    case: &str,
    dir: &Path,
    refused: Result<ContentError, String>,
) -> Option<String> {
    match refused {
        Ok(ContentError::Invalid { path, .. }) if path == dir.join("meta.json") => None,
        Ok(other) => Some(format!(
            "{case}: expected Invalid on meta.json, got {other}"
        )),
        Err(failure) => Some(failure),
    }
}

/// A meta index naming an ending the story index does not declare refuses the start: in a condition (`truth_found`
/// on `nope`), and as a title key (manor's `endings` with an extra `nope`).
#[tokio::test]
async fn startup_fails_when_meta_names_unknown_ending() {
    let mut failures = Vec::new();
    let cases: [(&str, MetaEdit); 2] = [
        ("truth_found on ending nope", |v| {
            v["stories"]["manor"]["achievements"][0]["when"]["ending"] = json!("nope")
        }),
        ("a manor title for nope", |v| {
            v["stories"]["manor"]["endings"]["nope"] = json!({ "ru": "Нет", "en": "None" })
        }),
    ];
    for (case, edit) in cases {
        let copy = FixtureCopy::new();
        copy.edit_json("meta.json", edit).await;
        let (started, _db) = state_on(copy.path()).await;
        let refused = content_error(case, started);
        failures.extend(expect_meta_invalid(case, copy.path(), refused));
    }
    report(&failures);
}

/// `meta.json` is at most 256 KiB (META-PLAN "Server formats"): the fixture padded with trailing spaces to one byte
/// over refuses the start; padded to exactly the bound, it starts.
#[tokio::test]
async fn startup_fails_when_meta_too_large() {
    let mut failures = Vec::new();
    let text = tokio::fs::read_to_string(Path::new(FIXTURE).join("meta.json"))
        .await
        .unwrap();
    for (case, size, refused) in [
        ("262,145 bytes", 256 * 1024 + 1, true),
        ("262,144 bytes", 256 * 1024, false),
    ] {
        let copy = FixtureCopy::new();
        let padded = format!("{text}{}", " ".repeat(size - text.len()));
        std::fs::write(copy.path().join("meta.json"), &padded).unwrap();
        let (started, _db) = state_on(copy.path()).await;
        if refused {
            let refusal = content_error(case, started);
            failures.extend(expect_meta_invalid(case, copy.path(), refusal));
        } else if let Err(e) = started {
            failures.push(format!("{case}: expected Ok, got {e}"));
        }
    }
    report(&failures);
}

/// The content error `ContentStore::load` refuses `dir` with, or the failure line when it loads.
async fn load_error(case: &str, dir: &Path) -> Result<ContentError, String> {
    match ContentStore::load(dir).await {
        Ok(_) => Err(format!("{case}: expected a content error, got Ok")),
        Err(e) => Ok(e),
    }
}

/// Every other startup rule of the meta index (META-PLAN "Server formats", M4, M5), one edit of the fixture each:
/// the format, the choice vocabulary against the chapter set, the story set both ways, the ending titles, the
/// achievement ids, counts and texts, and every condition kind's rule. A shape the parser refuses is `Json`; a
/// missing file is `Read`.
#[tokio::test]
async fn startup_fails_when_meta_breaks_a_rule() {
    fn manor(v: &mut Value, at: usize) -> &mut Value {
        &mut v["stories"]["manor"]["achievements"][at]
    }
    fn tide(v: &mut Value, at: usize) -> &mut Value {
        &mut v["stories"]["tide"]["achievements"][at]
    }
    // (case, a fragment of the reason its own rule gives, the edit)
    let cases: Vec<(&str, &str, MetaEdit)> = vec![
        ("format 2", "format 2, expected 1", |v| {
            v["format"] = json!(2)
        }),
        (
            "choices without ch4",
            "choices: no entry for chapter ch4",
            |v| {
                v["choices"].as_object_mut().unwrap().remove("ch4");
            },
        ),
        (
            "choices.ch9",
            "choices: ch9 is not a chapter of the story index",
            |v| v["choices"]["ch9"] = json!({}),
        ),
        (
            "option ch1.hall.C001",
            "choices.ch1: an option is not a line ID",
            |v| v["choices"]["ch1"]["ch1.hall.C001"] = json!("ch1.hall.c001"),
        ),
        (
            "option ch2.hall.c001 under ch1",
            "choices.ch1: option ch2.hall.c001 is not of ch1",
            |v| v["choices"]["ch1"]["ch2.hall.c001"] = json!("ch1.hall.c001"),
        ),
        (
            "a point that is no option",
            "choices.ch1: the point of ch1.hall.c002 is not an option of ch1",
            |v| v["choices"]["ch1"]["ch1.hall.c002"] = json!("ch1.hall.c009"),
        ),
        (
            "stories without tide",
            "stories: no entry for story tide",
            |v| {
                v["stories"].as_object_mut().unwrap().remove("tide");
            },
        ),
        (
            "stories.nope",
            "stories: nope is not a story of the index",
            |v| v["stories"]["nope"] = json!({ "endings": {}, "achievements": [] }),
        ),
        (
            "manor endings without ashes",
            "manor: endings: no title for ashes",
            |v| {
                v["stories"]["manor"]["endings"]
                    .as_object_mut()
                    .unwrap()
                    .remove("ashes");
            },
        ),
        (
            "a 41-code-point ending title",
            "manor: ending truth: the ru title",
            |v| v["stories"]["manor"]["endings"]["truth"]["ru"] = json!("я".repeat(41)),
        ),
        (
            "a blank en ending title",
            "tide: ending dawn: the en title",
            |v| v["stories"]["tide"]["endings"]["dawn"]["en"] = json!("   "),
        ),
        (
            "achievement id Bad",
            "manor: achievement 1: the id is not an achievement id",
            |v| manor(v, 0)["id"] = json!("Bad"),
        ),
        (
            "an achievement id of 33 characters",
            "manor: achievement 1: the id is not an achievement id",
            |v| manor(v, 0)["id"] = json!(format!("a{}", "b".repeat(32))),
        ),
        (
            "a duplicate achievement id",
            "manor: achievement truth_found is listed twice",
            |v| manor(v, 1)["id"] = json!("truth_found"),
        ),
        (
            "51 achievements",
            "manor: 51 achievements, at most 50",
            |v| {
                let list = v["stories"]["manor"]["achievements"]
                    .as_array_mut()
                    .unwrap();
                let template = list[5].clone();
                for i in 0..45 {
                    let mut extra = template.clone();
                    extra["id"] = json!(format!("extra_{i}"));
                    list.push(extra);
                }
            },
        ),
        (
            "a 41-code-point name",
            "achievement truth_found: the ru name",
            |v| manor(v, 0)["name"]["ru"] = json!("я".repeat(41)),
        ),
        (
            "a 141-code-point desc",
            "achievement truth_found: the en desc",
            |v| manor(v, 0)["desc"]["en"] = json!("d".repeat(141)),
        ),
        (
            "a blank en name",
            "achievement truth_found: the en name",
            |v| manor(v, 0)["name"]["en"] = json!(" "),
        ),
        (
            "an empty ru desc",
            "achievement truth_found: the ru desc",
            |v| manor(v, 0)["desc"]["ru"] = json!(""),
        ),
        ("hints: 0 beside ending", "hints beside ending", |v| {
            manor(v, 0)["when"]["hints"] = json!(0)
        }),
        ("hints: 1 beside puzzle", "hints 1, expected 0", |v| {
            manor(v, 3)["when"]["hints"] = json!(1)
        }),
        ("endings: 3 on manor", "endings 3 is outside 1 to 2", |v| {
            manor(v, 1)["when"]["endings"] = json!(3)
        }),
        ("endings: 0", "endings 0 is outside 1 to 2", |v| {
            manor(v, 1)["when"]["endings"] = json!(0)
        }),
        ("allEndings: false", "allEndings is not true", |v| {
            manor(v, 2)["when"]["allEndings"] = json!(false)
        }),
        (
            "choice ch3.shore.s001 in manor",
            "choice ch3.shore.s001 is not an option of a chapter of manor",
            |v| manor(v, 5)["when"]["choice"] = json!("ch3.shore.s001"),
        ),
        (
            "choice ch1.hall.c009, no option of ch1",
            "choice ch1.hall.c009 is not an option of a chapter of manor",
            |v| manor(v, 5)["when"]["choice"] = json!("ch1.hall.c009"),
        ),
        (
            "chapter ch3 in manor",
            "chapter ch3 is not on the chain of manor",
            |v| manor(v, 0)["when"] = json!({ "chapter": "ch3" }),
        ),
        (
            "puzzle ch1.nothing",
            "puzzle ch1.nothing is not a puzzle of a chapter of manor",
            |v| manor(v, 3)["when"]["puzzle"] = json!("ch1.nothing"),
        ),
        (
            "puzzle ch1.drawer in tide",
            "puzzle ch1.drawer is not a puzzle of a chapter of tide",
            |v| tide(v, 0)["when"] = json!({ "puzzle": "ch1.drawer" }),
        ),
        ("all with one condition", "all holds 1 conditions", |v| {
            tide(v, 1)["when"] = json!({ "all": [{ "ending": "dawn" }] })
        }),
        ("all with five conditions", "all holds 5 conditions", |v| {
            tide(v, 1)["when"] = json!({ "all": [
                { "ending": "dawn" }, { "ending": "drowned" }, { "chapter": "ch3" },
                { "chapter": "ch4" }, { "choice": "ch3.shore.s002" }
            ] })
        }),
        ("a nested all", "an all inside an all", |v| {
            tide(v, 1)["when"] = json!({ "all": [
                { "ending": "dawn" },
                { "all": [{ "ending": "drowned" }, { "choice": "ch3.shore.s002" }] }
            ] })
        }),
        (
            "two kinds in one condition",
            "the condition has 2 kinds",
            |v| manor(v, 0)["when"] = json!({ "ending": "truth", "chapter": "ch2" }),
        ),
        ("no condition kind", "the condition has 0 kinds", |v| {
            manor(v, 0)["when"] = json!({})
        }),
    ];
    let mut failures = Vec::new();
    for (case, rule, edit) in cases {
        let copy = FixtureCopy::new();
        copy.edit_json("meta.json", edit).await;
        // The reason names the case's own rule: a copy refused by another rule would not prove this one.
        match load_error(case, copy.path()).await {
            Ok(ContentError::Invalid { path, reason })
                if path == copy.path().join("meta.json") && reason.contains(rule) => {}
            Ok(other) => failures.push(format!(
                "{case}: expected Invalid on meta.json naming {rule:?}, got {other}"
            )),
            Err(failure) => failures.push(failure),
        }
    }

    let copy = FixtureCopy::new();
    copy.edit_json("meta.json", |v| {
        manor(v, 0)["when"] = json!({ "ending": "truth", "when": 1 })
    })
    .await;
    let case = "an unknown key in a condition";
    match load_error(case, copy.path()).await {
        Ok(ContentError::Json { path, .. }) if path == copy.path().join("meta.json") => {}
        Ok(other) => failures.push(format!("{case}: expected Json on meta.json, got {other}")),
        Err(failure) => failures.push(failure),
    }

    let copy = FixtureCopy::new();
    copy.remove("meta.json");
    let case = "no meta.json";
    match load_error(case, copy.path()).await {
        Ok(ContentError::Read { path, source })
            if path == copy.path().join("meta.json") && source.kind() == ErrorKind::NotFound => {}
        Ok(other) => failures.push(format!("{case}: expected Read (NotFound), got {other}")),
        Err(failure) => failures.push(failure),
    }
    report(&failures);
}

/// A second player.
const BEN: i64 = 1002;

fn body_text(reply: &common::Reply) -> String {
    String::from_utf8_lossy(&reply.body).into_owned()
}

/// The mismatch of `reply` against a status and the error body `{"error": <code>}`.
fn expect_error(case: &str, reply: &common::Reply, status: u16, code: &str) -> Option<String> {
    let got: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    (reply.status.as_u16() != status || got != json!({ "error": code })).then(|| {
        format!(
            "{case}: expected {status} {code}, got {} {:?}",
            reply.status.as_u16(),
            body_text(reply)
        )
    })
}

/// The header `name` of `reply` as text.
fn header(reply: &common::Reply, name: HeaderName) -> Option<&str> {
    reply.headers.get(name).and_then(|v| v.to_str().ok())
}

/// A paid chapter or a gated asset without its entitlement is a 403 that carries no content; without a token every id
/// is the same 401, so an anonymous caller learns no chapter or file name.
#[tokio::test]
async fn paid_chapter_403_without_entitlement() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    own(&st, BEN, "chapter:ch2").await;
    let mut failures = Vec::new();
    for ch in ["ch2", "ch4"] {
        let reply = get(&st, Some(ANN), &format!("/api/chapters/{ch}")).await;
        failures.extend(expect_error(
            &format!("no rows: {ch}"),
            &reply,
            403,
            "not_entitled",
        ));
    }
    let reply = get(&st, Some(BEN), "/api/chapters/ch4").await;
    failures.extend(expect_error(
        "chapter:ch2 owner: ch4 (another story)",
        &reply,
        403,
        "not_entitled",
    ));
    for (user, file) in [
        (BEN, "bg-lamp_room-4e5f6a7b.avif"),
        (BEN, "bgm-storm-8c9d0e1f.m4a"),
        (ANN, "bg-archive-0a1b2c3d.avif"),
    ] {
        let reply = get(&st, Some(user), &format!("/api/assets/{file}")).await;
        failures.extend(expect_error(
            &format!("user {user}: {file}"),
            &reply,
            403,
            "not_entitled",
        ));
    }
    for path in [
        "/api/chapters/ch2",
        "/api/chapters/ch1",
        "/api/chapters/ch9",
        "/api/assets/bg-archive-0a1b2c3d.avif",
        "/api/assets/bg-orphan-6e7f8a9b.avif",
    ] {
        let reply = get(&st, None, path).await;
        failures.extend(expect_error(
            &format!("no token: {path}"),
            &reply,
            401,
            "token_missing",
        ));
    }
    report(&failures);
}

/// The owner of a chapter gets its files exactly as the build wrote them (`world` is `null` when it has none), and
/// the gated files its manifest names; a file two chapters share opens with either chapter.
#[tokio::test]
async fn paid_chapter_200_with_entitlement() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    own(&st, ANN, "chapter:ch2").await;
    own(&st, BEN, "chapter:ch4").await;
    let mut failures = Vec::new();
    for (user, ch, version, has_world) in [
        (ANN, "ch2", "c2c2c2c2c2c2c2c2", true),
        (BEN, "ch4", "c4c4c4c4c4c4c4c4", false),
    ] {
        let case = format!("chapter:{ch} owner: {ch}");
        let reply = get(&st, Some(user), &format!("/api/chapters/{ch}")).await;
        if reply.status.as_u16() != 200 {
            failures.push(format!(
                "{case}: expected 200, got {} {:?}",
                reply.status.as_u16(),
                body_text(&reply)
            ));
            continue;
        }
        let got: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
        let dir = Path::new(FIXTURE).join("chapters").join(ch);
        let mut want = json!({ "chapterId": ch, "storyVersion": version, "world": null });
        for key in ["story", "meta", "assets", "en"] {
            want[key] = read_json(&dir.join(format!("{key}.json"))).await;
        }
        if has_world {
            want["world"] = read_json(&dir.join("world.json")).await;
        }
        for key in [
            "chapterId",
            "storyVersion",
            "story",
            "meta",
            "assets",
            "en",
            "world",
        ] {
            if got.get(key) != want.get(key) {
                failures.push(format!(
                    "{case}: {key}: expected {:?}, got {:?}",
                    want.get(key),
                    got.get(key)
                ));
            }
        }
        if got.as_object().map(|o| o.len()) != Some(7) {
            failures.push(format!("{case}: expected exactly the 7 payload keys"));
        }
    }
    for (user, file, content_type) in [
        (ANN, "bg-archive-0a1b2c3d.avif", "image/avif"),
        (ANN, "bg-archive-0a1b2c3d.webp", "image/webp"),
        (ANN, "sfx-door-2a3b4c5d.m4a", "audio/mp4"),
        (BEN, "sfx-door-2a3b4c5d.m4a", "audio/mp4"),
        (BEN, "bg-lamp_room-4e5f6a7b.webp", "image/webp"),
        (BEN, "bgm-storm-8c9d0e1f.m4a", "audio/mp4"),
    ] {
        let reply = get(&st, Some(user), &format!("/api/assets/{file}")).await;
        let want = tokio::fs::read(Path::new(FIXTURE).join("assets").join(file))
            .await
            .unwrap();
        let got_type = header(&reply, CONTENT_TYPE);
        if reply.status.as_u16() != 200
            || reply.body.as_ref() != want.as_slice()
            || got_type != Some(content_type)
        {
            failures.push(format!(
                "user {user}: {file}: expected 200 {content_type} with the fixture bytes, got {} {got_type:?} {:?}",
                reply.status.as_u16(),
                body_text(&reply)
            ));
        }
    }
    report(&failures);
}

/// Free chapters are static files of the client build: the API answers them, unknown ids and malformed ids alike
/// with 404, even to a player who owns every paid chapter.
#[tokio::test]
async fn free_chapter_not_served_by_api() {
    let (st, _db) = state_with_users(&[ANN]).await;
    own(&st, ANN, "chapter:ch2").await;
    own(&st, ANN, "chapter:ch4").await;
    let mut failures = Vec::new();
    for id in ["ch1", "ch3", "ch9", "Ch2", "ch02", "..%2Fstories.json"] {
        let reply = get(&st, Some(ANN), &format!("/api/chapters/{id}")).await;
        failures.extend(expect_error(
            &format!("chapter {id}"),
            &reply,
            404,
            "not_found",
        ));
    }
    for ch in ["ch2", "ch4"] {
        let reply = get(&st, Some(ANN), &format!("/api/chapters/{ch}")).await;
        if reply.status.as_u16() != 200 {
            failures.push(format!(
                "control {ch}: expected 200, got {}",
                reply.status.as_u16()
            ));
        }
    }
    report(&failures);
}

/// An asset name is a key of the index built at startup, never a path: every traversal, case or encoding form, a
/// file no manifest names, a public asset and the server's own files are 404 with no content.
#[tokio::test]
async fn asset_path_traversal_404() {
    let (st, _db) = state_with_users(&[ANN]).await;
    own(&st, ANN, "chapter:ch2").await;
    own(&st, ANN, "chapter:ch4").await;
    let mut failures = Vec::new();
    for name in [
        "..%2Fstories.json",
        "%2e%2e%2fstories.json",
        "..%5Cstories.json",
        "chapters%2Fch2%2Fstory.json",
        "puzzles%2Fch1.json",
        "..%2F..%2Fcatalog.json",
        "%2Fetc%2Fpasswd",
        "stories.json",
        "bg-orphan-6e7f8a9b.avif",
        "BG-ARCHIVE-0A1B2C3D.AVIF",
        "bgm-hall-0e0e0e0e.m4a",
    ] {
        let reply = get(&st, Some(ANN), &format!("/api/assets/{name}")).await;
        failures.extend(expect_error(
            &format!("asset {name}"),
            &reply,
            404,
            "not_found",
        ));
    }
    // Two segments never match the one-segment route: the router's own 404.
    let reply = get(&st, Some(ANN), "/api/assets/../stories.json").await;
    if reply.status.as_u16() != 404 || body_text(&reply).contains("FIXTURE") {
        failures.push(format!(
            "raw /api/assets/../stories.json: expected 404 without content, got {} {:?}",
            reply.status.as_u16(),
            body_text(&reply)
        ));
    }
    let reply = get(&st, Some(ANN), "/api/assets/bg-archive-0a1b2c3d.avif").await;
    if reply.status.as_u16() != 200 {
        failures.push(format!(
            "control bg-archive-0a1b2c3d.avif: expected 200, got {}",
            reply.status.as_u16()
        ));
    }
    report(&failures);
}

/// Paid 200s say `private, no-store` and `nosniff` themselves; the 403 and 404 answers keep the api layer's
/// `no-store`.
#[tokio::test]
async fn paid_responses_private_no_store() {
    let (st, _db) = state_with_users(&[ANN]).await;
    own(&st, ANN, "chapter:ch2").await;
    let mut failures = Vec::new();
    for (path, content_type) in [
        ("/api/chapters/ch2", "application/json"),
        ("/api/assets/bg-archive-0a1b2c3d.avif", "image/avif"),
    ] {
        let reply = get(&st, Some(ANN), path).await;
        let got = (
            reply.status.as_u16(),
            header(&reply, CACHE_CONTROL),
            header(&reply, X_CONTENT_TYPE_OPTIONS),
            header(&reply, CONTENT_TYPE),
        );
        let want = (
            200,
            Some("private, no-store"),
            Some("nosniff"),
            Some(content_type),
        );
        if got != want {
            failures.push(format!("{path}: expected {want:?}, got {got:?}"));
        }
    }
    for (path, status) in [
        ("/api/chapters/ch4", 403),
        ("/api/assets/bg-lamp_room-4e5f6a7b.avif", 403),
        ("/api/chapters/ch1", 404),
        ("/api/assets/bg-orphan-6e7f8a9b.avif", 404),
    ] {
        let reply = get(&st, Some(ANN), path).await;
        let got = (reply.status.as_u16(), header(&reply, CACHE_CONTROL));
        if got != (status, Some("no-store")) {
            failures.push(format!(
                "{path}: expected ({status}, no-store), got {got:?}"
            ));
        }
    }
    report(&failures);
}

/// The production router has no dev route: `server-dev`'s routes (launch, simulated payments) answer 404 here.
#[tokio::test]
async fn server_has_no_dev_routes() {
    let (st, _db) = common::test_state().await;
    let mut failures = Vec::new();
    for (method, path) in [
        ("GET", "/dev/launch?uid=1001"),
        ("GET", "/dev/invoices/x"),
        ("POST", "/dev/simulate-payment"),
        ("POST", "/dev/refund"),
        ("POST", "/dev/refunded-update"),
    ] {
        let req = Request::builder()
            .method(method)
            .uri(path)
            .body(Body::empty())
            .unwrap();
        let reply = common::call(&st, req).await;
        if reply.status.as_u16() != 404 {
            failures.push(format!(
                "{method} {path}: expected 404, got {}",
                reply.status.as_u16()
            ));
        }
    }
    let reply = common::call(
        &st,
        Request::get("/api/health").body(Body::empty()).unwrap(),
    )
    .await;
    if reply.status.as_u16() != 200 || body_text(&reply) != "ok" {
        failures.push(format!(
            "control GET /api/health: expected 200 ok, got {}",
            reply.status.as_u16()
        ));
    }
    report(&failures);
}
