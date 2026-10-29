import test from 'node:test';
import assert from 'node:assert/strict';
import { LatestRequest, hourlySegments, qualityStatus } from '../public/client.mjs';

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


const statusText = { ok: "Query API data", error: "Query failed", loading: "Fetching", empty: "No data", noQuery: "Not fetched", retryLater: "Retry after", earlierResults: "Showing earlier results" };
const status = selection => qualityStatus({ now: 1000, ...selection }, key => statusText[key], iso => iso);
const previous = { fetchedAt: "2026-10-29T00:00:00.000Z" };

test("a rate-limited fetch keeps the earlier-result qualification through cooldown and expiry", () => {
  const retained = { ...previous, stale: true };
  assert.equal(status({ state: "error", result: retained, cooldownUntil: 2000 }), "Retry after: 1970-01-01T00:00:02.000Z Showing earlier results");
  assert.equal(status({ state: "error", result: retained, cooldownUntil: 1000 }), "Query failed Showing earlier results");
  assert.equal(status({ state: "ok", result: previous, cooldownUntil: 1000 }), "Query API data");
});

test("loading qualifies retained values even before a refresh outcome is known", () => {
  assert.equal(status({ state: "loading", result: previous, loading: true }), "Fetching Showing earlier results");
  assert.equal(status({ state: "loading", result: { ...previous, stale: true }, loading: true }), "Fetching Showing earlier results");
});

test("unfetched, first-loading and fresh empty results never acquire an earlier-result label", () => {
  assert.equal(status({ state: "noQuery", result: null }), "Not fetched");
  assert.equal(status({ state: "loading", result: null, loading: true }), "Fetching");
  assert.equal(status({ state: "empty", result: previous }), "No data");
});

test("a rate limit without retained results does not invent an earlier measurement", () => {
  assert.equal(status({ state: "error", result: null, cooldownUntil: 2000 }), "Retry after: 1970-01-01T00:00:02.000Z");
});
