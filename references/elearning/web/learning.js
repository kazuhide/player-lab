export function parseCourses(catalog) {
  if (
    catalog.schemaVersion !== 1 ||
    !Array.isArray(catalog.courses) ||
    !catalog.courses.length ||
    !Array.isArray(catalog.lessons)
  )
    throw Error('Invalid catalog');
  const byId = new Map();
  for (const item of catalog.lessons) {
    if (
      !item ||
      !/^EDU-FX-[0-9]{2}$/.test(item.id) ||
      item.id !== item.videoId ||
      byId.has(item.id) ||
      !item.title ||
      !item.streams ||
      !Array.isArray(item.subtitleTracks)
    )
      throw Error('Invalid lesson');
    byId.set(item.id, item);
  }
  const ids = new Set();
  return catalog.courses.map((course) => {
    if (
      !course?.id ||
      ids.has(course.id) ||
      !course.title ||
      !Array.isArray(course.lessonIds) ||
      !course.lessonIds.length ||
      new Set(course.lessonIds).size !== course.lessonIds.length
    )
      throw Error('Invalid course');
    ids.add(course.id);
    const lessons = course.lessonIds.map((id) => byId.get(id));
    if (lessons.includes(undefined)) throw Error('Unknown lesson');
    return { ...course, lessons };
  });
}
export function resumeKey(learner, lesson) {
  return 'reference.elearning.resume.' + encodeURIComponent(learner) + '/' + encodeURIComponent(lesson);
}
export function parseRecord(raw) {
  try {
    const value = JSON.parse(raw);
    if (
      Number.isFinite(value?.seconds) &&
      value.seconds >= 0 &&
      Number.isFinite(value.speed) &&
      value.speed >= 0.25 &&
      value.speed <= 2 &&
      typeof value.caption === 'string'
    )
      return value;
  } catch {
    /* Local storage can be unavailable in a private browsing session. */
  }
  return null;
}
export function searchCues(cues, language, query) {
  const normalized = (s) => s.normalize('NFKC').trim().toLocaleLowerCase();
  return cues.filter(
    (c) =>
      c.language === language &&
      Number.isSafeInteger(c.startMs) &&
      Number.isSafeInteger(c.endMs) &&
      c.startMs >= 0 &&
      c.endMs > c.startMs &&
      typeof c.text === 'string' &&
      normalized(c.text).includes(normalized(query))
  );
}
