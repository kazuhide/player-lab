import test from 'node:test';
import assert from 'node:assert/strict';
import { HandoffLedger } from '../handoffs.js';
test('paused archive observation needs matching source, position and state', () => {
  const ledger = new HandoffLedger();
  const ticket = ledger.begin('event', 'sports:archive', 5000, false, 100);
  for (const [video, pos, playing, paused] of [
    [null, 5000, false, true],
    ['sports:archive', null, false, true],
    ['sports:archive', 5000, true, false],
    ['wrong', 5000, false, true],
    ['sports:archive', 2000, false, true]
  ]) {
    assert.equal(ledger.observe(ticket, video, pos, playing, paused), false);
  }
  assert.equal(ledger.observe(ticket, 'sports:archive', 5020, false, true), true);
  const { records, source } = ledger.snapshot(200);
  assert.equal(source, 'local-device-records');
  assert.deepEqual(records[0].confirmed, {
    videoId: 'sports:archive',
    positionMs: 5020,
    playWhenReady: false,
    positionAdvanced: false
  });
  assert.equal(records[0].receiverQoe, null);
});
test('playing confirmation needs a second advancing observation from same source', () => {
  const ledger = new HandoffLedger();
  const ticket = ledger.begin('event', 'archive', 22000, true);
  assert.equal(ledger.observe(ticket, 'archive', 22000, true, false), false);
  assert.equal(ledger.observe(ticket, 'wrong', 22100, true, false), false);
  assert.equal(ledger.observe(ticket, 'archive', 22000, true, false), false);
  assert.equal(ledger.observe(ticket, 'archive', 22450, true, false), true);
  assert.equal(ticket.row.confirmed.positionAdvanced, true);
});
test('bounded local export preserves unknown and failed receipts', () => {
  const ledger = new HandoffLedger();
  assert.equal(ledger.begin('e', 'archive', null, true), null);
  for (let i = 0; i < 205; i++) ledger.begin('e', 'a', i, false, i);
  const t = ledger.begin('e', 'a', 100, true, 300);
  ledger.fail(t, 'load-failed');
  assert.equal(ledger.observe(t, 'a', 100, true, false), false);
  const data = ledger.snapshot(450);
  assert.equal(data.records.length, 200);
  assert.equal(data.records.at(-1).confirmed, null);
  assert.equal(data.records.at(-1).failure, 'load-failed');
  assert.ok(data.records.every((r) => r.receiverQoe === null));
});
