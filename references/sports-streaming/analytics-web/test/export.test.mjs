import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDemoData } from '../public/demo.mjs';
import { exportSnapshot, exportCsv, csvCell } from '../public/export.mjs';
import { config } from '../config.mjs';

const exportedAt = '2026-11-01T00:00:00.000Z';
const options = { mode: 'demo', viewStatus: 'demoReady', exportedAt, config };

test('demo JSON retains source, scenario, scope, units, nulls and zeros without credential fields', () => {
  const input = createDemoData(config, { scenario: 'rebuffering', asset: 'sports:SP-CLIP-A' });
  input.apiKey = 'private-api'; input.filters.licenseKey = 'private-license';
  input.metrics.plays.userEmail = 'person@example.invalid';
  const output = exportSnapshot(input, options);
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.dataSource, 'demo');
  assert.equal(output.scenario, 'rebuffering');
  assert.equal(output.fetchedAt, null);
  assert.deepEqual(output.period, input.period);
  assert.deepEqual(output.filters, { asset: 'sports:SP-CLIP-A', type: 'all', origin: 'all', platform: 'android' });
  assert.equal(output.metrics.startupMedian.unit, 'seconds');
  assert.equal(output.metrics.errorPercentage.value, input.metrics.errorPercentage.value);
  assert.doesNotMatch(JSON.stringify(output), /private-api|private-license|person@|userEmail|licenseKey/);
});

test('retained measured exports identify earlier successful data and preserve original period', () => {
  const input = createDemoData(config); input.source = 'Bitmovin Analytics Query API';
  input.fetchedAt = '2026-10-31T01:00:00.000Z'; input.requestedAt = '2026-10-31T00:59:58.000Z'; input.stale = true;
  input.metrics.startupP95 = { status: 'error', value: null, unit: 'seconds', code: 'TIMEOUT' };
  input.series.startupP95 = { status: 'error', rows: [], code: 'TIMEOUT' };
  input.status = 'partial';
  const output = exportSnapshot(input, { ...options, mode: 'measured', viewStatus: 'error' });
  assert.equal(output.isEarlier, true);
  assert.equal(output.dataStatus, 'partial');
  assert.equal(output.viewStatus, 'error');
  assert.equal(output.scenario, null);
  assert.equal(output.fetchedAt, input.fetchedAt);
  assert.equal(output.metrics.startupP95.value, null);
  assert.equal(output.series.startupP95.code, 'TIMEOUT');
  assert.deepEqual(output.period, input.period);
  const csv = exportCsv(output);
  assert.match(csv, /TIMEOUT/); assert.match(csv, /startupP95/);
  assert.match(csv, /true/); assert.match(csv, /partial/);
});

test('CSV cells quote delimiters and prevent spreadsheet formula interpretation', () => {
  for (const value of ['=1+1', '+CMD()', '-2+3', '@SUM(1)', '\t=1', '\r=2', '  =3', '\ufeff=4', '＝1+1', '＋1', '－1', '＠SUM(1)', '\ntext', '\ttext']) {
    assert.ok(csvCell(value).startsWith('"\''), JSON.stringify(value));
  }
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell(0), '"0"'); assert.equal(csvCell(null), '""');
});

test('export rejects unknown videos, source relabeling and malformed numeric values', () => {
  const input = createDemoData(config);
  assert.throws(() => exportSnapshot(input, { ...options, mode: 'measured' }), /INVALID_EXPORT/);
  input.comparison.plays.rows[0].asset = 'private-video';
  assert.throws(() => exportSnapshot(input, options), /INVALID_EXPORT/);
  const other = createDemoData(config); other.metrics.plays.value = Infinity;
  assert.throws(() => exportSnapshot(other, options), /INVALID_EXPORT/);
});


test('published fictional JSON is a reproducible export from individual demo sessions', async () => {
  const sample = JSON.parse(await readFile(new URL('../examples/demo-rebuffering.json', import.meta.url), 'utf8'));
  const input = createDemoData(config, { scenario: 'rebuffering', type: 'clip', asset: 'sports:SP-CLIP-A' });
  assert.deepEqual(sample, exportSnapshot(input, options));
  assert.equal(sample.dataSource, 'demo'); assert.equal(sample.requestedAt, null);
  assert.doesNotMatch(JSON.stringify(sample), /licenseKey|apiKey|email|userId|sessionId/i);
});
