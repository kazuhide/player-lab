import { t, titleOf } from './i18n.js';
import './style.css';
import { HandoffLedger } from './handoffs.js';
import { button, jsonAt } from './media.js';
import { recordEvent, Session } from './session.js';
import { el, message, mountControls } from './controls.js';
import {
  archivePosition,
  canReturnToUtc,
  changedPublisher,
  newerStatus,
  sourceUtc,
  liveReturnOffset,
  validateCatalog,
  validateStatus
} from './sports.js';

const base = import.meta.env.VITE_MEDIA_BASE_URL || 'http://127.0.0.1:8622/';
const ledger = new HandoffLedger();
let pendingHandoff = null;
const preferences = { speed: 1, caption: 'off' };
const session = new Session(el('player'), base, onEvent);
const controls = mountControls(
  session,
  preferences,
  (delta) => {
    const range = session.controlRange();
    if (range) seek(range.current + delta, range);
  },
  seek,
  () => session.controlRange()
);
let catalog,
  event,
  status,
  lastPublishedStatus,
  asset,
  savedUtc = null,
  generation = 0,
  statusRequest = 0,
  timer,
  waiting = 0,
  failedPolls = 0,
  intent,
  activeFormat;
let interactive = false,
  savedPlay = true,
  autoClaimed = false;
function seek(target, range = session.controlRange()) {
  const p = session.player;
  if (!interactive || !range) return;
  if (pendingHandoff?.observing) pendingHandoff = null;
  if (p.isLive()) p.timeShift(Math.max(range.start, Math.min(range.end, target)), 'reference');
  else if (range.end > range.start) {
    const seconds = Math.max(range.start, Math.min(range.end - 0.05, target));
    if (
      (target > range.current && seconds <= range.current) ||
      (target < range.current && seconds >= range.current)
    )
      return;
    if (range.clock) void session.seekNative(range.clock, seconds);
    else p.seek(seconds, 'reference');
  }
}
function intendsPlay() {
  const video = session.host.querySelector('video');
  return video ? !video.paused : session.player.isPlaying();
}
function liveUtc() {
  return interactive && session.ready ? sourceUtc(asset, session.utcSeconds()) : null;
}
function checkpoint(type) {
  if (!['TimeChanged', 'Seeked', 'Playing', 'Paused'].includes(type)) return;
  const player = session.player;
  if (player.getSource()?.metadata?.videoId !== asset.videoId) return;
  const play = type === 'Playing' ? true : type === 'Paused' ? false : (intent?.play ?? player.isPlaying());
  const utc = asset.kind === 'live' ? liveUtc() : null;
  if (utc !== null) intent = { utc, play };
  else if (asset.kind !== 'live') {
    const seconds = player.getCurrentTime('relativetime');
    if (Number.isFinite(seconds) && seconds >= 0 && seconds < player.getDuration())
      intent = { seconds, play };
  }
}
function onEvent(type, eventInfo) {
  if (type === 'Error') {
    if (pendingHandoff?.observing) pendingHandoff = null;
    else ledger.fail(pendingHandoff?.ticket, 'load-failed');
    interactive = false;
    controls.enable(false);
    el('retry').hidden = false;
    message(
      t('Playback error') + (Number.isInteger(eventInfo.code) ? ' (' + eventInfo.code + ')' : '') + '.'
    );
    actions();
    return;
  }
  if (!session.ready) return;
  if (type === 'SubtitleAdded') session.setCaption(preferences.caption);
  if (type.startsWith('Subtitle')) {
    controls.captions();
    if (interactive && type !== 'SubtitleAdded') preferences.caption = el('captions').value;
  }
  if (type === 'PlaybackSpeedChanged') controls.reflectSpeed();
  controls.paint();
  if (interactive) {
    if (
      pendingHandoff?.observing &&
      (['Seek', 'TimeShift', 'CastStart', 'CastStarted', 'AirplayChanged'].includes(type) ||
        (type === 'Paused' && pendingHandoff.ticket.row.requested.playWhenReady) ||
        session.player.isCasting() ||
        session.player.isAirplayActive())
    )
      pendingHandoff = null;
    observeHandoff();
    checkpoint(type);
    actions();
    if (type === 'PlaybackFinished' && asset.kind === 'clip' && status?.status === 'live')
      el('return').click();
    else if (type === 'TimeChanged') maybeContinue();
  }
}
function actions() {
  const live = asset?.kind === 'live';
  el('edge').disabled = !(live && interactive && session.player?.isLive());
  el('return').hidden = !(asset?.kind === 'clip' && status?.status === 'live');
  el('earlier').hidden = el('return').hidden || !canReturnToUtc(status, savedUtc);
  el('archives').hidden = !(live && interactive && status?.archiveStatus === 'ready');
}
function showAssets() {
  const items = catalog.assets.filter((a) => a.eventId === event.id);
  const buttons = items.map((a) => {
    const b = button(titleOf(a) + ' · ' + t(a.kind), () => open(a));
    b.dataset.id = a.id;
    b.setAttribute('aria-current', String(asset?.id === a.id));
    b.disabled =
      (a.kind === 'archive' && status?.archiveStatus !== 'ready') ||
      (a.kind === 'live' && !['live', 'ended'].includes(status?.status));
    return b;
  });
  el('assets').replaceChildren(...buttons);
  el('targets').replaceChildren(
    ...items.filter((a) => a.kind === 'archive').map((a) => button(titleOf(a), () => handoff(a)))
  );
  actions();
}
function applyStatus(update) {
  const changed = update.status !== status?.status || update.archiveStatus !== status?.archiveStatus;
  status = lastPublishedStatus = update;
  failedPolls = 0;
  el('status').textContent =
    t('Event') +
    ' · ' +
    t(update.status) +
    ' / ' +
    t('Archive') +
    ' · ' +
    t(update.archiveStatus.replaceAll('_', ' '));
  if (changed) showAssets();
  actions();
}
let statusReads = new Set();
function poll() {
  const reads = statusReads;
  const request = readStatus(reads);
  reads.add(request);
  request.finally(() => reads.delete(request));
  return request;
}
async function readStatus(reads) {
  clearTimeout(timer);
  const token = ++statusRequest;
  try {
    const update = validateStatus(await jsonAt(event.statusUrl, base), event);
    if (reads !== statusReads) return;
    const current = newerStatus(lastPublishedStatus, update);
    if (!status && current !== update) return;
    if (current !== status) {
      if (changedPublisher(lastPublishedStatus, current)) {
        // Never reuse a previous run's DVR position, source or pending handoff.
        if (asset?.kind === 'clip') {
          statusReads = new Set();
          savedUtc = null;
          waiting = 0;
          applyStatus(current);
          void poll();
          return current;
        }
        const live = asset?.kind === 'live' && current.status === 'live' ? asset : null;
        const play = interactive ? intendsPlay() : intent?.play !== false;
        chooseEvent(event, current);
        if (live) void open(live, { play });
        return current;
      }
      applyStatus(current);
      maybeContinue();
    }
    if (
      token === statusRequest &&
      (['live', 'scheduled'].includes(current.status) ||
        (current.status === 'ended' &&
          !['ready', 'failed'].includes(current.archiveStatus) &&
          ++waiting < 12))
    )
      timer = setTimeout(poll, 5000);
    return current;
  } catch {
    if (token !== statusRequest) return;
    status = null;
    showAssets();
    el('status').textContent = t('Event status unavailable. Refresh to retry.');
    if (++failedPolls < 3) timer = setTimeout(poll, 5000);
  }
}
function chooseEvent(item, knownStatus = null) {
  ++generation;
  ++statusRequest;
  statusReads = new Set();
  clearTimeout(timer);
  interactive = false;
  controls.enable(false);
  void session.close();
  pendingHandoff = null;
  event = item;
  el('archiveTarget').replaceChildren(
    ...catalog.assets
      .filter((a) => a.eventId === item.id && a.kind === 'archive')
      .map((a) => new Option(titleOf(a), a.id))
  );
  el('archiveTarget').value = item.archiveAssetId;
  status = lastPublishedStatus = null;
  asset = null;
  savedUtc = null;
  intent = null;
  waiting = 0;
  failedPolls = 0;
  for (const b of el('events').children) b.setAttribute('aria-current', String(b.dataset.id === item.id));
  el('title').textContent = titleOf(item);
  message('');
  el('retry').hidden = true;
  el('status').textContent = t('Checking event…');
  showAssets();
  if (knownStatus) applyStatus(knownStatus);
  void poll();
}
async function open(item, options = {}) {
  const token = ++generation;
  if (asset?.kind === 'live' && item.kind === 'clip') {
    savedUtc = liveUtc();
    savedPlay = interactive && intendsPlay();
  }
  autoClaimed = false;
  interactive = false;
  controls.enable(false);
  const ticket = options.handoff
    ? ledger.begin(item.eventId, item.videoId, Math.round(options.seconds * 1000), options.play)
    : null;
  pendingHandoff = ticket ? { ticket, token, observing: false } : null;
  if (ticket) el('export').disabled = false;
  intent = options;
  activeFormat = el('format').value;
  asset = item;
  el('title').textContent = titleOf(asset);
  for (const b of el('assets').children) b.setAttribute('aria-current', String(b.dataset.id === item.id));
  el('retry').hidden = true;
  actions();
  message('Loading video…');
  try {
    if (!(await session.open(item, activeFormat, {})) || token !== generation) return;
    controls.restore();
    if (options.utc != null) {
      const p = session.player,
        seconds = options.utc / 1000;
      // The Web SDK can return {-1,-1} for getSeekableRange on a live
      // manifest. Verify the publisher window, then confirm the SDK's actual
      // time after the seek instead of interpreting a sentinel as a range.
      const latest = await poll();
      if (token !== generation) return;
      if (!latest) throw Error();
      let offset = null;
      const inPublisherWindow = canReturnToUtc(latest, options.utc);
      const live = p.isLive();
      if (
        (live && inPublisherWindow) ||
        (!live && latest.status === 'ended' && sourceUtc(item, seconds) !== null)
      ) {
        offset = await decodedReturnPosition(p, seconds, live);
        if (token !== generation) return;
      }
      if (offset === null) {
        // Keep this source paused; only an explicit choice can fall back to its edge.
        interactive = true;
        controls.enable(true);
        actions();
        message(
          p.isLive() && !inPublisherWindow
            ? 'Saved position left the DVR window. Choose Live edge to continue.'
            : 'The previous position is unavailable. Choose Play to watch this video.'
        );
        return;
      }
      const positioned = live ? await timeShiftTo(p, seconds, offset) : await session.seekFinalized(seconds, offset);
      if (token !== generation) return;
      const observed = session.utcSeconds();
      if (!positioned || !Number.isFinite(observed) || Math.abs(observed - seconds) > 1.5) throw Error();
    } else if (options.seconds != null && !(await session.seekTo(options.seconds))) {
      ledger.fail(ticket, 'position-mismatch');
      throw Error();
    }
    if (token !== generation) return;
    if (!session.ready) throw Error();
    interactive = true;
    controls.enable(true);
    actions();
    message(
      options.completed
        ? 'This video has finished. Choose Play to replay it.'
        : options.unknownPosition
          ? 'The previous position is unavailable. Choose Play to watch this video.'
          : ''
    );
    if (pendingHandoff?.ticket === ticket && ticket) {
      // Positioning is complete. Any later Retry belongs to this archive
      // playback, independently of whether the local receipt is confirmed.
      intent = { seconds: session.player.getCurrentTime('relativetime'), play: options.play };
      pendingHandoff.observing = true;
      pendingHandoff.deadline = performance.now() + 5000;
      observeHandoff();
      for (const delay of [250, 750, 1500, 3000]) {
        setTimeout(() => {
          if (generation === token) observeHandoff();
        }, delay);
      }
      setTimeout(() => {
        if (generation === token) pendingHandoff = null;
      }, 5000);
    }
    if (options.play !== false) await session.play();
  } catch {
    if (token !== generation) return;
    ledger.fail(ticket, 'load-failed');
    interactive = false;
    controls.enable(false);
    actions();
    el('retry').hidden = false;
    message(
      import.meta.env.VITE_PUBLIC_PLAYER_LICENSE_KEY
        ? 'Playback or positioning failed. Retry or select another video.'
        : 'Set VITE_PUBLIC_PLAYER_LICENSE_KEY in .env.local and restart the app.'
    );
  }
}
async function decodedReturnPosition(player, target, live) {
  const readPosition = () =>
    live
      ? liveReturnOffset(target, session.utcSeconds(), player.getTimeShift(), player.getMaxTimeShift())
      : session.finalizedPosition(target);
  // On MSE the initial live clock can point at the first available segment
  // until the first frame decodes, with no seekable range yet. Decode muted
  // behind the loading state before computing a fresh live-edge offset.
  const host = session.host.firstElementChild;
  const muted = player.isMuted();
  host.style.visibility = 'hidden';
  player.mute('positioning');
  try {
    await player.play('positioning');
    const deadline = performance.now() + 4500;
    const video = host.querySelector('video');
    // play() may resolve before the SDK's decoded time and seek window have
    // settled. In particular, an immediately reopened live edge can lag the
    // previous player by a fraction of one segment.
    while (session.player === player && performance.now() < deadline) {
      const current = session.utcSeconds();
      const offset = readPosition();
      if (
        video &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !video.seeking &&
        sourceUtc(asset, current) !== null &&
        offset !== null
      ) {
        player.pause('positioning');
        return readPosition();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  } finally {
    host.style.visibility = '';
    if (session.player === player) {
      player.pause('positioning');
      if (!muted) player.unmute('positioning');
    }
  }
}
function timeShiftTo(player, utcSeconds, offset) {
  if (Math.abs(session.utcSeconds() - utcSeconds) < 0.1) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (value) => {
      clearTimeout(timeout);
      if (session.player === player) player.off('timeshifted', check);
      resolve(value);
    };
    const check = () =>
      finish(session.player === player && Math.abs(session.utcSeconds() - utcSeconds) <= 1.5);
    const timeout = setTimeout(() => finish(false), 5000);
    player.on('timeshifted', check);
    try {
      player.timeShift(offset, 'reference');
    } catch {
      finish(false);
    }
  });
}
function observeHandoff() {
  const pending = pendingHandoff,
    player = session.player;
  if (!pending?.observing || pending.token !== generation || !interactive || !session.ready || !player)
    return;
  const now = performance.now();
  if (now > pending.deadline || pending.ticket.retired || player.isCasting() || player.isAirplayActive()) {
    pendingHandoff = null;
    return;
  }
  const video = session.host.querySelector('video');
  if (video?.seeking) {
    // SDK Seeked can precede decoding the initial handoff frame.
    if (pending.ticket.first !== null) pendingHandoff = null;
    return;
  }
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const seconds = player.getCurrentTime('relativetime');
  if (!Number.isFinite(seconds) || seconds < 0) return;
  const positionMs = Math.round(seconds * 1000);
  if (
    ledger.observe(
      pending.ticket,
      player.getSource()?.metadata?.videoId,
      positionMs,
      player.isPlaying(),
      video.paused,
      now,
      player.getPlaybackSpeed()
    )
  ) {
    recordEvent(asset.id, 'HandoffConfirmed');
    pendingHandoff = null;
  }
}
el('export').onclick = () => {
  const blob = new Blob([JSON.stringify(ledger.snapshot(), null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'sports-handoffs.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
function handoff(target) {
  if (
    status?.archiveStatus !== 'ready' ||
    !interactive ||
    asset.kind !== 'live' ||
    target.eventId !== event.id
  )
    return;
  const mapping = target.id === event.archiveAssetId ? status.archiveMapping : target;
  const position = archivePosition(mapping, liveUtc());
  if (position.reason) {
    message(t(position.reason) + ' · ' + t('Select the archive under Watch to start from its beginning.'));
    return;
  }
  void open(target, { seconds: position.seconds, play: intendsPlay(), handoff: true });
}
function maybeContinue() {
  if (
    !interactive ||
    asset?.kind !== 'live' ||
    !el('auto').checked ||
    autoClaimed ||
    status?.status !== 'ended' ||
    status.archiveStatus !== 'ready'
  )
    return;
  const target = catalog.assets.find((a) => a.eventId === event.id && a.id === el('archiveTarget').value);
  const mapping = target?.id === event.archiveAssetId ? status.archiveMapping : target;
  if (!target || archivePosition(mapping, liveUtc()).seconds == null) return;
  autoClaimed = true;
  handoff(target);
}
el('archiveTarget').onchange = el('auto').onchange = maybeContinue;
async function loadCatalog() {
  try {
    catalog = validateCatalog(await jsonAt('catalog.json', base));
    el('events').replaceChildren(
      ...catalog.events.map((e) => {
        const b = button(titleOf(e), () => chooseEvent(e));
        b.dataset.id = e.id;
        return b;
      })
    );
    chooseEvent(catalog.events[0]);
  } catch {
    message('Catalog unavailable. Start the media publisher and refresh status.');
  }
}
el('refresh').onclick = () => {
  waiting = failedPolls = 0;
  if (event) void poll();
  else void loadCatalog();
};
el('retry').onclick = () => {
  if (asset) void open(asset, intent);
};
el('return').onclick = () => open(catalog.assets.find((a) => a.id === event.liveAssetId));
el('earlier').onclick = async () => {
  if (!interactive || asset?.kind !== 'clip' || !canReturnToUtc(status, savedUtc)) return;
  const token = generation,
    selectedEvent = event;
  const reads = statusReads;
  if (!(await poll()) || token !== generation) return;
  // Refresh can begin while a previous read is settling. Drain this event's
  // outstanding reads before the synchronous decision to leave the clip.
  while (token === generation && reads === statusReads && reads.size) await Promise.all([...reads]);
  if (token !== generation || reads !== statusReads || !status) return;
  if (!canReturnToUtc(status, savedUtc)) {
    savedUtc = null;
    actions();
    message('The saved DVR position has expired. You can keep watching this clip.');
    return;
  }
  void open(
    catalog.assets.find((a) => a.id === selectedEvent.liveAssetId),
    { utc: savedUtc, play: savedPlay }
  );
};
el('edge').onclick = () => {
  seek(0);
  void session.play();
};
el('format').onchange = () => {
  if (!asset) return;
  const player = session.player;
  const format = el('format').value;
  if (
    !asset.streams[format] ||
    (session.ready && !player.getSupportedTech().some((tech) => tech.streaming === format))
  ) {
    el('format').value = activeFormat;
    message('This delivery format is unavailable for the selected video.');
    return;
  }
  if (!interactive || !session.ready || player.getSource()?.metadata?.videoId !== asset.videoId) {
    // A second format change can arrive while the previous one is positioning.
    void open(asset, { ...intent, handoff: false });
    return;
  }
  const video = session.host.querySelector('video');
  const play = intendsPlay();
  if (asset.kind === 'live') {
    const utc = liveUtc();
    void open(asset, utc === null ? { unknownPosition: true, play: false } : { utc, play });
  } else {
    const seconds = player.getCurrentTime('relativetime');
    const range = player.getSeekableRange();
    if (video?.ended || (range.end > range.start && seconds >= range.end)) {
      void open(asset, { completed: true, play: false });
      return;
    }
    void open(
      asset,
      Number.isFinite(seconds) && seconds >= 0 ? { seconds, play } : { unknownPosition: true, play: false }
    );
  }
};
void loadCatalog();
