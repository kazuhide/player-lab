import test from 'node:test';
import assert from 'node:assert/strict';
import { metrics, queryBody, queryTasks } from '../lib/query.mjs';
import { metricExample, selectionFor } from '../public/query-recipes.mjs';
import { config } from '../config.mjs';

const period = { start: '2026-10-31T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' };
const filters = { asset: 'sports:SP-CLIP-A', type: 'clip', origin: 'all' };

test('displayed JSON uses the exact query builder and shapes used for account requests', () => {
  const selection = selectionFor(config, period, filters);
  assert.deepEqual(selection.assets, ['sports:SP-CLIP-A']);
  assert.equal(queryTasks.length, 12);
  for (const { metric, shape } of queryTasks) {
    const example = metricExample(selection, metric.id, shape);
    assert.deepEqual(JSON.parse(example.json), queryBody(selection, metric, '<ANALYTICS_LICENSE_KEY>', shape));
    assert.equal(example.operation, metric.operation);
    assert.equal(example.unit, metric.unit);
    assert.equal(example.divisor, metric.divisor);
    assert.doesNotMatch(example.code, /private-license|private-api/);
    assert.match(example.code, /process\.env\.BITMOVIN_API_KEY/);
    assert.match(example.code, /process\.env\.BITMOVIN_ANALYTICS_LICENSE_KEY/);
  }
});

test('recipes preserve public scope and reject a shape not used by that metric', () => {
  const selected = selectionFor(config, period, { asset: 'all', type: 'archive' });
  const recipe = JSON.parse(metricExample(selected, 'startupP95', 'assets').json);
  assert.deepEqual(recipe.filters[0], { name: 'PLATFORM', operator: 'EQ', value: 'android' });
  assert.deepEqual(recipe.filters[1].value, config.assets.filter(asset => asset.kind === 'archive').map(asset => asset.id));
  assert.equal(recipe.percentile, 95);
  assert.deepEqual(recipe.groupBy, ['VIDEO_ID']);
  assert.equal(recipe.includeContext, false);
  assert.throws(() => metricExample(selected, 'watchHours', 'hourly'), /INVALID_RECIPE/);
  assert.throws(() => selectionFor(config, period, { ...filters, asset: 'other-video' }), /INVALID_SELECTION/);
});


test('copyable Node code sends the generated request server-side and normalizes values without leaking credentials', async () => {
  const selection = selectionFor(config, period, { asset: 'sports:SP-CLIP-A', type: 'clip', origin: 'all' });
  const example = metricExample(selection, 'startupP95', 'assets');
  const requests = []; const output = [];
  const run = Object.getPrototypeOf(async function () {}).constructor('process', 'fetch', 'console', 'AbortSignal', 'Buffer', example.code);
  await run({ env: { BITMOVIN_API_KEY: 'private-api', BITMOVIN_ANALYTICS_LICENSE_KEY: 'private-license' } }, async (url, options) => {
    requests.push({ url, options });
    return Response.json({ status: 'SUCCESS', data: { result: { rows: [['sports:SP-CLIP-A', 2300]] } } });
  }, { log: value => output.push(JSON.parse(value)) }, AbortSignal, Buffer);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.bitmovin.com/v1/analytics/queries/percentile');
  assert.equal(requests[0].options.headers['X-Api-Key'], 'private-api');
  assert.deepEqual(JSON.parse(requests[0].options.body), queryBody(selection, metrics.find(metric => metric.id === 'startupP95'), 'private-license', 'assets'));
  assert.deepEqual(output, [{ metric: 'startupP95', unit: 'seconds', rows: [{ asset: 'sports:SP-CLIP-A', value: 2.3 }] }]);
  assert.doesNotMatch(JSON.stringify(output), /private-api|private-license/);
  await assert.rejects(() => run({ env: { BITMOVIN_API_KEY: 'private-api', BITMOVIN_ANALYTICS_LICENSE_KEY: 'private-license' } }, async () => Response.json({ status: 'SUCCESS', data: { result: { rows: [['unknown-video', 2300]] } } }), { log() {} }, AbortSignal, Buffer), /Unknown or duplicate video/);
});
