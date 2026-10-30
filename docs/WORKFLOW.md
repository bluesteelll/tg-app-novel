# Workflow — the orchestrator's reference

Read by the orchestrator only. [CLAUDE.md](../CLAUDE.md) holds the rules every agent follows and is
authoritative where this file restates one; this file holds the rationale and the procedures behind them. The
workflow was ported from boyko-engine (a Rust engine, ≈ 1,150 agents and 66k model calls measured); numbers marked
**measured on boyko-engine** are that project's and were not re-derived here. Live state is not kept in this file:
it lives in `D:/tmp/novel-orch/RESUME.md`.

## Gate flags

⚠️ The flags in the CLAUDE.md gate list are load-bearing; each was added after a measurement, not for tidiness.

- **`cargo … --workspace`**: without it a virtual manifest at the root checks a subset and reports success —
  measured on boyko-engine, a whole CI was vacuum-green this way. From its first lane the server is a workspace
  whose manifest is a root `Cargo.toml` (virtual, members = [`server`]), so the CLAUDE.md cargo gates run from the
  repo root like `npm --prefix client`; the flag stays even while it has one crate.
- **`cargo test --no-fail-fast`**: `cargo test` stops at the first failing target, so one known-red target
  shadows every target behind it. Measured on boyko-engine: three red targets hid behind "green except the known
  one", one of them for 87 commits. **"Green" without the flag means "green up to the first thing already red".**
- **No `--bail` anywhere** — vitest `--bail`, Playwright `--max-failures`, a budget script that exits on its first
  over-budget file: each hides every later failure. A budget script prints every row, then exits non-zero if any
  row failed.
- **Vacuous greens for this stack**: vitest "No test files found" (exit code depends on `passWithNoTests` — never
  set it); a vitest `include` glob that matches nothing in a renamed directory; cargo `running 0 tests` for a target
  that should have tests; `npm run story` compiling zero chapters; a bundle budget that measured a stale or empty
  `dist/`; Playwright with every test skipped because no dev server answered. Count tests **by name** against the expected set; a gate script is trusted only after it was seen
  exiting non-zero on a failing input.
- **Per-worktree dependencies**: `npm ci` inside the worktree's `client/` (never a `node_modules` shared through a
  junction — every lane would test whichever tree installed last); cargo builds into the worktree's own `target/`
  (git-ignored) — never a shared `CARGO_TARGET_DIR` between two live lanes. With two lanes building at once,
  `CARGO_BUILD_JOBS=6` per lane (the inventory's 8C/16T, 15.4 GB laptop).
- **Baseline**: the tree is empty, so there is no `baseline.tsv` yet. The first lane that adds a runner writes
  `D:/tmp/novel-orch/baseline.tsv` (pass/fail per test ID on `main`); from then on a lane's red is new only if it
  is absent there. Until a runner exists the gates are build + type-check + lint, and the cut says red-first is
  impossible for that commit.

### Gate kit (installed 2026-10-30)

`D:/tmp/novel-orch/kit/` — boyko-engine's proven kit copied byte-for-byte (kit_hash `d7401a58b1ae`), self-tested
on this machine (10/10 cases). Its `README.md` is the contract: `launch.ps1` runs one gate detached in its own
minimized console inside a Job object under a time budget (`-CmdFile` for any line with a double quote), writing
`PID`, `owner.txt`, `log`, `exit_code`, `DONE` or `KILLED`; `wait.sh <out> [slice]` waits one bounded slice (exit 0
= finished, which is not passed: read the `VERDICT` line); `summary.sh` folds several gates into one verdict.
Never `run_in_background`/`&` for a multi-minute gate (measured on boyko-engine: the harness reaps background
shells after ~30 min and their children die with 0xC0000142); never stop a gate by image name.

**What goes through it:** every gate that can run past ~3 minutes — cargo `build`/`clippy`/`test` on a cold target
(about 5 min alone on this laptop, more with a second lane building), the Playwright e2e, a cold `npm ci`. The
README lists this project's gate lines and budgets. The lane header's TOKEN ECONOMY line points at it.

## Model routing

**Every role runs on Opus** (`model: opus` in each `.claude/agents/*.md`) — owner rule inherited from
boyko-engine (RULINGS 2). **One exception:** the `tester` runs on Sonnet through the lane script's per-call
`model` (`testerModel`, default `'sonnet'`); `code-reviewer`, `results-analyst` and every verifier stay Opus.
Watch the escape rate of Sonnet-tester GREENs: a defect found after a GREEN (by review, triage, the owner or in
Telegram) is logged in the lane's report dir, and a pattern is a reason to put the tester back on Opus.

**Effort** (owner, inherited): `xhigh` for architect, architecture-critic, developer, code-reviewer,
results-analyst, project-analyst; `high` for tester, researcher, doc-writer, narrative-designer. Set in the
frontmatter and mirrored by the `EFFORT` map in `.claude/workflows/lane.js`, so a workflow call never inherits the
session's effort. One per-call override: the context-pack scout (`project-analyst`) runs `high`. Nothing runs
below `high` — lower effort was measured on boyko-engine and rejected. The orchestrator stays on the session model.

**Why — measured on boyko-engine.** 27 retrieval questions over that tree, each with a ripgrep-verified
ground-truth passage and phrased without the target's own vocabulary, one identical brief per tier — the most
mechanical task an agent there ever does, so the friendliest case for a cheaper tier:

| tier | found | rank-1 | MRR | **confidently wrong** | returned nothing |
|---|---|---|---|---|---|
| haiku | 14/27 | 14 | 0.519 | **8** | 3 |
| sonnet | 23/27 | 22 | 0.833 | **4** | 0 |
| opus | **27/27** | **25** | **0.957** | **0** | 0 |

The decisive column is "confidently wrong": a confident wrong answer is the defect nobody downstream can detect.
A six-question pilot of the same experiment said Sonnet tied Opus and was wrong; any future routing measurement
needs ≥ ~25 items and must score confident-wrong separately from missed. The tester exception followed a re-run on
Sonnet 5.5 (26/27, 1 confident-wrong).

A second, historical boyko-engine measurement (matched 43-day windows either side of the Sonnet → Opus switch):
identical `fix:` rate, but self-refutations per 100 commits 7.9 → 50.9 (6.45×) — confounded by gate-quality
campaigns, yet pointing at the same faculty: self-scepticism, not capability.

Only facts are gated downstream, never judgement. Here: `tsc` catches a type error but not a paid chapter copied
into `dist/`; clippy catches an `unwrap` lint but not a grant issued before `successful_payment`; a tester's
pass/fail is gated while a test that cannot fail reads as green; a doc-writer's or narrative-designer's output is
gated by little more than the story lint (on boyko-engine, doc repairs introduced new falsehoods in 3 of 5
attempts). **Do not downgrade a role because it looks mechanical; optimise effort, batch size and
redundant arms instead.** A downgrade needs an A/B on ≥ ~25 ground-truthed items from this repository.

## Token economy

**Measured on boyko-engine (2026-10-07): 1,148 agents, 66.5k calls.** Cost ≈ turns × context: ~95 % of volume is
cache re-reads, and 79 % of what is re-read is context growing inside ONE agent. The number of agents is not the
driver (spawn + brief + re-orientation ≈ 5 %), and every modelled stage merge cost MORE (+0.4 … +8.6 %), because
the merged agent re-reads the earlier stage's context on every later turn.

- **Do not merge stages to save agents.** Merging also kills independent refutation (tester ∥ reviewer,
  triage → fix). Parallel arms buy wall time, not tokens: run them when their inputs or roles differ.
- **Parallel checkers start from one context pack.** Measured: reviewers spent 42–48 % of their tokens before
  their first action, triage 61–65 %, the cut 58 %. `lane.js` runs a `project-analyst` scout before each verify
  round that writes `<lane>/pack_r<n>.md` (≤ 15k tokens: files + line ranges, the delta, gates with exact commands,
  pins); the tester and reviewer briefs start from it. Disable with `pack: false` only for a one-commit lane.
- **Keep the cache warm.** Subagents default to a 5-min prompt-cache TTL; 23.5 % of measured cost was full
  re-writes after waits past it. The committed `.claude/settings.json` carries `"subagentPromptCacheTtl": "1h"`
  (needs Claude Code ≥ v2.1.242; on an API key also `"promptCacheTtl": "1h"` for the orchestrator). Confirm after a
  session start: a subagent transcript shows
  `usage.cache_creation.ephemeral_1h_input_tokens > 0`.
- **Logs live on disk.** Tool outputs over 5k tokens, re-read for an agent's life, were 27.9 % of all re-reads.
  `rg -n` + ranged reads (≤ ~200 lines); verdict lines and failure excerpts only. A Vite build log, a
  `cargo test` log and a Playwright trace are never read whole.
- **Hand off through files.** Briefs carry paths + section names, never pasted documents; every report is saved; a
  resume = a commit + a ≤ 1-page handoff. Split a long agent only at a commit, past ~350k context.
- **One owner per heavy gate per round.** Developer: `npm run check`, clippy + fmt, its red-firsts, the gates its
  diff touches. Tester: `npm run test`, `story`, `build` + budgets, `cargo test --workspace`, pins. (Measured:
  both ran the full workspace check in 21 of 38 lanes.)
- **Rounds ≥ 2 are delta-scoped**: the confirmed items' red-first on the parent and HEAD, ≥ 2 new tester mutations
  aimed at the fix and at the gates the last round added (measured: one round's only defect came from one, after
  review said APPROVED), the touched gates, lint. One full-suite run on the lane's final HEAD before merge.
- **Keep every checking arm** (critique, triage, tester mutations, review each round — together ≈ 9–10 % of cost):
  triage confirmed a defect in all 13 measured rounds. Cut an arm only on a measured escape-rate diff over
  ≥ ~25 items.
- **Small always-loaded floor.** Each 1k tokens in CLAUDE.md / MEMORY.md cost ≈ 0.29 % of all spend: MEMORY.md
  ≤ ~15 KB, measurement tables live here, not in CLAUDE.md. Typed agents start at 40–48k tokens vs a
  general-purpose agent's 72–89k — prefer typed agents.
- **Orchestrator.** Workflows return verdicts + paths (≤ ~2k tokens), not agent texts; read reports by section;
  restart from `RESUME.md` past ~400k context.

## Orchestration state

`ORCH = D:/tmp/novel-orch` — outside the repo, its own git repo; commit it at every `RESUME.md` rewrite. (Not a
system temp dir; on boyko-engine a temp scratchpad was wiped after ~3 days and took a campaign's state with it.)

- `RESUME.md` — the live checkpoint, rewritten at every stop: `Trunk: main @ <sha> (pushed y/n)`; the table
  `lane | branch | worktree | base | stage | run id | script | lock set`; `Running gates (PID, lane, budget,
  start)`; `Next, in order`; `Waiting on the owner`.
- `RULINGS.md` — numbered decisions; lanes cite them by number. Owner rulings marked `(owner)`. Append; never
  renumber; supersede with a new number that names the old one.
- `inventory.md` — machine, toolchains, versions seen, lane capacity. Re-check versions before a lane pins one.
- `baseline.tsv` — once a runner exists (see Gate flags).
- `embed/<lane>.js` + `embed/args_<lane>.json` — the exact script and args of every launch.
- `<lane>/` — `spec.md`, `cut.md`, `critique.md`, `impl.md`, `pack_r<n>.md`, `test_r<n>.md`, `review_r<n>.md`,
  `triage_r<n>.md`, `fix_r<n>.md`, gate logs, `wt-<role>` scratch worktrees.
- `kit/` — when installed.

`.claude/settings.local.json` lists `D:/tmp/novel-orch` in `additionalDirectories`; without it every report write
prompts and an `embed/` script cannot be launched. Lane worktrees live under the repo, so they need no entry.

## Lanes, worktrees, trunk

- **lane**: a branch (`feat/<name>` / `fix/<name>`) + worktree for one reviewable unit. **trunk**: `main`, merged
  into only by the orchestrator. **lock set**: the files and dirs a lane owns. **red-first**: a behavioural claim or
  new gate shown failing for the predicted reason without the change, then passing. **mutation**: a deliberate bug
  a named gate must catch. **pin**: a committed expected value (snapshot, compiled-story hash, budget file, SQL
  schema). **delta-scoped**: only what the last fix touched.
- Worktrees: `D:/claude/tg-app-novel/.claude/worktrees/<lane>` (git-ignored), each with its own `client/node_modules`
  (`npm ci`) and its own `target/`. Two agents in one checkout corrupt each other's state. Scratch worktrees for
  red-firsts and mutations live under `ORCH/<lane>/wt-<role>` with their own `npm ci` / `target/`.
- **Lock sets that will collide here**: `client/package.json` + `package-lock.json`, `Cargo.toml` + `Cargo.lock`,
  `server/migrations/`, the staging-command type shared by the story runtime and the scene controller,
  `docs/FEATURE_MAP.md`, `docs/STAGING-DSL.md`. Give each to one lane; a second lane that needs it waits or gets a
  ruling. A dependency bump is its own lane-sized commit, never a side effect.
- **Capacity: ≤ 2 concurrent lanes** (inventory: 15.4 GB RAM; a cargo build + Vite + tests per lane). Disk floor (a starting value — re-set it once one full gate's output size is measured):
  stop a big build below ~10 GB free on D: (the inventory showed 60 GB; `target/` dirs grow by GBs). A cleanup
  never deletes a `target/` or `node_modules` a live process uses or one written in the last ~2 h unless named,
  and logs every deletion.
- Navigation is ripgrep + the LSP (CLAUDE.md). rust-analyzer can serve `server/` through the LSP tool if the owner
  links the project; until then treat an empty `hover`/`findReferences` as "unknown", not "none".

## The orchestrator's loop

- **Classify each owner request.** *Direct* (≤ ~30 lines, ≤ 2 files, an existing test covers it): one developer +
  one tester agent, no lane. *Lane* (≤ ~10 commits, ≤ ~15 files, one subsystem — e.g. "initData → token",
  "Stars invoice + webhook grant", "scene controller + texture lifetime", "ink compile + tag lint"). *Campaign*
  (the prototype, a monetization model, an asset pipeline): a design workflow — researcher(s) → architect →
  architecture-critic, ≤ 2 rounds, round 2 delta-only — producing a plan doc in `docs/`; stop for the owner's
  value calls (story, prices, art direction, bot, hosting — docs/OPEN-QUESTIONS.md); then cut the plan into
  rungs, one lane each, ordered so payments and paid-content delivery land with their tests, never "later".
- **Launch a lane**:
  1. Write `ORCH/<lane>/spec.md`: goal, acceptance gates (exact commands or test names), how it is seen working
     (a dev-mock URL, a Playwright test), out of scope, cited RULINGS numbers, the CLAUDE.md principles at stake.
  2. Estimate the lock set from the spec; the cut STOPs if its touch set leaves it or hits another lane's set — rule
     and relaunch.
  3. `git worktree add D:/claude/tg-app-novel/.claude/worktrees/<lane> -b <branch> <trunk-sha>`; `npm ci` in its
     `client/` once the client exists.
  4. Copy `.claude/workflows/lane.js` to `ORCH/embed/<lane>.js` (LF endings) and the args to
     `ORCH/embed/args_<lane>.json`; launch the workflow by name (`lane`) with those args; record lane / branch /
     base / run id / script / lock set in `RESUME.md`; commit ORCH.
- **Between runs**: read verdicts only; open a report, by section, only on RED / CHANGES_REQUESTED / STOPPED /
  CUT BLOCKED. Answer questions as numbered RULINGS and relaunch with `resumeNote`. A lane still red after round 3
  is not merged: rule, then a fix-only relaunch or a split. `stopAfter: 'cut'|'critique'` lets you read a cut
  before code is written (high-risk lanes: payments, entitlements, auth).
- **Merge (orchestrator only)**:
  1. If `main` moved since the lane's sync, a developer agent runs `cd <wt> && git merge --no-ff main` and the lane
     gets a delta re-verify.
  2. `git merge-base --is-ancestor main <branch>`.
  3. The full suites once on the lane's final HEAD (CLAUDE.md gate list), if the last round was delta-scoped.
  4. `git merge --no-ff <branch>` in the main checkout.
  5. `git rev-parse main^{tree}` must equal the lane's verified tree; otherwise stop and investigate.
  6. `git push origin main` (private GitHub repository, approved by the owner 2026-10-30); before each push,
     `git log origin/main..main --format=%B` must not mention Claude/Anthropic (the `commit-msg` hook already rejects it).
  7. `git worktree remove`, delete the lane's `target/` and `node_modules`, close the lane in `RESUME.md`, update
     `baseline.tsv` if the lane added tests, commit ORCH.

## The lane workflow

`.claude/workflows/lane.js`. Stages: **cut → critique (1 round) → implement → pack → test ∥ review → triage → fix →
delta re-verify (≤ 3 rounds)**. Every stage saves a report at the path its brief names under `ORCH/<lane>/` and
answers with a structured verdict (`verdict`, `report`, `head`, `summary`), so nothing is parsed from prose:

| stage | role | verdicts |
|---|---|---|
| cut | architect | CUT READY / CUT BLOCKED |
| critique | architecture-critic | APPROVED / CHANGES_REQUESTED + critical/important counts |
| implement, fix | developer | DONE / STOPPED |
| pack | project-analyst (scout, effort high) | DONE / STOPPED |
| test | tester (Sonnet) | GREEN / RED |
| review | code-reviewer | APPROVED / CHANGES_REQUESTED + critical/important counts |
| triage | code-reviewer as adversarial verifier | DONE + `confirmed`; per item CONFIRMED / REFUTED / DEFERRED-OUT-OF-SCOPE |

- The developer resolves each Critical/Important of the critique or refutes it in an addendum at the end of
  `cut.md`; a Critical that changes the design is a STOP back to the orchestrator; the round-1 reviewer checks the
  addendum.
- Tester and reviewer run in parallel because their roles differ (independent refutation), not to save tokens.
  Triage tries to refute every finding; `confirmed = 0` returns to the orchestrator, who rules on any remaining red.
- The loop ends clean when the tester is GREEN and the reviewer reports 0 critical + 0 important.
- Args: `name, branch, base (sha), wt, spec (path), lock, others`; optional `trunk` (default `main`), `gates`,
  `resumeNote`, `stopAfter`, `pack` (default true), `testerModel` (default `'sonnet'`), `inlineRoles` (default
  false; true when this session started before `.claude/agents/*.md` existed or last changed — see the lane.js
  header).

Workflow facts that bit boyko-engine:

- **Resume replays only a prefix** of agent calls: after the first call that must re-run, every later call re-runs.
  Put new state ONLY into `resumeNote` (it feeds the implement stage). Editing any arg the shared header (HDR) uses
  (name, branch, base, wt, trunk, spec, lock, others, gates), or `inlineRoles`, re-runs the cut and overwrites
  `cut.md`.
- **Keep the embed copy exact** — it is what a resume needs; a mid-lane change to `.claude/workflows/lane.js` does
  not reach a running lane. **LF endings** (CRLF is rejected as hidden control characters): `rg -c '\r'` on the
  copy must print nothing.
- **The report file is required.** A role whose answer arrives without its file leaves the next stage reading
  nothing while the run reports success (happened twice on boyko-engine). Only the implement stage checks its
  inputs (`cut.md`, `critique.md`) and STOPs if one is missing; the critique, pack, test, review, triage and fix
  briefs do not, and critique, test, review and triage have no STOP verdict. So the orchestrator confirms that each
  verdict's `report` path exists on disk before it reads on or relaunches.
- **Cross-session**: resume the old session (`claude --resume <id>`) and relaunch with the run id; copying the
  session's `subagents/workflows/wf_<id>/` dir is an undocumented fallback only.
- Without the Workflow tool, run the same stages with the Agent tool and the same briefs.

## Crash and resume

1. **Orphans.** List `node`/`cargo`/`rustc`/`vite`/browser processes started by lanes; for every one whose lane's
   workflow is not running now, kill its PID tree (by PID, never by image name). Once the kit exists, judge by
   `owner.txt`, not by process ancestry (kit runs are detached on purpose).
2. **Void outputs.** Gate logs written before the crash are void; archive them as `*.stopped-<time>/` under the
   lane dir. After a machine crash, a corrupt build artifact (a linker access violation, a nonsense link error, a
   truncated `node_modules` package) → clean that package's `target/` subtree or re-run `npm ci`, then rebuild.
3. **Mid-merge worktree.** Never abort: an agent reviews the resolved files against both parents
   (`git show :1:<file>`, `:2:`, `:3:`), `git add`s them, re-runs the gates, commits the merge.
4. **Relaunch** each workflow from `ORCH/embed/<lane>.js` with its run id, new state only in `resumeNote`.
5. **Rewrite and commit `RESUME.md`**; delete scratch `wt-<role>` worktrees that no live agent uses
   (`git worktree remove --force`, then `git worktree prune`).

## Memory

Claude Code's auto memory for this project: `C:/Users/flint/.claude/projects/D--claude-tg-app-novel/memory/` — a
`MEMORY.md` index loaded every session, plus one file per fact.

- One fact per file, typed `user` / `feedback` / `project` / `reference`, each with **Why** and **How to apply**.
- The index: one short line per file, ≤ ~15 KB total; a "read first" block that holds ONLY the current state line
  (pointing at `ORCH/RESUME.md`). Old checkpoints live in the project file, not the index.
- Record owner rulings as `feedback` memories (and as a RULINGS number); measured gotchas as `reference` memories —
  e.g. a WebView behaviour seen on a real device, a Telegram API limit verified against the docs, a budget number.
- Never store what the repo, `RULINGS.md` or git history already records; never store secrets or player data.
  Correct a stale fact in place rather than appending a contradiction.
