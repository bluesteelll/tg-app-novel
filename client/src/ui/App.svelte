<script lang="ts">
  // The overlay's root (PROTOTYPE-PLAN "Screen map"; L15 D5, D6, D12, D26): it routes the view model to the
  // components and their callbacks to Home's actions, the Game and the meta controller, and decides nothing itself.
  // Home, the notices, the chapter list and the toasts ship in the entry; the meta overlays are the meta chunk's
  // (`vm.meta.ui`, META M27); the in-play overlays are the overlays chunk's (`vm.overlayUi`, lever O5); every other
  // component is the engine's (`vm.ui`); each renders once its chunk is in.
  // Home's, the Menu's and the Terms' meta taps go through boot's gate (`app.metaTaps`), so they are always given.
  // The Stage mounts with the engine and stays for the page's life (one Pixi Application; the scene itself mounts at
  // the first start), under the opaque Home and notice layers. The cue layer (engine plan §8.1) sits above the frame
  // layer and below Home, the overlays and the toasts, once the session has loaded the cue stage's chunk; it takes no
  // tap. Every layer is full-bleed: each
  // component pads itself past the safe area, and the hotspot layer lives inside the Stage host, the box the canvas
  // and the hotspot rects share. Below the top overlay every layer is inert. Player-facing words come from the UI
  // tables only (principle 8).
  import type { AppHandle } from '../app/boot.ts';
  import { t } from '../i18n/index.ts';
  import ChapterSelect from './ChapterSelect.svelte';
  import Notice from './Notice.svelte';
  import type { ScreenKind } from './screens.ts';
  import StoryPicker from './StoryPicker.svelte';
  import TapToStart from './TapToStart.svelte';
  import Toast from './Toast.svelte';

  let { app }: { app: AppHandle } = $props();

  /** Home's and the engine's overlays; the explore panels and the puzzle frame render elsewhere. */
  const OWN: ReadonlySet<ScreenKind> = new Set<ScreenKind>(['menu', 'backlog', 'settings', 'saves', 'chapters', 'paywall', 'terms']);
  /** The meta overlays, from the meta chunk once the controller has loaded it. */
  const META: ReadonlySet<ScreenKind> = new Set<ScreenKind>(['card', 'friends', 'friend', 'wallet', 'gift', 'consent', 'invite']);

  const vm = $derived(app.vm);
  const ui = $derived(vm.ui);
  /** Set before `vm.ui` (app/boot.ts), so it is there whenever the engine's components are. */
  const game = $derived(ui === null ? null : app.game());
  const root = $derived(vm.screens.root.kind);
  const overlays = $derived(vm.screens.overlays);
  const covered = $derived(overlays.some((o) => OWN.has(o.kind) || META.has(o.kind)));
  const meta = $derived(vm.meta);
  const mui = $derived(meta?.ui ?? null);
  /** Set before `vm.meta` changes after the controller's creation (app/boot.ts), so it is there whenever its data are. */
  const ctl = $derived(meta === null ? null : app.meta());
  const frame = $derived(ui?.puzzle.frame ?? null);
  const puzzleHost = $derived(ui?.puzzle.host ?? null);
  /** The puzzle-host chunk did not load: no frame component to show its Retry (D13). */
  const hostFailed = $derived(frame !== null && frame.loadFailed && puzzleHost === null);

  let rootEl: HTMLElement | undefined = $state();

  // D12: any tap in play resumes sound that needs a gesture, in the capture phase, so a tap the dialogue consumes to
  // complete its reveal counts too. The listener reads the root when it runs; it is off on Home and the notices.
  $effect(() => {
    const el = rootEl;
    if (el === undefined) {
      return;
    }
    const capture = (): void => {
      if (app.vm.screens.root.kind === 'game') {
        app.game()?.gesture();
      }
    };
    el.addEventListener('click', capture, { capture: true });
    return () => el.removeEventListener('click', capture, { capture: true });
  });
</script>

<div class="app" bind:this={rootEl}>
  {#if ui !== null && game !== null}
    <div class="layer" inert={root !== 'game' || covered || ui.puzzle.covers}>
      <ui.Stage onhost={(el) => game?.attachStage(el)}>
        {#if root === 'game' && ui.explore.layer !== null}
          {@const Layer = ui.explore.layer}
          <Layer lang={vm.lang} view={ui.explore} actions={game.exploreActions} puzzle={ui.puzzle} puzzleActions={game.puzzleActions} />
        {/if}
      </ui.Stage>
      {#if root === 'game'}
        {#if ui.explore.layer === null}
          <ui.DialogueBox
            line={vm.line}
            speed={vm.speed}
            reducedMotion={vm.reducedMotion}
            paused={vm.paused}
            lang={vm.lang}
            stageTap={vm.stageTap}
            onadvance={() => void game?.advance()}
            ondone={() => game?.lineShown()}
          />
        {/if}
        <ui.Choices set={vm.choices} lang={vm.lang} onchoose={(i) => void game?.choose(i)} />
        <ui.QuickBar
          mode={vm.mode}
          lang={vm.lang}
          onmode={(m) => game?.setMode(m)}
          onbacklog={() => game?.openBacklog()}
          onmenu={() => game?.openMenu()}
        />
      {/if}
    </div>
    {#if root === 'game' && frame !== null && ui.puzzle.covers}
      <div class="layer frame-layer" inert={covered}>
        {#if puzzleHost !== null}
          {@const Host = puzzleHost}
          <Host lang={vm.lang} {frame} ladder={ui.puzzle.ladder} {...game.puzzleActions} />
        {:else if hostFailed}
          <section class="host-failed" role="alert" data-cue-notice data-cue-panel="puzzle">
            <p>{t(vm.lang, 'puzzle.load_failed')}</p>
            <button type="button" data-cue="puzzle-retry" disabled={frame.retrying} onclick={() => game?.puzzleActions.onretry()}>
              {t(vm.lang, 'puzzle.retry')}
            </button>
          </section>
        {/if}
      </div>
    {/if}
  {/if}

  {#if vm.cueStage !== null}
    {@const cue = vm.cueStage}
    <div class="layer cue-layer">
      <cue.component
        subscribe={cue.subscribe}
        orphans={cue.orphans}
        dropped={cue.dropped}
        host={cue.host}
        haptic={cue.haptic}
        reduced={vm.reducedMotion}
      />
    </div>
  {/if}

  {#if root === 'home'}
    <div class="layer" inert={covered}>
      {#if vm.cards.length === 0}
        <div class="wait"><span aria-hidden="true">▶</span></div>
      {:else}
        <TapToStart lang={vm.lang} continueLabel={vm.continueLabel} oncontinue={() => app.home.continue()}>
          <div class="cards">
            <StoryPicker
              cards={vm.cards}
              lang={vm.lang}
              onstart={(id) => app.home.start(id)}
              oncontinue={(id) => app.home.resume(id)}
              onchapters={(id) => app.home.chapters(id)}
              oncard={(id) => app.metaTaps.card(id)}
              onfriends={() => app.metaTaps.friends()}
              onwallet={() => app.metaTaps.wallet()}
            />
          </div>
        </TapToStart>
      {/if}
    </div>
  {:else if root === 'notice' && vm.notice !== null}
    <div class="layer" inert={covered}>
      <Notice notice={vm.notice} lang={vm.lang} />
    </div>
  {/if}

  {#each overlays as o, i (o.kind)}
    {#if OWN.has(o.kind)}
      <div class="layer" inert={i < overlays.length - 1}>
        {#if o.kind === 'chapters'}
          {@const story = o.story}
          {#if vm.chapters !== null}
            <ChapterSelect
              story={vm.chapters.story}
              chapters={vm.chapters.rows}
              lang={vm.lang}
              onchapter={(id) => app.home.chapter(story, id)}
            />
          {/if}
        {:else if ui !== null && game !== null}
          {@const k = vm.overlayUi}
          {#if o.kind === 'paywall'}
            {#if vm.paywall !== null}
              <ui.Paywall
                chapter={vm.paywall.chapter}
                priceStars={vm.paywall.priceStars}
                state={vm.paywall.state}
                lang={vm.lang}
                onbuy={() => game?.buy()}
                oncheckagain={() => game?.checkAgain()}
                onterms={() => game?.openTerms()}
                onretry={() => void game?.retryPrice()}
              />
            {/if}
          {:else if o.kind === 'terms'}
            <ui.Terms lang={vm.lang} onpolicy={() => app.metaTaps.policy()} />
          {:else if k !== null}
            {#if o.kind === 'menu'}
              <k.Menu
                lang={vm.lang}
                onsaves={() => void game?.openSaves()}
                onsettings={() => game?.openSettings()}
                onstories={() => void game?.exitToStories()}
                onfriends={() => app.metaTaps.friends()}
                onwallet={() => app.metaTaps.wallet()}
              />
            {:else if o.kind === 'backlog'}
              <k.Backlog lines={vm.backlog} lang={vm.lang} />
            {:else if o.kind === 'settings'}
              <k.Settings settings={vm.settings} lang={vm.lang} onchange={(next) => game?.setSettings(next)} />
            {:else if o.kind === 'saves'}
              <k.SaveLoad
                slots={vm.saves.slots}
                lang={vm.lang}
                saving={vm.saves.saving}
                conflict={vm.saves.conflict}
                failed={vm.saves.failed}
                onsave={(slot) => void game?.save(slot)}
                onoverwrite={(slot) => void game?.overwrite(slot)}
                oncancel={() => game?.cancelOverwrite()}
                onload={(slot) => void game?.load(slot)}
              />
            {/if}
          {/if}
        {/if}
      </div>
    {:else if META.has(o.kind) && meta !== null && mui !== null}
      <div class="layer" inert={i < overlays.length - 1}>
        {#if o.kind === 'card'}
          {#if meta.card !== null}
            {@const story = meta.card.story}
            <mui.CompletionCard card={meta.card.data} storyTitle={meta.card.storyTitle} lang={vm.lang} onshare={() => void ctl?.share(story)} />
          {/if}
        {:else if o.kind === 'friends'}
          {#if meta.social !== null}
            <mui.Friends
              social={meta.social}
              lang={vm.lang}
              busy={meta.busy.social}
              onaccept={(h) => ctl?.accept(h)}
              ondecline={(h) => ctl?.remove(h)}
              onopen={(h) => ctl?.openProfile(h)}
              oninvite={() => void ctl?.share(null)}
              onconsent={() => ctl?.openConsent()}
              onpolicy={() => ctl?.openPolicy()}
              onrotate={() => ctl?.rotate()}
            />
          {/if}
        {:else if o.kind === 'friend'}
          {#if meta.profile !== null}
            <mui.FriendProfile
              profile={meta.profile}
              lang={vm.lang}
              busy={meta.busy.social}
              ongift={(h) => ctl?.openGift(h)}
              onremove={(h) => ctl?.remove(h)}
            />
          {/if}
        {:else if o.kind === 'wallet'}
          {#if meta.wallet !== null}
            <mui.Wallet
              wallet={meta.wallet}
              lang={vm.lang}
              busy={meta.busy.wallet}
              onbuy={(p) => ctl?.buyPack(p)}
              onterms={() => ctl?.openTerms()}
            />
          {/if}
        {:else if o.kind === 'gift'}
          {#if meta.gift !== null}
            {@const g = meta.gift}
            <mui.GiftDialog
              friend={g.friend}
              kind={g.kind}
              balance={g.balance}
              maxAmount={g.maxAmount}
              error={g.error}
              lang={vm.lang}
              busy={g.busy}
              onsend={(n) => void ctl?.gift(g.friend.handle, g.kind, n)}
              oncancel={() => ctl?.cancelGift()}
            />
          {/if}
        {:else if o.kind === 'consent'}
          {#if meta.social !== null}
            <mui.ConsentDialog
              granted={meta.social.profileVisible}
              lang={vm.lang}
              busy={meta.busy.consent}
              onchange={(on, version) => ctl?.setVisible(on, version)}
              onpolicy={() => ctl?.openPolicy()}
            />
          {/if}
        {:else if o.kind === 'invite'}
          <mui.InvitePrompt
            lang={vm.lang}
            busy={meta.busy.invite}
            onsend={() => ctl?.sendInvite()}
            onlater={() => ctl?.dismissInvite()}
          />
        {/if}
      </div>
    {/if}
  {/each}

  <Toast toasts={vm.toasts} lang={vm.lang} ondismiss={(key) => vm.dismissToast(key)} />
</div>

<style>
  .app {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #000;
    color: #fff;
  }

  .layer {
    position: absolute;
    inset: 0;
  }

  /* The frame layer passes taps (engine plan 08b "The frame wrapper passes taps"): its two blocks take them back
     while they are on screen, and a leaving frame is gone at once, its ghost on the cue layer, which takes no tap, so
     the room answers at once. */
  .frame-layer {
    pointer-events: none;
  }

  /* The cue layer only plays motions on its ghosts: every tap reaches the layers below it (its stage is inert too). */
  .cue-layer {
    pointer-events: none;
  }

  /* The cards scroll in a box of their own. TapToStart's column is aligned to its end, so content taller than its
     frame would overflow past the top edge, where no scroll reaches (unsafe flex-end overflow), and take Continue
     with it. */
  .cards {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  /* Home while its boot reads are in flight: a glyph only, no words. */
  .wait {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    user-select: none;
  }

  .wait span {
    font-size: 48px;
    line-height: 1;
    opacity: 0.85;
  }

  .host-failed {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: calc(var(--app-inset-top, 0px) + 24px) calc(var(--app-inset-right, 0px) + 24px)
      calc(var(--app-inset-bottom, 0px) + 24px) calc(var(--app-inset-left, 0px) + 24px);
    background: var(--tg-theme-bg-color, #17171c);
    color: var(--tg-theme-text-color, #fff);
    text-align: center;
    pointer-events: auto;
  }

  .host-failed p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .host-failed button {
    min-height: 44px;
    padding: 12px 20px;
    border: 0;
    border-radius: 12px;
    background: var(--tg-theme-secondary-bg-color, #2a2a32);
    color: inherit;
    font: inherit;
  }
</style>
