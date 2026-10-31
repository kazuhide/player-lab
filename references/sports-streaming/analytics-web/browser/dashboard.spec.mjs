import { test as base, expect } from '@playwright/test';
import { config } from '../config.mjs';

const ids = ['plays', 'watchHours', 'startupMedian', 'startupP95', 'rebufferPercentage', 'errorPercentage'];
const text = {
  en: { demo: 'Demo data', measured: 'Measured data', load: 'Load demo data', fetch: 'Fetch data', ok: 'Query API data', empty: 'No data for this selection.', partial: 'Some queries failed. Available results are shown.', error: 'Query failed. Check the server configuration and try again.', earlier: 'Showing earlier results.', limited: 'Rate limited. Try again after', pending: 'Fetching playback quality…' },
  ja: { demo: 'デモデータ', measured: '実測データ', load: 'デモデータを読み込む', fetch: '取得する', ok: 'Query APIの取得結果', empty: 'この条件のデータはありません。', partial: '一部の照会に失敗しました。取得できた結果を表示します。', error: '照会に失敗しました。サーバーの設定を確認し、再試行してください。', earlier: '前回取得した値を表示しています。', limited: '照会回数の制限に達しました。再試行できる時刻', pending: '再生品質を取得しています。' },
};

// Fictional responses follow the public BFF contract; no account data or keys.
function snapshot(request, { shape = 'ok', plays = 101 } = {}) {
  const params = new URL(request.url()).searchParams;
  const start = params.get('start'); const end = params.get('end');
  const values = shape === 'empty' ? ids.map(() => null) : shape === 'zero' ? [0, 0, null, null, 0, 0] : [plays, 2.5, 1.2, 2.3, 0, 0];
  const fetchedAt = '2026-10-31T12:00:00.000Z';
  const result = {
    status: shape === 'zero' ? 'ok' : shape,
    source: 'Bitmovin Analytics Query API', requestedAt: fetchedAt, fetchedAt, latestSampleAt: null,
    period: { start, end, interval: 'HOUR' },
    filters: { asset: params.get('asset'), origin: params.get('origin'), type: params.get('type'), platform: 'android' },
    metrics: Object.fromEntries(ids.map((id, i) => [id, { status: values[i] === null ? 'empty' : 'ok', value: values[i], rows: [{ value: values[i] }], fetchedAt }])),
    series: {}, comparison: {},
  };
  for (const id of ['plays', 'startupMedian', 'startupP95']) result.series[id] = { status: shape === 'empty' ? 'empty' : 'ok', rows: shape === 'empty' ? [] : [{ at: start, value: result.metrics[id].value }], fetchedAt };
  const assets = config.assets.filter(asset => (result.filters.asset === 'all' || result.filters.asset === asset.id) && (result.filters.type === 'all' || result.filters.type === asset.kind));
  for (const id of ['plays', 'startupP95', 'errorPercentage']) result.comparison[id] = { status: shape === 'empty' ? 'empty' : 'ok', rows: shape === 'empty' ? [] : assets.map(asset => ({ asset: asset.id, value: result.metrics[id].value })), fetchedAt };
  if (shape === 'partial') result.metrics.startupP95 = { status: 'error', value: null, rows: [], code: 'UPSTREAM_ERROR', fetchedAt: null };
  return result;
}

const test = base.extend({
  configured: [true, { option: true }],
  dashboard: async ({ page, baseURL, configured, locale }, use) => {
    const calls = []; const errors = []; const external = []; const pending = [];
    let responder = route => route.fulfill({ json: snapshot(route.request()) });
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== baseURL) { external.push(url.origin); return route.abort(); }
      if (url.pathname === '/api/config') {
        const response = await route.fetch(); const json = await response.json();
        expect(json.queryConfigured).toBe(false);
        return route.fulfill({ response, json: { ...json, queryConfigured: configured } });
      }
      if (url.pathname === '/api/qoe') { calls.push(url.searchParams); return responder(route); }
      return route.continue();
    });
    const t = text[locale.startsWith('ja') ? 'ja' : 'en'];
    const dashboard = {
      calls, t,
      demo: page.getByRole('link', { name: t.demo, exact: true }),
      measured: page.getByRole('link', { name: t.measured, exact: true }),
      fetch: page.getByRole('button', { name: t.fetch, exact: true }),
      status: page.locator('#status'), values: page.locator('.metric-value'),
      async open(hash = '') { await page.goto(`/${hash}`); await expect(page.locator('#asset option')).not.toHaveCount(0); await expect(page.locator('#status')).not.toBeEmpty(); },
      reply(options) { responder = route => route.fulfill({ json: snapshot(route.request(), options) }); },
      fail(status, headers = {}) { responder = route => route.fulfill({ status, headers, json: { code: 'QUERY_FAILED' } }); },
      hold(options) {
        let release; const gate = new Promise(resolve => { release = resolve; });
        let settled; const done = new Promise(resolve => { settled = resolve; });
        responder = async route => { pending.push({ release, done }); await gate; try { await route.fulfill({ json: snapshot(route.request(), options) }); } finally { settled(); } };
        return async () => { release(); await done; };
      },
    };
    try { await use(dashboard); }
    finally { for (const gate of pending) gate.release(); await Promise.all(pending.map(gate => gate.done)); expect(errors).toEqual([]); expect(external).toEqual([]); }
  },
});

async function expectUnfetched(dashboard) {
  await expect(dashboard.values).toHaveCount(6);
  await expect(dashboard.values).toHaveText(Array(6).fill(/^—/));
}

// The actual keyless server remains useful without a fabricated config flag.
test.describe('without query credentials', () => {
  test.use({ configured: false });
  test('demo renders and filters locally; measured setup never borrows demo values', async ({ page, dashboard }) => {
    await dashboard.open();
    await expect(dashboard.demo).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#period-field')).toBeHidden();
    await expect(page.locator('#plays-chart svg')).toBeVisible();
    const initial = await dashboard.values.first().textContent();
    await page.locator('#asset').selectOption(config.assets[0].id);
    await expect(dashboard.values.first()).not.toHaveText(initial);
    await expect(page.locator('#comparison-table tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: dashboard.t.load, exact: true }).click();
    await dashboard.measured.click();
    await expect(page.locator('.setup')).toBeVisible();
    await expect(dashboard.fetch).toBeDisabled();
    await expectUnfetched(dashboard);
    expect(dashboard.calls).toHaveLength(0);
    await expect(page.locator('html')).toHaveAttribute('lang', dashboard.t === text.ja ? 'ja' : 'en');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test('measured data requires an explicit fetch and keeps selection, charts and language', async ({ page, dashboard }) => {
  await dashboard.open('#measured'); await expectUnfetched(dashboard);
  await page.locator('#asset').selectOption(config.assets[0].id);
  await page.locator('#period').selectOption('168');
  expect(dashboard.calls).toHaveLength(0);
  await dashboard.fetch.click();
  await expect(dashboard.status).toHaveText(dashboard.t.ok);
  expect(dashboard.calls).toHaveLength(1);
  expect(dashboard.calls[0].get('asset')).toBe(config.assets[0].id);
  expect(Date.parse(dashboard.calls[0].get('end')) - Date.parse(dashboard.calls[0].get('start'))).toBe(7 * 86_400_000);
  await expect(dashboard.values.first()).toHaveText(/^101/);
  await expect(page.locator('#plays-chart svg')).toBeVisible();
  await expect(page.locator('#comparison-table tbody tr')).toHaveCount(1);
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', dashboard.t === text.ja ? 'en' : 'ja');
  await expect(dashboard.values.first()).toHaveText(/^101/);
  expect(dashboard.calls).toHaveLength(1);
});

test('skip link preserves fetched results; empty-hash Back restores demo and Forward is unfetched', async ({ page, dashboard }) => {
  await dashboard.open(); await dashboard.measured.click(); await dashboard.fetch.click();
  await expect(dashboard.values.first()).toHaveText(/^101/);
  await page.goto('/#main');
  await expect(dashboard.measured).toHaveAttribute('aria-current', 'page');
  await expect(dashboard.values.first()).toHaveText(/^101/);
  await page.goBack(); await expect(page).toHaveURL(/#measured$/);
  await page.keyboard.press('Tab');
  await page.locator('.skip-link').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(dashboard.measured).toHaveAttribute('aria-current', 'page');
  await expect(dashboard.values.first()).toHaveText(/^101/);
  await expect(page).toHaveURL(/#measured$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(dashboard.demo).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: dashboard.t.load, exact: true })).toBeEnabled();
  await page.goForward();
  await expect(dashboard.measured).toHaveAttribute('aria-current', 'page');
  await expectUnfetched(dashboard);
  expect(dashboard.calls).toHaveLength(1);
});

test('pending request survives skip navigation, but filter and mode changes discard late responses', async ({ page, dashboard }) => {
  await dashboard.open('#measured');
  let release = dashboard.hold({ plays: 202 });
  await dashboard.fetch.click(); await expect(dashboard.fetch).toBeDisabled();
  await expect.poll(() => dashboard.calls.length).toBe(1);
  await expect(dashboard.status).toHaveText(dashboard.t.pending);
  await page.locator('.skip-link').focus(); await page.keyboard.press('Enter');
  await expect(dashboard.measured).toHaveAttribute('aria-current', 'page');
  await release(); await expect(dashboard.values.first()).toHaveText(/^202/);
  release = dashboard.hold({ plays: 303 });
  await dashboard.fetch.click(); await expect(dashboard.fetch).toBeDisabled();
  await expect.poll(() => dashboard.calls.length).toBe(2);
  await page.locator('#asset').selectOption(config.assets[1].id);
  await expectUnfetched(dashboard); await release();
  await expectUnfetched(dashboard);
  release = dashboard.hold({ plays: 404 });
  await dashboard.fetch.click(); await expect(dashboard.fetch).toBeDisabled();
  await expect.poll(() => dashboard.calls.length).toBe(3);
  await dashboard.demo.click(); await expect(dashboard.demo).toHaveAttribute('aria-current', 'page');
  const demo = await dashboard.values.first().textContent();
  await release(); await expect(dashboard.values.first()).toHaveText(demo);
  await dashboard.measured.click(); await expectUnfetched(dashboard);
  dashboard.reply({ plays: 505 }); await dashboard.fetch.click();
  await expect(dashboard.values.first()).toHaveText(/^505/);
  expect(dashboard.calls).toHaveLength(4);
});

test('empty, valid zero and partial responses have distinct visible states', async ({ dashboard }) => {
  await dashboard.open('#measured');
  dashboard.reply({ shape: 'empty' }); await dashboard.fetch.click();
  await expect(dashboard.status).toHaveText(dashboard.t.empty); await expectUnfetched(dashboard);
  dashboard.reply({ shape: 'zero' }); await dashboard.fetch.click();
  await expect(dashboard.status).toHaveText(dashboard.t.ok);
  await expect(dashboard.values.first()).toHaveText(/^0/); await expect(dashboard.values.nth(2)).toHaveText(/^—/);
  await expect(dashboard.values.nth(5)).toHaveText(/^0/);
  dashboard.reply({ shape: 'partial' }); await dashboard.fetch.click();
  await expect(dashboard.status).toHaveText(dashboard.t.partial);
  await expect(dashboard.values.first()).toHaveText(/^101/); await expect(dashboard.values.nth(3)).toHaveText(/^—/);
  expect(dashboard.calls).toHaveLength(3);
});

test('failed first fetch stays empty and an explicit retry can succeed', async ({ dashboard }) => {
  await dashboard.open('#measured'); dashboard.fail(500); await dashboard.fetch.click();
  await expect(dashboard.status).toHaveText(dashboard.t.error); await expectUnfetched(dashboard);
  dashboard.reply({ plays: 606 }); await dashboard.fetch.click();
  await expect(dashboard.status).toHaveText(dashboard.t.ok); await expect(dashboard.values.first()).toHaveText(/^606/);
  expect(dashboard.calls).toHaveLength(2);
});

test('rate limiting retains qualified earlier results and enables retry after the deadline', async ({ page, dashboard }) => {
  await dashboard.open('#measured'); await dashboard.fetch.click(); await expect(dashboard.values.first()).toHaveText(/^101/);
  dashboard.fail(429, { 'Retry-After': '1' }); await dashboard.fetch.click();
  await expect(dashboard.status).toContainText(dashboard.t.limited); await expect(dashboard.status).toContainText(dashboard.t.earlier);
  await expect(dashboard.values.first()).toHaveText(/^101/); await expect(dashboard.fetch).toBeDisabled();
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:02Z'));
  await expect(dashboard.fetch).toBeEnabled();
  dashboard.reply({ plays: 707 }); await dashboard.fetch.click();
  await expect(dashboard.values.first()).toHaveText(/^707/); await expect(dashboard.status).toHaveText(dashboard.t.ok);
  expect(dashboard.calls).toHaveLength(3);
});

test('keyboard navigation and custom UTC controls remain usable at the configured viewport', async ({ page, dashboard }) => {
  await dashboard.open(); await page.keyboard.press('Tab'); await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#main')).toBeFocused();
  await dashboard.measured.click(); await page.locator('#period').selectOption('custom');
  await expect(page.locator('#custom-range')).toBeVisible();
  await page.locator('#start').fill('2026-10-30T12:00'); await page.locator('#end').fill('2026-10-31T12:00');
  await dashboard.fetch.click(); await expect(dashboard.status).toHaveText(dashboard.t.ok);
  expect(dashboard.calls[0].get('start')).toBe('2026-10-30T12:00:00.000Z');
  expect(dashboard.calls[0].get('end')).toBe('2026-10-31T12:00:00.000Z');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
