# Promotion research — context pack (read this first)

Date 2026-10-31. Task: how to promote tg-app-novel. Research only — no product code, no design-doc edits. Every
area agent reads this file, then writes ONE report to the path its brief names. The final synthesis is
`docs/research/PROMOTION.md`.

## 1. The product (facts as of 2026-10-31)

- A **visual novel shipped as a Telegram Mini App** (TMA), monetized only with **Telegram Stars** (XTR). Client:
  Svelte 5 + PixiJS 8 + inkjs in the Telegram WebView; server: Rust axum + PostgreSQL 18.
- **Genre and audience (owner, 2026-10-31): the MAIN line is romance visual novels for girls / young women.** The
  age bracket (teens 13-17 vs adults 18+) is NOT decided — research must cover both and say where they differ
  (law on minors, ad targeting, platforms, creatives). Gameplay layer: puzzles and exploration with hints (an earlier
  owner wish: puzzles "like Resident Evil / Silent Hill"), multiple endings, replayability for endings/achievements.
- **Languages:** Russian first (primary market so far), English second.
- **Content model:** several independent stories; each story's **chapter 1 is free and ends on a paywall
  cliffhanger**; later chapters are bought one by one for Stars (placeholder price 1 Star each; real prices are an
  owner value, Q3). Hints are bought in Stars **packs** into a balance (placeholders: 3 hints / 1 Star, 10 / 3 Stars).
- **Status:** prototype in development (14 of ~47 implementation lanes merged). **No public bot yet** (the owner has a
  test bot). **No launch date. Jurisdiction / hosting open** (Q21: where the operator is resident; Russia's 152-FZ
  data localization; possible 2026 Telegram restrictions in Russia — news, unverified). Placeholder demo stories
  (`manor`, `tide`) exist; real story writing and art direction are open (Q1, Q2).

## 2. Planned social / growth features (design draft `docs/META-PLAN.md` on branch `design/choices`, NOT merged)

Read-only reference: `D:/claude/tg-app-novel/.claude/worktrees/design-choices/docs/META-PLAN.md` §D (lines ~335-455),
§E M22-M23 (lines ~563-612), "Open questions" (lines ~1596-1645). Summary:

- **Invite link** (M10): one active 128-bit code per user, `https://t.me/<bot>?startapp=f<code>` (main Mini App link,
  no named app). A launch through it creates a friend request; the invitee accepts → a mutual friendship (both-sides
  consent). No contact access exists in TMAs; no friend search; caps 200 friends / 50 pending.
- **Attribution** (M11): from the signed initData `start_param` on `POST /api/auth`; "newcomer" = the users row was
  inserted by this launch.
- **Visibility** (M12-M13): progress private by default; friends-only, by a separate revocable consent (152-FZ art. 9,
  GDPR art. 7); a friend sees counts of endings/achievements per story + titles both have found. **No public profile.**
- **Share** (M14): text + one URL button via `savePreparedInlineMessage` (server) → `WebApp.shareMessage(id)`
  (client, Bot API 8.0); fallback `t.me/share/url`. **No image card** in the foundation (a static per-story JPEG is
  "Later"); never an ending/achievement title, never paid content. Every share carries the sharer's invite link.
  `shareToStory` was rejected for now (claimed: widget links Premium-only, no callback). 20 shares/hour cap.
- **Completion card** at an ending: only endings the player found (no total count — owner rule Q25), achievements,
  runs. Opened from Home after the first ending.
- **Gifts** (M22): hints to friends only, ≤ 3 per gift, 3 sent / 5 received per day.
- **Referral** (M23): inviter 5 hints, invitee 2 (placeholders) when the invitee completes the FIRST chapter of any
  story; server evidence = two server-clock receipts ≥ 120 s apart; caps 3 grants/inviter/day, 20 lifetime;
  single-level; no Premium weighting. **MV11: the Telegram Affiliate Program is "not used" (default)** — an owner
  business value this research should inform.
- Other defaults: MV12 minimum age 14+ Russia / 18+ EU (lawyer item); bot commands `/terms`, `/support`,
  `/paysupport`, `/privacy`; a privacy policy served publicly.

## 3. Prior research to REUSE (do not redo; re-verify only what your area depends on)

All under `D:/tmp/novel-orch/design/choices/`:
- `research_M2.md` — sharing and friends: `shareMessage`/`savePreparedInlineMessage` (Bot API 8.0), `start_param`
  limits, `chat_instance`, Games platform (`setGameScore`), Bot Developer Terms §5.2 (spam, "social growth
  manipulation"), share-card images. TL;DR at lines 13-36.
- `research_M4.md` — §2c Telegram Affiliate Programs (launched 2024-12-04; `bots.updateStarRefProgram`, commission
  permille, duration; affiliate links `t.me/<bot>?ref=`), §3 referral practice in big TMA games (Hamster Kombat bans,
  Blum), §4 consumer-law notes.
- `research_M3.md` — privacy: Telegram Bot Developer Terms, 152-FZ, GDPR, minors.
- Owner's stack research (repo root, Russian): `Стек новеллы в Telegram Mini Apps.md` — Stars payout facts
  (e.g. "$0.013 per Star" as stated there; re-verify for your area).

## 4. Rules for every agent (hard)

- **Search the web** (owner rule). Every non-trivial claim: a URL you actually opened + the date it applies to.
- Label numbers **MEASURED** (data with stated method/sample: an ads dashboard export, an analytics benchmark with n),
  **DOCUMENTED** (an official doc/terms/law text states it), **CLAIMED** (vendor, agency, blog, case-study PR, press
  release, an anonymous post). Vendor case studies are CLAIMED even when precise. Give the date of every number.
- Legal content is **INTERPRETATION, not legal advice** — mark it so; cite the law text (consultant.ru, garant.ru,
  pravo.gov.ru, eur-lex.europa.eu) and the date of the edition read.
- Reddit / X / Telegram channels / vc.ru-style posts are pointers, not primary sources — still usable as CLAIMED
  practitioner data points when nothing better exists; say so.
- Freshness: as of 2026-10. Telegram ships often (check `core.telegram.org/bots/api-changelog`,
  `telegram.org/blog`); state the version/date you read. If something you expect does not exist or changed, say so.
- **Never** put the owner's name, e-mail, user name or any account data in a search, URL or request. No logins,
  no sign-ups, no forms, no file downloads — reading pages only.
- Write ONLY your report file. Never edit anything else in the repository. English only (quoted Russian terms are
  fine, with a translation).
- No recommendations of the final plan inside the facts sections; but DO fill the "Fit for this project" column and
  the "Applicability" section — the synthesis step makes the plan.

## 5. Report format (every area report)

```markdown
# Promotion research <NN>: <area>
Date 2026-10-31. Sources read: <n>. Freshness notes: <Bot API version read, dates of key pages>.

## TL;DR (5-8 bullets, decision-relevant)
## Findings (subsections per sub-question; each fact labelled MEASURED / DOCUMENTED / CLAIMED, with [n])
## Channel rows (for the synthesis table)
| Channel | Cost (with currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality (A primary/measured, B documented-but-vendor, C anecdotal) | Notes |
## Applicability to tg-app-novel (map onto §2 planned features; product feature asks, listed not designed)
## Pitfalls / what goes wrong (sourced)
## Key claims for verification (numbered, 6-15 items: the claim, the number, the URL, the label — the verify pass re-checks these)
## Gaps (asked but no reliable source found)
## Owner value questions this area raises (each with a default reading)
## Sources
[n] URL — what it is, date (published / read 2026-10-31), why trusted
```

Return to the orchestrator: first line `DONE` or `STOPPED: <reason>`, then the report path and ≤ 8 summary lines.
