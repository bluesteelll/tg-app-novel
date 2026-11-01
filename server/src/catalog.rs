//! The product catalog: every paid chapter of the story index, priced and given its invoice texts by
//! `server/catalog.json`, and the packs and resource rules of its `economy` section (META-PLAN M17). Built once in
//! `AppState::new`; a catalog that does not fit the index, or whose economy section breaks a rule, is a refusal to
//! start.
//!
//! Principle 2: a price comes only from here, never from a request. Hint tiers are not products: hints are sold as
//! packs into a balance (RULINGS 25), and a tier is unlocked by spending from it (M21).

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::Deserialize;

use crate::content::{ContentError, ContentStore, Localized};
use crate::ids::{ChapterId, ProductId, is_local_id};

/// `server/catalog.json`, compiled in: prices and economy values are server-only and change with a deploy
/// (PLACEHOLDER values: Q3, Q30-Q33).
pub const CATALOG_JSON: &str = include_str!("../catalog.json");

/// The resource kind the hint ladder spends (M21). Code, not data: `spend` names no kind, so the economy section must
/// declare this one.
pub const HINT_KIND: &str = "hint";

/// The longest resource kind, in bytes (the `kind_shape` CHECKs of `0004_economy.sql`).
const KIND_MAX_LEN: usize = 16;

/// The largest amount one pack, hint tier, gift or referral bonus moves: the `orders_pack_binding` and
/// `resource_ledger_amount_bounded` CHECKs, so a paid grant can never fail on them after the payment row.
const AMOUNT_MAX: u32 = 1000;

/// A resource kind of the economy, e.g. `hint`: `^[a-z][a-z0-9_]{0,15}$`, the `kind_shape` CHECKs of the balance and
/// ledger tables.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ResourceKind(pub String);

impl ResourceKind {
    /// The kind `s` spells: a lower-case ASCII letter, then up to 15 lower-case letters, digits or `_`.
    pub fn parse(s: &str) -> Option<ResourceKind> {
        let ok = s.len() <= KIND_MAX_LEN && is_local_id(s);
        ok.then(|| ResourceKind(s.to_owned()))
    }
}

/// Telegram's limits on an invoice title, in characters (counted here in code points).
const TITLE_CHARS: (usize, usize) = (1, 32);

/// Telegram's limits on an invoice description, in characters (counted here in code points).
const DESCRIPTION_CHARS: (usize, usize) = (1, 255);

/// The prefix of every pack product id.
const PACK_PREFIX: &str = "pack:";

/// The longest pack id, in bytes (META-PLAN M17: `^[a-z][a-z0-9_]{0,23}$`).
const PACK_ID_MAX_LEN: usize = 24;

/// A pack id of the economy section, e.g. `hint_s`: `^[a-z][a-z0-9_]{0,23}$`. Its product id is `pack:<PackId>`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct PackId(pub String);

impl PackId {
    /// The pack id `s` spells: a lower-case ASCII letter, then up to 23 lower-case letters, digits or `_`.
    pub fn parse(s: &str) -> Option<PackId> {
        let ok = s.len() <= PACK_ID_MAX_LEN && is_local_id(s);
        ok.then(|| PackId(s.to_owned()))
    }
}

/// What a product id names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProductRef {
    /// `chapter:<ChapterId>`: a paid chapter.
    Chapter {
        /// The chapter it unlocks.
        chapter: ChapterId,
    },
    /// `pack:<PackId>`: a pack of resources, credited into a balance (META-PLAN M17).
    Pack {
        /// The pack.
        pack: PackId,
    },
}

/// What a pack credits: `amount` units of `kind`. An order binds it at invoice time, and its payment credits the
/// order's binding, never the catalog's current value (revision 1, W3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackDef {
    /// The pack.
    pub id: PackId,
    /// The resource kind it credits, a declared one.
    pub kind: ResourceKind,
    /// The units it credits, 1 to 1000.
    pub amount: u32,
}

/// A product for sale, with its rendered invoice texts.
#[derive(Debug, Clone)]
pub struct Product {
    /// The product id, e.g. `chapter:ch2`.
    pub id: ProductId,
    /// What it unlocks.
    pub kind: ProductRef,
    /// The price in Telegram Stars, at least 1.
    pub price_stars: u32,
    /// The invoice title, 1-32 characters in each language.
    pub title: Localized,
    /// The invoice description, 1-255 characters in each language.
    pub description: Localized,
    /// A pack product's binding (what its order records and its payment credits); `None` for a chapter.
    pub pack: Option<PackDef>,
}

/// The gift rules of the economy section (META-PLAN M22, read by LE2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GiftRules {
    /// The kinds a user may give, each a declared one.
    pub kinds: Vec<ResourceKind>,
    /// The most units one gift moves, 1 to 1000.
    pub max_per_gift: u32,
    /// The gifts a user may send per day.
    pub send_per_day: u32,
    /// The gifts a user may receive per day.
    pub receive_per_day: u32,
}

/// The referral rules of the economy section (META-PLAN M23, read by LE2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferralRules {
    /// The kind both bonuses credit, a declared one.
    pub kind: ResourceKind,
    /// The inviter's bonus, 1 to 1000.
    pub inviter: u32,
    /// The invitee's bonus, 1 to 1000.
    pub invitee: u32,
    /// The invitee's play time before the bonuses count, in seconds.
    pub min_play_secs: i64,
    /// The inviter's bonuses per day.
    pub cap_per_day: u32,
    /// The inviter's bonuses in total.
    pub cap_total: u32,
}

/// The economy section as checked at startup (the packs are products of the catalog).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Economy {
    /// The resource kinds in declaration order, [`HINT_KIND`] among them: the order the wallet lists balances in.
    pub kinds: Vec<ResourceKind>,
    /// The units of [`HINT_KIND`] one hint tier costs, 1 to 1000.
    pub hint_tier_cost: u32,
    /// The gift rules.
    pub gifts: GiftRules,
    /// The referral rules.
    pub referral: ReferralRules,
}

/// `server/catalog.json` as parsed: public so the contract test reads the same file the server does.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogFile {
    /// The file's marker line (JSON has no comments).
    #[serde(rename = "//", default)]
    _comment: Option<String>,
    /// The pricing of every paid chapter.
    pub chapters: ChapterPricing,
    /// The resource economy: kinds, packs and rules (META-PLAN M17).
    pub economy: EconomyFile,
}

/// The `chapters` section of `server/catalog.json` (STORIES-PLAN Y6).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ChapterPricing {
    /// The price of every paid chapter without an override.
    pub default_price_stars: u32,
    /// Overrides: chapter id -> price. Every key is a paid chapter of the story index.
    pub price_stars: BTreeMap<String, u32>,
    /// The invoice title template: `{chapter}` (the chapter title) and `{story}` (the story title).
    pub title: Localized,
    /// The invoice description template, with the same placeholders.
    pub description: Localized,
}

/// The `economy` section of `server/catalog.json` (META-PLAN M17), as written.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EconomyFile {
    /// The resource kinds, in display order.
    pub kinds: Vec<String>,
    /// The packs for sale: pack id -> pack.
    pub packs: BTreeMap<String, PackFile>,
    /// What spending costs.
    pub spend: SpendFile,
    /// The gift rules.
    pub gifts: GiftsFile,
    /// The referral rules.
    pub referral: ReferralFile,
}

/// A pack of the `economy` section, as written.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PackFile {
    /// The kind it credits.
    pub kind: String,
    /// The units it credits.
    pub amount: u32,
    /// The price in Telegram Stars.
    pub price_stars: u32,
    /// The invoice title, also the wallet's label.
    pub title: Localized,
    /// The invoice description.
    pub description: Localized,
}

/// The `spend` part of the `economy` section.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpendFile {
    /// The hints one hint tier costs.
    pub hint_tier: u32,
}

/// The `gifts` part of the `economy` section.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GiftsFile {
    /// The kinds a user may give.
    pub kinds: Vec<String>,
    /// The most units one gift moves.
    pub max_per_gift: u32,
    /// The gifts a user may send per day.
    pub send_per_day: u32,
    /// The gifts a user may receive per day.
    pub receive_per_day: u32,
}

/// The `referral` part of the `economy` section.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReferralFile {
    /// The kind both bonuses credit.
    pub kind: String,
    /// The inviter's bonus.
    pub inviter: u32,
    /// The invitee's bonus.
    pub invitee: u32,
    /// The invitee's play time before the bonuses count, in seconds.
    pub min_play_secs: i64,
    /// The inviter's bonuses per day.
    pub cap_per_day: u32,
    /// The inviter's bonuses in total.
    pub cap_total: u32,
}

/// Parses `server/catalog.json`. Its error text may quote the file: it is in git and holds no paid content.
pub fn parse_file(text: &str) -> Result<CatalogFile, ContentError> {
    serde_json::from_str(text)
        .map_err(|e| ContentError::Catalog(format!("not the expected JSON: {e}")))
}

/// The product a product id names: `chapter:<ChapterId>` or `pack:<PackId>`, spelled canonically (no `ch01`, no
/// spaces, no upper case), so one product has one id.
pub fn parse_product_id(s: &str) -> Option<ProductRef> {
    if let Some(chapter) = s.strip_prefix("chapter:") {
        let chapter = ChapterId::parse(chapter)?;
        return Some(ProductRef::Chapter { chapter });
    }
    let pack = PackId::parse(s.strip_prefix(PACK_PREFIX)?)?;
    Some(ProductRef::Pack { pack })
}

/// Every product, checked against the story index, and the economy rules. Immutable for the process lifetime.
#[derive(Debug)]
pub struct Catalog {
    /// The chapter products in index order, then the pack products in (kind, amount, id) order.
    products: Vec<Product>,
    at: HashMap<ProductId, usize>,
    economy: Economy,
}

impl Catalog {
    /// Builds the chapter products of `content`'s index from `catalog_json`: each paid chapter priced by its
    /// override, else the default, with its invoice texts rendered. Refuses a price below 1, an override key that is
    /// not a paid chapter of the index, a template with a placeholder other than `{chapter}` / `{story}`, and a
    /// rendered text outside Telegram's limits. Then the pack products and the rules of the `economy` section, with
    /// the refusals listed at `build_economy`.
    pub fn build(catalog_json: &str, content: &ContentStore) -> Result<Catalog, ContentError> {
        let file = parse_file(catalog_json)?;
        let pricing = &file.chapters;
        for template in [&pricing.title, &pricing.description] {
            render(&template.ru, "", "")?;
            render(&template.en, "", "")?;
        }
        check_price("defaultPriceStars", pricing.default_price_stars)?;
        let paid: HashSet<&str> = content
            .stories()
            .iter()
            .flat_map(|story| &story.chapters)
            .filter(|chapter| chapter.paid)
            .map(|chapter| chapter.id.0.as_str())
            .collect();
        for (chapter, &price) in &pricing.price_stars {
            if !paid.contains(chapter.as_str()) {
                return Err(ContentError::PriceOverride {
                    chapter: chapter.clone(),
                });
            }
            check_price(chapter, price)?;
        }

        let mut products = Vec::new();
        for story in content.stories() {
            for chapter in &story.chapters {
                let Some(id) = &chapter.product else {
                    continue;
                };
                let title = Localized {
                    ru: render(&pricing.title.ru, &chapter.title.ru, &story.title.ru)?,
                    en: render(&pricing.title.en, &chapter.title.en, &story.title.en)?,
                };
                let description = Localized {
                    ru: render(&pricing.description.ru, &chapter.title.ru, &story.title.ru)?,
                    en: render(&pricing.description.en, &chapter.title.en, &story.title.en)?,
                };
                check_texts(id, &title, &description)?;
                products.push(Product {
                    id: id.clone(),
                    kind: ProductRef::Chapter {
                        chapter: chapter.id.clone(),
                    },
                    price_stars: pricing
                        .price_stars
                        .get(&chapter.id.0)
                        .copied()
                        .unwrap_or(pricing.default_price_stars),
                    title,
                    description,
                    pack: None,
                });
            }
        }
        let (economy, packs) = build_economy(&file.economy)?;
        products.extend(packs);
        let at = products
            .iter()
            .enumerate()
            .map(|(at, product)| (product.id.clone(), at))
            .collect();
        Ok(Catalog {
            products,
            at,
            economy,
        })
    }

    /// The product `id` names, if the catalog sells it: a chapter or a pack.
    pub fn product(&self, id: &ProductId) -> Option<&Product> {
        self.at.get(id).and_then(|&at| self.products.get(at))
    }

    /// Every chapter product in index order (story, then chain): what `GET /api/entitlements` lists.
    pub fn chapters(&self) -> impl Iterator<Item = &Product> {
        self.products
            .iter()
            .filter(|product| matches!(product.kind, ProductRef::Chapter { .. }))
    }

    /// Every pack product, by kind (declaration order), then amount, then id: what `GET /api/wallet` lists.
    pub fn packs(&self) -> impl Iterator<Item = &Product> {
        self.products
            .iter()
            .filter(|product| matches!(product.kind, ProductRef::Pack { .. }))
    }

    /// The binding of the pack product `id` names, if the catalog sells it.
    pub fn pack(&self, id: &ProductId) -> Option<&PackDef> {
        self.product(id)?.pack.as_ref()
    }

    /// The economy rules.
    pub fn economy(&self) -> &Economy {
        &self.economy
    }
}

/// The checked rules and the pack products of the `economy` section. Each refusal is `ContentError::Catalog` naming
/// the key (an invoice text is `InvoiceText`):
/// - `kinds`: not empty, each a [`ResourceKind`], none twice, [`HINT_KIND`] among them;
/// - each pack: a [`PackId`], a declared kind, an amount of 1 to [`AMOUNT_MAX`], a price of at least 1 Star (no
///   ceiling: a one-time invoice has none), and its texts within Telegram's limits;
/// - `spend.hintTier` 1 to [`AMOUNT_MAX`];
/// - every gift kind and the referral kind declared; `maxPerGift`, `inviter` and `invitee` 1 to [`AMOUNT_MAX`] (they
///   are ledger amounts).
///
/// The packs come by kind (declaration order), then amount, then id: the smaller pack first, whatever its id sorts to.
fn build_economy(file: &EconomyFile) -> Result<(Economy, Vec<Product>), ContentError> {
    if file.kinds.is_empty() {
        return Err(refused("economy.kinds", "no kind is declared"));
    }
    let mut kinds: Vec<ResourceKind> = Vec::with_capacity(file.kinds.len());
    for raw in &file.kinds {
        let kind = ResourceKind::parse(raw).ok_or_else(|| {
            refused(
                "economy.kinds",
                format!("{raw:?} is not a resource kind (^[a-z][a-z0-9_]{{0,15}}$)"),
            )
        })?;
        if kinds.contains(&kind) {
            return Err(refused(
                "economy.kinds",
                format!("{raw:?} is declared twice"),
            ));
        }
        kinds.push(kind);
    }
    if !kinds.iter().any(|kind| kind.0 == HINT_KIND) {
        return Err(refused(
            "economy.kinds",
            format!("{HINT_KIND:?} is not declared: the hint ladder spends it"),
        ));
    }
    let declared = |key: &str, raw: &str| -> Result<(usize, ResourceKind), ContentError> {
        kinds
            .iter()
            .enumerate()
            .find(|(_, kind)| kind.0 == raw)
            .map(|(at, kind)| (at, kind.clone()))
            .ok_or_else(|| refused(key, format!("{raw:?} is not a declared kind")))
    };

    let mut packs: Vec<((usize, u32, PackId), Product)> = Vec::with_capacity(file.packs.len());
    for (raw, pack) in &file.packs {
        let key = format!("economy.packs.{raw}");
        let id = PackId::parse(raw)
            .ok_or_else(|| refused(&key, "not a pack id (^[a-z][a-z0-9_]{0,23}$)"))?;
        let (order, kind) = declared(&format!("{key}.kind"), &pack.kind)?;
        check_amount(&format!("{key}.amount"), pack.amount)?;
        check_price(&format!("{key}.priceStars"), pack.price_stars)?;
        let mut product = String::with_capacity(PACK_PREFIX.len() + id.0.len());
        product.push_str(PACK_PREFIX);
        product.push_str(&id.0);
        let product = ProductId(product);
        check_texts(&product, &pack.title, &pack.description)?;
        packs.push((
            (order, pack.amount, id.clone()),
            Product {
                id: product,
                kind: ProductRef::Pack { pack: id.clone() },
                price_stars: pack.price_stars,
                title: pack.title.clone(),
                description: pack.description.clone(),
                pack: Some(PackDef {
                    id,
                    kind,
                    amount: pack.amount,
                }),
            },
        ));
    }
    packs.sort_by(|a, b| a.0.cmp(&b.0));

    check_amount("economy.spend.hintTier", file.spend.hint_tier)?;
    let gift_kinds = file
        .gifts
        .kinds
        .iter()
        .map(|raw| declared("economy.gifts.kinds", raw).map(|(_, kind)| kind))
        .collect::<Result<Vec<_>, _>>()?;
    check_amount("economy.gifts.maxPerGift", file.gifts.max_per_gift)?;
    let (_, referral_kind) = declared("economy.referral.kind", &file.referral.kind)?;
    check_amount("economy.referral.inviter", file.referral.inviter)?;
    check_amount("economy.referral.invitee", file.referral.invitee)?;
    let economy = Economy {
        kinds,
        hint_tier_cost: file.spend.hint_tier,
        gifts: GiftRules {
            kinds: gift_kinds,
            max_per_gift: file.gifts.max_per_gift,
            send_per_day: file.gifts.send_per_day,
            receive_per_day: file.gifts.receive_per_day,
        },
        referral: ReferralRules {
            kind: referral_kind,
            inviter: file.referral.inviter,
            invitee: file.referral.invitee,
            min_play_secs: file.referral.min_play_secs,
            cap_per_day: file.referral.cap_per_day,
            cap_total: file.referral.cap_total,
        },
    };
    Ok((
        economy,
        packs.into_iter().map(|(_, product)| product).collect(),
    ))
}

/// The refusal of the catalog key `key`: `<key>: <why>`.
fn refused(key: &str, why: impl std::fmt::Display) -> ContentError {
    ContentError::Catalog(format!("{key}: {why}"))
}

/// A price is at least 1 Star (the `orders_amount_positive` and `payments_amount_positive` CHECKs).
fn check_price(what: &str, price: u32) -> Result<(), ContentError> {
    if price >= 1 {
        Ok(())
    } else {
        Err(ContentError::Catalog(format!(
            "{what}: a price must be at least 1 Star"
        )))
    }
}

/// An amount of resource units is 1 to [`AMOUNT_MAX`].
fn check_amount(what: &str, amount: u32) -> Result<(), ContentError> {
    if (1..=AMOUNT_MAX).contains(&amount) {
        Ok(())
    } else {
        Err(refused(
            what,
            format!("{amount} is outside 1..={AMOUNT_MAX}"),
        ))
    }
}

/// A product's invoice texts within Telegram's limits, in both languages.
fn check_texts(
    product: &ProductId,
    title: &Localized,
    description: &Localized,
) -> Result<(), ContentError> {
    for (lang, field, text, limits) in [
        ("ru", "title", &title.ru, TITLE_CHARS),
        ("en", "title", &title.en, TITLE_CHARS),
        ("ru", "description", &description.ru, DESCRIPTION_CHARS),
        ("en", "description", &description.en, DESCRIPTION_CHARS),
    ] {
        check_text(product, lang, field, text, limits)?;
    }
    Ok(())
}

/// A rendered invoice text within `(min, max)` code points (verify: Telegram's counting unit, SP Y6).
fn check_text(
    product: &ProductId,
    lang: &'static str,
    field: &'static str,
    text: &str,
    (min, max): (usize, usize),
) -> Result<(), ContentError> {
    let chars = text.chars().count();
    if (min..=max).contains(&chars) {
        Ok(())
    } else {
        Err(ContentError::InvoiceText {
            product: product.0.clone(),
            lang,
            field,
            chars,
            min,
            max,
        })
    }
}

/// `template` with each `{chapter}` and `{story}` replaced. Any other brace (an unknown placeholder, an unclosed `{`,
/// a stray `}`) is refused, so a typo never reaches an invoice.
fn render(template: &str, chapter: &str, story: &str) -> Result<String, ContentError> {
    let mut out = String::with_capacity(template.len() + chapter.len() + story.len());
    let mut rest = template;
    while let Some(brace) = rest.find(['{', '}']) {
        out.push_str(&rest[..brace]);
        let tail = &rest[brace..];
        let (value, placeholder) = if tail.starts_with("{chapter}") {
            (chapter, "{chapter}")
        } else if tail.starts_with("{story}") {
            (story, "{story}")
        } else {
            return Err(ContentError::Catalog(format!(
                "template {template:?}: a brace that is not {{chapter}} or {{story}}"
            )));
        };
        out.push_str(value);
        rest = &tail[placeholder.len()..];
    }
    out.push_str(rest);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `chapter:<ChapterId>` in its one canonical spelling; hint tiers and every other form are not products.
    #[test]
    fn product_id_grammar() {
        let mut failures = Vec::new();
        for (s, chapter) in [("chapter:ch2", "ch2"), ("chapter:ch10", "ch10")] {
            let want = Some(ProductRef::Chapter {
                chapter: ChapterId(chapter.to_owned()),
            });
            let got = parse_product_id(s);
            if got != want {
                failures.push(format!(
                    "parse_product_id({s:?}): expected {want:?}, got {got:?}"
                ));
            }
        }
        for bad in [
            "",
            "chapter:",
            "chapter:ch01",
            "chapter:ch0",
            "chapter:ch2 ",
            " chapter:ch2",
            "Chapter:ch2",
            "chapter:Ch2",
            "chapter:ch2:1",
            "ch2",
            "hint:ch1.drawer:1",
            "hint:ch1.drawer:01",
        ] {
            if let Some(got) = parse_product_id(bad) {
                failures.push(format!(
                    "parse_product_id({bad:?}): expected None, got {got:?}"
                ));
            }
        }
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    /// `pack:<PackId>` in its one canonical spelling: up to 24 characters of `^[a-z][a-z0-9_]*$` after the prefix.
    #[test]
    fn pack_product_id_grammar() {
        let mut failures = Vec::new();
        let longest = "a".repeat(24);
        for (s, pack) in [
            ("pack:hint_s".to_owned(), "hint_s"),
            (format!("pack:{longest}"), longest.as_str()),
        ] {
            let want = Some(ProductRef::Pack {
                pack: PackId(pack.to_owned()),
            });
            let got = parse_product_id(&s);
            if got != want {
                failures.push(format!(
                    "parse_product_id({s:?}): expected {want:?}, got {got:?}"
                ));
            }
        }
        for bad in [
            "pack:".to_owned(),
            "pack:Hint".to_owned(),
            "pack:hint s".to_owned(),
            "pack:hint_s ".to_owned(),
            " pack:hint_s".to_owned(),
            "pack:1hint".to_owned(),
            "Pack:hint_s".to_owned(),
            "hint:x".to_owned(),
            "hint_s".to_owned(),
            format!("pack:{}", "a".repeat(25)),
        ] {
            if let Some(got) = parse_product_id(&bad) {
                failures.push(format!(
                    "parse_product_id({bad:?}): expected None, got {got:?}"
                ));
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
