export function courseLessons(catalog) {
  const course = catalog.courses?.[0];
  if (catalog.schemaVersion !== 1 || !course?.lessonIds?.length) throw Error('Invalid course');
  const lessons = course.lessonIds.map((id) => catalog.lessons.find((item) => item.id === id));
  if (
    lessons.some(
      (item) => !item?.videoId || !item.title || !item.streams || !Array.isArray(item.subtitleTracks)
    ) ||
    new Set(lessons).size !== lessons.length
  )
    throw Error('Invalid lessons');
  return lessons;
}
export function resumeKey(learner, lesson) {
  return 'reference.elearning.resume.' + encodeURIComponent(learner) + '/' + encodeURIComponent(lesson);
}
export function readRecord(storage, learner, lesson) {
  try {
    const value = JSON.parse(storage.getItem(resumeKey(learner, lesson)));
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
