import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import { metrics, queryBody, queryTasks, queryRecipe } from '../public/query-recipes.mjs';
import { demoSnapshot } from '../public/demo.mjs';
import { exportSnapshot, csvCell, toCSV } from '../public/exports.mjs';
import { readFile } from 'node:fs/promises';

test('recipes use the server generator, actual supported shapes, and placeholders only', async () => {
  const server = await import('../lib/query.mjs');
  assert.equal(server.queryBody, queryBody);
  assert.equal(server.metrics, metrics);
  const shown = demoSnapshot({ asset: 'EDU-FX-02', origin: 'playlist' }, config);
  assert.equal(queryTasks().length, 12);
  for (const { metric, shape } of queryTasks()) {
    const recipe = queryRecipe(shown, config, metric.id, shape);
    assert.deepEqual(recipe.body, queryBody({ ...shown.period, ...shown.filters, assets: ['EDU-FX-02'] }, metric, 'YOUR_ANALYTICS_LICENSE_KEY', shape));
    assert.match(recipe.endpoint, new RegExp(`/queries/${metric.operation}$`));
    assert.match(recipe.node, /process.env.BITMOVIN_API_KEY/);
    assert.match(recipe.node, /process.env.BITMOVIN_ANALYTICS_LICENSE_KEY/);
    assert.match(recipe.node, new RegExp(`value / ${metric.divisor}`));
    assert.equal(recipe.body.filters.find(row => row.name === 'CUSTOM_DATA_1').value, 'playlist');
  }
  assert.throws(() => queryRecipe(shown, config, 'watchHours', 'hourly'), RangeError);
  assert.throws(() => queryRecipe({ ...shown, filters: { ...shown.filters, origin: 'unknown' } }, config, 'plays'), RangeError);
});

test('demo scenarios change individual startup/rebuffer observations while preserving counts and filters', () => {
  const selection = { asset: 'EDU-FX-02', origin: 'playlist' };
  const normal = demoSnapshot(selection, config);
  const slow = demoSnapshot({ ...selection, scenario: 'slow-start' }, config);
  const buffering = demoSnapshot({ ...selection, scenario: 'rebuffering' }, config);
  assert.deepEqual(slow, demoSnapshot({ ...selection, scenario: 'slow-start' }, config));
  for (const result of [normal, slow, buffering]) {
    assert.equal(result.metrics.plays.value, normal.metrics.plays.value);
    assert.equal(result.metrics.watchHours.value, normal.metrics.watchHours.value);
    assert.deepEqual(result.filters, normal.filters);
    assert.equal(result.requestedAt, null); assert.equal(result.fetchedAt, null);
    assert.ok(result.metrics.startupP95.value >= result.metrics.startupMedian.value);
  }
  assert.ok(slow.metrics.startupP95.value > normal.metrics.startupP95.value * 2);
  assert.ok(buffering.metrics.rebufferPercentage.value > normal.metrics.rebufferPercentage.value * 2);
  assert.equal(slow.metrics.rebufferPercentage.value, normal.metrics.rebufferPercentage.value);
  assert.equal(buffering.metrics.startupP95.value, normal.metrics.startupP95.value);
  const lesson = demoSnapshot({ asset: 'EDU-FX-01', origin: 'catalog', scenario: 'slow-start' }, config);
  assert.equal(lesson.metrics.plays.value, 96);
  assert.equal(lesson.metrics.startupP95.value, 12.49);
  assert.notEqual(lesson.metrics.startupP95.value, lesson.series.startupP95.rows.reduce((sum, row) => sum + row.value, 0) / lesson.series.startupP95.rows.length);
  assert.throws(() => demoSnapshot({ scenario: 'unknown' }, config), RangeError);
});

test('exports retain actual snapshot context, null, zero, partial and earlier results but omit arbitrary data', () => {
  const snapshot = demoSnapshot({ asset: 'EDU-FX-01', origin: 'catalog', scenario: 'slow-start' }, config);
  snapshot.status = 'partial'; snapshot.stale = true;
  snapshot.fetchedAt = '2026-10-22T01:00:00.000Z';
  snapshot.secret = 'private'; snapshot.source = 'private'; snapshot.filters.userId = 'private';
  snapshot.metrics.plays.value = 0; snapshot.metrics.plays.userId = 'private';
  snapshot.metrics.startupP95 = { status: 'error', value: null, code: 'TIMEOUT', userId: 'private' };
  snapshot.series.plays.rows[0].private = 'private';
  snapshot.comparison.plays.rows.push({ asset: 'private', value: 1 });
  const result = exportSnapshot(snapshot, config, { dataSource: 'measured', viewStatus: 'error', exportedAt: '2026-10-22T02:00:00.000Z' });
  assert.equal(result.dataSource, 'measured'); assert.equal(result.scenario, null);
  assert.equal(result.dataStatus, 'partial'); assert.equal(result.viewStatus, 'error');
  assert.equal(result.isEarlier, true); assert.equal(result.isPartial, true);
  assert.deepEqual(result.period, snapshot.period); assert.equal(result.filters.asset, 'EDU-FX-01');
  assert.equal(result.fetchedAt, snapshot.fetchedAt); assert.equal(result.latestSampleAt, null);
  assert.equal(result.metrics.plays.value, 0);
  assert.deepEqual(result.metrics.startupP95, { status: 'error', value: null, unit: 'seconds', code: 'TIMEOUT' });
  assert.doesNotMatch(JSON.stringify(result), /private/);
  assert.doesNotMatch(toCSV(result), /private/);
  assert.match(toCSV(result), /"isEarlier"/);
  assert.throws(() => exportSnapshot(null, config, { dataSource: 'measured' }), RangeError);
  assert.throws(() => exportSnapshot(snapshot, config, { dataSource: 'unexpected' }), RangeError);
});

test('CSV escapes quotes, newlines and formula prefixes without changing numeric zero or null', () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  for (const value of ['=SUM(1,2)', '+1', '-1', '@x', ' \t=1', '\rformula', '\ttext', '\ntext', '＝1', '＋1', '－1', '＠x', '\uFEFF=1']) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell(0), '"0"'); assert.equal(csvCell(null), '""');
});

test('the public example is an exact fictional export from the deterministic generator', async () => {
  const example = JSON.parse(await readFile(new URL('../examples/fictional-learning-quality.json', import.meta.url), 'utf8'));
  assert.deepEqual(example, exportSnapshot(demoSnapshot({ asset: 'EDU-FX-01', scenario: 'slow-start' }, config), config, { dataSource: 'demo', exportedAt: '2026-10-22T00:00:00.000Z' }));
});

test('copied Node examples execute locally with mock responses, preserve null and reject missing server credentials', async () => {
  const snapshot = demoSnapshot({}, config);
  const recipe = queryRecipe(snapshot, config, 'startupP95', 'hourly');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('fetch', 'process', 'console', recipe.node);
  let request; let logged;
  await run(async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ status: 'SUCCESS', data: { result: { rows: [[1792540800000, 2500], [1792544400000, null]] } } }) };
  }, { env: { BITMOVIN_API_KEY: 'fictional-api-key', BITMOVIN_ANALYTICS_LICENSE_KEY: 'fictional-license' } }, { log: value => { logged = JSON.parse(value); } });
  assert.equal(request.options.headers['X-Api-Key'], 'fictional-api-key');
  assert.equal(JSON.parse(request.options.body).licenseKey, 'fictional-license');
  assert.deepEqual(logged, { unit: 'seconds', rows: [[1792540800000, 2.5], [1792544400000, null]] });
  await assert.rejects(run(() => assert.fail('No credentials must prevent fetching'), { env: {} }, console), /Set the server environment/);
});
