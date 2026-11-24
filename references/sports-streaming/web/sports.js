const millis = (value) => Number.isSafeInteger(value) && value >= 0;
export function validateCatalog(catalog) {
  if (catalog.schemaVersion !== 1 || !catalog.events?.length || !catalog.assets?.length)
    throw Error('Invalid catalog');
  const events = new Set(catalog.events.map((e) => e.id));
  const ids = new Set(catalog.assets.map((a) => a.id));
  if (events.size !== catalog.events.length || ids.size !== catalog.assets.length)
    throw Error('Duplicate identifier');
  for (const a of catalog.assets) {
    if (
      !events.has(a.eventId) ||
      !['live', 'clip', 'archive'].includes(a.kind) ||
      !a.title ||
      !a.videoId ||
      !a.streams ||
      !Array.isArray(a.subtitleTracks)
    )
      throw Error('Invalid asset');
  }
  for (const e of catalog.events)
    for (const [id, kind] of [
      [e.liveAssetId, 'live'],
      [e.archiveAssetId, 'archive']
    ]) {
      if (id && !catalog.assets.some((a) => a.id === id && a.kind === kind && a.eventId === e.id))
        throw Error('Asset belongs to another event');
    }
  return catalog;
}
export function validateStatus(update, event) {
  if (
    update.id !== event.id ||
    update.eventId !== event.id ||
    update.liveAssetId !== event.liveAssetId ||
    update.archiveAssetId !== event.archiveAssetId ||
    !['scheduled', 'live', 'ended', 'cancelled'].includes(update.status) ||
    !['not_ready', 'processing', 'ready', 'failed'].includes(update.archiveStatus)
  )
    throw Error('Event status mismatch');
  if (
    update.archiveMapping &&
    (update.archiveStatus !== 'ready' || update.archiveMapping.assetId !== event.archiveAssetId)
  )
    throw Error('Invalid archive status');
  return update;
}
// Return a reason when a point is outside the verified timeline. Never
// substitute the device clock, the live edge, or an unmeasured zero offset.
export function archivePosition(mapping, utc) {
  if (!mapping || !millis(utc) || !millis(mapping.durationMs) || !mapping.durationMs)
    return { reason: 'UTC mapping unavailable' };
  const intervals = mapping.utcMappings ?? [];
  let offset;
  if (intervals.length) {
    let previousEnd = 0,
      previousArchiveEnd = 0;
    for (const { utcStartMs: start, utcEndMs: end, archiveStartMs: position } of intervals) {
      const archiveEnd = position + (end - start);
      if (
        ![start, end, position, archiveEnd].every(millis) ||
        start >= end ||
        start < previousEnd ||
        position < previousArchiveEnd ||
        archiveEnd > mapping.durationMs
      )
        return { reason: 'Invalid archive mapping' };
      if (utc >= start && utc < end) offset = position + (utc - start);
      previousEnd = end;
      previousArchiveEnd = archiveEnd;
    }
    if (utc === previousEnd && previousArchiveEnd === mapping.durationMs)
      return { reason: 'At archive end' };
  } else if (millis(mapping.utcStartMs)) offset = utc - mapping.utcStartMs;
  else return { reason: 'UTC mapping unavailable' };
  if (offset === mapping.durationMs) return { reason: 'At archive end' };
  if (!(offset >= 0 && offset < mapping.durationMs))
    return { reason: 'Position outside the retained archive' };
  return { seconds: offset / 1000 };
}
export function sourceUtc(asset, seconds) {
  const utc = Math.round(seconds * 1000);
  if (
    asset?.kind !== 'live' ||
    !Number.isFinite(seconds) ||
    !millis(asset.utcStartMs) ||
    asset.utcStartMs <= 0 ||
    !millis(utc) ||
    utc < asset.utcStartMs
  )
    return null;
  if (millis(asset.expectedDurationMs) && utc > asset.utcStartMs + asset.expectedDurationMs) return null;
  return utc;
}
