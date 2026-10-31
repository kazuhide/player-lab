export const metrics = Object.freeze([
  { id: 'plays', operation: 'count', dimension: 'IMPRESSION_ID', positive: 'VIDEO_STARTUPTIME', divisor: 1, unit: 'count' },
  { id: 'watchHours', operation: 'sum', dimension: 'PLAYED', positive: 'PLAYED', divisor: 3_600_000, unit: 'hours' },
  { id: 'startupMedian', operation: 'median', dimension: 'VIDEO_STARTUPTIME', positive: 'VIDEO_STARTUPTIME', divisor: 1000, unit: 'seconds' },
  { id: 'startupP95', operation: 'percentile', dimension: 'VIDEO_STARTUPTIME', positive: 'VIDEO_STARTUPTIME', divisor: 1000, unit: 'seconds' },
  { id: 'rebufferPercentage', operation: 'avg', dimension: 'REBUFFER_PERCENTAGE', divisor: 1, unit: 'percent' },
  { id: 'errorPercentage', operation: 'avg', dimension: 'ERROR_PERCENTAGE', divisor: 1, unit: 'percent' },
]);

export const queryTasks = Object.freeze([
  ...metrics.map(metric => Object.freeze({ metric, shape: 'total' })),
  ...['plays', 'startupMedian', 'startupP95'].map(id => Object.freeze({ metric: metrics.find(metric => metric.id === id), shape: 'hourly' })),
  ...['plays', 'startupP95', 'errorPercentage'].map(id => Object.freeze({ metric: metrics.find(metric => metric.id === id), shape: 'assets' })),
]);

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

export function selectionFor(config, period, filters) {
  const start = period?.start; const end = period?.end;
  const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const validDate = value => typeof value === 'string' && utc.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const asset = filters?.asset ?? 'all'; const type = filters?.type ?? 'all'; const origin = filters?.origin ?? 'all';
  if (!validDate(start) || !validDate(end) || end <= start || Date.parse(end) - Date.parse(start) > 7 * 86_400_000 ||
      (asset !== 'all' && !config.assets.some(item => item.id === asset)) ||
      (type !== 'all' && !['live', 'clip', 'archive'].includes(type)) ||
      (origin !== 'all' && !config.origins.includes(origin))) throw new Error('INVALID_SELECTION');
  const assets = config.assets.filter(item => (asset === 'all' || item.id === asset) && (type === 'all' || item.kind === type)).map(item => item.id);
  if (!assets.length) throw new Error('INVALID_SELECTION');
  return { start, end, asset, type, origin, assets };
}

export function metricExample(selection, id, shape = 'total') {
  const task = queryTasks.find(task => task.metric.id === id && task.shape === shape);
  if (!task) throw new Error('INVALID_RECIPE');
  const { metric } = task;
  const body = queryBody(selection, metric, '<ANALYTICS_LICENSE_KEY>', shape);
  const json = JSON.stringify(body, null, 2);
  const code = `// Node.js 24 or later. Run on a server; never bundle account credentials in a browser.
const apiKey = process.env.BITMOVIN_API_KEY;
const licenseKey = process.env.BITMOVIN_ANALYTICS_LICENSE_KEY;
if (!apiKey || !licenseKey) throw new Error('Set server environment credentials.');
const body = ${json};
body.licenseKey = licenseKey;
const rows = []; const seen = new Set();
// Match the dashboard's bounded pagination and overall deadline.
const signal = AbortSignal.timeout(10_000);
for (let offset = 0; offset < 800; offset += body.limit) {
  const response = await fetch('https://api.bitmovin.com/v1/analytics/queries/${metric.operation}', {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ ...body, offset }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Query failed: HTTP ' + response.status);
  }
  const parts = []; let bytes = 0;
  if (!response.body) throw new Error('Missing response.');
  for await (const part of response.body) {
    bytes += part.byteLength;
    if (bytes > 512 * 1024) throw new Error('Response too large.');
    parts.push(part);
  }
  const result = JSON.parse(Buffer.concat(parts).toString('utf8'));
  const page = result?.data?.result?.rows;
  if (result.status !== 'SUCCESS' || !Array.isArray(page) || page.length > body.limit) throw new Error('Invalid result.');
  for (const row of page) {
    const raw = row?.at(-1);
    if (!Array.isArray(row) || row.length !== ${shape === 'total' ? 1 : 2} || (raw !== null && (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0))) throw new Error('Invalid value.');
    if ('${metric.id}' === 'plays' && raw !== null && !Number.isSafeInteger(raw)) throw new Error('Invalid count.');
${shape === 'assets' ? "    if (!body.filters.find(filter => filter.name === 'VIDEO_ID').value.includes(row[0]) || seen.has(row[0])) throw new Error('Unknown or duplicate video.');\n    seen.add(row[0]);" : shape === 'hourly' ? "    const at = row[0];\n    if (!Number.isSafeInteger(at) || at % 3600000 !== 0 || at < Math.floor(Date.parse(body.start) / 3600000) * 3600000 || at >= Date.parse(body.end) || seen.has(at)) throw new Error('Invalid hour.');\n    seen.add(at);" : "    if (rows.length) throw new Error('Unexpected total rows.');"}
    rows.push({ ${shape === 'hourly' ? "at: new Date(row[0]).toISOString(), " : shape === 'assets' ? 'asset: row[0], ' : ''}value: raw === null ? null : raw / ${metric.divisor} });
  }
  if (page.length < body.limit) break;
  if (offset + body.limit >= 800) throw new Error('Incomplete result.');
}
console.log(JSON.stringify({ metric: '${metric.id}', unit: '${metric.unit}', rows }, null, 2));`;
  return { operation: metric.operation, unit: metric.unit, divisor: metric.divisor, body, json, code };
}
