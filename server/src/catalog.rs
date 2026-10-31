//! The product catalog: every paid chapter of the story index, priced and given its invoice texts by
//! `server/catalog.json`. Built once in `AppState::new`; a catalog that does not fit the index is a refusal to start.
//!
//! Principle 2: a price comes only from here, never from a request. Hint tiers are not products (RULINGS 25: hints are
//! sold as packs into a balance, a later lane).

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::Deserialize;

use crate::content::{ContentError, ContentStore, Localized};
use crate::ids::{ChapterId, ProductId};

/// `server/catalog.json`, compiled in: prices are server-only and change with a deploy (PLACEHOLDER values: Q3).
pub const CATALOG_JSON: &str = include_str!("../catalog.json");

/// Telegram's limits on an invoice title, in characters (counted here in code points).
const TITLE_CHARS: (usize, usize) = (1, 32);

/// Telegram's limits on an invoice description, in characters (counted here in code points).
const DESCRIPTION_CHARS: (usize, usize) = (1, 255);

/// What a product id names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProductRef {
    /// `chapter:<ChapterId>`: a paid chapter.
    Chapter {
        /// The chapter it unlocks.
        chapter: ChapterId,
    },
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

/// Parses `server/catalog.json`. Its error text may quote the file: it is in git and holds no paid content.
pub fn parse_file(text: &str) -> Result<CatalogFile, ContentError> {
    serde_json::from_str(text)
        .map_err(|e| ContentError::Catalog(format!("not the expected JSON: {e}")))
}

/// The product a product id names: `chapter:<ChapterId>`, spelled canonically (no `ch01`, no spaces), so one product
/// has one id.
pub fn parse_product_id(s: &str) -> Option<ProductRef> {
    let chapter = ChapterId::parse(s.strip_prefix("chapter:")?)?;
    Some(ProductRef::Chapter { chapter })
}

/// Every product, checked against the story index. Immutable for the process lifetime.
#[derive(Debug)]
pub struct Catalog {
    chapters: Vec<Product>,
    at: HashMap<ProductId, usize>,
}

impl Catalog {
    /// Builds the chapter products of `content`'s index from `catalog_json`: each paid chapter priced by its
    /// override, else the default, with its invoice texts rendered. Refuses a price below 1, an override key that is
    /// not a paid chapter of the index, a template with a placeholder other than `{chapter}` / `{story}`, and a
    /// rendered text outside Telegram's limits.
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

        let mut chapters = Vec::new();
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
                for (lang, field, text, limits) in [
                    ("ru", "title", &title.ru, TITLE_CHARS),
                    ("en", "title", &title.en, TITLE_CHARS),
                    ("ru", "description", &description.ru, DESCRIPTION_CHARS),
                    ("en", "description", &description.en, DESCRIPTION_CHARS),
                ] {
                    check_text(id, lang, field, text, limits)?;
                }
                chapters.push(Product {
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
                });
            }
        }
        let at = chapters
            .iter()
            .enumerate()
            .map(|(at, product)| (product.id.clone(), at))
            .collect();
        Ok(Catalog { chapters, at })
    }

    /// The product `id` names, if the catalog sells it.
    pub fn product(&self, id: &ProductId) -> Option<&Product> {
        self.at.get(id).and_then(|&at| self.chapters.get(at))
    }

    /// Every chapter product in index order (story, then chain): what `GET /api/entitlements` lists.
    pub fn chapters(&self) -> impl Iterator<Item = &Product> {
        self.chapters.iter()
    }
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
}
