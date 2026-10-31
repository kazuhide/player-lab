import { metrics, queryTasks, selectionFor } from './query-recipes.mjs';

const codes = new Set(['ACCESS_DENIED', 'RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'UPSTREAM_ERROR', 'INVALID_RESPONSE', 'INCOMPLETE_RESPONSE', 'BUSY']);
const failure = () => { throw new Error('INVALID_EXPORT'); };
const timestamp = value => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return failure();
  return value;
};
const statusOf = value => ['ok', 'empty', 'error'].includes(value) ? value : failure();
const valueOf = (value, metric) => value === null ? null : typeof value === 'number' && Number.isFinite(value) && value >= 0 && (metric.id !== 'plays' || Number.isSafeInteger(value)) ? value : failure();

function resultFields(input) {
  if (!input || typeof input !== 'object') return failure();
  const result = { status: statusOf(input.status), fetchedAt: timestamp(input.fetchedAt) };
  if (input.code !== undefined) {
    if (!codes.has(input.code) || result.status !== 'error') return failure();
    result.code = input.code;
  }
  if (input.retryAfter !== undefined && input.retryAfter !== null) {
    if (!Number.isFinite(input.retryAfter) || input.retryAfter < 0 || input.retryAfter > 604800) return failure();
    result.retryAfter = input.retryAfter;
  }
  return result;
}

// Select known aggregate fields; never serialize the input object or raw API rows.
export function exportSnapshot(input, { mode, viewStatus, config, exportedAt = new Date().toISOString() }) {
  if (!input || !['demo', 'measured'].includes(mode) || input.source !== (mode === 'demo' ? 'synthetic-demo' : 'Bitmovin Analytics Query API') ||
      !['ok', 'empty', 'partial', 'error'].includes(input.status) || !['demoReady', 'ok', 'empty', 'partial', 'error'].includes(viewStatus)) return failure();
  let selection;
  try { selection = selectionFor(config, input.period, input.filters); } catch { return failure(); }
  if (input.filters.platform !== 'android' || input.period.interval !== 'HOUR') return failure();
  const scenario = mode === 'demo' ? input.scenario : null;
  if (mode === 'demo' && !['normal', 'slow-start', 'rebuffering'].includes(scenario)) return failure();
  const result = {
    schemaVersion: 1, dataSource: mode, scenario, dataStatus: input.status, viewStatus,
    isEarlier: mode === 'measured' && input.stale === true,
    exportedAt: timestamp(exportedAt), requestedAt: timestamp(input.requestedAt), fetchedAt: timestamp(input.fetchedAt), latestSampleAt: timestamp(input.latestSampleAt),
    period: { start: selection.start, end: selection.end, interval: 'HOUR' },
    filters: { asset: selection.asset, type: selection.type, origin: selection.origin, platform: 'android' },
    metrics: {}, series: {}, comparison: {},
  };
  if (result.exportedAt === null || (mode === 'demo' && (result.requestedAt !== null || result.fetchedAt !== null || result.latestSampleAt !== null))) return failure();
  for (const metric of metrics) {
    const entry = input.metrics?.[metric.id];
    if (entry?.unit !== metric.unit) return failure();
    result.metrics[metric.id] = { ...resultFields(entry), value: valueOf(entry.value, metric), unit: metric.unit };
  }
  for (const { metric, shape } of queryTasks.filter(task => task.shape !== 'total')) {
    const field = shape === 'hourly' ? 'series' : 'comparison';
    const entry = input[field]?.[metric.id];
    if (!Array.isArray(entry?.rows) || entry.rows.length > (shape === 'hourly' ? 169 : selection.assets.length)) return failure();
    const seen = new Set();
    const rows = entry.rows.map(row => {
      const value = valueOf(row?.value, metric);
      const key = shape === 'hourly' ? timestamp(row?.at) : row?.asset;
      if (key === null || seen.has(key)) return failure();
      seen.add(key);
      if (shape === 'hourly') {
        const at = Date.parse(key); const firstHour = Math.floor(Date.parse(selection.start) / 3600000) * 3600000;
        if (at % 3600000 !== 0 || at < firstHour || at >= Date.parse(selection.end)) return failure();
        return { at: key, value };
      }
      if (!selection.assets.includes(key)) return failure();
      return { asset: key, value };
    });
    result[field][metric.id] = { ...resultFields(entry), unit: metric.unit, rows };
  }
  return result;
}

// Quote every cell. Prefix formula-like text even after whitespace or a BOM.
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^(?:[\t\r\n]|[\s\ufeff]*[=+\-@＝＋－＠])/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function exportCsv(snapshot) {
  const metadata = {
    schemaVersion: snapshot.schemaVersion, dataSource: snapshot.dataSource, scenario: snapshot.scenario,
    dataStatus: snapshot.dataStatus, viewStatus: snapshot.viewStatus, isEarlier: snapshot.isEarlier,
    exportedAt: snapshot.exportedAt, requestedAt: snapshot.requestedAt, snapshotFetchedAt: snapshot.fetchedAt, latestSampleAt: snapshot.latestSampleAt,
    periodStart: snapshot.period.start, periodEnd: snapshot.period.end, interval: snapshot.period.interval,
    filterAsset: snapshot.filters.asset, filterType: snapshot.filters.type, filterOrigin: snapshot.filters.origin, platform: snapshot.filters.platform,
  };
  const headers = [...Object.keys(metadata), 'section', 'metric', 'unit', 'status', 'code', 'retryAfter', 'fetchedAt', 'at', 'asset', 'value'];
  const rows = [];
  for (const field of ['metrics', 'series', 'comparison']) {
    for (const metric of metrics) {
      const entry = snapshot[field][metric.id];
      if (!entry) continue;
      const entries = field === 'metrics' ? [{ value: entry.value }] : entry.rows.length ? entry.rows : [{}];
      for (const row of entries) rows.push({ ...metadata, section: field, metric: metric.id, unit: entry.unit, status: entry.status, code: entry.code, retryAfter: entry.retryAfter, fetchedAt: entry.fetchedAt, at: row.at, asset: row.asset, value: row.value });
    }
  }
  return [headers.map(csvCell).join(','), ...rows.map(row => headers.map(key => csvCell(row[key])).join(','))].join('\r\n') + '\r\n';
}
