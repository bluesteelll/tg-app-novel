<script lang="ts">
  // Friends (META-PLAN M10, M26; F19-F21): Invite, the visibility row that opens the consent dialog, the incoming
  // requests with Accept and Decline (the note says once that a decline is final), the friends, and the privacy
  // policy. Every row is keyed by handle, since two people may share a first name (W1); a handle is only the address
  // a callback carries and is never shown.
  import { mt } from '../../i18n/meta.ts';
  import type { FriendsProps } from './index.ts';

  let { social, lang, busy = false, onaccept, ondecline, onopen, oninvite, onconsent, onpolicy }: FriendsProps =
    $props();

  const uid = $props.id();
</script>

<section class="panel" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{mt(lang, 'meta.friends_title')}</h2>
  <button type="button" class="primary" onclick={() => oninvite()}>{mt(lang, 'meta.friends_invite')}</button>
  <button type="button" class="row" onclick={() => onconsent()}>
    <span>{mt(lang, 'meta.friends_visibility')}</span>
    <span class="state">
      {mt(lang, social.profileVisible ? 'meta.friends_visibility_on' : 'meta.friends_visibility_off')}
    </span>
  </button>
  {#if social.requests.length > 0}
    <h3 id="{uid}-requests">{mt(lang, 'meta.friends_requests')}</h3>
    <p class="note">{mt(lang, 'meta.friends_decline_note')}</p>
    <ul aria-labelledby="{uid}-requests">
      {#each social.requests as request (request.handle)}
        <li>
          <span class="name">{request.firstName}</span>
          <button type="button" class="primary" disabled={busy} onclick={() => onaccept(request.handle)}>
            {mt(lang, 'meta.friends_accept')}
          </button>
          <button type="button" disabled={busy} onclick={() => ondecline(request.handle)}>
            {mt(lang, 'meta.friends_decline')}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if social.friends.length > 0}
    <ul aria-labelledby="{uid}-title">
      {#each social.friends as friend (friend.handle)}
        <li><button type="button" class="row" onclick={() => onopen(friend.handle)}>{friend.firstName}</button></li>
      {/each}
    </ul>
  {:else}
    <p>{mt(lang, 'meta.friends_empty')}</p>
  {/if}
  <button type="button" class="link" onclick={() => onpolicy()}>{mt(lang, 'meta.friends_policy')}</button>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 100%;
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: calc(var(--app-inset-top, 0px) + 16px) calc(var(--app-inset-right, 0px) + 20px)
      calc(var(--app-inset-bottom, 0px) + 16px) calc(var(--app-inset-left, 0px) + 20px);
    background: rgb(20 20 24 / 96%);
    color: #fff;
  }

  h2,
  h3,
  p,
  ul {
    margin: 0;
  }

  h2 {
    font-size: 20px;
  }

  h3 {
    margin-top: 8px;
    font-size: 16px;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .name {
    flex: 1;
    overflow-wrap: anywhere;
  }

  .note {
    opacity: 0.75;
    font-size: 14px;
  }

  button {
    min-height: 44px;
    padding: 10px 16px;
    border: 0;
    border-radius: 12px;
    background: rgb(255 255 255 / 16%);
    color: inherit;
    font: inherit;
  }

  button:disabled {
    opacity: 0.5;
  }

  .primary {
    background: rgb(250 248 255 / 94%);
    color: #111;
  }

  .row {
    display: flex;
    box-sizing: border-box;
    width: 100%;
    justify-content: space-between;
    gap: 12px;
    text-align: left;
  }

  .state {
    opacity: 0.75;
  }

  .link {
    align-self: flex-start;
    background: none;
    text-decoration: underline;
  }
</style>
