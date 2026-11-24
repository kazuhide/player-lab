import { t, titleOf, locale } from './i18n.js';
import './style.css';
import { button, clock, jsonAt } from './media.js';
import { Session } from './session.js';
import { el, message, mountControls } from './controls.js';
import { courseLessons, readRecord, resumeKey, searchCues } from './learning.js';

const base = import.meta.env.VITE_MEDIA_BASE_URL || 'http://127.0.0.1:8621/';
const preferences = { speed: 1, caption: 'en' };
const session = new Session(el('player'), base, onEvent);
const controls = mountControls(
  session,
  preferences,
  (delta) => seek(session.player.getCurrentTime() + delta),
  seek,
  (p) => ({ ...p.getSeekableRange(), current: p.getCurrentTime() })
);
let lessons = [],
  lesson = null,
  learner = 'a',
  record = null,
  cues = [];
let startOrigin = 'catalog';
let generation = 0,
  catalogRequest = 0,
  watching = false,
  lastSave = 0,
  advance = false,
  checkpoint = 0,
  finished = false;
function seek(value) {
  if (!watching) return;
  const range = session.player.getSeekableRange();
  if (range.end > range.start)
    session.player.seek(Math.max(range.start, Math.min(value, range.end - 0.05)), 'reference');
}
function save() {
  if (!watching || finished || !session.ready) return;
  const seconds = session.player.getCurrentTime();
  if (!Number.isFinite(seconds) || seconds < 0) return;
  checkpoint = seconds;
  try {
    localStorage.setItem(
      resumeKey(learner, lesson.id),
      JSON.stringify({ seconds, ...preferences, mode: el('mode').value, autoAdvance: advance })
    );
  } catch {
    message('This browser could not save the resume position.');
  }
  lastSave = Date.now();
}
function endSelection() {
  save();
  ++generation;
  watching = false;
  finished = false;
  checkpoint = 0;
  controls.enable(false);
  void session.close();
  lesson = null;
  record = null;
  cues = [];
  el('results').replaceChildren();
  el('transcriptStatus').textContent = '';
  el('choices').hidden = el('retry').hidden = true;
  el('prev').disabled = el('next').disabled = true;
  el('course').hidden = true;
  el('title').textContent = t('Select a lesson');
  el('auto').disabled = el('format').disabled = false;
  el('delivery').disabled = el('format').value !== 'hls';
  for (const item of el('lessons').children) item.removeAttribute('aria-current');
}
function renderTranscript() {
  const visible = searchCues(cues, el('language').value, el('query').value);
  el('results').replaceChildren(
    ...visible.map((cue) => {
      const item = button(clock(cue.startMs / 1000) + ' · ' + cue.text, () => seek(cue.startMs / 1000));
      item.disabled = !watching;
      item.dataset.start = cue.startMs;
      item.dataset.end = cue.endMs;
      return item;
    })
  );
  if (watching) updateActiveCue();
}
function updateActiveCue() {
  const ms = session.player.getCurrentTime() * 1000;
  for (const cue of el('results').children)
    cue.setAttribute(
      'aria-current',
      String(ms >= Number(cue.dataset.start) && ms < Number(cue.dataset.end))
    );
}
async function transcript(token) {
  try {
    const data = await jsonAt(lesson.transcriptUrl, base);
    if (token !== generation) return;
    if (!Array.isArray(data.cues) || data.cues.length > 10000) throw Error();
    cues = data.cues;
    el('transcriptStatus').textContent = cues.length ? '' : t('No transcript cues.');
    renderTranscript();
  } catch {
    if (token === generation) el('transcriptStatus').textContent = t('Transcript unavailable.');
  }
}
function setSelection(item) {
  lesson = item;
  el('title').textContent = titleOf(item);
  el('course').hidden = false;
  for (const b of el('lessons').children) b.setAttribute('aria-current', String(b.dataset.id === item.id));
}
function choose(item, origin = 'catalog') {
  endSelection();
  setSelection(item);
  advance = el('auto').checked;
  if (origin === 'catalog') {
    try {
      record = readRecord(localStorage, learner, item.id);
    } catch {
      record = null;
    }
    if (record && record.seconds > 0) {
      el('choices').hidden = false;
      el('resume').hidden = false;
      el('resume').textContent = t('Resume at') + ' ' + clock(record.seconds);
      message('Continue this lesson or start over.');
      return;
    }
  }
  void open(0, origin);
}
async function open(seconds, origin) {
  const token = ++generation;
  startOrigin = origin;
  watching = false;
  checkpoint = seconds;
  controls.enable(false);
  el('choices').hidden = el('retry').hidden = true;
  el('auto').disabled = el('format').disabled = el('delivery').disabled = true;
  message('Loading lesson…');
  try {
    const opened = await session.open(
      lesson,
      el('format').value,
      { customUserId: 'demo-learner-' + learner, customData1: origin },
      el('format').value === 'hls' && el('delivery').value === 'embedded'
    );
    if (!opened || token !== generation) return;
    controls.restore();
    if (seconds > 0) {
      const duration = session.player.getDuration();
      if (!(Number.isFinite(duration) && seconds < duration)) {
        message('The saved position is outside this lesson. Start over or return to the course.');
        el('choices').hidden = false;
        el('resume').hidden = true;
        return;
      }
      const positioned = await session.seekTo(seconds);
      if (token !== generation) return;
      if (!positioned) throw Error();
    }
    if (!session.ready) throw Error();
    watching = true;
    controls.enable(true);
    const index = lessons.indexOf(lesson);
    el('prev').disabled = index <= 0;
    el('next').disabled = index >= lessons.length - 1;
    message('');
    void transcript(token);
    await session.play();
  } catch {
    if (token !== generation) return;
    controls.enable(false);
    el('retry').hidden = false;
    message(
      import.meta.env.VITE_PUBLIC_PLAYER_LICENSE_KEY
        ? 'Playback unavailable. Check the media publisher and Player license, then retry.'
        : 'Set VITE_PUBLIC_PLAYER_LICENSE_KEY in .env.local and restart the app.'
    );
  }
}
function onEvent(type, event) {
  if (type === 'Error') {
    watching = false;
    controls.enable(false);
    el('retry').hidden = false;
    message(t('Playback error') + (Number.isInteger(event.code) ? ' (' + event.code + ')' : '') + '.');
    return;
  }
  if (!session.ready) return;
  if (type === 'SubtitleAdded') session.setCaption(preferences.caption);
  if (type.startsWith('Subtitle')) {
    controls.captions();
    if (watching && type !== 'SubtitleAdded') preferences.caption = el('captions').value;
  }
  if (type === 'PlaybackSpeedChanged') controls.reflectSpeed();
  if (!watching) return;
  controls.paint();
  if (type === 'TimeChanged') {
    updateActiveCue();
    if (Date.now() - lastSave >= 5000) save();
  }
  if (type === 'Paused' || type === 'Seeked') save();
  if (type === 'Playing') finished = false;
  if (type === 'PlaybackFinished') {
    finished = true;
    try {
      localStorage.removeItem(resumeKey(learner, lesson.id));
    } catch {
      /* Storage unavailable. */
    }
    if (advance && lessons.indexOf(lesson) < lessons.length - 1) adjacent(1);
    else message('Lesson finished.');
  }
}
function adjacent(delta) {
  const item = lessons[lessons.indexOf(lesson) + delta];
  if (lesson && item) choose(item, 'playlist');
}
async function loadCourse() {
  const token = ++catalogRequest;
  endSelection();
  lessons = [];
  el('lessons').replaceChildren();
  message('Loading course…');
  try {
    const catalog = await jsonAt('catalog.json', base);
    if (token !== catalogRequest) return;
    lessons = courseLessons(catalog);
    el('lessons').replaceChildren(
      ...lessons.map((item, i) => {
        const b = button(i + 1 + '. ' + titleOf(item), () => choose(item));
        b.dataset.id = item.id;
        return b;
      })
    );
    message('');
  } catch {
    if (token === catalogRequest)
      message('Course unavailable. Start the media publisher and reload the course.');
  }
}
el('resume').onclick = () => {
  el('mode').value = record.mode === 'custom' ? 'custom' : 'standard';
  controls.mode();
  Object.assign(preferences, { speed: record.speed, caption: record.caption });
  void open(record.seconds, 'catalog');
};
el('restart').onclick = () => {
  void open(0, 'catalog');
};
el('cancel').onclick = () => {
  endSelection();
  message('');
};
el('prev').onclick = () => adjacent(-1);
el('next').onclick = () => adjacent(1);
el('retry').onclick = () => {
  void open(checkpoint, startOrigin);
};
el('course').onclick = el('cancel').onclick;
el('mode').addEventListener('change', save);
el('reload').onclick = loadCourse;
el('format').onchange = () => {
  el('delivery').disabled = el('format').value !== 'hls';
};
el('learner').onchange = () => {
  endSelection();
  learner = el('learner').value;
  preferences.speed = 1;
  preferences.caption = 'en';
  el('mode').value = 'standard';
  controls.mode();
  el('auto').checked = false;
  el('query').value = '';
  el('log')?.replaceChildren();
  message('');
};
el('language').onchange = el('query').oninput = renderTranscript;
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && watching) {
    save();
    session.player.pause('reference');
  }
});
el('language').value = locale;
void loadCourse();
