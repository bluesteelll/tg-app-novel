// L15b's purchase e2e (PROTOTYPE-PLAN "Payment flow end to end" P1-P9, "Test strategy"): the grant comes only
// through server-dev's simulated payment and the real webhook handler (principles 1-2); the client unlocks a chapter
// only after the flow's server reads. One observable per test (L15 critique OQ3). The first test plays ch1 to its
// END; the others start from F4 step 3's pending start (`plantPending`), so a Continue opens the paywall at once.
import type { APIRequestContext, Page } from '@playwright/test';

import { t, type UiKey } from '../src/i18n/index.ts';
import { catalogTitle, devToken, expect, launch, plantPending, playCh1ToEnd, reachLine, requests, test, type E2eWindow } from './helpers.ts';

const ru = (key: UiKey, params?: Readonly<Record<string, string | number>>): string => t('ru', key, params);

const LINE_MS = 30_000;
/** What ch1 carries into ch2 on the trust path (story/common/globals.ink). */
const CARRY = { g_gate_forced: false, g_manor_trust: 2, g_manor_promise: true, g_tide_trust_keeper: 0 } as const;

test.use({ reducedMotion: 'reduce' });

type Product = { productId: string; chapterId: string; priceStars: number; owned: boolean };

async function products(request: APIRequestContext, token: string): Promise<Product[]> {
  const res = await request.get('/api/entitlements', { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status(), 'GET /api/entitlements').toBe(200);
  return ((await res.json()) as { products: Product[] }).products;
}

async function ch2(request: APIRequestContext, token: string): Promise<Product> {
  const p = (await products(request, token)).find((x) => x.chapterId === 'ch2');
  if (p === undefined) {
    throw new Error('no ch2 product');
  }
  return p;
}

function setOutcome(page: Page, outcome: 'cancelled' | 'failed'): Promise<void> {
  return page.evaluate((o) => (window as unknown as E2eWindow).__tgMock.setInvoiceOutcome(o), outcome);
}

const paywall = (page: Page) => page.getByRole('heading', { name: catalogTitle('ch2'), exact: true });
const buyButton = (page: Page, price: number) => page.getByRole('button', { name: ru('paywall.buy', { n: price }) });

/** The terms box (P1), then Buy. */
async function buy(page: Page, price: number): Promise<void> {
  await page.getByRole('checkbox', { name: ru('paywall.terms_agree') }).check();
  await buyButton(page, price).tap();
}

/** The planted pending start: Home's Continue resumes it, and the paywall opens over an empty stage. */
async function continueToPaywall(page: Page, uid: number): Promise<void> {
  await launch(page, uid);
  const resume = page.getByRole('button', { name: ru('tap.continue_story', { story: catalogTitle('manor') }) });
  await expect(resume).toBeVisible();
  await resume.tap();
  await expect(paywall(page)).toBeVisible({ timeout: LINE_MS });
}

const firstLine = (page: Page) => page.locator('.dialogue[data-line-id="ch2.archive_cabinet.c002"]');

test('purchase unlocks chapter 2', async ({ page, request }) => {
  test.setTimeout(180_000);
  const token = await devToken(request, 3001);
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  expect((await request.get('/api/chapters/ch2', auth)).status(), 'ch2 before the purchase').toBe(403);
  const price = (await ch2(request, token)).priceStars;

  await launch(page, 3001);
  const start = page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') });
  await start.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
  await playCh1ToEnd(page); // the trust picks: arrival c001, the cellar's c001, street c001
  await expect(paywall(page)).toBeVisible({ timeout: LINE_MS });
  await buy(page, price);
  const sheet = page.locator('[data-tg-mock-sheet]');
  await expect(sheet, "the sheet's amount is the server's price").toContainText(`${price} XTR`);
  await sheet.locator('[data-sheet-button="pay"]').tap();

  await expect(firstLine(page)).toBeVisible({ timeout: LINE_MS });
  expect((await request.get('/api/chapters/ch2', auth)).status(), 'ch2 after the purchase').toBe(200);
  // ch2 reads what ch1 carried: trust 3 >= 2 (story/ch2/main.ink).
  await reachLine(page, 'ch2.archive_cabinet.c004');
});

test('cancelled purchase keeps paywall', async ({ page, request }) => {
  test.setTimeout(90_000);
  await plantPending(request, 3002, 'ch2', CARRY);
  const token = await devToken(request, 3002);
  const price = (await ch2(request, token)).priceStars;
  await continueToPaywall(page, 3002);
  await setOutcome(page, 'cancelled');
  await buy(page, price);
  await expect(buyButton(page, price), 'the form is back').toBeEnabled({ timeout: 10_000 });
  expect((await ch2(request, token)).owned, 'ch2 on the server').toBe(false);
});

test('failed purchase keeps paywall', async ({ page, request }) => {
  test.setTimeout(90_000);
  await plantPending(request, 3003, 'ch2', CARRY);
  const price = (await ch2(request, await devToken(request, 3003))).priceStars;
  await continueToPaywall(page, 3003);
  await setOutcome(page, 'failed');
  await buy(page, price);
  const note = page.locator('[data-variant="note"]', { hasText: ru('toast.purchase_failed') });
  await expect(note).toBeVisible({ timeout: 10_000 });
  // The note lives 4 s (TOAST_MS): it is hit-tested first, at its own centre, in one evaluate.
  const onTop = await note.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && el.contains(hit);
  });
  expect(onTop, 'the note is on top at its centre').toBe(true);
  // Under the note, the paywall's plain form (L15b cut: the form "above" the toast): no error, Buy enabled.
  await expect(paywall(page), 'the paywall under the note').toBeVisible();
  await expect(buyButton(page, price), 'the form is back').toBeEnabled();
  await expect(page.locator('section', { has: paywall(page) }).getByRole('alert'), 'no error form').toHaveCount(0);
});

test('delayed webhook unlocks after polling', async ({ page, request }) => {
  test.setTimeout(90_000);
  await plantPending(request, 3004, 'ch2', CARRY);
  const price = (await ch2(request, await devToken(request, 3004))).priceStars;
  await continueToPaywall(page, 3004);
  await buy(page, price);
  const sheet = page.locator('[data-tg-mock-sheet]');
  await expect(sheet).toContainText(`${price} XTR`);
  const polls = requests(page, /\/api\/orders\/[^/]+$/);
  await sheet.locator('[data-sheet-button="pay-delayed"]').tap(); // closes `paid`; the webhook comes 3 s later
  await expect(firstLine(page)).toBeVisible({ timeout: LINE_MS });
  expect(polls.urls.length, 'order polls between the close and the line').toBeGreaterThanOrEqual(2);
});

test('paid twice grants once', async ({ page, request }) => {
  test.setTimeout(90_000);
  await plantPending(request, 3005, 'ch2', CARRY);
  const token = await devToken(request, 3005);
  const price = (await ch2(request, token)).priceStars;
  await continueToPaywall(page, 3005);
  await buy(page, price);
  const sheet = page.locator('[data-tg-mock-sheet]');
  await expect(sheet).toContainText(`${price} XTR`);
  await sheet.locator('[data-sheet-button="pay-twice"]').tap(); // `successful_payment` delivered twice
  // A second delivery the webhook did not answer 200 would close the sheet `failed`: the failed-payment note.
  await expect(firstLine(page)).toBeVisible({ timeout: LINE_MS });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 2000)));
  await expect(page.locator('[data-variant="note"]', { hasText: ru('toast.purchase_failed') })).toHaveCount(0);
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible();
  // The product is owned and cannot be bought again; the one grant per charge id is the server's (its UNIQUE).
  expect((await ch2(request, token)).owned).toBe(true);
  const again = await request.post('/api/invoices', { headers: { Authorization: `Bearer ${token}` }, data: { productId: 'chapter:ch2' } });
  expect(again.status(), 'a second invoice for an owned chapter').toBe(409);
});
