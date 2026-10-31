export const metrics = Object.freeze([
  { id: 'plays', operation: 'count', dimension: 'IMPRESSION_ID', positive: 'VIDEO_STARTUPTIME', divisor: 1, unit: 'count', shapes: ['total', 'hourly', 'assets'] },
  { id: 'watchHours', operation: 'sum', dimension: 'PLAYED', positive: 'PLAYED', divisor: 3_600_000, unit: 'hours', shapes: ['total'] },
  { id: 'startupMedian', operation: 'median', dimension: 'VIDEO_STARTUPTIME', positive: 'VIDEO_STARTUPTIME', divisor: 1000, unit: 'seconds', shapes: ['total', 'hourly'] },
  { id: 'startupP95', operation: 'percentile', dimension: 'VIDEO_STARTUPTIME', positive: 'VIDEO_STARTUPTIME', divisor: 1000, unit: 'seconds', shapes: ['total', 'hourly', 'assets'] },
  { id: 'rebufferPercentage', operation: 'avg', dimension: 'REBUFFER_PERCENTAGE', divisor: 1, unit: 'percent', shapes: ['total'] },
  { id: 'errorPercentage', operation: 'avg', dimension: 'ERROR_PERCENTAGE', divisor: 1, unit: 'percent', shapes: ['total', 'assets'] },
].map(metric => Object.freeze({ ...metric, shapes: Object.freeze(metric.shapes) })));

export function queryTasks() {
  return ['total', 'hourly', 'assets'].flatMap(shape => metrics.filter(metric => metric.shapes.includes(shape)).map(metric => ({ metric, shape })));
}

export function queryBody(selection, metric, licenseKey, shape = 'total', offset = 0) {
  const body = {
    licenseKey, start: selection.start, end: selection.end, dimension: metric.dimension,
    filters: [{ name: 'PLATFORM', operator: 'EQ', value: 'android' }, { name: 'VIDEO_ID', operator: 'IN', value: selection.assets }],
    includeContext: false, limit: 200, offset,
  };
  if (metric.positive) body.filters.push({ name: metric.positive, operator: 'GT', value: 0 });
  if (selection.origin !== 'all') body.filters.push({ name: 'CUSTOM_DATA_1', operator: 'EQ', value: selection.origin });
  if (metric.operation === 'percentile') body.percentile = 95;
  if (shape === 'hourly') body.interval = 'HOUR';
  if (shape === 'assets') body.groupBy = ['VIDEO_ID'];
  return body;
}

export function snapshotSelection(snapshot, config) {
  const { start, end } = snapshot?.period ?? {};
  const { asset, origin, type } = snapshot?.filters ?? {};
  for (const value of [start, end]) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new RangeError('Invalid snapshot period');
  }
  if (end <= start || Date.parse(end) - Date.parse(start) > 7 * 86_400_000) throw new RangeError('Invalid snapshot period');
  if (type !== 'all' || (asset !== 'all' && !config.assets.some(item => item.id === asset)) || (origin !== 'all' && !config.origins.includes(origin))) throw new RangeError('Invalid snapshot filters');
  return { start, end, asset, origin, type, assets: config.assets.filter(item => asset === 'all' || item.id === asset).map(item => item.id) };
}

export function queryRecipe(snapshot, config, metricId, shape = 'total') {
  const metric = metrics.find(item => item.id === metricId);
  if (!metric?.shapes.includes(shape)) throw new RangeError('Unsupported metric or query shape');
  const body = queryBody(snapshotSelection(snapshot, config), metric, 'YOUR_ANALYTICS_LICENSE_KEY', shape);
  const endpoint = `https://api.bitmovin.com/v1/analytics/queries/${metric.operation}`;
  const node = `// Save as query.mjs and run with Node.js 24 or later on a server.
const apiKey = process.env.BITMOVIN_API_KEY;
const licenseKey = process.env.BITMOVIN_ANALYTICS_LICENSE_KEY;
if (!apiKey || !licenseKey) throw new Error('Set the server environment variables.');
const body = ${JSON.stringify(body, null, 2)};
body.licenseKey = licenseKey;
const rows = [];
const signal = AbortSignal.timeout(10000);
for (let offset = 0; offset < 800; offset += body.limit) {
  const response = await fetch(${JSON.stringify(endpoint)}, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ ...body, offset }),
  });
  if (!response.ok) throw new Error('Query failed: HTTP ' + response.status);
  const result = await response.json();
  const page = result?.data?.result?.rows;
  if (result?.status !== 'SUCCESS' || !Array.isArray(page) || page.length > body.limit) throw new Error('Invalid query response');
  rows.push(...page);
  if (page.length < body.limit) break;
  if (offset === 600) throw new Error('Incomplete query response');
}
// Convert API values to ${metric.unit}; preserve null rather than replacing it with zero.
const converted = rows.map(row => {
  if (!Array.isArray(row) || row.length !== ${shape === 'total' ? 1 : 2}) throw new Error('Invalid query row');
  const value = row.at(-1);
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Invalid query value');
  return [...row.slice(0, -1), value === null ? null : value / ${metric.divisor}];
});
console.log(JSON.stringify({ unit: ${JSON.stringify(metric.unit)}, rows: converted }, null, 2));
`;
  return { endpoint, body, node, metric, shape };
}
