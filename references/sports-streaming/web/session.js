import { finalizedPosition, mediaRangeAt } from './sports.js';
import { DashClock } from './dash-clock.js';
import { locale, titleOf } from './i18n.js';
import { UI_JA } from './ui-ja.js';
import { Player, PlayerEvent } from 'bitmovin-player';
import { UIFactory } from 'bitmovin-player-ui';
import 'bitmovin-player-ui/dist/css/bitmovinplayer-ui.css';
import { mediaUrl } from './media.js';

// A source change retires the old SDK owner. A controls-only change uses CSS and
// keeps the same player, source, caption renderer and Analytics impression.
export function recordEvent(assetId, type, code) {
  const log = document.getElementById('log');
  const item = document.createElement('li');
  item.dataset.event = type;
  item.textContent = assetId + ' · ' + type + (Number.isInteger(code) ? ' (' + code + ')' : '');
  log.append(item);
  while (log.children.length > 30) log.firstChild.remove();
}

export class Session {
  constructor(host, base, onEvent) {
    this.host = host;
    this.base = base;
    this.onEvent = onEvent;
    this.generation = 0;
    this.retirement = Promise.resolve();
    this.player = null;
    this.ready = false;
  }
  close() {
    ++this.generation;
    this.ready = false;
    const old = this.player;
    this.player = null;
    if (old) {
      this.ui?.release();
      this.ui = null;
      this.retirement = old.destroy();
    }
    return this.retirement;
  }
  async open(asset, format, analytics, embedded = false) {
    const retiring = this.close();
    const token = this.generation;
    await retiring;
    if (token !== this.generation) return false;
    const key = import.meta.env.VITE_PUBLIC_PLAYER_LICENSE_KEY;
    if (!key) throw Error('Set VITE_PUBLIC_PLAYER_LICENSE_KEY in .env.local and restart the app.');
    const analyticsKey = import.meta.env.VITE_PUBLIC_ANALYTICS_LICENSE_KEY;
    const mount = document.createElement('div');
    this.host.replaceChildren(mount);
    const clock = asset.kind === 'live' && format === 'dash' ? new DashClock(asset.utcStartMs) : null;
    this.dashClock = clock;
    this.finalizedAnchor = null;
    const player = (this.player = new Player(mount, {
      key,
      ui: false,
      analytics: analyticsKey
        ? { key: analyticsKey, ...analytics, videoId: asset.videoId, title: asset.title }
        : false,
      network: clock
        ? {
            preprocessHttpResponse: async (type, response) => {
              if (type === 'manifest/dash') clock.readManifest(response.body);
              return response;
            }
          }
        : undefined,
      playback: { autoplay: false },
      adaptation: { preload: true }
    }));
    if (asset.kind === 'live')
      player.on(PlayerEvent.SegmentPlayback, (event) => {
        if (this.player !== player || !event.mimeType?.startsWith('video/')) return;
        clock?.observe(event);
        if (!player.isLive()) {
          const utcSeconds = clock ? clock.utc(event.playbackTime) : Date.parse(event.dateTime) / 1000;
          this.finalizedAnchor =
            Number.isFinite(utcSeconds) && Number.isFinite(event.playbackTime)
              ? { utcSeconds, playbackTime: event.playbackTime, url: event.url }
              : null;
        }
      });
    const record = (type, code) => recordEvent(asset.id, type, code);
    record('Load');
    this.ui = UIFactory.buildUI(player, {
      localization: {
        language: locale,
        vocabularies: { ja: UI_JA },
        adaptLocalizationToSubtitleLanguage: false
      }
    });
    for (const type of [
      'Playing',
      'Paused',
      'TimeChanged',
      'PlaybackFinished',
      'Seek',
      'TimeShift',
      'CastStart',
      'CastStarted',
      'AirplayChanged',
      'Seeked',
      'TimeShifted',
      'SubtitleAdded',
      'SubtitleEnabled',
      'SubtitleDisabled',
      'PlaybackSpeedChanged',
      'Error'
    ]) {
      player.on(PlayerEvent[type], (event) => {
        if (this.player !== player) return;
        if (type !== 'TimeChanged') record(type, event.code);
        if (type === 'Error') this.ready = false;
        this.onEvent(type, event);
      });
    }
    const path = embedded ? asset.streams.hlsWithSubtitles : asset.streams[format];
    const source = {
      metadata: { videoId: asset.videoId },
      title: titleOf(asset),
      [format]: mediaUrl(path, this.base)
    };
    if (!embedded)
      source.subtitleTracks = asset.subtitleTracks.map((track) => ({
        id: track.language,
        lang: track.language,
        label: track.label,
        kind: 'subtitle',
        enabled: false,
        url: mediaUrl(track.url, this.base)
      }));
    await player.load(source);
    if (this.player !== player) return false;
    record('Loaded');
    this.ready = true;
    return true;
  }
  nativeFinalizedClock() {
    const player = this.player;
    if (player.getPlayerType() !== 'native' || player.getStreamType() !== 'hls' || player.isLive())
      return null;
    const video = player.getVideoElement();
    if (
      !video ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.currentSrc !== player.getSource()?.hls ||
      typeof video.getStartDate !== 'function'
    )
      return null;
    const origin = video.getStartDate().getTime() / 1000;
    return Number.isFinite(origin) && Number.isFinite(video.currentTime) ? { video, origin } : null;
  }
  controlRange() {
    const player = this.player;
    if (!this.ready || !player) return null;
    if (player.isLive()) return { start: player.getMaxTimeShift(), end: 0, current: player.getTimeShift() };
    const clock = this.nativeFinalizedClock();
    if (clock) {
      const ranges = clock.video.seekable;
      if (!ranges.length) return null;
      return {
        start: ranges.start(0),
        end: ranges.end(ranges.length - 1),
        current: clock.video.currentTime,
        clock
      };
    }
    return { ...player.getSeekableRange(), current: player.getCurrentTime() };
  }
  utcSeconds() {
    const native = this.nativeFinalizedClock();
    if (native) return native.origin + native.video.currentTime;
    const seconds = this.player.getCurrentTime('absolutetime');
    if (this.finalizedAnchor && !this.player.isLive())
      return this.finalizedAnchor.utcSeconds + (seconds - this.finalizedAnchor.playbackTime);
    return this.dashClock ? this.dashClock.utc(seconds) : seconds;
  }
  finalizedPosition(utcSeconds) {
    const native = this.nativeFinalizedClock();
    if (native) {
      // Native HLS exposes program date via the active media element and
      // retained ranges via TimeRanges. It has no SDK segment map.
      const mediaTime = utcSeconds - native.origin;
      return mediaRangeAt(native.video.seekable, mediaTime)
        ? this.player.getCurrentTime('relativetime') + (mediaTime - native.video.currentTime)
        : null;
    }
    return finalizedPosition(this.player.getAvailableSegments(), this.finalizedAnchor, utcSeconds);
  }
  setCaption(language) {
    const player = this.player;
    if (!this.ready || !player) return;
    for (const track of player.subtitles.list()) {
      if (track.lang === language && !track.enabled) player.subtitles.enable(track.id, true);
      else if (track.lang !== language && track.enabled) player.subtitles.disable(track.id);
    }
  }
  async play() {
    if (!this.ready) return;
    try {
      await this.player.play('reference');
    } catch {
      /* A browser can require another user gesture. Play stays available. */
    }
  }
  async seekTo(seconds) {
    const player = this.player;
    if (!this.ready || !player || !Number.isFinite(seconds)) return false;
    const range = player.getSeekableRange();
    if (!range || seconds < range.start || seconds >= range.end) return false;
    if (Math.abs(player.getCurrentTime() - seconds) < 0.05) return true;
    return new Promise((resolve) => {
      const finish = (result) => {
        clearTimeout(timer);
        if (this.player === player) player.off(PlayerEvent.Seeked, check);
        resolve(result);
      };
      const check = () =>
        finish(this.player === player && this.ready && Math.abs(player.getCurrentTime() - seconds) <= 1);
      const timer = setTimeout(() => finish(false), 5000);
      player.on(PlayerEvent.Seeked, check);
      try {
        if (!player.seek(seconds, 'reference')) finish(false);
      } catch {
        finish(false);
      }
    });
  }
  async seekFinalized(utcSeconds, relativeSeconds) {
    const player = this.player;
    if (player.getPlayerType() !== 'native' || player.getStreamType() !== 'hls')
      return this.seekTo(relativeSeconds);
    const clock = this.nativeFinalizedClock();
    if (!this.ready || !clock) return false;
    return this.seekNative(clock, utcSeconds - clock.origin);
  }
  async seekNative(clock, target) {
    const player = this.player;
    const { video, origin } = clock;
    if (!mediaRangeAt(video.seekable, target)) return false;
    if (!video.seeking && Math.abs(video.currentTime - target) < 0.05) return true;
    // The SDK may expose only the first retained native range. Seek on the
    // same source-bound video and timeline used to validate this target.
    return new Promise((resolve) => {
      const finish = (ok) => {
        clearTimeout(timer);
        video.removeEventListener('seeked', check);
        resolve(ok);
      };
      const check = () => {
        const current = this.player === player && this.ready && this.nativeFinalizedClock();
        finish(
          current?.video === video &&
            current.origin === origin &&
            !!mediaRangeAt(video.seekable, target) &&
            Math.abs(video.currentTime - target) <= 1
        );
      };
      const timer = setTimeout(() => finish(false), 5000);
      video.addEventListener('seeked', check);
      try {
        video.currentTime = target;
      } catch {
        finish(false);
      }
    });
  }
}
