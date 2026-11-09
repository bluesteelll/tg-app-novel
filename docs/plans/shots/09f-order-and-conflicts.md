### 9.14 Order and conflicts (superseded by engine §12)

Superseded by [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts) (engine §30 item 10): the one order and the one shared-file table of the three plans hold every SH lane's `After` / `Beside` and every file an SH lane shares. The shots design's own §9.14 (rev. 7) is the record in the orchestration repo (`design/shots/proposal.md` §9.14, tag `designs-adopted-2026-11-09`). Facts of this plan the one order does not carry:

- **No SH lane** holds `server/*`; `emit.ts`, `yields.ts`, `world/*`, `explore/*` except `controller.ts` (I-11's method is GM3b's; I-14 needs no explore edit; I-16 is SH9's one hunk); `play.test.ts` stays green at SH12a (verified at SH12a's cut, which takes it back if red).
- **Docs lanes:** the maps (`docs/FEATURE_MAP.md`, `docs/ARCHITECTURE.md`) and `docs/MEMORY-PLAN.md`'s step-window section go to a docs lane after SH3b and again after SH8; no SH lane holds them.
