import { mount } from 'svelte';

import App from './ui/App.svelte';

const target = document.getElementById('app');
if (target === null) {
  throw new Error('invariant: #app exists in index.html');
}

mount(App, { target });
