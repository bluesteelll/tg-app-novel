// The fake Stars sheet (PROTOTYPE-PLAN "Dev mock" item 4): what the dev mock shows for `web_app_open_invoice`. It
// reads the order from server-dev's `GET /dev/invoices/{slug}` and settles a payment through
// `POST /dev/simulate-payment`, which feeds the real webhook handler. It never grants anything: its status is the
// same hint a real client's `invoice_closed` is, and the purchase flow polls the server (principles 1-2).
// DEV / e2e only, under telegram/dev/; no top-level side effects (the Vite config loader bundles this module).
import type { InvoiceStatus } from '../index.ts';

export type SheetButton = 'pay' | 'pay-delayed' | 'pay-twice' | 'pending' | 'cancel' | 'fail';

/** What the sheet shows: the order, or why it could not be read (the buttons stay usable either way). */
export type SheetDetails = { title: string; amount: number } | { error: string };

/** The overlay: shown once per invoice, removed once. */
export type SheetRender = {
  mount(press: (button: SheetButton) => void): void;
  details(view: SheetDetails): void;
  remove(): void;
};

export type SheetDeps = { fetch: typeof fetch; render: SheetRender };

/** `POST /dev/simulate-payment`'s body after the slug (l8b-webhook-grant cut D8; `outcome` is required). */
type Simulate = { outcome: 'paid' | 'paid_twice'; webhookDelayMs?: number };

/**
 * The button table. "Pending" is the paid POST with the webhook delayed (L8b Q12): the sheet closes `pending`
 * while the payment lands 3 s later, which the purchase flow sees only by polling.
 */
const BUTTONS: Readonly<Record<SheetButton, { label: string; simulate: Simulate | null; closes: InvoiceStatus }>> = {
  pay: { label: 'Pay', simulate: { outcome: 'paid' }, closes: 'paid' },
  'pay-delayed': { label: 'Pay, webhook +3 s', simulate: { outcome: 'paid', webhookDelayMs: 3000 }, closes: 'paid' },
  'pay-twice': { label: 'Pay twice', simulate: { outcome: 'paid_twice' }, closes: 'paid' },
  pending: { label: 'Pending', simulate: { outcome: 'paid', webhookDelayMs: 3000 }, closes: 'pending' },
  cancel: { label: 'Cancel', simulate: null, closes: 'cancelled' },
  fail: { label: 'Fail', simulate: null, closes: 'failed' },
};

const BUTTON_ORDER: readonly SheetButton[] = ['pay', 'pay-delayed', 'pay-twice', 'pending', 'cancel', 'fail'];

/** A dev route that does not answer within this closes the invoice 'failed'. */
const ROUTE_TIMEOUT_MS = 15_000;

/** The button an outcome preset by `__tgMock.setInvoiceOutcome` stands for. */
export function presetButton(outcome: InvoiceStatus): SheetButton {
  switch (outcome) {
    case 'paid':
      return 'pay';
    case 'pending':
      return 'pending';
    case 'cancelled':
      return 'cancel';
    case 'failed':
      return 'fail';
    default: {
      const unhandled: never = outcome;
      throw new Error(`invariant: unhandled invoice outcome ${String(unhandled)}`);
    }
  }
}

/** One button's server action and the status it closes with; a refused or failed POST closes 'failed'. */
export async function pressButton(slug: string, button: SheetButton, f: typeof fetch): Promise<InvoiceStatus> {
  const row = BUTTONS[button];
  if (row.simulate === null) {
    return row.closes;
  }
  try {
    const res = await f('/dev/simulate-payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, ...row.simulate }),
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return 'failed';
    }
    const body: unknown = await res.json();
    const precheckoutOk = typeof body === 'object' && body !== null && 'precheckoutOk' in body && body.precheckoutOk;
    return precheckoutOk === true ? row.closes : 'failed';
  } catch {
    // A network error, a timeout or a body that is not JSON.
    return 'failed';
  }
}

/** `GET /dev/invoices/{slug}` as what the sheet shows. */
async function loadDetails(slug: string, f: typeof fetch, signal: AbortSignal): Promise<SheetDetails> {
  try {
    const res = await f(`/dev/invoices/${encodeURIComponent(slug)}`, { signal });
    if (!res.ok) {
      return { error: `GET /dev/invoices: ${res.status}` };
    }
    const body: unknown = await res.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'title' in body &&
      typeof body.title === 'string' &&
      'amount' in body &&
      typeof body.amount === 'number'
    ) {
      return { title: body.title, amount: body.amount };
    }
    return { error: 'GET /dev/invoices: unexpected body' };
  } catch (e) {
    return { error: `GET /dev/invoices: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Shows the sheet for `slug` until a button is pressed, then settles it. Never rejects. */
export async function runInvoiceSheet(slug: string, d: SheetDeps): Promise<InvoiceStatus> {
  // The details load belongs to this run: it is aborted when the sheet goes.
  const load = new AbortController();
  try {
    const pressed = new Promise<SheetButton>((resolve) => d.render.mount(resolve));
    void loadDetails(slug, d.fetch, load.signal).then((view) => {
      if (!load.signal.aborted) {
        d.render.details(view);
      }
    }); // loadDetails never rejects: every failure is a shown error.
    const button = await pressed;
    load.abort();
    d.render.remove();
    return await pressButton(slug, button, d.fetch);
  } catch {
    load.abort();
    return 'failed';
  }
}

const OVERLAY_CSS =
  'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:flex-end;justify-content:center;' +
  'background:rgba(0,0,0,0.6);font:15px/1.4 system-ui,sans-serif';
const PANEL_CSS =
  'width:100%;max-width:420px;box-sizing:border-box;padding:16px;border-radius:12px 12px 0 0;' +
  'background:#1c2733;color:#f5f5f5;display:flex;flex-direction:column;gap:8px';
const BUTTON_CSS = 'padding:10px;border:0;border-radius:8px;background:#5288c1;color:#fff;font:inherit';

/** The overlay in `doc`: createElement + textContent only (no HTML sink). `data-sheet-button` names each button. */
export function domSheetRender(doc: Document): SheetRender {
  const overlay = doc.createElement('div');
  overlay.setAttribute('data-tg-mock-sheet', '');
  overlay.style.cssText = OVERLAY_CSS;
  const panel = doc.createElement('div');
  panel.style.cssText = PANEL_CSS;
  const title = doc.createElement('strong');
  title.textContent = 'Fake Stars invoice';
  const amount = doc.createElement('span');
  panel.append(title, amount);
  let press: ((button: SheetButton) => void) | null = null;
  for (const button of BUTTON_ORDER) {
    const el = doc.createElement('button');
    el.type = 'button';
    el.textContent = BUTTONS[button].label;
    el.setAttribute('data-sheet-button', button);
    el.style.cssText = BUTTON_CSS;
    el.addEventListener('click', () => press?.(button));
    panel.append(el);
  }
  overlay.append(panel);
  return {
    mount: (onPress) => {
      press = onPress;
      doc.body.append(overlay);
    },
    details: (view) => {
      if ('error' in view) {
        amount.textContent = view.error;
      } else {
        title.textContent = view.title;
        amount.textContent = `${view.amount} XTR`;
      }
    },
    remove: () => {
      press = null;
      overlay.remove();
    },
  };
}
