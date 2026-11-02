//! The server's content, loaded once from `CONTENT_DIR` in `AppState::new`: the story index (`stories.json`), the
//! paid chapters (`chapters/<ch>/`), the puzzle index (`puzzles/<ch>.json`), the gated asset index (`assets/`) and
//! the meta index (`meta.json`: ending titles, achievements, the choice vocabulary; its rules live in `meta.rs`).
//!
//! Principle 0: paid chapter JSON, paid worlds, puzzle solutions and meta texts live here and leave only through
//! routes that check an entitlement first. No paid type derives `Debug`, so none of them reaches a log line, and a [`ContentError`]
//! names paths and ids, never what a file holds. A load that does not fully succeed is a refusal to start, never a
//! server that sells a chapter it cannot serve.
//!
//! Only what the story index names is read: a free chapter's directory, a chapter directory the index does not list
//! and `build/` are never loaded, so no route can serve them.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde::de::{DeserializeOwned, IgnoredAny};
use serde_json::value::RawValue;

use crate::ids::{ChapterId, ProductId, PuzzleId, StoryId, is_local_id};
use crate::meta::{MetaFile, MetaIndex};

/// The most hint tiers a puzzle has (PUZZLES-PLAN X18); a puzzle may have none (the producer's `HintTiers` is
/// `0 | 1 | 2 | 3`).
pub const MAX_HINT_TIERS: usize = 3;

/// The largest `meta.json`, in bytes (META-PLAN "Server formats"; the story tool's mirror checks the same bound).
pub const META_MAX_BYTES: usize = 256 * 1024;

/// Why the content could not be loaded. Each text names a path, an id or a count, never file contents.
#[derive(Debug, thiserror::Error)]
pub enum ContentError {
    /// A file that must exist could not be read (or is not a regular file).
    #[error("cannot read {}: {source}", .path.display())]
    Read {
        /// The file.
        path: PathBuf,
        /// The I/O error.
        source: io::Error,
    },
    /// A file is not the JSON its format expects.
    #[error("{}: not the expected JSON: {fault}", .path.display())]
    Json {
        /// The file.
        path: PathBuf,
        /// Where the parse failed.
        fault: JsonFault,
    },
    /// A file parsed but breaks a rule of its format.
    #[error("{}: {reason}", .path.display())]
    Invalid {
        /// The file.
        path: PathBuf,
        /// The rule it breaks, with ids only.
        reason: String,
    },
    /// A story whose first chapter is paid: a story is always started for free (STORIES-PLAN ST2).
    #[error("story {story}: its first chapter {chapter} is paid")]
    FirstChapterPaid {
        /// The story id.
        story: String,
        /// Its first chapter.
        chapter: String,
    },
    /// A rendered invoice text outside Telegram's limits.
    #[error("{product}: the {lang} invoice {field} has {chars} characters, outside {min}..={max}")]
    InvoiceText {
        /// The product id.
        product: String,
        /// `ru` or `en`.
        lang: &'static str,
        /// `title` or `description`.
        field: &'static str,
        /// The rendered text's length in code points.
        chars: usize,
        /// The smallest length allowed.
        min: usize,
        /// The largest length allowed.
        max: usize,
    },
    /// A `priceStars` key of `server/catalog.json` that is not a paid chapter of the story index.
    #[error("price override for {chapter}: not a paid chapter of the story index")]
    PriceOverride {
        /// The key.
        chapter: String,
    },
    /// `server/catalog.json` itself is not valid. The text may quote the catalog, which is in git and holds no paid
    /// content.
    #[error("server/catalog.json: {0}")]
    Catalog(String),
}

/// Where a JSON parse failed, without the text there: serde_json's own message quotes input values (a hint, a
/// solution, a paid line), and a startup error is logged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JsonFault {
    /// `syntax`, `data` (valid JSON, wrong shape), `eof` or `io`.
    pub category: &'static str,
    /// The line, from 1.
    pub line: usize,
    /// The column, from 1.
    pub column: usize,
}

impl JsonFault {
    fn of(e: &serde_json::Error) -> JsonFault {
        let category = match e.classify() {
            serde_json::error::Category::Io => "io",
            serde_json::error::Category::Syntax => "syntax",
            serde_json::error::Category::Data => "data",
            serde_json::error::Category::Eof => "eof",
        };
        JsonFault {
            category,
            line: e.line(),
            column: e.column(),
        }
    }
}

impl fmt::Display for JsonFault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} error at line {}, column {}",
            self.category, self.line, self.column
        )
    }
}

/// A player-facing text in both languages.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Localized {
    /// Russian, the primary language.
    pub ru: String,
    /// English.
    pub en: String,
}

/// A story of the index.
#[derive(Debug, Clone)]
pub struct StoryDef {
    /// The story id.
    pub id: StoryId,
    /// The story title.
    pub title: Localized,
    /// The chapters in chain order; the first one is free.
    pub chapters: Vec<StoryChapter>,
    /// Ending name -> the chapter of this story it is reached in.
    pub endings: BTreeMap<String, ChapterId>,
}

/// A chapter of a story.
#[derive(Debug, Clone)]
pub struct StoryChapter {
    /// The chapter id, unique across all stories.
    pub id: ChapterId,
    /// Whether the chapter is sold.
    pub paid: bool,
    /// `chapter:<id>` for a paid chapter, `None` for a free one.
    pub product: Option<ProductId>,
    /// The chapter title (a paid chapter's invoice title).
    pub title: Localized,
}

/// A puzzle of the index: what the server checks answers against. No `Debug`: it holds the solution and the hint
/// texts, which are sold.
pub struct PuzzleDef {
    /// `<chapter>.<local>`.
    pub id: PuzzleId,
    /// The chapter the puzzle is in.
    pub chapter: ChapterId,
    /// The answer's length.
    pub answer_len: usize,
    /// The largest value of an answer entry.
    pub answer_max: u16,
    /// The solution, `answer_len` values, each at most `answer_max`.
    pub solution: Vec<u16>,
    /// The puzzle title.
    pub title: Localized,
    /// The hint texts, tier 1 first; at most [`MAX_HINT_TIERS`].
    pub hints: Vec<Localized>,
}

/// A paid chapter's files as the build wrote them, held raw. No `Debug`: this is the sold content.
pub struct PaidChapter {
    /// The chapter id.
    pub id: ChapterId,
    /// `chapter:<id>`, the product that unlocks it.
    pub product: ProductId,
    /// `meta.json`'s `storyVersion`: 16 lower-case hex characters.
    pub story_version: String,
    /// `story.json`, the compiled ink.
    pub story: Box<RawValue>,
    /// `meta.json`.
    pub meta: Box<RawValue>,
    /// `assets.json`, the chapter's asset manifest.
    pub assets: Box<RawValue>,
    /// `en.json`, the English line table.
    pub en: Box<RawValue>,
    /// `world.json`, the public world of the chapter, when it has one.
    pub world: Option<Box<RawValue>>,
}

/// A gated asset file: one a paid chapter's manifest names under `/api/assets/`.
#[derive(Debug, Clone)]
pub struct AssetFile {
    /// `<content dir>/assets/<file>`, proven a regular file at startup.
    pub path: PathBuf,
    /// The `Content-Type` it is served with.
    pub content_type: &'static str,
    /// The chapter products whose manifests name it: any one of them unlocks it.
    pub owners: Vec<ProductId>,
}

/// Everything the content directory holds that the server serves or checks. Immutable for the process lifetime: a
/// new build needs a restart. No `Debug`: it holds the paid content.
pub struct ContentStore {
    stories: Vec<StoryDef>,
    story_of: HashMap<ChapterId, usize>,
    paid: HashMap<ChapterId, PaidChapter>,
    puzzles: Vec<PuzzleDef>,
    puzzle_at: HashMap<PuzzleId, usize>,
    assets: HashMap<String, AssetFile>,
    meta: MetaIndex,
}

impl ContentStore {
    /// Loads and checks the content under `dir`: the story index (required), every paid chapter's files (required:
    /// `story`, `meta`, `assets`, `en`; optional: `world`), each gated asset its manifest names (required), the
    /// puzzle index (optional: no `puzzles/` directory, or no file for a chapter, means no puzzles there), and last
    /// the meta index (required).
    pub async fn load(dir: &Path) -> Result<ContentStore, ContentError> {
        let stories = load_index(dir).await?;
        let mut story_of = HashMap::new();
        for (at, story) in stories.iter().enumerate() {
            for chapter in &story.chapters {
                story_of.insert(chapter.id.clone(), at);
            }
        }
        let mut paid = HashMap::new();
        let mut assets = HashMap::new();
        for chapter in stories.iter().flat_map(|story| &story.chapters) {
            if let Some(product) = &chapter.product {
                let loaded = load_paid_chapter(dir, &chapter.id, product).await?;
                index_assets(dir, &loaded, &mut assets).await?;
                paid.insert(chapter.id.clone(), loaded);
            }
        }
        let puzzles = load_puzzles(dir, &stories).await?;
        let puzzle_at = puzzles
            .iter()
            .enumerate()
            .map(|(at, puzzle)| (puzzle.id.clone(), at))
            .collect();
        let meta = load_meta(dir, &stories, &puzzles).await?;
        Ok(ContentStore {
            stories,
            story_of,
            paid,
            puzzles,
            puzzle_at,
            assets,
            meta,
        })
    }

    /// The stories in index order.
    pub fn stories(&self) -> &[StoryDef] {
        &self.stories
    }

    /// The story `id` names.
    pub fn story(&self, id: &StoryId) -> Option<&StoryDef> {
        self.stories.iter().find(|story| &story.id == id)
    }

    /// The story chapter `ch` belongs to.
    pub fn story_of(&self, ch: &ChapterId) -> Option<&StoryDef> {
        self.story_of.get(ch).and_then(|&at| self.stories.get(at))
    }

    /// The paid chapter `ch`; `None` for a free or unknown chapter (free chapters are static files of the client).
    pub fn paid_chapter(&self, ch: &ChapterId) -> Option<&PaidChapter> {
        self.paid.get(ch)
    }

    /// The public world of the paid chapter `ch`, when it has one (a free chapter's world is a static file).
    pub fn chapter_world(&self, ch: &ChapterId) -> Option<&RawValue> {
        self.paid.get(ch)?.world.as_deref()
    }

    /// The puzzle `id` names.
    pub fn puzzle(&self, id: &PuzzleId) -> Option<&PuzzleDef> {
        self.puzzle_at.get(id).and_then(|&at| self.puzzles.get(at))
    }

    /// Every puzzle: story order, chain order, then local id order.
    pub fn puzzles(&self) -> &[PuzzleDef] {
        &self.puzzles
    }

    /// The gated asset with exactly this file name: the only asset lookup, so a request never becomes a path.
    pub fn asset(&self, file: &str) -> Option<&AssetFile> {
        self.assets.get(file)
    }

    /// The meta index: ending titles, achievements and the choice vocabulary.
    pub fn meta(&self) -> &MetaIndex {
        &self.meta
    }
}

/// `stories.json` as the story tool writes it (STORIES-PLAN "Server formats"); the fixture is the contract.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IndexFile {
    format: u32,
    stories: Vec<IndexStory>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IndexStory {
    id: String,
    title: Localized,
    chapters: Vec<IndexChapter>,
    endings: BTreeMap<String, IndexEnding>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct IndexChapter {
    id: String,
    paid: bool,
    product_id: Option<String>,
    title: Localized,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IndexEnding {
    chapter: String,
}

/// The fields of `meta.json` the server reads; the rest stays opaque.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetaProbe {
    chapter_id: String,
    story_version: String,
}

/// The fields of `assets.json` the server reads: each asset's file URLs.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetsProbe {
    chapter_id: String,
    assets: BTreeMap<String, AssetProbe>,
}

#[derive(Deserialize)]
struct AssetProbe {
    avif: Option<UrlProbe>,
    webp: Option<UrlProbe>,
    file: Option<UrlProbe>,
}

#[derive(Deserialize)]
struct UrlProbe {
    url: String,
}

/// The keys of each puzzle of a public `world.json`.
#[derive(Deserialize)]
struct WorldProbe {
    #[serde(default)]
    puzzles: BTreeMap<String, BTreeMap<String, IgnoredAny>>,
}

/// `puzzles/<ch>.json` as the story tool writes it (PUZZLES-PLAN "Server formats"); the fixture is the contract.
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PuzzleFile {
    format: u32,
    chapter_id: String,
    puzzles: BTreeMap<String, PuzzleEntry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PuzzleEntry {
    // Checked, not kept: the answer check is type-agnostic, but an unknown type is a producer the server predates.
    #[serde(rename = "type")]
    _kind: PuzzleKind,
    answer_len: usize,
    answer_max: u16,
    solution: Vec<u16>,
    title: Localized,
    hints: Vec<Localized>,
}

/// The puzzle types of the client's rules (`client/src/puzzles/rules/`).
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum PuzzleKind {
    Code,
    Order,
}

/// The server-only keys of a puzzle, which a public world must not carry (PUZZLES-PLAN X5, X7).
const SERVER_ONLY_PUZZLE_KEYS: [&str; 2] = ["solution", "hints"];

fn invalid(path: &Path, reason: impl Into<String>) -> ContentError {
    ContentError::Invalid {
        path: path.to_path_buf(),
        reason: reason.into(),
    }
}

async fn read_text(path: &Path) -> Result<String, ContentError> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|source| ContentError::Read {
            path: path.to_path_buf(),
            source,
        })?;
    String::from_utf8(bytes).map_err(|_| invalid(path, "not UTF-8"))
}

fn parse<T: DeserializeOwned>(path: &Path, text: &str) -> Result<T, ContentError> {
    serde_json::from_str(text).map_err(|e| ContentError::Json {
        path: path.to_path_buf(),
        fault: JsonFault::of(&e),
    })
}

/// A required JSON file, kept as its text.
async fn raw_file(path: &Path) -> Result<Box<RawValue>, ContentError> {
    parse(path, &read_text(path).await?)
}

/// `^[a-z][a-z0-9_]{0,31}$` (STORIES-PLAN `EndingName`; also an achievement id, META-PLAN M4): the one copy the
/// story index, the meta index and the stats route check against.
pub(crate) fn is_ending_name(s: &str) -> bool {
    s.len() <= 32 && is_local_id(s)
}

/// `^[0-9a-f]{16}$`: the first 16 hex characters of the story's sha256 (`meta.json` here, a stats event's
/// `storyVersion` in `api/stats.rs`).
pub(crate) fn is_story_version(s: &str) -> bool {
    s.len() == 16 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// A line ID, `^ch[1-9][0-9]*\.[a-z][a-z0-9_]*\.[0-9a-z]{4}$` (STAGING-DSL §4): the owning chapter, the knot part
/// and a four-character suffix. A meta option key and a stats `choice_made` subject.
pub(crate) fn is_line_id(s: &str) -> bool {
    let mut parts = s.split('.');
    let (Some(chapter), Some(knot), Some(suffix), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    ChapterId::parse(chapter).is_some()
        && is_local_id(knot)
        && suffix.len() == 4
        && suffix
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// The `Content-Type` of a gated asset file name `^[a-z0-9][a-z0-9_-]*\.(avif|webp|m4a|wav)$`
/// (`<kind>-<id>-<hash8>.<ext>`); `None` for any other name. No `/`, `\` or `.` before the extension, so a manifest
/// cannot point the route outside `assets/`.
fn gated_asset_type(name: &str) -> Option<&'static str> {
    let (stem, ext) = name.rsplit_once('.')?;
    let content_type = match ext {
        "avif" => "image/avif",
        "webp" => "image/webp",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        _ => return None,
    };
    let (first, rest) = stem.as_bytes().split_first()?;
    let name_ok = (first.is_ascii_lowercase() || first.is_ascii_digit())
        && rest
            .iter()
            .all(|&b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-');
    name_ok.then_some(content_type)
}

async fn load_index(dir: &Path) -> Result<Vec<StoryDef>, ContentError> {
    let path = dir.join("stories.json");
    let file: IndexFile = parse(&path, &read_text(&path).await?)?;
    if file.format != 1 {
        return Err(invalid(
            &path,
            format!("format {}, expected 1", file.format),
        ));
    }
    if file.stories.is_empty() {
        return Err(invalid(&path, "no story"));
    }
    let mut story_ids = HashSet::new();
    let mut chapter_ids = HashSet::new();
    let mut stories = Vec::with_capacity(file.stories.len());
    for entry in file.stories {
        let id = StoryId::parse(&entry.id)
            .ok_or_else(|| invalid(&path, format!("story id {:?} is not a story id", entry.id)))?;
        if !story_ids.insert(id.clone()) {
            return Err(invalid(&path, format!("story {} is listed twice", id.0)));
        }
        let mut chapters = Vec::with_capacity(entry.chapters.len());
        for c in entry.chapters {
            let ch = ChapterId::parse(&c.id).ok_or_else(|| {
                invalid(
                    &path,
                    format!("story {}: {:?} is not a chapter id", id.0, c.id),
                )
            })?;
            // Chapter ids are unique across all stories (STORIES-PLAN Y1): puzzle and product ids rely on it.
            if !chapter_ids.insert(ch.clone()) {
                return Err(invalid(&path, format!("chapter {} is listed twice", ch.0)));
            }
            let product = match (c.paid, c.product_id) {
                (false, None) => None,
                (true, Some(product)) if product == format!("chapter:{}", ch.0) => {
                    Some(ProductId(product))
                }
                (true, Some(_)) => {
                    return Err(invalid(
                        &path,
                        format!(
                            "chapter {}: a paid chapter's productId must be chapter:{}",
                            ch.0, ch.0
                        ),
                    ));
                }
                (paid, _) => {
                    return Err(invalid(
                        &path,
                        format!(
                            "chapter {}: paid is {paid} but productId says otherwise",
                            ch.0
                        ),
                    ));
                }
            };
            chapters.push(StoryChapter {
                id: ch,
                paid: c.paid,
                product,
                title: c.title,
            });
        }
        match chapters.first() {
            None => return Err(invalid(&path, format!("story {} has no chapter", id.0))),
            Some(first) if first.paid => {
                return Err(ContentError::FirstChapterPaid {
                    story: id.0,
                    chapter: first.id.0.clone(),
                });
            }
            Some(_) => {}
        }
        let mut endings = BTreeMap::new();
        for (name, ending) in entry.endings {
            if !is_ending_name(&name) {
                return Err(invalid(
                    &path,
                    format!("story {}: {name:?} is not an ending name", id.0),
                ));
            }
            let Some(chapter) = chapters.iter().find(|c| c.id.0 == ending.chapter) else {
                return Err(invalid(
                    &path,
                    format!(
                        "story {}: ending {name}'s chapter is not on its chain",
                        id.0
                    ),
                ));
            };
            endings.insert(name, chapter.id.clone());
        }
        stories.push(StoryDef {
            id,
            title: entry.title,
            chapters,
            endings,
        });
    }
    Ok(stories)
}

async fn load_paid_chapter(
    dir: &Path,
    id: &ChapterId,
    product: &ProductId,
) -> Result<PaidChapter, ContentError> {
    let base = dir.join("chapters").join(&id.0);
    let story = raw_file(&base.join("story.json")).await?;
    let meta_path = base.join("meta.json");
    let meta = raw_file(&meta_path).await?;
    let assets = raw_file(&base.join("assets.json")).await?;
    let en = raw_file(&base.join("en.json")).await?;
    let world_path = base.join("world.json");
    let world = match tokio::fs::try_exists(&world_path).await {
        Ok(false) => None,
        Ok(true) => Some(raw_file(&world_path).await?),
        Err(source) => {
            return Err(ContentError::Read {
                path: world_path,
                source,
            });
        }
    };

    let probe: MetaProbe = parse(&meta_path, meta.get())?;
    if probe.chapter_id != id.0 {
        return Err(invalid(&meta_path, format!("chapterId is not {}", id.0)));
    }
    if !is_story_version(&probe.story_version) {
        return Err(invalid(
            &meta_path,
            "storyVersion is not 16 lower-case hex characters",
        ));
    }
    if let Some(world) = &world {
        // A public world with the server half would make every hint of an owned chapter free (PUZZLES-PLAN X5, X7).
        let keys: WorldProbe = parse(&world_path, world.get())?;
        for (local, puzzle) in &keys.puzzles {
            if let Some(key) = SERVER_ONLY_PUZZLE_KEYS
                .iter()
                .find(|key| puzzle.contains_key(**key))
            {
                return Err(invalid(
                    &world_path,
                    format!("puzzle {local} carries the server-only {key}"),
                ));
            }
        }
    }
    Ok(PaidChapter {
        id: id.clone(),
        product: product.clone(),
        story_version: probe.story_version,
        story,
        meta,
        assets,
        en,
        world,
    })
}

/// Adds the gated files `chapter`'s manifest names to `assets`, each owned by the chapter's product. A public URL
/// (`/assets/<file>`) is a static file of the client build and is skipped.
async fn index_assets(
    dir: &Path,
    chapter: &PaidChapter,
    assets: &mut HashMap<String, AssetFile>,
) -> Result<(), ContentError> {
    let path = dir.join("chapters").join(&chapter.id.0).join("assets.json");
    let manifest: AssetsProbe = parse(&path, chapter.assets.get())?;
    // A manifest written into another chapter's directory would hand that chapter's buyers these files.
    if manifest.chapter_id != chapter.id.0 {
        return Err(invalid(&path, format!("chapterId is not {}", chapter.id.0)));
    }
    for (asset, entry) in &manifest.assets {
        for url in [&entry.avif, &entry.webp, &entry.file]
            .into_iter()
            .flatten()
        {
            if url.url.starts_with("/assets/") {
                continue;
            }
            let Some(name) = url.url.strip_prefix("/api/assets/") else {
                return Err(invalid(
                    &path,
                    format!(
                        "asset {asset}: a URL is neither /assets/<file> nor /api/assets/<file>"
                    ),
                ));
            };
            let Some(content_type) = gated_asset_type(name) else {
                return Err(invalid(
                    &path,
                    format!("asset {asset}: {name:?} is not a gated asset file name"),
                ));
            };
            let file = dir.join("assets").join(name);
            match tokio::fs::symlink_metadata(&file).await {
                Ok(meta) if meta.is_file() => {}
                Ok(_) => {
                    return Err(ContentError::Read {
                        path: file,
                        source: io::Error::other("not a regular file"),
                    });
                }
                Err(source) => return Err(ContentError::Read { path: file, source }),
            }
            let indexed = assets.entry(name.to_owned()).or_insert_with(|| AssetFile {
                path: file,
                content_type,
                owners: Vec::new(),
            });
            if !indexed.owners.contains(&chapter.product) {
                indexed.owners.push(chapter.product.clone());
            }
        }
    }
    Ok(())
}

/// The meta index `meta.json` (required): at most [`META_MAX_BYTES`], checked before it is parsed, then its rules
/// against the story and puzzle indexes (`meta.rs`). Read last, so every earlier file keeps its own refusal.
async fn load_meta(
    dir: &Path,
    stories: &[StoryDef],
    puzzles: &[PuzzleDef],
) -> Result<MetaIndex, ContentError> {
    let path = dir.join("meta.json");
    let text = read_text(&path).await?;
    if text.len() > META_MAX_BYTES {
        return Err(invalid(
            &path,
            format!("{} bytes, at most {META_MAX_BYTES}", text.len()),
        ));
    }
    let file: MetaFile = parse(&path, &text)?;
    MetaIndex::build(file, stories, puzzles).map_err(|reason| invalid(&path, reason))
}

/// The puzzle index: `puzzles/<ch>.json` for chapters of the index, in story and chain order. A `.json` file named
/// after no chapter of the index is refused: the story tool and the index disagree about the chapter set.
async fn load_puzzles(dir: &Path, stories: &[StoryDef]) -> Result<Vec<PuzzleDef>, ContentError> {
    let puzzles_dir = dir.join("puzzles");
    let mut entries = match tokio::fs::read_dir(&puzzles_dir).await {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(source) => {
            return Err(ContentError::Read {
                path: puzzles_dir,
                source,
            });
        }
    };
    let chapters: HashSet<&str> = stories
        .iter()
        .flat_map(|story| &story.chapters)
        .map(|chapter| chapter.id.0.as_str())
        .collect();
    let mut files = HashSet::new();
    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(source) => {
                return Err(ContentError::Read {
                    path: puzzles_dir,
                    source,
                });
            }
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(stem) = name.strip_suffix(".json") else {
            continue;
        };
        if !chapters.contains(stem) {
            return Err(invalid(&entry.path(), "not a chapter of the story index"));
        }
        files.insert(stem.to_owned());
    }

    let mut puzzles = Vec::new();
    for chapter in stories.iter().flat_map(|story| &story.chapters) {
        if files.contains(&chapter.id.0) {
            let path = puzzles_dir.join(format!("{}.json", chapter.id.0));
            load_puzzle_file(&path, &chapter.id, &mut puzzles).await?;
        }
    }
    Ok(puzzles)
}

async fn load_puzzle_file(
    path: &Path,
    chapter: &ChapterId,
    puzzles: &mut Vec<PuzzleDef>,
) -> Result<(), ContentError> {
    let file: PuzzleFile = parse(path, &read_text(path).await?)?;
    if file.format != 1 {
        return Err(invalid(path, format!("format {}, expected 1", file.format)));
    }
    if file.chapter_id != chapter.0 {
        return Err(invalid(path, format!("chapterId is not {}", chapter.0)));
    }
    for (local, entry) in file.puzzles {
        let Some(id) = PuzzleId::parse(&format!("{}.{local}", chapter.0)) else {
            return Err(invalid(path, format!("{local:?} is not a puzzle id")));
        };
        let rule = if entry.answer_len == 0 || entry.solution.len() != entry.answer_len {
            Some("the solution's length must be answerLen, at least 1")
        } else if entry.solution.iter().any(|&v| v > entry.answer_max) {
            Some("a solution value is above answerMax")
        } else if entry.hints.len() > MAX_HINT_TIERS {
            Some("more than 3 hints")
        } else if [&entry.title]
            .into_iter()
            .chain(&entry.hints)
            .any(|text| text.ru.is_empty() || text.en.is_empty())
        {
            Some("an empty title or hint text")
        } else {
            None
        };
        if let Some(rule) = rule {
            return Err(invalid(path, format!("puzzle {}: {rule}", id.0)));
        }
        puzzles.push(PuzzleDef {
            id,
            chapter: chapter.clone(),
            answer_len: entry.answer_len,
            answer_max: entry.answer_max,
            solution: entry.solution,
            title: entry.title,
            hints: entry.hints,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ending-name, story-version and line-ID grammars, held here once for the story index, the meta index and
    /// the stats route (`api/stats.rs`): the shapes `stats_malformed_event_400` refuses, and the meta option keys.
    #[test]
    fn grammars_shared_with_stats() {
        let longest_name = format!("a{}", "b".repeat(31));
        let long_name = "d".repeat(33);
        type Table<'a> = (&'a str, fn(&str) -> bool, Vec<&'a str>, Vec<&'a str>);
        let tables: [Table<'_>; 3] = [
            (
                "is_ending_name",
                is_ending_name,
                vec!["truth", "drowned", "a", "a_1", "a9", longest_name.as_str()],
                vec![
                    "",
                    "Truth",
                    "1a",
                    "_a",
                    "a-b",
                    "a.b",
                    "a b",
                    "\u{e9}",
                    long_name.as_str(),
                ],
            ),
            (
                "is_story_version",
                is_story_version,
                vec!["0123456789abcdef", "c2c2c2c2c2c2c2c2"],
                vec![
                    "",
                    "ABC",
                    "0123456789ABCDEF",
                    "0123456789abcde",
                    "0123456789abcdef0",
                    "0123456789abcdeg",
                ],
            ),
            (
                "is_line_id",
                is_line_id,
                vec!["ch1.hall.c001", "ch3.shore.s001", "ch12.a_b.0z9y"],
                vec![
                    "",
                    "ch3.shore",
                    "ch3.shore.S001",
                    "ch3.shore.s01",
                    "ch3.shore.s0011",
                    "ch1.hall.C001",
                    "ch0.hall.c001",
                    "ch01.hall.c001",
                    "ch1.Hall.c001",
                    "ch1.hall.c001.x",
                    "hall.c001",
                    "ch1..c001",
                    "ch1.hall.c0-1",
                ],
            ),
        ];
        let mut failures = Vec::new();
        for (name, grammar, ok, bad) in &tables {
            for s in ok {
                if !grammar(s) {
                    failures.push(format!("{name}({s:?}): expected true"));
                }
            }
            for s in bad {
                if grammar(s) {
                    failures.push(format!("{name}({s:?}): expected false"));
                }
            }
        }
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}
