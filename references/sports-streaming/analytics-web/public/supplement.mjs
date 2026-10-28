const safeId = /^[A-Za-z0-9:_-]{1,80}$/;
const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
function validTime(value) { return typeof value === 'string' && utc.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString().slice(0, 19) === value.slice(0, 19); }
function exactKeys(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)); }
function state(value, allowed, confirmed) {
  const keys = ['videoId', 'positionMs', 'playWhenReady', ...(confirmed ? ['positionAdvanced'] : [])];
  return exactKeys(value, keys) && allowed.has(value.videoId) && ((!confirmed && value.positionMs === null) || (Number.isSafeInteger(value.positionMs) && value.positionMs >= 0 && value.positionMs <= 7 * 86_400_000)) && typeof value.playWhenReady === 'boolean' && (!confirmed || typeof value.positionAdvanced === 'boolean');
}

export function parseRecords(text, videoIds) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > 1_048_576) throw new Error('INVALID_RECORDS');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('INVALID_RECORDS'); }
  if (!exactKeys(value, ['schemaVersion', 'source', 'period', 'records']) || value.schemaVersion !== 1 || !['fictional-demo', 'local-device-records'].includes(value.source) || !exactKeys(value.period, ['start', 'end']) || !validTime(value.period.start) || !validTime(value.period.end) || Date.parse(value.period.end) < Date.parse(value.period.start) || !Array.isArray(value.records) || value.records.length > 200) throw new Error('INVALID_RECORDS');
  const seen = new Set(); const allowed = new Set(videoIds);
  for (const row of value.records) {
    if (!exactKeys(row, ['requestId', 'requestedAt', 'eventId', 'transition', 'requested', 'confirmed', 'failure', 'receiverQoe']) || (typeof row.requestId !== 'string' || !safeId.test(row.requestId)) || seen.has(row.requestId) || (typeof row.eventId !== 'string' || !safeId.test(row.eventId)) || !validTime(row.requestedAt) || Date.parse(row.requestedAt) < Date.parse(value.period.start) || Date.parse(row.requestedAt) > Date.parse(value.period.end) || !['live-to-archive', 'cast'].includes(row.transition) || !state(row.requested, allowed, false) || (row.confirmed !== null && !state(row.confirmed, allowed, true)) || ![null, 'load-failed', 'position-mismatch', 'disconnected'].includes(row.failure) || row.receiverQoe !== null) throw new Error('INVALID_RECORDS');
    seen.add(row.requestId);
  }
  return value;
}

export function handoffOutcome(record) {
  if (record.failure) return 'failed';
  const a = record.requested; const b = record.confirmed;
  if (a.positionMs === null || !b || a.videoId !== b.videoId || Math.abs(a.positionMs - b.positionMs) > 1000 || a.playWhenReady !== b.playWhenReady || (a.playWhenReady && !b.positionAdvanced)) return 'pending';
  return 'success';
}

export function summarizeRecords(value) {
  const counts = { requests: value.records.length, success: 0, failed: 0, pending: 0 };
  for (const row of value.records) counts[handoffOutcome(row)] += 1;
  const confirmed = counts.success + counts.failed;
  return { ...counts, confirmedRate: confirmed ? counts.success / confirmed * 100 : null, allRate: counts.requests ? counts.success / counts.requests * 100 : null, receiverQoe: null };
}

export function fictionalRecords() {
  const records = Array.from({ length: 8 }, (_, index) => {
    const requested = { videoId: index < 4 ? 'sports:SP-ARCH-EVENT' : 'sports:SP-LIVE-EVENT', positionMs: 90_000, playWhenReady: index % 2 === 0 };
    return {
      requestId: `example-${index + 1}`, requestedAt: `2026-10-28T0${index}:00:00.000Z`, eventId: 'SP-EVENT-A', transition: index < 4 ? 'live-to-archive' : 'cast',
      requested,
      confirmed: index < 6 ? { ...requested, positionAdvanced: requested.playWhenReady } : null,
      failure: index === 6 ? 'disconnected' : null, receiverQoe: null,
    };
  });
  return { schemaVersion: 1, source: 'fictional-demo', period: { start: '2026-10-28T00:00:00.000Z', end: '2026-10-28T08:00:00.000Z' }, records };
}
