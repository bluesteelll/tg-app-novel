# Open questions for the owner

One line of status + the gist + options + what it blocks. Resolved items are marked `RESOLVED <date>: <ruling>`,
never deleted.

| # | Status | Question | Options / default in use | Blocks |
|---|---|---|---|---|
| Q1 | OPEN | Story: genre, setting, tone, target audience, length per chapter (owner 2026-10-30: puzzles "like Resident Evil and Silent Hill" — Q13) | Default: a placeholder mystery demo (2 short chapters) written by the narrative-designer; placeholder cast ids `ally`, `stranger`, `voice` (plan V8) | Real chapter writing, art direction |
| Q2 | OPEN | Art direction: style, who produces the art (artist / generated / licensed), Spine or static sprites | Default: generated placeholder art through the real asset pipeline | Asset budgets per chapter, Spine decision |
| Q3 | OPEN | Monetization: price per chapter in Stars, bundles, a 30-day subscription for episodic releases | Default: chapter 2 at a placeholder price of `1` Star in `server/catalog.json`, marked PLACEHOLDER (plan V3) | Pricing UI copy, subscription work |
| Q4 | OPEN | Bot identity: bot username, Mini App short name, the support contact for `/support` and `/paysupport`, the terms text | Default: placeholders in config, `server/locales/bot.*.json` and the UI tables (plan V5) | Connecting a real bot |
| Q5 | OPEN | Hosting: VPS provider for the axum server, domain, Cloudflare account for R2 | Default: local only | Deployment, paid-asset Worker |
| Q6 | OPEN | Git remote: create a GitHub repository (private/public)? | Default: local commits only, no push | Backups, CI |
| Q7 | OPEN | Minimum iOS: Vite 8's default build target needs iOS ≥ 16.4; older devices get a blank page | Default: keep the target; add a "device not supported" notice later (plan V1) | Older-device support |
| Q8 | OPEN | Default language for users whose Telegram language is neither ru nor en | Default: ru for `ru/uk/be/kk`, en otherwise (plan V2) | — |
| Q9 | OPEN | Refunds: admin-only manual `/refund`, no self-service? And charges that cannot be applied (a duplicate order, a payment pending past the 120 s checkout lock): refund automatically, or notify and let the admin refund? | Default: admin-only; unapplied charges → a bot message to the payer and the admins, flagged in `/paysupport`, refunded by the admin (plan V4) | Refund automation |
| Q10 | OPEN | Keep a copy of Telegram's `telegram-web-app.js` (no stated licence) as an e2e test fixture? | Default: yes, test fixture only, never shipped; the alternative is a network fetch during e2e (plan V6) | e2e determinism |
| Q11 | OPEN | May chapter 2 be started from chapter select without finishing chapter 1 (default values for chapter 1 choices)? | Default: allowed (plan V7) | — |
| Q12 | OPEN | Connecting a real bot: copy one real `Telegram.WebApp.initData` from a test-environment launch (an extra validator vector) and time how long a Stars payment can stay pending | Owner step when a bot exists (plan E6, E8); until then independent signed vectors and a 120 s checkout lock | Production confidence in auth and checkout |
| Q13 | RESOLVED 2026-10-30: owner — the game has puzzles in the style of Resident Evil / Silent Hill, as mini-games; solving one may need something found on the scene; outcomes branch the story; a failed or stuck player can buy a hint for Stars (a monetization point); built into the prototype now | Puzzles: kinds, role in the story, hints, timing | — | Design extension `docs/PUZZLES-PLAN.md` (RULINGS 10) |
| Q14 | OPEN | Hint pricing: Stars per hint, single hints or packs, how many hint levels per puzzle, whether the last level reveals the solution | Default: placeholder prices in `server/catalog.json` marked PLACEHOLDER; format decided in the puzzles design | Real prices, hint copy |
