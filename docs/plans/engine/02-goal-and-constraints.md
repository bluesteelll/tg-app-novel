## 2. Goal and constraints

- **Goal.** A new mechanic is a module: a data half, a rules half, a lint file (with its texts' walker, round 6), its
  motions, one line per registry, and no edit of the engine kernel, `world/{types,decode}.ts`,
  `client/scripts/story/world.ts` or the save codec unless it saves new state. The owner's
  mechanics land as modules. Every state change, action and UI interaction plays a visible motion from the lane that
  introduces it, enforced by a gate that fails on a missing or no-op motion and (round 7, W1) by a state gate that
  fails a visible change of the puzzle view that plays no cue.
- **Correctness targets.** The build proves what the player runs (one reducer, X4); a save from any earlier format and
  content version loads or fails without a write; no answer of a secret puzzle ships in a public file; a required
  carried item is held on every path into the chapter that needs it.
- **Budgets.** Engine growth over the programme <= 1.5 KB br (ARITHMETIC estimate **+1.71** in reconcile r2, the
  frame edge and `roomFor`'s wrapper +0.02, 0.01 past the 1.7 that §15 Q12 recommends, item 12;
  +1.69 in reconcile r1, the four request answers +0.07; was +1.62, round 12: 0.12 past it, the
  target ruling asked in §15 Q12, 1.7 recommended; round 11 was +1.61, round 10 +1.56, round 9 +1.53, round 8 at the bound); explore-ui <= 16 KB
  br LIMIT (estimate 12.5 before MR1); cue stage <= 6 KB br (new LIMIT, estimate 3.0; 3.07 in round 7, 3.15 in round 9, 3.22 in round 10, 3.28 in round 11; ~3.78 with SH10's `scene` ids, reconcile r2, §11.1); each puzzle-type chunk <= 8 KB br;
  room-set and knot-set <= 32 MiB; world <= 32 KB raw / 8 KB br per chapter; entry +0.05 KB br inside its 0.6 KB
  headroom (39.80 / 40.0 with per-player's round-4 +0.35, §11); 0 extra round trips before the first line; every answer
  the build emits fits the server's `MAX_ANSWER_LEN` (W3).
- **Principles.** 0 (secret answers and paid module data only in server content or the paid world), 1 (solves, hints,
  values: server facts; client world state is a cache of play), 4 (rules lazy; memory gated), 5 (Back, reduced motion,
  `deactivated`), 6 (GSAP stays in the executor: overlay cue motions use the Web Animations API), 7 (modules return
  data; the scene gets commands only), 8 (every new text a `WorldText` with a line ID, and from GM3c on a line of the
  one walk with its role, so the en checks see it; round 6, W1).
- **Invariants that must survive.** `resume()` synchronous; the golden successor test at `RULES_VERSION = 1` through
  GM1a-GM1c; `TAKE_FADE_MS` batches (LFU3's tests); no write on an unreadable body; the attempt window as built.
- **Platform.** No new platform API. Back is Telegram's BackButton through the screens stack. Web Animations
  (`Element.animate`) exists in WKWebView (iOS 13.4+, CLAIM; verify: MDN compat table at the GM3m cut) and Android
  WebView; the owner's devices are iOS 16.4+ and mid / new Android (RULINGS 122, Q54).
