# Plans

The three designs adopted 2026-11-09 (RULINGS 152, 153, 158) as plans: planned, nothing built yet.
Changed by RULINGS 159-173 (as of `9a83251`; docs lane `docs-errata-10`, group B): built since: engine GM1a
(`ef8b4dc`) and GM1b (`03a00bc`), per-player GM6k (`fd62933`) and GM6s1 (`81a15b0`); per-player GM6s2 runs; no shots
lane has started; the rest is planned, in the one order below.
Changed by RULINGS 174-182 (as of `9b4fd25`; docs lane `docs-errata-11`, group B): built since also engine GM1c
(`8c2fa03`) and GM2a (`9b4fd25`) and per-player GM6s2 (`2815340`), so the per-player server chain is done; engine GM1d
and GM3w run; no shots lane has started; the rest is planned, in the one order below.

- [engine](engine/README.md) — the mechanics engine: module contract, world data, puzzle types, the cue union and bus, lanes GM1a-GM9r.
- [per-player](per-player/README.md) — per-player codes and labels on the art: the server half, the values store, labels, lanes GM6a-GM6d2.
- [shots](shots/README.md) — drawn-shot staging: the shot model, story DSL, asset pipeline, runtime, lanes SH1-SH12b.

The one lane order: [engine §12 Order and conflicts](engine/12f-order-and-conflicts.md#order-and-conflicts).
