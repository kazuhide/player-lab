import { translations } from './translations.mjs';
import { LatestRequest, hourlySegments, qualityStatus, modeFromHash } from './client.mjs';
import { element, dataTable, drawChart } from './ui.mjs';
import { demoSnapshot } from './demo.mjs';
import { metrics, queryRecipe } from './query-recipes.mjs';
import { exportSnapshot, toCSV } from './exports.mjs';

const $ = id => document.getElementById(id);
const ids = metrics.map(metric => metric.id);
const units = metrics.map(metric => metric.unit);
const latest = new LatestRequest();
let locale = navigator.language.startsWith('ja') ? 'ja' : 'en';
try { locale = localStorage.getItem('analytics-language') === 'ja' ? 'ja' : localStorage.getItem('analytics-language') === 'en' ? 'en' : locale; } catch { /* Language persistence is optional. */ }
let config; let current = null; let currentKey = ''; let state = 'noQuery'; let loading = false;
let mode = 'demo'; let cooldownUntil = 0; let cooldownTimer;
const t = key => translations[locale][key] ?? key;
const number = (value, places = 2) => value == null ? '—' : new Intl.NumberFormat(locale, value !== 0 && Math.abs(value) < 10 ** -places ? { maximumSignificantDigits: 2, notation: Math.abs(value) < .0001 ? 'scientific' : 'standard' } : { maximumFractionDigits: places }).format(value);
const date = value => value ? new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : '—';
const assetName = id => config.assets.find(asset => asset.id === id)?.[locale] ?? id;

function translate() {
  document.documentElement.lang = locale;
  document.querySelectorAll('[data-text]').forEach(node => { node.textContent = t(node.dataset.text); });
  document.querySelectorAll('[data-label]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.label)); });
  $('title').textContent = t('learningTitle');
  document.title = `${$('title').textContent} | Player Lab`;
  $('quality-heading').textContent = t('quality');
  $('language').textContent = locale === 'ja' ? 'English' : '日本語'; $('language').lang = locale === 'ja' ? 'en' : 'ja';
  document.querySelector('.skip-link').textContent = t('skipContent');
  const oldAsset = $('asset').value;
  $('asset').replaceChildren(new Option(t('all'), 'all'), ...config.assets.map(asset => new Option(asset[locale], asset.id)));
  $('asset').value = oldAsset || 'all'; $('asset-label').textContent = t('lesson');
  const oldOrigin = $('origin').value;
  $('origin').replaceChildren(new Option(t('all'), 'all'), ...config.origins.map(origin => new Option(t(origin), origin)));
  $('origin').value = oldOrigin || 'all';
  const oldMetric = $('recipe-metric').value;
  $('recipe-metric').replaceChildren(...metrics.map(metric => new Option(t(metric.id), metric.id)));
  $('recipe-metric').value = oldMetric || 'plays';
  renderQuality();
}

function renderQuality() {
  const demo = mode === 'demo';
  const error = state === 'error' || state === 'partial';
  $('status').textContent = qualityStatus({ state, result: current, loading, cooldownUntil: mode === 'measured' ? cooldownUntil : 0, now: Date.now() }, t, date);
  $('status').className = error ? 'error' : '';
  $('metrics').setAttribute('aria-busy', String(loading));
  $('refresh').disabled = !demo && (loading || !config.queryConfigured || Date.now() < cooldownUntil);
  $('refresh').textContent = t(demo ? 'loadDemo' : 'refresh');
  $('period-field').hidden = demo; $('filters').classList.toggle('demo', demo);
  $('scenario-field').hidden = !demo; $('scenario').disabled = !demo;
  $('custom-range').hidden = demo || $('period').value !== 'custom';
  $('start').disabled = $('custom-range').hidden; $('end').disabled = $('custom-range').hidden;
  $('setup-instructions').hidden = demo || config.queryConfigured;
  $('mode-notice').textContent = t(demo ? 'demoNotice' : config.queryConfigured ? 'measuredNotice' : 'setupNotice');
  $('demo-tab').toggleAttribute('aria-current', demo); $('measured-tab').toggleAttribute('aria-current', !demo);
  for (const link of [$('demo-tab'), $('measured-tab')]) if (link.hasAttribute('aria-current')) link.setAttribute('aria-current', 'page');
  $('fetch-time').textContent = current?.fetchedAt ? `${t('received')}: ${date(current.fetchedAt)}` : '';
  $('period-summary').textContent = current ? `${date(current.period.start)} – ${date(current.period.end)}` : '';
  $('source-summary').textContent = `${t('source')}: ${demo ? t('demoSource') : 'Bitmovin Analytics Query API'}`;
  $('definitions-text').textContent = t(demo ? 'demoDefinitions' : 'definitionsText');
  $('sample-note').hidden = demo;
  $('scope').textContent = t(demo ? 'demoScope' : 'scope');
  $('download-json').disabled = $('download-csv').disabled = !current || loading;
  $('metrics').replaceChildren(...ids.map((id, index) => {
    const metric = current?.metrics[id]; const node = element('div', undefined, 'metric');
    const label = element('p', t(id), 'metric-label'); const value = element('p', number(metric?.value, id === 'plays' ? 0 : 2), 'metric-value');
    value.append(element('small', t(units[index])));
    const status = metric?.status === 'error' ? t(metric.code) : metric?.status === 'empty' ? t('unavailable') : metric ? '' : t('notFetched');
    node.append(label, value, element('p', status, 'metric-state')); return node;
  }));
  renderCharts(); renderComparison(); renderRecipe();
  document.querySelectorAll('.table-scroll').forEach(node => { node.tabIndex = 0; node.setAttribute('role', 'region'); node.setAttribute('aria-label', t('tableView')); });
}

function renderRecipe() {
  const metric = metrics.find(item => item.id === $('recipe-metric').value) ?? metrics[0];
  const oldShape = $('recipe-shape').value;
  $('recipe-shape').replaceChildren(...metric.shapes.map(shape => new Option(t(`shape_${shape}`), shape)));
  $('recipe-shape').value = metric.shapes.includes(oldShape) ? oldShape : 'total';
  try {
    const params = current ? null : parameters();
    const snapshot = current ?? { period: { start: params.get('start'), end: params.get('end') }, filters: { asset: params.get('asset'), origin: params.get('origin'), type: 'all' } };
    const recipe = queryRecipe(snapshot, config, metric.id, $('recipe-shape').value);
    $('recipe-json').textContent = JSON.stringify(recipe.body, null, 2);
    $('recipe-node').textContent = recipe.node;
    $('recipe-endpoint').textContent = `POST ${recipe.endpoint}`;
    $('recipe-context').textContent = t(mode === 'demo' ? 'recipeDemo' : current?.stale ? 'recipeEarlier' : current ? 'recipeResult' : 'recipeSelection');
    $('recipe-definition').textContent = t(`definition_${metric.id}`);
    $('recipe-unit').textContent = `${t('conversion')}: ÷ ${metric.divisor.toLocaleString(locale)} → ${t(metric.unit)}`;
    $('copy-json').disabled = $('copy-node').disabled = false;
  } catch {
    for (const id of ['recipe-json', 'recipe-node', 'recipe-endpoint', 'recipe-definition', 'recipe-unit']) $(id).textContent = '';
    $('recipe-context').textContent = t('invalidPeriod');
    $('copy-json').disabled = $('copy-node').disabled = true;
  }
}

async function copyRecipe(format) {
  try {
    await navigator.clipboard.writeText($(format === 'json' ? 'recipe-json' : 'recipe-node').textContent);
    $('copy-status').textContent = t('copied');
  } catch { $('copy-status').textContent = t('copyFailed'); }
}

function downloadResult(format) {
  if (!current || loading) return;
  let url;
  try {
    const result = exportSnapshot(current, config, { dataSource: mode, viewStatus: state });
    const text = format === 'json' ? JSON.stringify(result, null, 2) + '\n' : toCSV(result);
    url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }));
    const link = element('a'); link.href = url; link.download = `learning-quality-${mode}.${format}`;
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
    $('export-status').textContent = t('downloaded');
  } catch { $('export-status').textContent = t('downloadFailed'); }
  finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function renderCharts() {
  const plays = current?.series.plays?.rows ?? [];
  const median = current?.series.startupMedian?.rows ?? [];
  const p95 = current?.series.startupP95?.rows ?? [];
  const period = current?.period;
  for (const [target, series, title, bars] of [[$('plays-chart'), [{ rows: plays }], t('playsTrend'), true], [$('startup-chart'), [{ rows: median }, { rows: p95 }], t('startupTrend'), false]]) {
    if (period) drawChart(target, { series, period, title, empty: t('noValues'), bars, segments: hourlySegments, locale });
    else target.replaceChildren(element('p', t('noValues'), 'empty-chart'));
  }
  $('plays-table').replaceChildren(dataTable([t('timeUtc'), t('plays')], plays.map(row => [date(row.at), number(row.value, 0)]), t('playsTrend')));
  const times = [...new Set([...median, ...p95].map(row => row.at))].sort();
  $('startup-table').replaceChildren(dataTable([t('timeUtc'), `${t('median')} (${t('seconds')})`, `${t('p95')} (${t('seconds')})`], times.map(at => [date(at), number(median.find(row => row.at === at)?.value), number(p95.find(row => row.at === at)?.value)]), t('startupTrend')));
}

function renderComparison() {
  const selected = config.assets.filter(asset => !current || (current.filters.asset === 'all' || current.filters.asset === asset.id) && (current.filters.type === 'all' || current.filters.type === asset.kind));
  const rows = selected.map(asset => [assetName(asset.id), ...['plays', 'startupP95', 'errorPercentage'].map(id => {
    const result = current?.comparison[id];
    return result?.status === 'error' ? t(result.code) : number(result?.rows.find(row => row.asset === asset.id)?.value, id === 'plays' ? 0 : 2);
  })]);
  $('comparison-table').replaceChildren(dataTable([t(config.kind === 'sports' ? 'video' : 'lesson'), t('plays'), `${t('p95')} (${t('seconds')})`, `${t('errorPercentage')} (%)`], rows));
}

function parameters() {
  let end; let start;
  if ($('period').value === 'custom') {
    start = new Date(`${$('start').value}:00.000Z`); end = new Date(`${$('end').value}:00.000Z`);
  } else {
    end = new Date(Math.floor(Date.now() / 60_000) * 60_000); start = new Date(end.getTime() - Number($('period').value) * 3_600_000);
  }
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end - start > 7 * 86_400_000 || end.getTime() > Date.now() + 60_000) throw new Error('INVALID_PERIOD');
  return new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), asset: $('asset').value, origin: $('origin').value, type: 'all' });
}

async function refresh() {
  if (mode !== 'measured' || loading || !config.queryConfigured || Date.now() < cooldownUntil) return;
  let params;
  try { params = parameters(); } catch { $('status').textContent = t('invalidPeriod'); return; }
  const key = params.toString();
  const earlier = key === currentKey ? current : null;
  if (key !== currentKey) current = null;
  currentKey = key; state = 'loading'; loading = true; renderQuality();
  await latest.run(async signal => {
    const response = await fetch(`/api/qoe?${params}`, { signal, cache: 'no-store' });
    if (!response.ok) { const error = new Error('QUERY_FAILED'); error.retryAfter = response.status === 429 ? Math.min(Number(response.headers.get('retry-after')) || 2, 604800) : 0; throw error; }
    return response.json();
  }, result => {
    loading = false; state = result.status;
    current = state === 'error' && earlier?.fetchedAt ? { ...earlier, stale: true } : result;
    const wait = Math.max(0, ...[...Object.values(result.metrics ?? {}), ...Object.values(result.series ?? {}), ...Object.values(result.comparison ?? {})].map(metric => metric.retryAfter ?? 0));
    if (wait) {
      cooldownUntil = Date.now() + wait * 1000;
      clearTimeout(cooldownTimer); cooldownTimer = setTimeout(renderQuality, Math.min(wait * 1000 + 20, 2_147_483_647));
    }
    renderQuality();
  }, error => { if (error.retryAfter) { cooldownUntil = Date.now() + error.retryAfter * 1000; clearTimeout(cooldownTimer); cooldownTimer = setTimeout(renderQuality, Math.min(error.retryAfter * 1000 + 20, 2147483647)); } loading = false; state = 'error'; current = earlier?.fetchedAt ? { ...earlier, stale: true } : null; renderQuality(); });
}

function loadDemo() {
  current = demoSnapshot({ asset: $('asset').value, origin: $('origin').value, scenario: $('scenario').value }, config);
  state = 'demo'; renderQuality();
}

function selectMode(next) {
  mode = next;
  $('export-status').textContent = ''; $('copy-status').textContent = '';
  latest.cancel(); loading = false; current = null; currentKey = '';
  state = config.queryConfigured ? 'noQuery' : 'unconfigured';
  if (mode === 'demo') loadDemo(); else renderQuality();
}

async function init() {
  const response = await fetch('/api/config', { cache: 'no-store' });
  if (!response.ok) throw new Error('CONFIG_FAILED');
  config = await response.json();
  $('origin-field').hidden = false;
  const end = new Date(Math.floor(Date.now() / 60_000) * 60_000); const start = new Date(end.getTime() - 86_400_000);
  $('start').value = start.toISOString().slice(0, 16); $('end').value = end.toISOString().slice(0, 16);
  mode = modeFromHash(location.hash);
  translate(); selectMode(mode);
  let chartWidth = 0;
  new ResizeObserver(entries => { const width = entries[0].contentRect.width; if (width !== chartWidth) { chartWidth = width; requestAnimationFrame(renderCharts); } }).observe($('plays-chart'));
  $('language').addEventListener('click', () => { locale = locale === 'en' ? 'ja' : 'en'; try { localStorage.setItem('analytics-language', locale); } catch { /* Optional preference. */ } translate(); });
  $('filters').addEventListener('submit', event => { event.preventDefault(); if (mode === 'demo') loadDemo(); else refresh(); });
  $('filters').addEventListener('change', () => {
    $('export-status').textContent = ''; $('copy-status').textContent = '';
    latest.cancel(); loading = false; current = null; currentKey = '';
    state = config.queryConfigured ? 'noQuery' : 'unconfigured';
    if (mode === 'demo') loadDemo(); else renderQuality();
  });
  $('recipe-metric').addEventListener('change', () => { $('copy-status').textContent = ''; renderRecipe(); });
  $('recipe-shape').addEventListener('change', () => { $('copy-status').textContent = ''; renderRecipe(); });
  for (const format of ['json', 'node']) $(`copy-${format}`).addEventListener('click', () => copyRecipe(format));
  for (const format of ['json', 'csv']) $(`download-${format}`).addEventListener('click', () => downloadResult(format));
  window.addEventListener('hashchange', () => {
    const next = modeFromHash(location.hash, mode);
    if (next !== mode) selectMode(next);
  });
}
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault(); $('main').focus(); $('main').scrollIntoView();
});
init().catch(() => { $('status').textContent = t('error'); });
