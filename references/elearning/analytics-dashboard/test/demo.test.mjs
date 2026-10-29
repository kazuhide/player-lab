import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import { demoSnapshot } from '../public/demo.mjs';

test('the demo contains deterministic synthetic data without an API fetch time', () => {
  const first = demoSnapshot({}, config);
  assert.deepEqual(first, demoSnapshot({}, config));
  assert.equal(first.status, 'demo');
  assert.equal(first.source, 'Synthetic demo data');
  assert.equal(first.fetchedAt, null);
  assert.equal(Date.parse(first.period.end) - Date.parse(first.period.start), 86_400_000);
  assert.ok(first.metrics.plays.value > 0);
  assert.ok(first.metrics.watchHours.value > 0);
  assert.ok(first.metrics.startupP95.value >= first.metrics.startupMedian.value);
  assert.equal(first.metrics.plays.value, first.series.plays.rows.reduce((sum, row) => sum + row.value, 0));
  assert.equal(first.metrics.plays.value, first.comparison.plays.rows.reduce((sum, row) => sum + row.value, 0));
});

test('lesson and entry filters select the synthetic observations rather than scaling a global value', () => {
  const all = demoSnapshot({}, config);
  const selected = demoSnapshot({ asset: config.assets[1].id, origin: 'playlist' }, config);
  assert.deepEqual(selected.comparison.plays.rows.map(row => row.asset), [config.assets[1].id]);
  assert.ok(selected.metrics.plays.value > 0 && selected.metrics.plays.value < all.metrics.plays.value);
  const catalog = demoSnapshot({ origin: 'catalog' }, config);
  const playlist = demoSnapshot({ origin: 'playlist' }, config);
  assert.equal(catalog.metrics.plays.value + playlist.metrics.plays.value, all.metrics.plays.value);
  assert.notEqual(catalog.metrics.startupMedian.value, playlist.metrics.startupMedian.value);
  assert.throws(() => demoSnapshot({ asset: 'unrelated' }, config));
  assert.throws(() => demoSnapshot({ origin: 'unrelated' }, config));
});
