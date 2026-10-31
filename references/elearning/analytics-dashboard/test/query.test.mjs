import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import { createAnalyticsService, validateParameters, queryBody, metrics, normalizeRows } from '../lib/query.mjs';

const now = Date.parse('2026-10-28T12:00:00.000Z');
const parameters = () => new URLSearchParams({ start: '2026-10-27T12:00:00.000Z', end: '2026-10-28T12:00:00.000Z' });
const selection = () => validateParameters(parameters(), config, now);
const reply = rows => new Response(JSON.stringify({ status: 'SUCCESS', data: { result: { rows, rowCount: rows.length } } }), { headers: { 'Content-Type': 'application/json' } });
const credentials = { apiKey: 'test-api-key-never-public', licenseKey: 'test-license-never-public' };
const service = options => createAnalyticsService({ config, ...credentials, clock: () => now, ...options });
function validResponse(_url, request) {
  const body = JSON.parse(request.body);
  return Promise.resolve(reply(body.interval ? [[Date.parse(body.start), 0]] : body.groupBy ? [[body.filters[1].value[0], 0]] : [[0]]));
}

test('only predefined parameters and valid UTC periods are accepted', () => {
  for (const [key, value] of [['url', 'https://example.test'], ['licenseKey', 'other'], ['dimension', 'IP_ADDRESS'], ['interval', 'MINUTE'], ['asset', 'unknown'], ['type', 'unknown'], ['origin', 'unknown']]) {
    const params = parameters(); params.set(key, value);
    assert.throws(() => validateParameters(params, config, now));
  }
  for (const value of ['2026-10-28', '2026-02-30T12:00:00.000Z', '2026-10-28T12:00:00+00:00', '2026-10-19T12:00:00.000Z']) {
    const params = parameters(); params.set('start', value);
    assert.throws(() => validateParameters(params, config, now));
  }
  const duplicate = parameters(); duplicate.append('asset', 'all'); duplicate.append('asset', 'all');
  assert.throws(() => validateParameters(duplicate, config, now));
});

test('six metric definitions use official operations, positive filters, and units', () => {
  assert.equal(metrics.length, 6);
  for (const metric of metrics) {
    const body = queryBody(selection(), metric, 'server-license');
    assert.equal(body.licenseKey, 'server-license');
    assert.deepEqual(body.filters.slice(0, 2), [
      { name: 'PLATFORM', operator: 'EQ', value: 'android' },
      { name: 'VIDEO_ID', operator: 'IN', value: config.assets.map(asset => asset.id) },
    ]);
    assert.equal(body.interval, undefined);
    assert.equal(body.groupBy, undefined);
    assert.equal(body.limit, 200);
    assert.equal(body.includeContext, false, 'context cells are not metric values');
    if (metric.positive) assert.deepEqual(body.filters.at(-1), { name: metric.positive, operator: 'GT', value: 0 });
    else assert.equal(body.filters.length, 2);
    assert.equal(body.percentile, metric.id === 'startupP95' ? 95 : undefined);
  }
  assert.equal(normalizeRows([[3_600_000]], metrics[1], 'total', selection())[0].value, 1);
  assert.equal(normalizeRows([[2050]], metrics[2], 'total', selection())[0].value, 2.05);
  assert.equal(normalizeRows([[4]], metrics[5], 'total', selection())[0].value, 4);
});

test('start-origin filtering is restricted to the application contract', () => {
  const params = parameters();
  if (config.kind === 'elearning') {
    params.set('origin', 'playlist');
    assert.deepEqual(queryBody(validateParameters(params, config, now), metrics[0], 'server').filters.at(-1), { name: 'CUSTOM_DATA_1', operator: 'EQ', value: 'playlist' });
    params.set('origin', 'bookmark');
    assert.throws(() => validateParameters(params, config, now));
  } else {
    params.set('origin', 'playlist');
    assert.throws(() => validateParameters(params, config, now));
    assert.equal(JSON.stringify(queryBody(selection(), metrics[0], 'server')).includes('CUSTOM_DATA'), false);
  }
});

test('unconfigured, zero, empty and failed responses remain distinct and never expose secrets', async () => {
  const unavailable = createAnalyticsService({ config, apiKey: '', licenseKey: '', clock: () => now, fetchImpl: () => assert.fail('unexpected request') });
  assert.equal((await unavailable.query(parameters())).status, 'unconfigured');
  const zero = await service({ fetchImpl: validResponse }).query(parameters());
  assert.equal(zero.status, 'ok');
  assert.equal(zero.metrics.plays.value, 0);
  assert.equal(zero.metrics.plays.status, 'ok');
  assert.equal(zero.latestSampleAt, null);
  const empty = await service({ fetchImpl: async () => reply([]) }).query(parameters());
  assert.equal(empty.status, 'empty');
  assert.equal(empty.metrics.plays.value, null);
  const failed = await service({ fetchImpl: async () => new Response('upstream secret response', { status: 403 }) }).query(parameters());
  assert.equal(failed.status, 'error');
  assert.equal(failed.metrics.plays.code, 'ACCESS_DENIED');
  assert.equal(failed.metrics.plays.value, null);
  assert.doesNotMatch(JSON.stringify({ zero, empty, failed }), /test-api-key|test-license|upstream secret/);
});

test('whole-period percentiles and grouped/hourly queries are separate requests', async () => {
  const calls = [];
  const result = await service({ fetchImpl: async (url, request) => { calls.push({ url, body: JSON.parse(request.body) }); return validResponse(url, request); } }).query(parameters());
  assert.equal(result.status, 'ok');
  assert.equal(calls.length, 12);
  assert.ok(calls.every(call => /^https:\/\/api\.bitmovin\.com\/v1\/analytics\/queries\/(count|sum|median|percentile|avg)$/.test(call.url)));
  const p95 = calls.filter(call => call.url.endsWith('/percentile'));
  assert.equal(p95.length, 3);
  assert.equal(p95.filter(call => !call.body.interval && !call.body.groupBy).length, 1);
  assert.equal(p95.filter(call => call.body.interval === 'HOUR').length, 1);
  assert.equal(p95.filter(call => call.body.groupBy?.[0] === 'VIDEO_ID').length, 1);
});

test('maximum active requests is three, concurrent requests deduplicate, and each later fetch queries again', async () => {
  let active = 0; let peak = 0; let calls = 0; let clock = now;
  const api = service({ clock: () => clock, fetchImpl: async (url, request) => {
    active += 1; peak = Math.max(peak, active); calls += 1;
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1; return validResponse(url, request);
  } });
  const [a, b] = await Promise.all([api.query(parameters()), api.query(parameters())]);
  assert.equal(calls, 12); assert.equal(peak, 3); assert.deepEqual(a, b);
  clock += 10_000;
  const fresh = await api.query(parameters());
  assert.equal(fresh.fetchedAt, new Date(clock).toISOString());
  assert.notEqual(fresh.fetchedAt, a.fetchedAt); assert.equal(calls, 24);
  clock += 1; await api.query(parameters()); assert.equal(calls, 36);
});

test('a full page fetches offset 200 and malformed or excess rows never become a complete result', async () => {
  const offsets = [];
  const result = await service({ fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body); offsets.push(body.offset);
    return reply(body.offset === 0 ? Array.from({ length: 200 }, () => [1]) : []);
  } }).query(parameters());
  assert.equal(result.status, 'error');
  assert.ok(offsets.includes(200));
  assert.equal(result.metrics.plays.code, 'INVALID_RESPONSE');
  const bounded = await service({ fetchImpl: async () => reply(Array.from({ length: 200 }, () => [1])) }).query(parameters());
  assert.equal(bounded.metrics.plays.code, 'INCOMPLETE_RESPONSE');
});

test('response normalization rejects foreign assets, duplicate times, invalid numbers and excessive chart points', () => {
  const metric = metrics[0]; const s = selection();
  for (const rows of [[[Infinity]], [['1']], [[-1]], [[1, 2]]]) assert.throws(() => normalizeRows(rows, metric, 'total', s));
  assert.throws(() => normalizeRows([['unrelated-video', 12]], metric, 'assets', s));
  assert.throws(() => normalizeRows([[now - 3_600_000, 1], [now - 3_600_000, 2]], metric, 'hourly', s));
  assert.throws(() => normalizeRows([[0, 12]], metric, 'hourly', s));
  assert.deepEqual(normalizeRows([[null]], metric, 'total', s), [{ value: null }]);
});

test('one failed metric remains partial without replacing it with zero', async () => {
  const result = await service({ fetchImpl: async (url, request) => url.endsWith('/sum') ? new Response('sensitive provider diagnostics', { status: 500 }) : validResponse(url, request) }).query(parameters());
  assert.equal(result.status, 'partial');
  assert.equal(result.metrics.watchHours.status, 'error');
  assert.equal(result.metrics.watchHours.value, null);
  assert.equal(result.metrics.plays.value, 0);
  assert.doesNotMatch(JSON.stringify(result), /sensitive provider/);
});

test('Retry-After prevents immediate refetch and is reported without provider bodies', async () => {
  let calls = 0;
  const api = service({ fetchImpl: async () => { calls += 1; return new Response('private error', { status: 429, headers: { 'Retry-After': '60' } }); } });
  const first = await api.query(parameters()); const before = calls;
  const second = await api.query(parameters());
  assert.equal(first.metrics.plays.code, 'RATE_LIMITED');
  assert.equal(second.metrics.plays.retryAfter, 60);
  assert.equal(calls, before);
  assert.ok(calls <= 3);
  assert.doesNotMatch(JSON.stringify(first), /private error/);
});

test('upstream body reading shares the ten-second deadline', async () => {
  const api = service({ timeoutMs: 20, clock: Date.now, fetchImpl: async (_url, request) => {
    return new Response(new ReadableStream({ start(controller) {
      request.signal.addEventListener('abort', () => controller.error(new Error('private timeout details')), { once: true });
    } }));
  } });
  const params = parameters(); params.set('end', new Date(Date.now()).toISOString()); params.set('start', new Date(Date.now() - 3_600_000).toISOString());
  const result = await api.query(params);
  assert.equal(result.metrics.plays.code, 'TIMEOUT');
  assert.doesNotMatch(JSON.stringify(result), /private timeout/);
});

test('oversized provider responses and malformed envelopes are refused', async () => {
  for (const response of [() => new Response('x'.repeat(524_289)), () => reply([[1], [2]]), () => new Response(JSON.stringify({ data: { result: { rows: [[1]] } } }))]) {
    const result = await service({ fetchImpl: async () => response() }).query(parameters());
    assert.equal(result.metrics.plays.code, 'INVALID_RESPONSE');
  }
});


test('at most two distinct batches are admitted and capacity recovers after completion', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const api = service({ fetchImpl: async (url, request) => { await gate; return validResponse(url, request); } });
  const first = parameters(); const second = parameters(); const third = parameters();
  second.set('asset', config.assets[0].id); third.set('asset', config.assets[1].id);
  const a = api.query(first); const b = api.query(second);
  await assert.rejects(api.query(third), error => error.code === 'BUSY' && error.retryAfter === 2);
  release();
  assert.equal((await a).status, 'ok'); assert.equal((await b).status, 'ok');
  assert.equal((await api.query(third)).status, 'ok');
});

test('queued operations share the absolute batch deadline and do not issue late requests', async () => {
  let calls = 0;
  const started = Date.now();
  let now = started;
  const api = service({ timeoutMs: 25, clock: () => now, fetchImpl: async (_url, request) => {
    calls += 1;
    await new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => {
      // A real timer can fire before Date.now reaches its millisecond boundary.
      // Expire the injected batch clock before a queued operation is admitted.
      now = started + 25;
      reject(new Error('aborted'));
    }, { once: true }));
  } });
  const params = parameters(); params.set('end', new Date(started).toISOString()); params.set('start', new Date(started - 3600000).toISOString());
  const result = await api.query(params);
  assert.equal(result.status, 'error');
  assert.equal(calls, 3);
  for (const metric of Object.values(result.metrics)) assert.equal(metric.code, 'TIMEOUT');
});


test('zero count and sum with otherwise absent measurements means no data without hiding valid zeros', async () => {
  const result = await service({ fetchImpl: async (url, request) => {
    const body = JSON.parse(request.body);
    return reply(body.interval || body.groupBy ? [] : [[url.endsWith('/count') || url.endsWith('/sum') ? 0 : null]]);
  } }).query(parameters());
  assert.equal(result.status, 'empty');
  assert.equal(result.metrics.plays.value, 0);
  assert.equal(result.metrics.watchHours.value, 0);
  assert.equal(result.metrics.startupMedian.value, null);
  assert.equal(result.metrics.startupMedian.status, 'empty');
});
