const START = Date.parse('2026-10-01T00:00:00.000Z');
const HOUR = 3_600_000;
const units = { plays: 'count', watchHours: 'hours', startupMedian: 'seconds', startupP95: 'seconds', rebufferPercentage: 'percent', errorPercentage: 'percent' };

function observations(assets, scenario) {
  const samples = [];
  assets.forEach((asset, index) => {
    for (let hour = 0; hour < 24; hour += 1) {
      const count = hour < 5 ? 0 : 2 + (hour * 3 + index * 2) % 9 + (asset.kind === 'live' && hour >= 12 && hour <= 17 ? 8 : 0);
      for (let play = 0; play < count; play += 1) {
        const seed = hour * 31 + index * 17 + play * 11;
        samples.push({ asset: asset.id, hour,
          startup: ((seed % 17 === 0 ? 4200 : 500) + seed % 1800) * (scenario === 'slow-start' ? 4 : 1),
          played: asset.kind === 'clip' ? 8000 + seed % 12000 : 60000 + seed % 240000,
          rebuffer: (seed % 13 === 0 ? 2.5 : .1 + (seed % 5) / 10) + (scenario === 'rebuffering' ? 8 + seed % 7 : 0),
          error: seed % 97 === 0 ? 100 : 0,
        });
      }
    }
  });
  return samples;
}

function values(samples) {
  if (!samples.length) return { plays: 0, watchHours: 0, startupMedian: null, startupP95: null, rebufferPercentage: null, errorPercentage: null };
  const times = samples.map(sample => sample.startup).sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  const average = field => samples.reduce((sum, sample) => sum + sample[field], 0) / samples.length;
  return {
    plays: samples.length,
    watchHours: samples.reduce((sum, sample) => sum + sample.played, 0) / HOUR,
    startupMedian: (times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2) / 1000,
    startupP95: times[Math.ceil(times.length * .95) - 1] / 1000,
    rebufferPercentage: average('rebuffer'), errorPercentage: average('error'),
  };
}

export function createDemoData(config, { asset = 'all', type = 'all', scenario = 'normal' } = {}) {
  if (!['normal', 'slow-start', 'rebuffering'].includes(scenario)) throw new Error('INVALID_SCENARIO');
  const selected = config.assets.filter(item => (asset === 'all' || item.id === asset) && (type === 'all' || item.kind === type));
  const samples = observations(config.assets, scenario).filter(sample => selected.some(item => item.id === sample.asset));
  const totals = values(samples);
  const series = {};
  for (const id of ['plays', 'startupMedian', 'startupP95']) {
    series[id] = { status: 'ok', rows: Array.from({ length: 24 }, (_, hour) => ({ at: new Date(START + hour * HOUR).toISOString(), value: values(samples.filter(sample => sample.hour === hour))[id] })) };
  }
  const comparison = {};
  for (const id of ['plays', 'startupP95', 'errorPercentage']) {
    comparison[id] = { status: 'ok', rows: selected.map(item => ({ asset: item.id, value: values(samples.filter(sample => sample.asset === item.id))[id] })) };
  }
  return {
    source: 'synthetic-demo', scenario, status: samples.length ? 'ok' : 'empty', requestedAt: null, fetchedAt: null, latestSampleAt: null,
    period: { start: new Date(START).toISOString(), end: new Date(START + 24 * HOUR).toISOString(), interval: 'HOUR' },
    filters: { asset, type, origin: 'all', platform: 'android' },
    metrics: Object.fromEntries(Object.entries(totals).map(([id, value]) => [id, { value, unit: units[id], status: value === null ? 'empty' : 'ok' }])),
    series, comparison,
  };
}
