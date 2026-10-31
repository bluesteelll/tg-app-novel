// L7's e2e: the boot calls reach Telegram's real script, the viewport and safe-area variables reach the layout,
// and nothing calls window.open or a dialog (principle 5).
import { boot, events, expect, test, type E2eWindow } from './helpers.ts';

/** A CSS variable as TWA set it on <html>. */
function rootVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

test('boot records ready, expand and swipe events', async ({ page }) => {
  await boot(page);
  await expect
    .poll(async () => (await events(page)).some((e) => e.type === 'web_app_ready'), {
      message: 'web_app_ready not recorded',
    })
    .toBe(true);
  const recorded = await events(page);
  const types = recorded.map((e) => e.type);
  expect(types).toContain('web_app_expand');
  expect(recorded).toContainEqual({ type: 'web_app_setup_swipe_behavior', data: { allow_vertical_swipe: false } });
  // TWA posts it while loading: it is recorded only if the bootstrap's proxy existed before the script ran.
  expect(types).toContain('web_app_request_viewport');
  // ready() comes last, once the tap screen is in the DOM.
  expect(types.indexOf('web_app_ready')).toBeGreaterThan(types.indexOf('web_app_expand'));
});

test('viewport vars and safe areas applied', async ({ page }) => {
  await boot(page);
  // 700, not the 812 default: the default would equal #app's 100% fallback and pass without TWA.
  await page.evaluate(() => (window as unknown as E2eWindow).__tgMock.setViewport(700));
  await expect.poll(() => page.evaluate(rootVar, '--tg-viewport-stable-height')).toBe('700px');
  await expect.poll(() => page.locator('#app').evaluate((el) => el.getBoundingClientRect().height)).toBe(700);

  await page.evaluate(() =>
    (window as unknown as E2eWindow).__tgMock.setSafeArea(
      { top: 24, bottom: 34, left: 0, right: 0 },
      { top: 46, bottom: 0, left: 0, right: 0 },
    ),
  );
  await expect.poll(() => page.evaluate(rootVar, '--tg-safe-area-inset-top')).toBe('24px');
  await expect.poll(() => page.evaluate(rootVar, '--tg-content-safe-area-inset-top')).toBe('46px');
  const padding = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;padding-top:var(--app-inset-top);padding-bottom:var(--app-inset-bottom);' +
      'padding-left:var(--app-inset-left);padding-right:var(--app-inset-right)';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const sides = { top: style.paddingTop, bottom: style.paddingBottom, left: style.paddingLeft, right: style.paddingRight };
    probe.remove();
    return sides;
  });
  expect(padding).toEqual({ top: '70px', bottom: '34px', left: '0px', right: '0px' });
});

test('no window.open or alert', async ({ page }) => {
  // boot() returns once main.ts installed the mock; the rest of its boot runs synchronously after the install.
  await boot(page);
  await page.evaluate(() => {
    const mock = (window as unknown as E2eWindow).__tgMock;
    mock.pressBack();
    mock.minimize();
    mock.restore();
  });
  await expect
    .poll(async () => (await events(page)).filter((e) => e.type === 'mock_app_closed').length)
    .toBe(1);
  await page.locator('#app').tap();
  // The mock answers on a timer; let every answer and the tap's handlers run before reading the record.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  expect(await page.evaluate(() => (window as unknown as E2eWindow).__e2eForbidden)).toEqual([]);
});
