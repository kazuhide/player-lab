import test from 'node:test';
import assert from 'node:assert/strict';
import { LatestRequest, hourlySegments } from '../public/client.mjs';
import { fictionalRecords, parseRecords, summarizeRecords, handoffOutcome } from '../public/supplement.mjs';

test('an older successful response cannot replace the newest selection', async () => {
  const latest = new LatestRequest(); const accepted = [];
  let resolveOld;
  const old = latest.run(() => new Promise(resolve => { resolveOld = resolve; }), value => accepted.push(value), assert.fail);
  await latest.run(async () => 'new', value => accepted.push(value), assert.fail);
  resolveOld('old'); await old;
  assert.deepEqual(accepted, ['new']);
});

test('an obsolete failure cannot replace a new success, and switching views cancels acceptance', async () => {
  const latest = new LatestRequest(); const accepted = []; const errors = [];
  let rejectOld;
  const old = latest.run(() => new Promise((_resolve, reject) => { rejectOld = reject; }), value => accepted.push(value), error => errors.push(error));
  await latest.run(async () => 'new', value => accepted.push(value), error => errors.push(error));
  rejectOld(new Error('old')); await old;
  let finish;
  const pending = latest.run(() => new Promise(resolve => { finish = resolve; }), value => accepted.push(value), error => errors.push(error));
  latest.cancel(); finish('hidden'); await pending;
  assert.deepEqual(accepted, ['new']); assert.deepEqual(errors, []);
});

test('charts preserve missing hours and nulls instead of drawing through gaps', () => {
  const rows = [{ at: '2026-10-28T00:00:00Z', value: 1 }, { at: '2026-10-28T01:00:00Z', value: null }, { at: '2026-10-28T02:00:00Z', value: 2 }, { at: '2026-10-28T04:00:00Z', value: 3 }];
  assert.deepEqual(hourlySegments(rows).map(group => group.map(row => row.value)), [[1], [2], [3]]);
});

const ids = ['sports:SP-LIVE-EVENT', 'sports:SP-ARCH-EVENT'];
test('fictional handoff records produce separate confirmed and all-request rates', () => {
  const data = parseRecords(JSON.stringify(fictionalRecords()), ids);
  const summary = summarizeRecords(data);
  assert.equal(data.source, 'fictional-demo');
  assert.deepEqual({ requests: summary.requests, success: summary.success, failed: summary.failed, pending: summary.pending }, { requests: 8, success: 6, failed: 1, pending: 1 });
  assert.equal(summary.confirmedRate.toFixed(1), '85.7'); assert.equal(summary.allRate, 75); assert.equal(summary.receiverQoe, null);
});

test('handoff success needs matching video, position, intent and advancing playback', () => {
  const example = fictionalRecords().records[0];
  assert.equal(handoffOutcome(example), 'success');
  for (const patch of [{ videoId: 'sports:SP-LIVE-EVENT' }, { positionMs: 91_001 }, { playWhenReady: false }, { positionAdvanced: false }]) assert.equal(handoffOutcome({ ...example, confirmed: { ...example.confirmed, ...patch } }), 'pending');
  const paused = fictionalRecords().records[1];
  assert.equal(handoffOutcome(paused), 'success');
  assert.equal(handoffOutcome({ ...paused, failure: 'load-failed' }), 'failed');
});

test('record importer rejects unrelated videos, secrets fields, duplicate IDs, oversized input and receiver estimates', () => {
  for (const alter of [
    data => { data.records[0].requested.videoId = 'other'; },
    data => { data.records[0].apiKey = 'private'; },
    data => { data.records[1].requestId = data.records[0].requestId; },
    data => { data.records[0].receiverQoe = { startup: 0 }; },
    data => { data.records[0].requestedAt = 'not-a-time'; },
    data => { data.records[0].confirmed.positionMs = -1; },
    data => { data.records[0].requested.positionMs = 1.5; },
    data => { data.records[0].failure = 'untrusted-error-message'; },
    data => { data.records = Array.from({ length: 201 }, () => data.records[0]); },
  ]) {
    const value = fictionalRecords(); alter(value);
    assert.throws(() => parseRecords(JSON.stringify(value), ids), /INVALID_RECORDS/);
  }
  assert.throws(() => parseRecords('x'.repeat(1_048_577), ids), /INVALID_RECORDS/);
  assert.throws(() => parseRecords('{', ids), /INVALID_RECORDS/);
});

test('zero requests have unavailable rates rather than zero percent', () => {
  const data = fictionalRecords(); data.records = [];
  const summary = summarizeRecords(parseRecords(JSON.stringify(data), ids));
  assert.equal(summary.confirmedRate, null); assert.equal(summary.allRate, null);
});


test('unknown requested live-edge position is retained as pending and never becomes zero', () => {
  const data = fictionalRecords();
  data.records[0].transition = 'cast'; data.records[0].requested.positionMs = null;
  const parsed = parseRecords(JSON.stringify(data), ids);
  assert.equal(parsed.records[0].requested.positionMs, null);
  assert.equal(handoffOutcome(parsed.records[0]), 'pending');
  data.records[0].confirmed.positionMs = null;
  assert.throws(() => parseRecords(JSON.stringify(data), ids), /INVALID_RECORDS/);
});
