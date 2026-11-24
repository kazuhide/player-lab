const millis = (value) => Number.isSafeInteger(value) && value >= 0;
export function validateCatalog(catalog) {
  if (catalog.schemaVersion !== 1 || !catalog.events?.length || !catalog.assets?.length)
    throw Error('Invalid catalog');
  const events = new Set(catalog.events.map((e) => e.id));
  const ids = new Set(catalog.assets.map((a) => a.id));
  const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(id);
  if (
    !catalog.events.every((e) => validId(e.id)) ||
    !catalog.assets.every((a) => validId(a.id) && validId(a.videoId)) ||
    new Set(catalog.assets.map((a) => a.videoId)).size !== catalog.assets.length
  )
    throw Error('Invalid catalog identity');
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

export function liveReturnOffset(target, currentUtc, currentShift, maxShift) {
  if (
    ![target, currentUtc, currentShift, maxShift].every(Number.isFinite) ||
    currentUtc <= 0 ||
    currentShift > 0 ||
    maxShift > 0
  )
    return null;
  const offset = target - (currentUtc - currentShift);
  return offset >= maxShift && offset <= 0 ? offset : null;
}

export function canReturnToUtc(status, utc) {
  return (
    status?.status === 'live' &&
    millis(utc) &&
    millis(status.seekableUtcStartMs) &&
    millis(status.seekableUtcEndMs) &&
    utc >= status.seekableUtcStartMs &&
    utc < status.seekableUtcEndMs
  );
}

// Compare publisher observations for one selected event. Request order and
// network delivery order do not identify which snapshot the publisher took last.
export function newerStatus(current, incoming) {
  if (!current) return incoming;
  for (const [a, b] of [
    [current.mediaUtcNow, incoming.mediaUtcNow],
    [Date.parse(current.observedAt), Date.parse(incoming.observedAt)]
  ]) {
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return b > a ? incoming : current;
  }
  // Snapshots can share a timestamp. The fixture's live window moves forward
  // and finished events do not return to the live state.
  if (current.status !== incoming.status) {
    const rank = { scheduled: 0, live: 1, ended: 2, cancelled: 2 };
    return rank[incoming.status] >= rank[current.status] ? incoming : current;
  }
  if (
    current.status === 'live' &&
    Number.isFinite(current.seekableUtcStartMs) &&
    Number.isFinite(incoming.seekableUtcStartMs) &&
    incoming.seekableUtcStartMs < current.seekableUtcStartMs
  )
    return current;
  if (
    current.status === 'live' &&
    incoming.seekableUtcStartMs === current.seekableUtcStartMs &&
    Number.isFinite(current.seekableUtcEndMs) &&
    Number.isFinite(incoming.seekableUtcEndMs) &&
    incoming.seekableUtcEndMs < current.seekableUtcEndMs
  )
    return current;
  if (
    current.status === 'ended' &&
    ['ready', 'failed'].includes(current.archiveStatus) &&
    !['ready', 'failed'].includes(incoming.archiveStatus)
  )
    return current;
  return incoming;
}

// SDK manifest segment times start at the retained window. The decoded
// segment identifies the corresponding position on the SDK seek timeline.
export function finalizedPosition(segments, anchor, utcSeconds) {
  if (
    !segments ||
    typeof anchor?.url !== 'string' ||
    !anchor.url ||
    ![anchor.utcSeconds, anchor.playbackTime, utcSeconds].every(Number.isFinite)
  )
    return null;
  const position = anchor.playbackTime + (utcSeconds - anchor.utcSeconds);
  for (const [type, representations] of Object.entries(segments)) {
    if (!type.startsWith('video/')) continue;
    for (const parts of Object.values(representations)) {
      const current = parts.find((part) => part.url === anchor.url);
      if (!current || !Number.isFinite(current.startTime)) continue;
      const target = current.startTime + (utcSeconds - anchor.utcSeconds);
      if (
        parts.some(
          (part) =>
            Number.isFinite(part.startTime) &&
            Number.isFinite(part.duration) &&
            target >= part.startTime &&
            target < part.startTime + part.duration
        )
      )
        return position;
    }
  }
  return null;
}
