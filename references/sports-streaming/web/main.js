import { t, titleOf } from './i18n.js';
import './style.css';
import { HandoffLedger } from './handoffs.js';
import { button, jsonAt } from './media.js';
import { recordEvent, Session } from './session.js';
import { el, message, mountControls } from './controls.js';
import {
  archivePosition,
  canReturnToUtc,
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
    const p = session.player;
    seek((p.isLive() ? p.getTimeShift() : p.getCurrentTime()) + delta);
  },
  seek,
  (p) =>
    p.isLive()
      ? { start: p.getMaxTimeShift(), end: 0, current: p.getTimeShift() }
      : { ...p.getSeekableRange(), current: p.getCurrentTime() }
);
let catalog,
  event,
  status,
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
function seek(target) {
  const p = session.player;
  if (!interactive || !p) return;
  if (p.isLive()) p.timeShift(Math.max(p.getMaxTimeShift(), Math.min(0, target)), 'reference');
  else {
    const r = p.getSeekableRange();
    if (r.end > r.start) p.seek(Math.max(r.start, Math.min(r.end - 0.05, target)), 'reference');
  }
}
function liveUtc() {
  return interactive && session.ready ? sourceUtc(asset, session.utcSeconds()) : null;
}
function onEvent(type, eventInfo) {
  if (type === 'Error') {
    ledger.fail(pendingHandoff?.ticket, 'load-failed');
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
    observeHandoff();
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
  status = update;
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
async function poll() {
  clearTimeout(timer);
  const token = ++statusRequest;
  try {
    const update = validateStatus(await jsonAt(event.statusUrl, base), event);
    if (token !== statusRequest) return;
    applyStatus(update);
    maybeContinue();
    if (
      ['live', 'scheduled'].includes(update.status) ||
      (update.status === 'ended' && !['ready', 'failed'].includes(update.archiveStatus) && ++waiting < 12)
    )
      timer = setTimeout(poll, 5000);
  } catch {
    if (token !== statusRequest) return;
    status = null;
    showAssets();
    el('status').textContent = t('Event status unavailable. Refresh to retry.');
    if (++failedPolls < 3) timer = setTimeout(poll, 5000);
  }
}
function chooseEvent(item) {
  ++generation;
  ++statusRequest;
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
  status = null;
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
  void poll();
}
async function open(item, options = {}) {
  const token = ++generation;
  if (asset?.kind === 'live' && item.kind === 'clip') {
    savedUtc = liveUtc();
    savedPlay = interactive && !session.player.isPaused();
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
      const latest = validateStatus(await jsonAt(event.statusUrl, base), event);
      if (token !== generation) return;
      let offset = null;
      const inPublisherWindow = canReturnToUtc(latest, options.utc);
      if (p.isLive() && inPublisherWindow) {
        offset = await decodedReturnOffset(p, seconds);
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
      if (!(await timeShiftTo(p, seconds, offset))) throw Error();
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
      options.unknownPosition
        ? 'The previous position is unavailable. Choose Play to watch this video.'
        : ''
    );
    if (pendingHandoff?.ticket === ticket && ticket) {
      pendingHandoff.observing = true;
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
async function decodedReturnOffset(player, target) {
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
      const offset = liveReturnOffset(target, current, player.getTimeShift(), player.getMaxTimeShift());
      if (
        video &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !video.seeking &&
        sourceUtc(asset, current) !== null &&
        offset !== null
      ) {
        player.pause('positioning');
        return liveReturnOffset(
          target,
          session.utcSeconds(),
          player.getTimeShift(),
          player.getMaxTimeShift()
        );
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
  if (
    !pending?.observing ||
    pending.token !== generation ||
    !interactive ||
    !session.ready ||
    !player ||
    player.isCasting() ||
    player.isAirplayActive()
  )
    return;
  const video = session.host.querySelector('video');
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
      video.paused
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
  void open(target, { seconds: position.seconds, play: !session.player.isPaused(), handoff: true });
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
  try {
    const latest = validateStatus(await jsonAt(selectedEvent.statusUrl, base), selectedEvent);
    if (token !== generation) return;
    applyStatus(latest);
    if (!canReturnToUtc(latest, savedUtc)) {
      el('earlier').hidden = true;
      savedUtc = null;
      message('The saved DVR position has expired. You can keep watching this clip.');
      return;
    }
    void open(
      catalog.assets.find((a) => a.id === selectedEvent.liveAssetId),
      { utc: savedUtc, play: savedPlay }
    );
  } catch {
    if (token === generation) message('Event status unavailable. Refresh to retry.');
  }
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
  const play = video ? !video.paused : player.isPlaying();
  if (asset.kind === 'live') {
    const utc = liveUtc();
    void open(asset, utc === null ? { unknownPosition: true, play: false } : { utc, play });
  } else {
    const seconds = player.getCurrentTime('relativetime');
    void open(
      asset,
      Number.isFinite(seconds) && seconds >= 0 ? { seconds, play } : { unknownPosition: true, play: false }
    );
  }
};
void loadCatalog();
