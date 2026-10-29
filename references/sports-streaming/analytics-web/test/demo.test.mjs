import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import { createDemoData } from '../public/demo.mjs';

test('key-free demo contains a fixed synthetic period, metric cards, hourly trends and known videos', () => {
  const demo = createDemoData(config);
  assert.equal(demo.source, 'synthetic-demo');
  assert.equal(demo.fetchedAt, null);
  assert.equal(Date.parse(demo.period.end) - Date.parse(demo.period.start), 86_400_000);
  assert.ok(demo.metrics.plays.value > 0);
  assert.ok(demo.metrics.watchHours.value > 0);
  assert.ok(demo.metrics.startupP95.value >= demo.metrics.startupMedian.value);
  assert.equal(demo.series.plays.rows.reduce((sum, row) => sum + row.value, 0), demo.metrics.plays.value);
  assert.equal(demo.comparison.plays.rows.reduce((sum, row) => sum + row.value, 0), demo.metrics.plays.value);
  assert.deepEqual(demo.comparison.plays.rows.map(row => row.asset), config.assets.map(asset => asset.id));
  assert.deepEqual(createDemoData(config), demo, 'reloading the demo does not become a fresh measurement');
});

test('demo filters recompute metrics and comparisons from the selected synthetic sessions', () => {
  const all = createDemoData(config);
  const live = createDemoData(config, { type: 'live' });
  const clip = createDemoData(config, { asset: 'sports:SP-CLIP-A', type: 'clip' });
  assert.ok(live.metrics.plays.value > 0 && live.metrics.plays.value < all.metrics.plays.value);
  assert.deepEqual(live.comparison.plays.rows.map(row => row.asset), config.assets.filter(asset => asset.kind === 'live').map(asset => asset.id));
  assert.deepEqual(clip.comparison.plays.rows.map(row => row.asset), ['sports:SP-CLIP-A']);
  assert.equal(clip.series.plays.rows.reduce((sum, row) => sum + row.value, 0), clip.metrics.plays.value);
  const meanHourlyP95 = clip.series.startupP95.rows.filter(row => row.value !== null).reduce((sum, row, _index, rows) => sum + row.value / rows.length, 0);
  assert.notEqual(clip.metrics.startupP95.value, meanHourlyP95, 'period percentiles are not means of hourly percentiles');
});

test('an incompatible selection has no values rather than borrowing another video', () => {
  const demo = createDemoData(config, { asset: 'sports:SP-CLIP-A', type: 'live' });
  assert.equal(demo.status, 'empty');
  assert.equal(demo.metrics.plays.value, 0);
  assert.equal(demo.metrics.startupP95.value, null);
  assert.deepEqual(demo.comparison.plays.rows, []);
});
