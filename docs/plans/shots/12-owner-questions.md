## 12. Owner questions (values only; each with a default) — the same list is returned in `ownerQuestions`

Rev. 6 (RULINGS 136, 138 (d)): **OQ1 is answered** (Krea 2) and **OQ2 is answered** (an RTX 5080, 16 GB); **OQ3,
OQ10 and OQ14 are not asked** (image generation is not designed now). Their texts stay below as a record. The
questions to ask are OQ4-OQ9, OQ11-OQ13 and OQ15-OQ18, unchanged in substance.

1. **OQ1** (rev. 6: **answered**, Krea 2; not asked) Which "local Krea": Krea 2 (Raw to train LoRAs, Turbo to draw) or FLUX.1 Krea [dev]? Default: **Krea 2**
   for the pipeline and the spikes. Its licence allows commercial use while your company's revenue over the last 12
   months is below USD 1M, and that permission covers the pictures it makes, too (see OQ3); FLUX.1 Krea dev's licence
   is non-commercial.
2. **OQ2** (rev. 6: **answered**, an RTX 5080, 16 GB; not asked) Which GPU (card and VRAM), and may LoRA training run on a rented GPU? Default: draw locally on a card with
   >= 16 GB; train each LoRA on a rented RTX 4090 (~$0.89/h, ~2-4 h) when the card has < 24 GB.
3. **OQ3** (rev. 3; rev. 6: **not asked**, RULINGS 136) The Krea 2 licence and the art you sell. Its text says: selling anything made with the model is
   "Commercial Use" (§1); once your company's revenue reaches USD 1M over 12 months you "must immediately cease
   Commercial Use" (§2.3), which includes chapters whose art is already made; Krea may end the licence on 30 days'
   notice for any reason (§9.2), and the text does not say whether art made before that may still be sold afterwards
   (§9.4-9.5 are silent on it). Which do you want before the first paid chapter ships Krea-made art: (a) ask Krea in
   writing whether shipped art stays sellable after a termination and above USD 1M; (b) buy Krea's enterprise licence;
   (c) make release art with another model; (d) accept the risk as written? Default: **(a)**, asked before release
   art, plus a dated copy of the licence and every LoRA's training set kept.
4. **OQ4** Art volume: camera setups per dialogue scene and distinct shots per chapter? Default: 3-4 setups per scene,
   ~20 shots per chapter: **~40-80 h of art per chapter** with one changed expression per face per shot (rev. 2: every
   face's full set, per-expression motion states and ambient loops counted; S-A measures it). Rev. 4: **each further
   expression of one face in one shot adds 4-24 min** (the drawing, plus its own blink, mouths and brows only where it
   changes them); e.g. two more on each face of the 12 dialogue shots adds ~2.5-14.5 h per chapter (§6.5).
5. **OQ5** Per-chapter download limit (images and music)? Default: raise from 6 MB to 12 MB. A cinematic chapter is
   ~9.2 MB with one changed expression per face per shot; rev. 5 (m4): each further expression adds ~49 KB, so ~10.6 MB
   at OQ17's typical count and ~12.8 MB if every face of every close-up uses 5 (over 12 MB: such a chapter fails the
   build until you raise this limit or use fewer expressions there). Answer it together with OQ17.
6. **OQ6** The default cut between shots inside a scene: a hard cut or a short dissolve? Default: hard cut; dissolves
   where the writer asks.
7. **OQ7** May a character be cut out of a shot's own drawing as a separate layer (for hops and bounces)? It is part of
   that one drawing, never reused elsewhere. Default: yes (not a sprite).
8. **OQ8** With the phone's "reduce motion" on: off are breathing, sway, hair, drift, particles, gestures and shake;
   camera moves jump to their end; kept are cuts, dissolves, blinks, brows, mouths and a softer flicker. Default:
   yes.
9. **OQ9** Battery guard: idle motion at up to 30 fps (20 on weak phones), held after 60 s with no tap and no new line,
   and held while a picture or puzzle covers the screen. Default: yes.
10. **OQ10** (rev. 6: **not asked**, RULINGS 136) Art style: which of 2-3 style tests from the LoRA spike? Default: the style of your existing Krea test
    images.
11. **OQ11** Say that the art is made with AI tools (a line in the bot description and the terms)? Default: yes, one
    line.
12. **OQ12** Camera and depth feel: default push 110 % over 2.4 s; the depth sway of near objects up to 8 x 5 CSS px in
    dialogue shots and 4 x 3 in rooms, in 11-13 s cycles; dissolve 500 ms (today's crossfade)? Default: yes; tune after
    the first scene.
13. **OQ13** Small faces in wide shots: the full set (blink, brows, mouths) like every face, or blinks only? Blinks only
    saves ~2-5 h of art per chapter. Default: **the full set** (your rule: maximum animation on every character).
14. **OQ14** (rev. 6: **not asked**, RULINGS 136) The LoRA likeness test needs people who name the characters blind: you alone (after a day's pause), or you
    plus 2 people from the audience? Default: you plus 2 people you pick.
15. **OQ15** (rev. 3; rev. 5 times) Opening a chapter or continuing a save on a slow link (the 6 s test link): the
    first line appears within 6 s over a half-resolution picture that sharpens in place about 2.6 s later for a
    close-up (3.0 s for a wide panning shot; ~0.4 s on a good 4G link), because the next shot's picture loads at the
    same time; that next shot is ready, also at half resolution first, about 1.2 s after the first line (a player who
    taps faster waits for it) and sharp after ~4.7 s; every shot type, close-ups included, fits this (rev. 5, m6: one
    network round trip per file counted). The
    alternative is to wait for the sharp picture: then the first line takes ~6.8 s for a typical close-up, ~7.1 s
    for a close-up on a wide panning picture and up to ~8.1 s for the largest allowed shot (A, §5.11). Default: **the
    half-resolution picture first, 6 s**.
16. **OQ16** (rev. 3; asked only if the device test fails after every fallback) If a phone class still cannot run
    breathing, sway and head motion at full rate after the cheaper fallbacks (half-rate updates, a coarser grid, the
    GPU version), should that class get slower motion or none? Default: **slower motion, never none**.
17. **OQ17** (rev. 4) How many different expressions should a love interest show in one close-up during one exchange
    (typical and maximum: calm, smile, blush, surprise, ...)? Memory and file size no longer limit the number; each one
    costs art time (4-24 min per expression per shot) and ~49 KB of download (rev. 5, m4: the face and its mouths).
    Default: **as the scene needs, typically 2-3 beyond the calm face, at most 5**; the art list shows the count and
    the hours per chapter. At the typical count a chapter is ~10.6 MB; at 5 on every close-up face ~12.8 MB, over
    OQ5's default 12 MB.
18. **OQ18** (rev. 4) Should characters be visible in the explore rooms while the player walks around, and change
    over the story (the ally waits in the hall until the gate opens, then is gone)? Yes means one more drawing of that
    room per "who is there" state (~1.5-3 h each) and an engine change; no means characters appear in rooms through
    story moments that cut to a shot of the room with them. Default: **no: characters appear through story cuts**; a
    character who is always in a room (the keeper at the lamp) is drawn into it.
