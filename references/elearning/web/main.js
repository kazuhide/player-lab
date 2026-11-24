import { t, titleOf, locale } from './i18n.js';
import './style.css';
import { button, clock, jsonAt } from './media.js';
import { Session } from './session.js';
import { el, message, mountControls } from './controls.js';
import { CheckpointWriter } from './checkpoints.js';
import { parseCourses, parseRecord, resumeKey, searchCues } from './learning.js';

const base = import.meta.env.VITE_MEDIA_BASE_URL || 'http://127.0.0.1:8621/';
const preferences = { speed: 1, caption: 'en' };
const courseByLearner = new Map();
const session = new Session(el('player'), base, onEvent);
const controls = mountControls(
  session,
  preferences,
  (delta) => seek(session.player.getCurrentTime() + delta),
  seek,
  (p) => ({ ...p.getSeekableRange(), current: p.getCurrentTime() })
);
let courses = [],
  lessons = [],
  lesson = null,
  learner = 'a',
  record = null,
  cues = [];
let startOrigin = 'catalog',
  followedCue = null;
let generation = 0,
  catalogRequest = 0,
  watching = false,
  lastSave = 0,
  advance = false,
  checkpoint = 0,
  finished = false,
  autoplayGeneration = 0,
  writer = null;
function seek(value) {
  if (!watching) return;
  const range = session.player.getSeekableRange();
  if (range.end > range.start)
    session.player.seek(Math.max(range.start, Math.min(value, range.end - 0.05)), 'reference-user');
}
function bookmark(seconds) {
  return { seconds, ...preferences, mode: el('mode').value, autoAdvance: advance };
}
function unavailable(owner) {
  if (owner === writer) {
    el('storageStatus').textContent = t('This browser could not save the resume position.');
    el('storageStatus').hidden = false;
  }
}
function store(operation, owner = writer) {
  void operation.then(
    () => {
      if (owner === writer) el('storageStatus').hidden = true;
    },
    () => unavailable(owner)
  );
}
function save(claim = false) {
  if (!writer || !watching || (finished && !claim) || !session.ready) return;
  const seconds = finished && claim ? 0 : session.player.getCurrentTime();
  if (!Number.isFinite(seconds) || seconds < 0) return;
  checkpoint = seconds;
  store(writer.write(bookmark(seconds), claim));
  lastSave = Date.now();
}
function endSelection() {
  save();
  writer = null;
  el('storageStatus').hidden = true;
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
  const list = el('results');
  let firstActive = null;
  for (const cue of list.children) {
    const active = ms >= Number(cue.dataset.start) && ms < Number(cue.dataset.end);
    cue.setAttribute('aria-current', String(active));
    if (!firstActive && active) firstActive = cue;
  }
  if (firstActive && firstActive !== followedCue && el('follow').checked && !el('query').value.trim()) {
    const top = firstActive.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTop += top;
  }
  followedCue = firstActive;
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
async function choose(item, origin = 'catalog', userAction = true) {
  endSelection();
  setSelection(item);
  const selected = (writer = new CheckpointWriter(resumeKey(learner, item.id)));
  if (origin === 'catalog') {
    let previous = null;
    try {
      previous = await selected.select(bookmark(0));
    } catch {
      unavailable(selected);
      try {
        previous = parseRecord(localStorage.getItem(selected.key));
      } catch {
        /* Storage can be disabled entirely. */
      }
    }
    if (selected !== writer) return;
    record = previous;
    if (record && record.seconds > 0) {
      el('choices').hidden = false;
      el('resume').hidden = false;
      el('resume').textContent = t('Resume at') + ' ' + clock(record.seconds);
      message('Continue this lesson or start over.');
      return;
    }
  }
  void open(0, origin, origin === 'catalog' ? undefined : userAction ? 'claim' : 'empty');
}
async function open(seconds, origin, ownership) {
  const token = ++generation;
  const autoplay = document.hidden ? null : autoplayGeneration;
  startOrigin = origin;
  advance = el('auto').checked;
  if (ownership === 'claim') store(writer.write(bookmark(seconds), true));
  if (ownership === 'empty') store(writer.startIfEmpty(bookmark(seconds)));
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
    if (autoplay === autoplayGeneration && !document.hidden) await session.play();
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
  if (type === 'Warning' && event.code === 1402) {
    save();
    el('retry').hidden = false;
    message('Captions could not be loaded. Retry playback or return to the course.');
    return;
  }
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

  if (type === 'Seeked') updateActiveCue();
  if (type === 'Paused' || type === 'Seeked') save();
  if (type === 'Play' || type === 'Seek') {
    if (!document.hidden && ['reference-user', 'ui'].includes(event.issuer)) save(true);
  }
  if (type === 'Playing') {
    finished = false;
    if (document.hidden && session.player.getViewMode() !== 'pictureinpicture')
      session.player.pause('reference');
  }
  if (type === 'PlaybackFinished') {
    finished = true;
    if (writer) store(writer.write(null));
    if (advance && lessons.indexOf(lesson) < lessons.length - 1) adjacent(1, false);
    else message('Lesson finished.');
  }
}
function adjacent(delta, userAction = true) {
  const item = lessons[lessons.indexOf(lesson) + delta];
  if (lesson && item) choose(item, 'playlist', userAction);
}
function selectCourse(course) {
  endSelection();
  courseByLearner.set(learner, course.id);
  lessons = course.lessons;
  el('courseSelect').value = course.id;
  document.querySelector('h1').textContent = titleOf(course);
  el('lessons').replaceChildren(
    ...lessons.map((item, i) => {
      const b = button(i + 1 + '. ' + titleOf(item), () => choose(item));
      b.dataset.id = item.id;
      return b;
    })
  );
  message('');
}
el('courseSelect').onchange = () => {
  const course = courses.find((c) => c.id === el('courseSelect').value);
  if (course) selectCourse(course);
};
async function loadCourse() {
  const token = ++catalogRequest;
  endSelection();
  lessons = [];
  courses = [];
  el('courseSelect').replaceChildren();
  el('coursePicker').hidden = true;
  el('lessons').replaceChildren();
  message('Loading course…');
  try {
    const catalog = await jsonAt('catalog.json', base);
    if (token !== catalogRequest) return;
    courses = parseCourses(catalog);
    el('courseSelect').replaceChildren(...courses.map((c) => new Option(titleOf(c), c.id)));
    el('coursePicker').hidden = courses.length < 2;
    selectCourse(courses.find((c) => c.id === courseByLearner.get(learner)) ?? courses[0]);
  } catch {
    if (token === catalogRequest)
      message('Course unavailable. Start the media publisher and reload the course.');
  }
}
el('resume').onclick = () => {
  el('mode').value = record.mode === 'custom' ? 'custom' : 'standard';
  controls.mode();
  Object.assign(preferences, { speed: record.speed, caption: record.caption });
  void open(record.seconds, 'catalog', 'claim');
};
el('restart').onclick = () => {
  void open(0, 'catalog', 'claim');
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
el('mode').addEventListener('change', () => save(true));
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
  el('follow').checked = true;
  el('query').value = '';
  el('log')?.replaceChildren();
  const course = courses.find((c) => c.id === courseByLearner.get(learner)) ?? courses[0];
  if (course) selectCourse(course);
  else message('');
};
el('language').onchange = el('query').oninput = renderTranscript;
el('follow').onchange = () => {
  followedCue = null;
  if (watching) updateActiveCue();
};
const stopFollowing = () => {
  el('follow').checked = false;
};
el('results').addEventListener('pointerdown', stopFollowing);
el('results').addEventListener('wheel', stopFollowing, { passive: true });
el('results').addEventListener('keydown', (event) => {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Tab'].includes(event.key))
    stopFollowing();
});
function suspend() {
  if (session.player?.getViewMode() === 'pictureinpicture') return;
  ++autoplayGeneration;
  save();
  if (watching) session.player.pause('reference');
}
window.addEventListener('pagehide', suspend);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspend();
});
el('language').value = locale;
void loadCourse();
