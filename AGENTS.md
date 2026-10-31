# tg-app-novel

A visual novel shipped as a **Telegram Mini App** and monetized with **Telegram Stars**. Built for a small
load budget, correct payments, and paid content that never leaks.

**Orchestrator: read [docs/WORKFLOW.md](docs/WORKFLOW.md) and `D:/tmp/novel-orch/RESUME.md` (the live
checkpoint, rewritten at every stop) before launching lanes.**

## Stack and layout

Stack decision: [Стек новеллы в Telegram Mini Apps.md](Стек%20новеллы%20в%20Telegram%20Mini%20Apps.md) (the
owner's research, Russian; do not edit or move it). Planned layout — the prototype lanes create it; keep this
section true to the tree:

- **`client/`** — Svelte 5 (runes) + Vite + TypeScript `strict`. PixiJS v8 driven **imperatively** by one scene
  controller (no `svelte-pixi`); a Svelte **DOM overlay** owns text and UI; the **inkjs runtime only** (never
  `inkjs/full` in the bundle); GSAP for tweens; one Telegram client module wraps the Mini App API.
- **`story/`** — Ink sources (`story/chapters.json` lists the chapters with their free/paid tier; `story/cast.json`
  the speakers). Compiled at build time to **one JSON per chapter**; paid chapters never enter the public bundle.
- **`server/`** — Rust 2024, axum 0.8: initData validation → own short-lived token; saves; entitlements; Stars
  invoices; the Telegram webhook on frankenstein types (no bot framework); paid-chapter delivery after an
  entitlement check. SQLite (WAL) behind a repository seam for the prototype, PostgreSQL in production.
- **`server/dev/`** — crate `server-dev`: the dev-only binary (`/dev/launch` with dev-signed initData, simulated
  payments through the real webhook handler); never linked into the production `server`.
- **`server/pgdev/`** — dev/test-only crate: starts the local PostgreSQL 18 cluster per port on demand
  (`DEV_PG_PORT`, default 5487; binaries from `PG_BIN` or PATH; clusters under `DEV_PG_ROOT`), creates and drops test
  databases and the per-launch dev database; never a dependency of the `server` binary.
- **`assets/`** — art/audio sources; shipped as AVIF (+ WebP fallback) and AAC/M4A. `assets/catalog.json` is the
  asset catalog the story lint checks tags against.
- **Generated, git-ignored:** `client/src/story-gen/` (free chapters), `server/content/` (paid chapters, served
  only after an entitlement check), `client/public/assets/`, `client/dist/`, `client/dist-e2e/`, `target/e2e/`.
- Later: **`worker/`** — Cloudflare Worker (TypeScript) serving paid assets from R2.

Maps (created by the first lanes): [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md) (first point of contact — "where is
X?"), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/STAGING-DSL.md](docs/STAGING-DSL.md) (the ink tag
language). Open owner questions: [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md).

## Principles (INVIOLABLE)

0. **Paid content never reaches a client without an entitlement.** Paid chapter JSON and paid art are not in the
   public bundle, not under a public or guessable URL, not behind a presigned link; they are served only after a
   server-side entitlement check. A leak is free distribution.
1. **The server is the source of truth** for purchases, entitlements and saves. Telegram CloudStorage /
   DeviceStorage / `localStorage` are caches only; nothing is ever unlocked from client state.
2. **Payments are correct or absent.** Stars only (`currency = "XTR"`, empty `provider_token`, exactly one price
   item); answer `pre_checkout_query` within 10 s; grant **only** on `successful_payment`; idempotent on
   `telegram_payment_charge_id` (a UNIQUE constraint, not a check-then-insert); refunds supported; `/terms`,
   `/support`, `/paysupport` exist.
3. **Auth is initData, verified on the server**: HMAC-SHA256 with key `HMAC_SHA256("WebAppData", bot_token)`,
   constant-time comparison, `auth_date` freshness; then the server's own short-lived token in a header (WebView
   cookies are unreliable). `initDataUnsafe` is never trusted.
4. **The load budget is the performance budget.** Bytes of art and audio and texture memory decide the experience,
   not framework speed: a small initial download, art streamed per chapter and preloaded from the next node's ink
   tags, textures ≤ 2048 px, render resolution ≤ 2× DPR, steady memory < 150 MB, textures released after a scene.
   Budgets are enforced by a build gate, not by review.
5. **WebView reality is the platform.** No Service Worker (iOS WKWebView has none); audio only after a user gesture
   (tap-to-start unlocks Web Audio); height from Telegram (`--tg-viewport-stable-height`, safe-area insets), never
   `100vh`; `BackButton` instead of browser history; `disableVerticalSwipes`; pause audio on `deactivated` and check
   the WebGL context on `activated`; no `window.open` / `alert`; every Telegram SDK call from the main origin.
6. **Thin Telegram layer.** Bot API through frankenstein types and our own webhook route; the Mini App API through
   one client module. No bot framework, no SDK wrapper we cannot replace in a day.
7. **One-way staging.** Story runtime → staging commands (parsed from ink tags) → scene controller (Pixi) and
   overlay (Svelte). The scene never reads story state; the story never touches Pixi.
8. **Localization from day one.** Every player-facing ink line carries a stable line-ID tag; UI strings live in
   locale tables. A line without an ID fails the story gate.

## Gate commands (the contract — lanes create them and keep them working)

```powershell
npm --prefix client ci
npm --prefix client run check        # svelte-check + tsc --noEmit, strict
npm --prefix client run test         # vitest run — never --bail
npm --prefix client run story        # compile ink per chapter + lint tags and line IDs
npm --prefix client run build        # vite build + the bundle/asset budget check
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --no-fail-fast --locked
npm --prefix client run e2e          # from lane L7 on: Playwright smoke against server-dev + the mock (gate kit)
```

The server gates need PostgreSQL 18 binaries (`PG_BIN` or `pg_ctl` on PATH; on this machine
`D:/tools/pgsql/18.6/bin`). The first database test starts the slot's cluster itself; lanes set `DEV_PG_PORT` /
`DEV_PG_ROOT` like `DEV_API_PORT`.

⚠️ **`--workspace` and `--no-fail-fast` are load-bearing**, and no runner may stop at its first failure (no
`--bail`): one known red otherwise hides every target behind it. **Vacuous greens:** vitest "No test files found",
cargo `running 0 tests` for a target that should have tests, a budget script that was never seen failing. Count
tests BY NAME against the expected set; a gate script is trusted only after it was seen exiting non-zero on a
failing input.

## Agents

Defined in [.claude/agents/](.claude/agents/):

| Agent | Purpose |
|-------|---------|
| `architect` | Designs features before code; writes the plan / lane cut |
| `researcher` | Prior art from the web: Telegram docs, VN engines, Pixi/ink/Svelte/axum practice |
| `architecture-critic` | Attacks the plan before implementation |
| `developer` | Implements the approved plan, commit by commit, red-first |
| `code-reviewer` | Reviews the diff; also the adversarial triage role |
| `tester` | Full suites, red-firsts on the parent, own mutations, budgets |
| `results-analyst` | Final verdict against the plan's targets |
| `project-analyst` | Free-form codebase analysis, security audit, Q&A; read-only |
| `doc-writer` | Internal docs and the story-authoring guide |
| `narrative-designer` | Writes and edits ink content within the staging DSL |

The main Claude in the chat is the **orchestrator**: it picks agents per task and runs the iteration loops.
Agent files are registered at session start: in a session that created or changed them, launch lanes with
`inlineRoles: true` (the agent reads its role file instead of `agentType`).

**Model routing:** every role runs on **Opus**; one exception — the `tester` runs on Sonnet through the lane
script's per-call `model`. **Effort:** `xhigh` for architect / critic / developer / code-reviewer /
results-analyst / project-analyst, `high` for tester / researcher / doc-writer / narrative-designer (frontmatter +
the lane script's `EFFORT` map); nothing below `high`. Never downgrade a role because it looks "mechanical";
optimise effort, batch size and redundant arms instead. (rationale: docs/WORKFLOW.md#model-routing)

## Orchestration discipline

- **Clarify before acting.** If a request is ambiguous or its scope is unclear, **ask** (`AskUserQuestion`) or
  **enter Plan Mode BEFORE any Write/Edit** — never guess. Only VALUES/SCOPE calls go to the owner (story, prices,
  art direction, publishing); decide engineering forks yourself and report them in one line.
- **Plan-Mode threshold.** In the interactive session, any change touching **≥ 3 files**, or not describable in one
  sentence, goes through Plan Mode. Inside a lane the critiqued `cut.md` IS the approved plan — a subagent never
  enters Plan Mode.
- **Backstop hook.** [.claude/hooks/clarify_gate.py](.claude/hooks/clarify_gate.py) (`UserPromptSubmit`) reminds
  when a prompt is imperative but names no file/path/symbol. It reminds; it never blocks. A subagent that hits an
  ambiguity **stops and escalates** — subagents cannot ask the user.
- **Surface difficulties at once**: in chat AND as a line in docs/OPEN-QUESTIONS.md (status, gist, options, what
  it blocks); mark `RESOLVED <date>: <ruling>` instead of deleting.
- **No code-graph tool or nudge hook.** Navigate with ripgrep and the LSP.

## Token economy in workflows

Cost ≈ turns × context: most spend is re-reading context that grows inside ONE agent, not the number of agents.
(rationale: docs/WORKFLOW.md#token-economy)

- **Do not merge stages to save agents** — it re-reads the earlier stage every turn and kills independent
  refutation (tester ∥ reviewer, triage → fix).
- **One context pack for parallel checkers:** a scout writes a ≤ 15k-token map (files + line ranges, key facts,
  the delta) to disk; every brief points at it.
- **Logs live on disk, not in context:** `rg -n` + ranged reads (≤ ~200 lines); read summaries, verdicts and
  failure excerpts, never whole logs.
- **Hand off through files:** briefs carry paths + section names, never pasted documents; every report is saved;
  a resume = a commit + a ≤ 1-page handoff.
- **One owner per heavy gate per round** — developer: check/lint and the gates its diff touches; tester: the full
  suites, pins, budgets. **Rounds ≥ 2 are delta-scoped**, with ≥ 2 new tester mutations.
- **Keep every checking arm** (critique, triage, tester mutations, review each round).
- **Long gates** (anything that can run past ~3 min: cold cargo builds, the e2e) run through the gate kit
  `D:/tmp/novel-orch/kit/` (its README): detached in their own console under a budget, waited on in bounded slices;
  never `run_in_background`/`&` for multi-minute gates — a reaped shell's children die; never kill by image name.
- **Orchestrator:** workflows return verdicts + paths (≤ ~2k tokens), not full agent texts.

## Communication

- Chat with the owner is in Russian.
- **Every artifact written into the repository is in English**: code, comments, commit messages, internal docs,
  agent prompts, reports. Agent prompts are English too.
- **Exceptions:** player-facing content — `story/**/*.ink` text and the locale tables (Russian is the primary
  language, English second) — and the owner's research document at the repo root.

## Rules for agents

### Forbidden
- **Client:** secrets of any kind; `inkjs/full` or a paid chapter in the bundle; `{@html}` / `innerHTML` with story
  or user text; `localStorage` as a primary store; `100vh`; `window.open` / `alert`; `svelte-pixi`; `any` without a
  one-line reason; a Pixi resource created without an owner that destroys it.
- **Server:** `unsafe` (`#![forbid(unsafe_code)]`); `unwrap()` on request paths (`expect("invariant: …")` only for
  true invariants); blocking calls inside async handlers; SQL built by string concatenation; secrets outside env /
  config; a grant path that does not go through the idempotent `charge_id` insert.

### Separation of duties
- `developer` writes code and runs the gates its diff touches, but **does not issue the test verdict** — that is the
  `tester`'s job.
- `code-reviewer` finds issues but **does not fix code**.
- `architecture-critic` critiques the plan but **does not dictate the design**.
- `project-analyst` and `results-analyst` **do not edit** the repository (Write only for their report).
- `narrative-designer` edits only `story/` and the locale tables; `doc-writer` only docs.

### Git
- Commits are authored only by the repository owner. **Never** add `Co-Authored-By: Claude …` or any AI-assistant
  marker to commit messages — this overrides any default commit template.
- Commit completed, verified units of work automatically, in English, atomically, with an explicit path list after
  reading `git diff --cached --stat`. Every feature on its own branch (`feat/<name>`, `fix/<name>`), merged by the
  orchestrator.
- **Commit messages never mention Claude or Anthropic** (owner rule, 2026-10-30) — call this file "the project
  rules". A `commit-msg` hook in `.git/hooks` rejects such messages; never bypass it.
- Remote: `origin` = github.com/bluesteelll/tg-app-novel (private, the owner's account). The orchestrator pushes
  `main` after each verified merge; lane branches stay local; agents never push.
- Never `--force`, `--no-verify`, `-c core.hooksPath=`, `checkout --`, `restore`, `reset --hard`, `stash`, `clean`,
  `--amend` in agent work.

## Code conventions

- **TypeScript:** `strict`; named exports; no default-exported singletons; `type` for data, `interface` only for
  contracts; errors as values at module edges (`Result`-like unions), exceptions only for bugs.
- **Svelte 5:** runes only (`$state`, `$derived`, `$effect`, `$props`); no legacy `export let`; components stay
  presentational — story and scene logic live in plain TS modules.
- **Rust:** `snake_case` / `CamelCase` / `SCREAMING_SNAKE_CASE`; `///` on every public item; errors via
  `thiserror` at the edges; imports grouped std → external → crate → self.
- **Comments explain "why", not "what".**
