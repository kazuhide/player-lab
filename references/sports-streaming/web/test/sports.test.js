import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  archivePosition,
  finalizedPosition,
  newerStatus,
  canReturnToUtc,
  sourceUtc,
  liveReturnOffset,
  validateCatalog,
  validateStatus
} from '../sports.js';
import { mediaUrl } from '../media.js';
const utc = 1793224537000;
const fixture = JSON.parse(readFileSync(new URL('../../fixtures/catalog.json', import.meta.url)));
test('catalog and event ownership', () => {
  assert.equal(validateCatalog(fixture), fixture);
  const e = fixture.events[0],
    update = { ...e, eventId: e.id };
  assert.equal(validateStatus(update, e), update);
  assert.throws(() => validateStatus({ ...update, archiveAssetId: 'another' }, e));
});
test('continuous archive bounds include zero and distinguish EOF', () => {
  const m = { durationMs: 4000, utcStartMs: utc };
  assert.equal(archivePosition(m, utc).seconds, 0);
  assert.equal(archivePosition(m, utc + 1250).seconds, 1.25);
  assert.equal(archivePosition(m, utc + 4000).reason, 'At archive end');
  assert.equal(archivePosition(m, null).reason, 'UTC mapping unavailable');
});
test('edited interval gaps and unknown clocks have no implicit fallback', () => {
  const m = {
    durationMs: 2000,
    utcMappings: [
      { utcStartMs: utc + 1000, utcEndMs: utc + 2000, archiveStartMs: 0 },
      { utcStartMs: utc + 5000, utcEndMs: utc + 6000, archiveStartMs: 1000 }
    ]
  };
  assert.equal(archivePosition(m, utc + 5200).seconds, 1.2);
  assert.equal(archivePosition(m, utc + 2000).reason, 'Position outside the retained archive');
  m.utcMappings[1].archiveStartMs = 0;
  assert.equal(archivePosition(m, utc + 1100).reason, 'Invalid archive mapping');
});
test('source UTC requires source-bound absolute time and a verified origin', () => {
  const a = { kind: 'live', utcStartMs: utc, expectedDurationMs: 7000 };
  assert.equal(sourceUtc(a, 2), null);
  assert.equal(sourceUtc(a, (utc + 8000) / 1000), null);
  assert.equal(sourceUtc({ ...a, utcStartMs: null }, utc / 1000), null);
  assert.equal(sourceUtc(a, (utc + 2000) / 1000), utc + 2000);
});
test('media URL stays within publisher base', () => {
  assert.throws(() => mediaUrl('//unexpected.invalid/x', 'https://media.example/'));
  assert.equal(mediaUrl('a/live', 'http://127.0.0.1:8622/'), 'http://127.0.0.1:8622/a/live');
});

test('saved DVR requests use the fresh SDK edge and cannot seek outside the moving window', () => {
  assert.equal(liveReturnOffset(105, 110, -3, -20), -8);
  assert.equal(liveReturnOffset(92, 110, -3, -20), null);
  assert.equal(liveReturnOffset(114, 110, -3, -20), null);
});

test('offer saved DVR return only within the published half-open live window', () => {
  const status = { status: 'live', seekableUtcStartMs: 200, seekableUtcEndMs: 300 };
  assert.equal(canReturnToUtc(status, 200), true);
  for (const utc of [null, 199, 300]) assert.equal(canReturnToUtc(status, utc), false);
  assert.equal(canReturnToUtc({ ...status, status: 'ended' }, 201), false);
  assert.equal(canReturnToUtc({ ...status, seekableUtcStartMs: null }, 201), false);
});

test('finalized positions use the actual retained segments and reject gaps, EOF and unknown anchors', () => {
  const segments = {
    'video/mp4': {
      0: [
        { url: 'first', startTime: 0, duration: 2 },
        { url: 'third', startTime: 4, duration: 2 }
      ]
    }
  };
  const anchor = { url: 'first', utcSeconds: 1700000000, playbackTime: 120 };
  assert.equal(finalizedPosition(segments, anchor, 1700000004.5), 124.5);
  for (const t of [1699999999, 1700000002, 1700000006])
    assert.equal(finalizedPosition(segments, anchor, t), null);
  assert.equal(finalizedPosition(segments, { ...anchor, url: 'foreign' }, 1700000001), null);
  assert.equal(finalizedPosition(null, anchor, 1700000001), null);
});

test('publisher observation times order overlapping status reads regardless of delivery or issuance', () => {
  const old = {
    status: 'live',
    mediaUtcNow: 5000,
    observedAt: '2026-10-01T00:00:01Z',
    seekableUtcStartMs: 1000
  };
  const fresh = { ...old, mediaUtcNow: 6000, observedAt: '2026-10-01T00:00:02Z', seekableUtcStartMs: 2000 };
  assert.equal(newerStatus(fresh, old), fresh);
  assert.equal(newerStatus(old, fresh), fresh);
  const tie = { ...old, seekableUtcStartMs: 3000 };
  assert.equal(newerStatus(tie, old), tie);
  assert.equal(newerStatus(old, tie), tie);
  const terminal = { ...old, status: 'ended' };
  assert.equal(newerStatus(terminal, old), terminal);
});
