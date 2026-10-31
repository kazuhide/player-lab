import { metrics, snapshotSelection } from './query-recipes.mjs';

const statuses = new Set(['demo', 'ok', 'empty', 'partial', 'error', 'unconfigured', 'noQuery']);
const codes = new Set(['ACCESS_DENIED', 'RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'UPSTREAM_ERROR', 'INVALID_RESPONSE', 'INCOMPLETE_RESPONSE', 'BUSY']);
const scenarios = new Set(['normal', 'slow-start', 'rebuffering']);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
const value = input => typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : null;
const status = input => ['ok', 'empty', 'error'].includes(input) ? input : 'empty';
function descriptor(input, metric) {
  return { status: status(input?.status), unit: metric.unit, code: input?.status === 'error' ? codes.has(input.code) ? input.code : 'UPSTREAM_ERROR' : null };
}

export function exportSnapshot(snapshot, config, { dataSource, viewStatus, exportedAt = new Date().toISOString() } = {}) {
  if (!['demo', 'measured'].includes(dataSource) || !snapshot || !statuses.has(snapshot.status)) throw new RangeError('No exportable snapshot');
  const selection = snapshotSelection(snapshot, config);
  const output = {
    schemaVersion: 1, dataSource, scenario: dataSource === 'demo' && scenarios.has(snapshot.scenario) ? snapshot.scenario : null,
    period: { start: selection.start, end: selection.end, interval: 'HOUR' },
    filters: { asset: selection.asset, origin: selection.origin, type: selection.type, platform: 'android' },
    requestedAt: timestamp(snapshot.requestedAt), fetchedAt: timestamp(snapshot.fetchedAt), latestSampleAt: timestamp(snapshot.latestSampleAt), exportedAt: timestamp(exportedAt),
    dataStatus: snapshot.status, viewStatus: statuses.has(viewStatus) ? viewStatus : snapshot.status,
    isPartial: snapshot.status === 'partial', isEarlier: snapshot.stale === true,
    metrics: {}, series: {}, comparison: {},
  };
  for (const metric of metrics) {
    const input = snapshot.metrics?.[metric.id];
    output.metrics[metric.id] = { ...descriptor(input, metric), value: input?.status === 'error' ? null : value(input?.value) };
    if (metric.shapes.includes('hourly')) {
      const input = snapshot.series?.[metric.id];
      output.series[metric.id] = { ...descriptor(input, metric), rows: (Array.isArray(input?.rows) ? input.rows : []).slice(0, 169).filter(row => timestamp(row?.at) && Date.parse(row.at) >= Math.floor(Date.parse(selection.start) / 3_600_000) * 3_600_000 && row.at < selection.end).map(row => ({ at: row.at, value: input.status === 'error' ? null : value(row.value) })) };
    }
    if (metric.shapes.includes('assets')) {
      const input = snapshot.comparison?.[metric.id];
      output.comparison[metric.id] = { ...descriptor(input, metric), rows: (Array.isArray(input?.rows) ? input.rows : []).filter(row => selection.assets.includes(row?.asset)).slice(0, config.assets.length).map(row => ({ asset: row.asset, value: input.status === 'error' ? null : value(row.value) })) };
    }
  }
  return output;
}

export function csvCell(input) {
  let text = input == null ? '' : String(input);
  if (typeof input === 'string' && (/^[\s]*[=+@＝＋＠－-]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCSV(snapshot) {
  const metadata = ['schemaVersion', 'dataSource', 'scenario', 'dataStatus', 'viewStatus', 'isPartial', 'isEarlier', 'requestedAt', 'fetchedAt', 'latestSampleAt', 'exportedAt'];
  const headers = [...metadata, 'start', 'end', 'interval', 'filterAsset', 'filterOrigin', 'filterType', 'platform', 'section', 'metric', 'unit', 'status', 'code', 'at', 'asset', 'value'];
  const prefix = [...metadata.map(key => snapshot[key]), snapshot.period.start, snapshot.period.end, snapshot.period.interval, snapshot.filters.asset, snapshot.filters.origin, snapshot.filters.type, snapshot.filters.platform];
  const rows = [headers];
  for (const section of ['metrics', 'series', 'comparison']) {
    for (const [metric, result] of Object.entries(snapshot[section])) {
      const values = section === 'metrics' ? [result] : result.rows.length ? result.rows : [{ value: null }];
      for (const row of values) rows.push([...prefix, section, metric, result.unit, result.status, result.code, row.at ?? null, row.asset ?? null, row.value]);
    }
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
