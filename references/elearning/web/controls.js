import { t } from './i18n.js';
import { clock } from './media.js';
export const el = (id) => document.getElementById(id);
export const message = (text) => {
  el('message').textContent = t(text);
};
export function mountControls(session, preferences, move, seekBar, range) {
  const select = el('captions');
  function mode() {
    const custom = el('mode').value === 'custom';
    el('custom').hidden = !custom;
    el('player').dataset.custom = String(custom);
  }
  el('mode').onchange = mode;
  function enable(enabled) {
    el('controls').disabled = !enabled;
    el('player').inert = !enabled;
  }
  function paint() {
    const p = session.player;
    if (!session.ready || !p) return;
    el('play').textContent = p.isPlaying() ? t('Pause') : t('Play');
    el('pip').hidden = !p.isViewModeAvailable('pictureinpicture');
    el('airplay').hidden = !p.isAirplayAvailable();
    const bounds = range(p);
    el('seek').disabled = !bounds || !(bounds.end > bounds.start);
    if (!el('seek').disabled) {
      el('seek').min = bounds.start;
      el('seek').max = bounds.end;
      el('seek').value = bounds.current;
    }
    el('clock').textContent = p.isLive()
      ? t('Live') + ' · ' + clock(Math.abs(p.getTimeShift())) + ' ' + t('behind')
      : clock(p.getCurrentTime('relativetime')) + ' / ' + clock(p.getDuration());
  }
  function captions() {
    const tracks = session.player?.subtitles.list() ?? [];
    const langs = new Map(tracks.map((t) => [t.lang, t.label || t.lang]));
    select.replaceChildren(
      new Option(t('Off'), 'off'),
      ...[...langs].map(([lang, label]) => new Option(t(label), lang))
    );
    select.value = tracks.find((t) => t.enabled)?.lang ?? 'off';
  }
  function reflectSpeed() {
    const rate = session.player.getPlaybackSpeed();
    if (Number.isFinite(rate) && rate > 0) {
      preferences.speed = rate;
      if (![...el('speed').options].some((option) => Number(option.value) === rate))
        el('speed').add(new Option(String(rate), String(rate)));
      el('speed').value = String(rate);
    }
  }
  el('fullscreen').hidden = !document.fullscreenEnabled;
  el('fullscreen').onclick = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el('stage').requestFullscreen();
  };
  el('pip').onclick = () => {
    const player = session.player;
    if (player)
      player.setViewMode(player.getViewMode() === 'pictureinpicture' ? 'inline' : 'pictureinpicture');
  };
  el('airplay').onclick = () => session.player?.showAirplayTargetPicker();
  el('play').onclick = () =>
    session.player?.isPlaying() ? session.player.pause('reference') : session.play();
  el('back').onclick = () => move(-10);
  el('forward').onclick = () => move(10);
  el('seek').onchange = () => seekBar(Number(el('seek').value));
  el('speed').onchange = () => {
    preferences.speed = Number(el('speed').value);
    session.player?.setPlaybackSpeed(preferences.speed);
  };
  select.onchange = () => {
    preferences.caption = select.value;
    session.setCaption(preferences.caption);
  };
  function restore() {
    session.player.setPlaybackSpeed(preferences.speed);
    session.setCaption(preferences.caption);
    reflectSpeed();
    captions();
    paint();
  }
  mode();
  return { mode, enable, paint, captions, restore, reflectSpeed };
}
