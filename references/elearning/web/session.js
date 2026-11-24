import { locale, titleOf } from './i18n.js';
import { UI_JA } from './ui-ja.js';
import { Player, PlayerEvent } from 'bitmovin-player';
import { UIFactory } from 'bitmovin-player-ui';
import 'bitmovin-player-ui/dist/css/bitmovinplayer-ui.css';
import { mediaUrl } from './media.js';

// A source change retires the old SDK owner. A controls-only change uses CSS and
// keeps the same player, source, caption renderer and Analytics impression.
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
    const player = (this.player = new Player(mount, {
      key,
      ui: false,
      analytics: analyticsKey
        ? { key: analyticsKey, ...analytics, videoId: asset.videoId, title: asset.title }
        : false,
      playback: { autoplay: false }
    }));
    const log = document.getElementById('log');
    const record = (type, code) => {
      if (!log) return;
      const item = document.createElement('li');
      item.textContent = asset.id + ' · ' + type + (Number.isInteger(code) ? ' (' + code + ')' : '');
      log.append(item);
      while (log.children.length > 30) log.firstChild.remove();
    };
    record('Load');
    this.ui = UIFactory.buildUI(player, {
      localization: {
        language: locale,
        vocabularies: { ja: UI_JA },
        adaptLocalizationToSubtitleLanguage: false
      }
    });
    for (const type of [
      'Play',
      'Playing',
      'Paused',
      'TimeChanged',
      'PlaybackFinished',
      'Seeked',
      'TimeShifted',
      'SubtitleAdded',
      'SubtitleEnabled',
      'SubtitleDisabled',
      'PlaybackSpeedChanged',
      'Warning',
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
    const source = { title: titleOf(asset), [format]: mediaUrl(path, this.base) };
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
  setCaption(language) {
    const player = this.player;
    if (!this.ready || !player) return;
    for (const track of player.subtitles.list()) {
      if (track.lang === language && !track.enabled) player.subtitles.enable(track.id, true);
      else if (track.lang !== language && track.enabled) player.subtitles.disable(track.id);
    }
  }
  async play(issuer = 'reference') {
    if (!this.ready) return;
    try {
      await this.player.play(issuer);
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
}
