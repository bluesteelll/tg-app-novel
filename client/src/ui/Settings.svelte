<script lang="ts">
  // The settings overlay: text speed, the three bus volumes (0-100), the language and "skip unread" (F2, default
  // off). It is controlled: every control shows the props, and a change emits the whole next Settings as a new object
  // (props are never written). A volume emits on `input`, since the AudioManager ramps each change and the store
  // coalesces the writes. Each language is labelled in itself (its `settings.lang_self` in its own table) in any UI
  // language; with `settings.lang` null (the account's language) the UI language is the one checked.
  import { t, type Lang, type UiKey } from '../i18n/index.ts';
  import type { Settings } from '../settings/store.ts';
  import type { TextSpeed } from './typewriter.ts';

  type Props = { settings: Settings; lang: Lang; onchange: (next: Settings) => void };

  let { settings, lang, onchange }: Props = $props();

  type Bus = keyof Settings['volume'];

  const SPEEDS: ReadonlyArray<readonly [TextSpeed, UiKey]> = [
    ['slow', 'settings.speed_slow'],
    ['normal', 'settings.speed_normal'],
    ['fast', 'settings.speed_fast'],
    ['instant', 'settings.speed_instant'],
  ];
  const BUSES: ReadonlyArray<readonly [Bus, UiKey]> = [
    ['master', 'settings.volume_master'],
    ['bgm', 'settings.volume_bgm'],
    ['sfx', 'settings.volume_sfx'],
  ];
  const LANGS: readonly Lang[] = ['ru', 'en'];

  const uid = $props.id();
  const shownLang = $derived(settings.lang ?? lang);

  function setVolume(bus: Bus, value: string): void {
    // Assigned by key, not spread with a computed key: a union key would widen the object and let a string through.
    const volume: { -readonly [K in Bus]: number } = { ...settings.volume };
    volume[bus] = Number(value);
    onchange({ ...settings, volume });
  }
</script>

<section class="panel" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{t(lang, 'settings.title')}</h2>
  <fieldset>
    <legend>{t(lang, 'settings.speed')}</legend>
    {#each SPEEDS as [speed, key] (speed)}
      <label class="option">
        <input
          type="radio"
          name="{uid}-speed"
          value={speed}
          checked={settings.speed === speed}
          onchange={() => onchange({ ...settings, speed })}
        />
        <span>{t(lang, key)}</span>
      </label>
    {/each}
  </fieldset>
  {#each BUSES as [bus, key] (bus)}
    <label class="volume">
      <span>{t(lang, key)}</span>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={settings.volume[bus]}
        oninput={(e) => setVolume(bus, e.currentTarget.value)}
      />
    </label>
  {/each}
  <fieldset>
    <legend>{t(lang, 'settings.language')}</legend>
    {#each LANGS as option (option)}
      <label class="option">
        <input
          type="radio"
          name="{uid}-lang"
          value={option}
          checked={shownLang === option}
          onchange={() => onchange({ ...settings, lang: option })}
        />
        <span lang={option}>{t(option, 'settings.lang_self')}</span>
      </label>
    {/each}
  </fieldset>
  <label class="option">
    <input
      type="checkbox"
      checked={settings.skipUnread}
      onchange={(e) => onchange({ ...settings, skipUnread: e.currentTarget.checked })}
    />
    <span>{t(lang, 'settings.skip_unread')}</span>
  </label>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: calc(var(--app-inset-top, 0px) + 16px) calc(var(--app-inset-right, 0px) + 20px)
      calc(var(--app-inset-bottom, 0px) + 16px) calc(var(--app-inset-left, 0px) + 20px);
    background: var(--tg-theme-bg-color, #17171c);
    color: var(--tg-theme-text-color, #fff);
  }

  h2 {
    margin: 0;
    font-size: 20px;
  }

  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    margin-bottom: 4px;
    padding: 0;
    color: var(--tg-theme-hint-color, #9a9aa6);
  }

  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }

  .option input {
    width: 22px;
    height: 22px;
    margin: 0;
    accent-color: var(--tg-theme-button-color, #6c5ce7);
  }

  .volume {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .volume input {
    width: 100%;
    min-height: 44px;
    margin: 0;
    accent-color: var(--tg-theme-button-color, #6c5ce7);
  }
</style>
