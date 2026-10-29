import { setTimeout as delay } from 'node:timers/promises';

export class QueryError extends Error {
  constructor(code, retryAfter = null) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export const metrics = Object.freeze([
  { id: 'plays', operation: 'count', dimension: 'IMPRESSION_ID', positive: 'VIDEO_STARTUPTIME', divisor: 1, unit: 'count' },
  { id: 'watchHours', operation: 'sum', dimension: 'PLAYED', positive: 'PLAYED', divisor: 3_600_000, unit: 'hours' },
  { id: 'startupMedian', operation: 'median', dimension: 'VIDEO_STARTUPTIME', positive: 'VIDEO_STARTUPTIME', divisor: 1000, unit: 'seconds' },
  { id: 'startupP95', operation: 'percentile', dimension: 'VIDEO_STARTUPTIME', positive: 'VIDEO_STARTUPTIME', divisor: 1000, unit: 'seconds' },
  { id: 'rebufferPercentage', operation: 'avg', dimension: 'REBUFFER_PERCENTAGE', divisor: 1, unit: 'percent' },
  { id: 'errorPercentage', operation: 'avg', dimension: 'ERROR_PERCENTAGE', divisor: 1, unit: 'percent' },
]);

const DAY = 86_400_000;
const UPSTREAM = 'https://api.bitmovin.com/v1/analytics/queries/';
const MAX_BODY = 512 * 1024;

export function validateParameters(params, config, now = Date.now()) {
  const allowed = new Set(['start', 'end', 'asset', 'type', 'origin']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new QueryError('INVALID_PARAMETERS');
  }
  const start = params.get('start');
  const end = params.get('end');
  const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (!utc.test(start ?? '') || !utc.test(end ?? '')) throw new QueryError('INVALID_PERIOD');
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || new Date(a).toISOString() !== start || new Date(b).toISOString() !== end || b <= a || b - a > 7 * DAY || b > now + 60_000) throw new QueryError('INVALID_PERIOD');
  const asset = params.get('asset') ?? 'all';
  const type = params.get('type') ?? 'all';
  const origin = params.get('origin') ?? 'all';
  if (asset !== 'all' && !config.assets.some(item => item.id === asset)) throw new QueryError('INVALID_ASSET');
  if (type !== 'all' && (config.kind !== 'sports' || !['live', 'clip', 'archive'].includes(type))) throw new QueryError('INVALID_TYPE');
  if (origin !== 'all' && !config.origins.includes(origin)) throw new QueryError('INVALID_ORIGIN');
  const assets = config.assets.filter(item => (asset === 'all' || item.id === asset) && (type === 'all' || item.kind === type)).map(item => item.id);
  if (!assets.length) throw new QueryError('INVALID_ASSET');
  return { start, end, asset, type, origin, assets };
}

export function queryBody(selection, metric, licenseKey, shape = 'total', offset = 0) {
  const body = {
    licenseKey, start: selection.start, end: selection.end,
    dimension: metric.dimension,
    filters: [
      { name: 'PLATFORM', operator: 'EQ', value: 'android' },
      { name: 'VIDEO_ID', operator: 'IN', value: selection.assets },
    ],
    includeContext: false, limit: 200, offset,
  };
  if (metric.positive) body.filters.push({ name: metric.positive, operator: 'GT', value: 0 });
  if (selection.origin !== 'all') body.filters.push({ name: 'CUSTOM_DATA_1', operator: 'EQ', value: selection.origin });
  if (metric.operation === 'percentile') body.percentile = 95;
  if (shape === 'hourly') body.interval = 'HOUR';
  if (shape === 'assets') body.groupBy = ['VIDEO_ID'];
  return body;
}

function semaphore(limit) {
  let active = 0;
  const waiting = [];
  return async task => {
    if (active < limit) active += 1;
    else await new Promise(resolve => waiting.push(resolve));
    try { return await task(); }
    finally {
      if (waiting.length) waiting.shift()();
      else active -= 1;
    }
  };
}

async function limitedJSON(response) {
  if (Number(response.headers.get('content-length')) > MAX_BODY) throw new QueryError('INVALID_RESPONSE');
  if (!response.body) throw new QueryError('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) throw new QueryError('INVALID_RESPONSE');
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts, size).toString('utf8'));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof QueryError) throw error;
    throw new QueryError('INVALID_RESPONSE');
  } finally { reader.releaseLock(); }
}

function responseRows(json) {
  const result = json?.data?.result;
  if (json?.status !== 'SUCCESS' || !Array.isArray(result?.rows) || result.rows.length > 200) throw new QueryError('INVALID_RESPONSE');
  if (result.rowCount != null && (!Number.isInteger(result.rowCount) || result.rowCount < 0)) throw new QueryError('INVALID_RESPONSE');
  return result.rows;
}

export function normalizeRows(rows, metric, shape, selection) {
  const output = [];
  const seen = new Set();
  for (const row of rows) {
    const expected = shape === 'total' ? 1 : 2;
    if (!Array.isArray(row) || row.length !== expected) throw new QueryError('INVALID_RESPONSE');
    const raw = row.at(-1);
    if (raw !== null && (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0)) throw new QueryError('INVALID_RESPONSE');
    if (metric.id === 'plays' && raw !== null && !Number.isSafeInteger(raw)) throw new QueryError('INVALID_RESPONSE');
    const value = raw === null ? null : raw / metric.divisor;
    if (shape === 'total') output.push({ value });
    else if (shape === 'assets') {
      if (!selection.assets.includes(row[0]) || seen.has(row[0])) throw new QueryError('INVALID_RESPONSE');
      seen.add(row[0]); output.push({ asset: row[0], value });
    } else {
      const at = row[0];
      const firstHour = Math.floor(Date.parse(selection.start) / 3_600_000) * 3_600_000;
      if (typeof at !== 'number' || !Number.isSafeInteger(at) || at % 3_600_000 !== 0 || at < firstHour || at >= Date.parse(selection.end) || seen.has(at) || output.length >= 169) throw new QueryError('INVALID_RESPONSE');
      seen.add(at); output.push({ at: new Date(at).toISOString(), value });
    }
  }
  if (shape === 'total' && output.length > 1) throw new QueryError('INVALID_RESPONSE');
  if (shape === 'hourly') output.sort((a, b) => a.at.localeCompare(b.at));
  return output;
}

export function createAnalyticsService({ config, apiKey, licenseKey, fetchImpl = fetch, timeoutMs = 10_000, clock = Date.now, wait = delay }) {
  const run = semaphore(3);
  const inFlight = new Map();
  let cooldownUntil = 0;

  async function operation(selection, metric, shape, deadline) {
    return run(async () => {
      if (clock() < cooldownUntil) throw new QueryError('RATE_LIMITED', Math.ceil((cooldownUntil - clock()) / 1000));
      if (clock() >= deadline) throw new QueryError('TIMEOUT');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - clock()));
      const rows = [];
      let fetchedAt = null;
      try {
        for (let offset = 0; offset < 800; offset += 200) {
          let response;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            response = await fetchImpl(UPSTREAM + metric.operation, {
              method: 'POST', redirect: 'error', signal: controller.signal,
              headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey, 'X-Api-Client': 'player-lab-reference-dashboard' },
              body: JSON.stringify(queryBody(selection, metric, licenseKey, shape, offset)),
            });
            if (response.status !== 429) break;
            const retry = response.headers.get('retry-after');
            let seconds = /^\d+(?:\.\d+)?$/.test(retry ?? '') ? Number(retry) : (Date.parse(retry ?? '') - clock()) / 1000;
            if (!Number.isFinite(seconds) || seconds <= 0) seconds = 2;
            seconds = Math.min(seconds, 604_800);
            cooldownUntil = Math.max(cooldownUntil, clock() + seconds * 1000);
            await response.body?.cancel();
            if (attempt || seconds > 2 || clock() + seconds * 1000 >= deadline) throw new QueryError('RATE_LIMITED', Math.ceil(seconds));
            await wait(seconds * 1000, undefined, { signal: controller.signal });
          }
          if (!response.ok) {
            await response.body?.cancel();
            throw new QueryError([401, 403].includes(response.status) ? 'ACCESS_DENIED' : 'UPSTREAM_ERROR');
          }
          const page = responseRows(await limitedJSON(response));
          if (clock() >= deadline || controller.signal.aborted) throw new QueryError('TIMEOUT');
          fetchedAt = new Date(clock()).toISOString();
          rows.push(...page);
          if (page.length < 200) {
            const normalized = normalizeRows(rows, metric, shape, selection);
            return { status: normalized.some(row => row.value !== null) ? 'ok' : 'empty', rows: normalized, fetchedAt };
          }
        }
        throw new QueryError('INCOMPLETE_RESPONSE');
      } catch (error) {
        if (controller.signal.aborted || clock() >= deadline) throw new QueryError('TIMEOUT');
        if (error instanceof QueryError) throw error;
        throw new QueryError('NETWORK_ERROR');
      } finally { clearTimeout(timer); }
    });
  }

  async function load(selection) {
    const deadline = clock() + timeoutMs;
    const requestedAt = new Date(clock()).toISOString();
    const base = {
      source: 'Bitmovin Analytics Query API', requestedAt, fetchedAt: null, latestSampleAt: null,
      period: { start: selection.start, end: selection.end, interval: 'HOUR' },
      filters: { asset: selection.asset, type: selection.type, origin: selection.origin, platform: 'android' },
      metrics: {}, series: {}, comparison: {},
    };
    if (!apiKey || !licenseKey) return { ...base, status: 'unconfigured' };
    const tasks = metrics.map(metric => ({ metric, shape: 'total' }));
    for (const id of ['plays', 'startupMedian', 'startupP95']) tasks.push({ metric: metrics.find(metric => metric.id === id), shape: 'hourly' });
    for (const id of ['plays', 'startupP95', 'errorPercentage']) tasks.push({ metric: metrics.find(metric => metric.id === id), shape: 'assets' });
    const results = await Promise.all(tasks.map(async ({ metric, shape }) => {
      let result;
      try { result = await operation(selection, metric, shape, deadline); }
      catch (error) { result = { status: 'error', rows: [], code: error.code ?? 'UPSTREAM_ERROR', retryAfter: error.retryAfter ?? null, fetchedAt: null }; }
      const target = shape === 'total' ? base.metrics : shape === 'hourly' ? base.series : base.comparison;
      target[metric.id] = shape === 'total' ? { ...result, value: result.rows[0]?.value ?? null, unit: metric.unit, rows: undefined } : result;
      return result;
    }));
    base.fetchedAt = results.map(result => result.fetchedAt).filter(Boolean).sort().at(-1) ?? null;
    const failures = results.filter(result => result.status === 'error').length;
    const hasValue = results.some((result, index) => result.rows.some(row => row.value !== null && !(row.value === 0 && ['plays', 'watchHours'].includes(tasks[index].metric.id))));
    return { ...base, status: failures === results.length ? 'error' : failures ? 'partial' : hasValue ? 'ok' : 'empty' };
  }

  return {
    configured: Boolean(apiKey && licenseKey),
    async query(params) {
      const selection = validateParameters(params, config, clock());
      const key = JSON.stringify(selection);
      if (inFlight.has(key)) return inFlight.get(key);
      if (inFlight.size >= 2) throw new QueryError('BUSY', 2);
      const job = load(selection).finally(() => inFlight.delete(key));
      inFlight.set(key, job);
      return job;
    },
  };
}
