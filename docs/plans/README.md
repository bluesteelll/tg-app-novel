# Plans

The three designs adopted 2026-11-09 (RULINGS 152, 153, 158) as plans: planned, nothing built yet.
Changed by RULINGS 159-173 (as of `9a83251`; docs lane `docs-errata-10`, group B): built since: engine GM1a
(`ef8b4dc`) and GM1b (`03a00bc`), per-player GM6k (`fd62933`) and GM6s1 (`81a15b0`); per-player GM6s2 runs; no shots
lane has started; the rest is planned, in the one order below.
Changed by RULINGS 174-182 (as of `9b4fd25`; docs lane `docs-errata-11`, group B): built since also engine GM1c
(`8c2fa03`) and GM2a (`9b4fd25`) and per-player GM6s2 (`2815340`), so the per-player server chain is done; engine GM1d
and GM3w run; no shots lane has started; the rest is planned, in the one order below.
Changed by RULINGS 183-197 (as of `837b1ed`; docs lane `docs-errata-12`, group B): built since also engine GM1d
(`794181b`), GM3w (`508bd36`), GM2b (`1782d6d`), GM3m (`a3f0678`) and GM3c (`837b1ed`) and per-player GM6a
(`23e1d31`); engine GM3s and shots SH1, the first shots lane, run; next, the engine-closure lever lane (new, RULINGS
195, 196) after GM3s, then GM3; the rest is planned, in the one order below.
Changed by RULINGS 198-209 (as of `461424d`; docs lane `docs-errata-13`, group B): built since also engine GM3s
(`65e10ad`) and shots SH1 (`2db33c3`) and SH2 (`7f45dee`), and the engine-closure lever X (`597dded`; the lever lane
became the program X, then P, RULINGS 201); engine GM3 and lever P run (RULINGS 209); next, engine GM3u after GM3 and
shots SH3a after SH2, both after P on a shared file; the rest is planned, in the one order below.
Changed by RULINGS 209-225 (as of `52e328e`; docs lane `docs-errata-14`, group B): built since also engine GM3
(`7082a35`) and GM3k (`3131844`; new, type-only, RULINGS 210 Q4), the lever P (`3d120bc`) and the recovery lane
(`8e099ee`; new, Q60); the levers O5 and Y are approved designs on the shelf (RULINGS 221, 222, 224); engine GM3u and
E6 (new, the money-path follow-up) run (RULINGS 225); next, engine GM3p after GM3u, shots SH3a and per-player GM6t;
the rest is planned, in the one order below.

- [engine](engine/README.md) — the mechanics engine: module contract, world data, puzzle types, the cue union and bus, lanes GM1a-GM9r.
- [per-player](per-player/README.md) — per-player codes and labels on the art: the server half, the values store, labels, lanes GM6a-GM6d2.
- [shots](shots/README.md) — drawn-shot staging: the shot model, story DSL, asset pipeline, runtime, lanes SH1-SH12b.

The one lane order: [engine §12 Order and conflicts](engine/12f-order-and-conflicts.md#order-and-conflicts).
