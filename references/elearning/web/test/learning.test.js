import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCourses, readRecord, resumeKey, searchCues } from '../learning.js';
import { mediaUrl } from '../media.js';
const fixture = (file) => JSON.parse(readFileSync(new URL('../../fixtures/' + file, import.meta.url)));
test('course follows published order and refuses dangling IDs', () => {
  const catalog = fixture('catalog.json');
  assert.deepEqual(
    parseCourses(catalog)[0].lessons.map((x) => x.id),
    catalog.courses[0].lessonIds
  );
  catalog.lessons.pop();
  assert.throws(() => parseCourses(catalog));
});
test('resume belongs to one demo learner and lesson', () => {
  const key = resumeKey('a', 'one');
  const storage = { getItem: (k) => (k === key ? '{"seconds":12,"speed":1.5,"caption":"off"}' : null) };
  assert.equal(readRecord(storage, 'a', 'one').seconds, 12);
  assert.equal(readRecord(storage, 'b', 'one'), null);
  assert.equal(readRecord(storage, 'a', 'two'), null);
  assert.equal(readRecord({ getItem: () => '{broken' }, 'a', 'one'), null);
});
test('transcript search normalizes query and preserves the original cue time', () => {
  const results = searchCues(fixture('transcripts/EDU-FX-01.json').cues, 'en', 'ＲＥＡＤ');
  assert.equal(results[0].startMs, 10000);
  assert.equal(searchCues(results, 'ja', '').length, 0);
});
test('media URLs stay under publisher base', () => {
  assert.equal(mediaUrl('a/hls', 'https://example.com/media'), 'https://example.com/media/a/hls');
  for (const path of ['https://other.test/stream', '../else', '. %2e', '//bad.test', '/outside'])
    assert.throws(() => mediaUrl(path, 'https://example.com/media/'));
});

test('each course has its own ordered lessons, even with overlap', () => {
  const catalog = fixture('catalog.json');
  catalog.courses.push({ id: 'practice', title: 'Practice', lessonIds: ['EDU-FX-03', 'EDU-FX-01'] });
  const courses = parseCourses(catalog);
  assert.deepEqual(
    courses.map((c) => c.lessons.map((l) => l.id)),
    [catalog.courses[0].lessonIds, catalog.courses[1].lessonIds]
  );
  catalog.courses[1].lessonIds.push('missing');
  assert.throws(() => parseCourses(catalog));
});
