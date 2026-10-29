import test from 'node:test';
import assert from 'node:assert/strict';
import { LatestRequest, hourlySegments } from '../public/client.mjs';

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
