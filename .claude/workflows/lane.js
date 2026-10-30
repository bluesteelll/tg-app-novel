export const meta = {
  name: 'lane',
  description: 'One lane: cut -> critique -> implement -> pack -> test || review -> triage -> fix -> delta re-verify; structured verdicts, file handoffs, local commits only',
  whenToUse: 'Implement one reviewable unit (<= ~10 commits, <= ~15 files, one subsystem) on its own branch + worktree. Args: name, branch, base, wt, spec (path), lock, others; optional trunk, gates, resumeNote, stopAfter, pack, testerModel.',
  phases: [ { title: 'Cut' }, { title: 'Critique' }, { title: 'Implement' }, { title: 'Verify' }, { title: 'Fix' } ],
}
// Ported from boyko-engine's lane v2 (token economy 2026-10-07). Keep a per-launch copy with the exact args in
// D:/tmp/novel-orch/embed/<lane>.js + args_<lane>.json (resume replays only a PREFIX of agent calls: new state goes
// ONLY into resumeNote, which feeds the implement stage, so cut/critique stay cached).
// args: name, branch, base (sha), wt (worktree path), spec (path), lock (files/dirs the lane owns), others (other open
// lanes + their lock sets), trunk (default 'main'), gates (default: CLAUDE.md gate list), resumeNote, stopAfter
// ('cut'|'critique'), pack (default true), testerModel (default 'sonnet', owner rule inherited from boyko-engine),
// inlineRoles (default false; true when the session started before the .claude/agents files existed or changed).
const A = args || {}
const ORCH = 'D:/tmp/novel-orch/'
const NAME = A.name || 'NAME-UNSET'
const BR = A.branch || 'BRANCH-UNSET'
const BASE = A.base || 'BASE-UNSET'
const WT = A.wt || 'WT-UNSET'
const TRUNK = A.trunk || 'main'
const SP = ORCH + NAME + '/'
const GATES = A.gates || 'the CLAUDE.md "Gate commands" that exist on this tree (client: ci, check, test, story, build; server: fmt --check, clippy -D warnings, test --workspace --no-fail-fast)'

const HDR = `LANE ${NAME}. Spec: ${A.spec || 'SPEC-UNSET'}. Rulings: ${ORCH}RULINGS.md. Project rules: CLAUDE.md in the worktree.
- Worktree ${WT}. EVERY shell command starts with cd ${WT} && (the shell resets its cwd). Write, build and commit only in ${WT} and ${SP}; delete only by absolute path under ${SP}.
- The ORCHESTRATOR created ${WT} on branch ${BR} from ${BASE} before launch (git worktree add -b ${BR} ${WT} ${BASE}); no stage creates or switches branches. FIRST (cut stage only): confirm ${WT} is on ${BR} (its .git file -> the worktree gitdir's HEAD) and record HEAD; a worktree not on ${BR} is CUT BLOCKED. TRUNK SYNC (developer stages only): if git merge-base --is-ancestor ${TRUNK} HEAD fails, git merge --no-ff ${TRUNK} -m 'merge: ${TRUNK} into ${BR} (trunk sync)', conflicts resolved by editing and keeping both sides (never checkout/restore a side), and say so.
- Lock set: ${A.lock || 'LOCK-UNSET'}. Other open lanes: ${A.others || 'none'}. A file outside your lock set, or in another open lane's set, is a STOP.
- Gates: ${GATES}. Dependencies are per worktree (npm ci inside the worktree's client/; cargo builds into the worktree's own target/).
- TOKEN ECONOMY (CLAUDE.md "Token economy in workflows"): logs stay on disk - read summaries, verdict lines and failure excerpts with rg -n + ranged reads (<= ~200 lines), never whole logs; a gate that can run past ~3 minutes (every cargo build/clippy/test on a cold target, the e2e, a cold npm ci) runs through the GATE KIT D:/tmp/novel-orch/kit/ (read its README.md: launch.ps1 -CmdFile -> wait.sh slices -> summary.sh; quote the VERDICT line + the log's tally lines, never wait.sh's 0 alone; never run_in_background or & for it; past budget the kit kills it; never kill by image name); briefs and reports carry paths, not pasted documents; check tests BY NAME against the expected set (equal counts over different sets, "No test files found", or running 0 tests are a vacuous green).
- Git: local commits only, explicit path lists after git diff --cached --stat; authored by the owner - NEVER a Co-Authored-By line or any AI marker; never push, --force, --no-verify, -c core.hooksPath=, checkout --, restore, reset --hard, stash, clean, --amend.
- Scratch: red-first runs on the parent and every mutation happen in a scratch worktree: git worktree add --detach ${SP}wt-<role> <sha> (its own npm ci / target dir inside it), removed afterwards with git worktree remove --force ${SP}wt-<role>. Never mutate ${WT} for a probe.
- YOUR ANSWER is the structured verdict (schema): verdict, report = the path you saved, head = the HEAD sha of the tree you examined, summary = <= 8 lines. The full text lives in the report file, never in the answer. THE REPORT FILE IS REQUIRED: the next stage reads it from disk, so a general note against writing report files does not apply to the path this brief names.
`

const S = (verdicts, extra) => ({
  type: 'object',
  properties: Object.assign({ verdict: { type: 'string', enum: verdicts }, report: { type: 'string' }, head: { type: 'string' }, summary: { type: 'string' } }, extra || {}),
  required: ['verdict', 'report', 'head', 'summary'].concat(Object.keys(extra || {})),
})
const RATED = { critical: { type: 'integer' }, important: { type: 'integer' } }
// Reasoning effort per role (owner rule inherited from boyko-engine, 2026-10-14): the roles that think hardest run
// xhigh, the rest high; mirrors the `effort:` frontmatter of .claude/agents/*.md so a workflow never inherits the
// session's effort.
const EFFORT = { architect: 'xhigh', 'architecture-critic': 'xhigh', developer: 'xhigh', 'code-reviewer': 'xhigh', 'results-analyst': 'xhigh', 'project-analyst': 'xhigh', tester: 'high', researcher: 'high', 'doc-writer': 'high', 'narrative-designer': 'high' }
// inlineRoles: agents defined in .claude/agents/ are registered only at session start, so in the session that
// created or changed them agentType lookups fail ("Agent type ... not found"). Then the role file is read inline.
const roleLine = (type) => A.inlineRoles ? `YOUR ROLE DEFINITION: first read D:/claude/tg-app-novel/.claude/agents/${type}.md completely and act as that agent (its rules, prohibitions and report template bind you).\n` : ''
const run = (label, ph, type, schema, body, opts) => agent(`${roleLine(type)}${HDR}\n${body}`, Object.assign({ label, phase: ph, schema }, A.inlineRoles ? {} : { agentType: type }, EFFORT[type] ? { effort: EFFORT[type] } : {}, opts || {}))
const brief = (r) => r ? { verdict: r.verdict, report: r.report, head: r.head, critical: r.critical, important: r.important, confirmed: r.confirmed } : null

phase('Cut')
const cut = await run('cut', 'Cut', 'architect', S(['CUT READY', 'CUT BLOCKED']),
  `ROLE: architect - THE CUT, no product code and no builds (read and grep only). Write ${SP}cut.md: (1) every spec item and its source design re-located on THIS tree (file:line now, or "new file" with its path); (2) the touch set with a reason per file, checked against the lock set and the other lanes; (3) commits in order, per commit the gates and the red-first evidence (the predicted red, and what a different red would mean); (4) which pins (snapshots, budgets, compiled-story hashes, schema files) move on purpose and which must stay identical; (5) how the result is seen working (a command, a URL in the dev mock, a test name); (6) questions only the orchestrator can decide, each with your recommendation.`)
if (!cut || cut.verdict !== 'CUT READY') return { stage: 'cut', cut: brief(cut), summary: cut && cut.summary }
if (A.stopAfter === 'cut') return { stage: 'cut', cut: brief(cut) }
phase('Critique')
const crit = await run('critique', 'Critique', 'architecture-critic', S(['APPROVED', 'CHANGES_REQUESTED'], RATED),
  `ROLE: architecture-critic. Read ${SP}cut.md and critique it against the spec, its source design and the tree: re-location errors, a touch-set file outside the lock set or held by another lane, a gate that cannot fail, a silent pin move, an unproved claim, a paid-content leak path, a payment/entitlement race or a non-idempotent grant, trust in client state, a WebView constraint ignored, a load/memory budget cost. A finding cites lines and is CONFIRMED or PLAUSIBLE; an empty list is a full result. Save ${SP}critique.md.`)
if (!crit) return { stage: 'critique', cut: brief(cut), crit: null }
if (A.stopAfter === 'critique') return { stage: 'critique', cut: brief(cut), crit: brief(crit), stopped: 'after critique (resume with the same args minus stopAfter)' }
phase('Implement')
const impl = await run('implement', 'Implement', 'developer', S(['DONE', 'STOPPED']),
  `${A.resumeNote ? 'RESUME NOTE: ' + A.resumeNote + '\n' : ''}ROLE: developer. Read ${SP}cut.md and ${SP}critique.md first (if either is missing: STOPPED). Implement per cut.md, commit by commit. Resolve every Critical and Important remark of the critique in the implementation, or refute it with evidence in an addendum at the end of cut.md; a Critical that changes the design is a STOP. Each red-first goes in RED first with its output quoted in the commit message. Per commit: the gates the cut lists and the gates your diff touches, plus the type-check/lint of the side you touched (client: npm run check; server: cargo clippy --workspace --all-targets --locked -- -D warnings and cargo fmt --all --check) - the full suites and the budgets are the tester's (one owner per heavy gate). Record in ${SP}impl.md, per side touched, each check/lint command you ran on the final HEAD with that HEAD sha and its exit code (the tester takes these instead of re-running them). git log --oneline; git status clean. Save ${SP}impl.md.`)
if (!impl || impl.verdict !== 'DONE') return { stage: 'implement', cut: brief(cut), crit: brief(crit), impl: brief(impl), summary: impl && impl.summary }

const verify = async (round, since) => {
  const ph = round === 1 ? 'Verify' : 'Fix'
  let packLine = ''
  if (A.pack !== false) {
    const p = await run(`pack-r${round}`, ph, 'project-analyst', S(['DONE', 'STOPPED']),
      `ROLE: scout for round ${round} (read-only on the repo; write only the pack). Write ${SP}pack_r${round}.md (<= 15k tokens) for the tester and the reviewer: git log --oneline and git diff --stat ${since}..HEAD; per changed file the line ranges that matter and why; the gates and red-firsts ${round === 1 ? SP + 'cut.md names' : 'the fix touches (' + SP + 'fix_r' + (round - 1) + '.md)'} with their exact commands and predicted reds; which pins may move and which must not; open points from ${round === 1 ? SP + 'impl.md' : SP + 'triage_r' + (round - 1) + '.md'}. Facts with file:line only, no opinions.`, { effort: 'high' })
    if (p && p.verdict === 'DONE') packLine = `START from the context pack ${SP}pack_r${round}.md, written for this round; open other files only for what it does not answer.\n`
  }
  const [test, review] = await parallel([
    () => run(`test-r${round}`, ph, 'tester', S(['GREEN', 'RED']),
      `${packLine}ROLE: tester (round ${round}). On ${BR} in ${WT} (quote HEAD; clean; ${BASE} an ancestor). ` + (round === 1
        ? `(1) Do NOT re-run the type-check/lint gates (the developer owns them): take the developer's recorded check/lint results from ${SP}impl.md (or the pack); a missing record, a record for a sha other than HEAD, or a non-zero exit code is RED. (2) Every red-first the cut names, re-run by you RED on the parent (a scratch worktree) and green on HEAD; two mutations of your own that a named gate must catch (scratch edits, reverted, checked by hash). (3) Every pin and budget (unmoved, or moved exactly as the cut declared). (4) The full suites: npm run test, npm run story, npm run build (with its budget check), cargo test --workspace --all-targets --no-fail-fast --locked - tests counted BY NAME against the expected set.`
        : `DELTA round - the fix since ${since} (${SP}fix_r${round - 1}.md): (1) Do NOT re-run the type-check/lint gates: take the developer's recorded check/lint results from ${SP}fix_r${round - 1}.md (or the pack); a missing record, a record for a sha other than HEAD, or a non-zero exit code is RED. (2) Every CONFIRMED item of ${SP}triage_r${round - 1}.md: its red-first red on ${since} and green on HEAD. (3) At least two NEW mutations of your own aimed at the fix and at every gate the previous round added, each caught by a named gate. (4) The gates, pins and budgets the fix touches. The full suites are NOT repeated here (they run once on the lane's final HEAD at the merge check).`)
        + ` No commits. Save ${SP}test_r${round}.md.`, { model: A.testerModel || 'sonnet' }),
    () => run(`review-r${round}`, ph, 'code-reviewer', S(['APPROVED', 'CHANGES_REQUESTED'], RATED),
      `${packLine}ROLE: code-reviewer (round ${round}). Review ${round === 1 ? 'git diff ' + BASE + '..HEAD and the addendum at the end of ' + SP + 'cut.md' : 'git diff ' + since + '..HEAD and whether it closes the CONFIRMED items of ' + SP + 'triage_r' + (round - 1) + '.md'} on ${BR} in ${WT} against the spec, the source design and ${SP}cut.md. Read code through git show/diff (the tester may be mutating a scratch tree). Above all, the CLAUDE.md principles: paid content reachable without an entitlement; a grant outside the idempotent charge_id path or before successful_payment; initData trusted without the HMAC check; client state treated as truth; WebView rules (audio gesture, viewport, BackButton, no window.open/alert); Pixi resources without an owner that destroys them; story code touching the scene; a player line without a line ID; secrets in the client; tests that cannot fail. Report only defects you can point at a line for, each CONFIRMED or PLAUSIBLE. Save ${SP}review_r${round}.md.`),
  ])
  return { test, review }
}
phase('Verify')
let r = await verify(1, BASE)
const rounds = [{ test: brief(r.test), review: brief(r.review) }]
for (let round = 2; round <= 3; round++) {
  const clean = r.test && r.test.verdict === 'GREEN' && r.review && (r.review.critical + r.review.important) === 0
  if (clean) break
  phase('Fix')
  const triage = await run(`triage-r${round - 1}`, 'Fix', 'code-reviewer', S(['DONE'], { confirmed: { type: 'integer' } }),
    `ROLE: adversarial verifier of findings (read-only: no edits, no commits; scratch probes only under ${SP}). For EVERY red test item in ${SP}test_r${round - 1}.md and every Critical/Important remark in ${SP}review_r${round - 1}.md: try to REFUTE it against HEAD and the design. A finding survives only if you could not refute it. Per item: '<id> CONFIRMED | REFUTED | DEFERRED-OUT-OF-SCOPE: <reason>'; Minor/Optional as NOTED. Save ${SP}triage_r${round - 1}.md; confirmed = the number of CONFIRMED items.`)
  if (!triage) return { stage: 'triage', rounds }
  if (triage.confirmed === 0) return { stage: 'triage', note: 'nothing confirmed - the orchestrator rules on any remaining red', rounds, triage: brief(triage) }
  const since = (r.review && r.review.head) || (r.test && r.test.head) || 'HEAD'
  const fix = await run(`fix-r${round - 1}`, 'Fix', 'developer', S(['DONE', 'STOPPED']),
    `ROLE: developer. Fix every CONFIRMED item of ${SP}triage_r${round - 1}.md as follow-up commits on ${BR} (never amend), red-first; re-run the gates the fix touches plus the type-check/lint of the side you touched, and record in ${SP}fix_r${round - 1}.md each check/lint command with the final HEAD sha and its exit code (the tester takes these instead of re-running them). Save ${SP}fix_r${round - 1}.md.`)
  if (!fix || fix.verdict !== 'DONE') return { stage: 'fix', rounds, triage: brief(triage), fix: brief(fix) }
  r = await verify(round, since)
  rounds.push({ triage: brief(triage), fix: brief(fix), test: brief(r.test), review: brief(r.review) })
}
return { cut: brief(cut), crit: brief(crit), impl: brief(impl), rounds, reports: SP }
