import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archivePosition, sourceUtc, validateCatalog, validateStatus } from '../sports.js';
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
