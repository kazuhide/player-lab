export const demoPeriod = Object.freeze({
  start: '2026-10-21T00:00:00.000Z', end: '2026-10-22T00:00:00.000Z', interval: 'HOUR',
});

const units = { plays: 'count', watchHours: 'hours', startupMedian: 'seconds', startupP95: 'seconds', rebufferPercentage: 'percent', errorPercentage: 'percent' };

function observations(config, scenario) {
  const rows = [];
  config.assets.forEach((asset, lesson) => config.origins.forEach((origin, entry) => {
    for (let hour = 0; hour < 24; hour += 1) {
      if (hour === 3 || hour === 17) continue;
      for (let play = 0; play < 2 + (hour + lesson + entry) % 6; play += 1) {
        rows.push({
          asset: asset.id, origin, at: new Date(Date.parse(demoPeriod.start) + hour * 3_600_000).toISOString(),
          startup: .65 + lesson * .25 + entry * .2 + play * .17 + (hour % 5 === 0 ? 1.4 : 0) + (scenario === 'slow-start' ? 2.5 + (play % 3) * 2 + (hour % 4 === 0 ? 5 : 0) : 0),
          played: 35 + lesson * 18 + play * 9 + hour % 7,
          rebuffer: scenario === 'rebuffering' ? 4 + (hour + play + lesson) % 7 : (hour + play + lesson) % 13 === 0 ? 3.2 : .15,
          error: (hour + play + lesson * 5 + entry) % 41 === 0 ? 100 : 0,
        });
      }
    }
  }));
  return rows;
}

function summarize(rows) {
  const starts = rows.map(row => row.startup).sort((a, b) => a - b);
  const middle = Math.floor(starts.length / 2);
  const average = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  return {
    plays: rows.length,
    watchHours: rows.reduce((sum, row) => sum + row.played, 0) / 3600,
    startupMedian: starts.length % 2 ? starts[middle] : (starts[middle - 1] + starts[middle]) / 2,
    startupP95: starts[Math.ceil(starts.length * .95) - 1],
    rebufferPercentage: average('rebuffer'), errorPercentage: average('error'),
  };
}

export function demoSnapshot({ asset = 'all', origin = 'all', scenario = 'normal' } = {}, config) {
  if (!['normal', 'slow-start', 'rebuffering'].includes(scenario)) throw new RangeError('Unknown demo scenario');
  if (asset !== 'all' && !config.assets.some(item => item.id === asset)) throw new RangeError('Unknown demo lesson');
  if (origin !== 'all' && !config.origins.includes(origin)) throw new RangeError('Unknown demo entry');
  const rows = observations(config, scenario).filter(row => (asset === 'all' || row.asset === asset) && (origin === 'all' || row.origin === origin));
  const total = summarize(rows);
  const metrics = Object.fromEntries(Object.entries(units).map(([id, unit]) => [id, { status: 'ok', value: total[id], unit }]));
  const series = Object.fromEntries(['plays', 'startupMedian', 'startupP95'].map(id => [id, {
    status: 'ok', rows: [...new Set(rows.map(row => row.at))].sort().map(at => ({ at, value: summarize(rows.filter(row => row.at === at))[id] })),
  }]));
  const comparison = Object.fromEntries(['plays', 'startupP95', 'errorPercentage'].map(id => [id, {
    status: 'ok', rows: config.assets.filter(item => asset === 'all' || item.id === asset).map(item => ({ asset: item.id, value: summarize(rows.filter(row => row.asset === item.id))[id] })),
  }]));
  return {
    status: 'demo', scenario, source: 'Synthetic demo data', requestedAt: null, fetchedAt: null, latestSampleAt: null,
    period: { ...demoPeriod }, filters: { asset, origin, type: 'all', platform: 'android' }, metrics, series, comparison,
  };
}
