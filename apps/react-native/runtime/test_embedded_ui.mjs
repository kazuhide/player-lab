import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { embeddedUiSnapshot } from './embedded-ui.mjs';

function observe(parentStyle = {}, nodeStyle = {}) {
  const parent = { style: { opacity: '1', visibility: 'visible', display: 'block', ...parentStyle }, parentElement: null };
  const node = { id: 'sdk-pause', className: 'bmpui-ui-playbacktogglebutton', parentElement: parent,
    style: { opacity: '1', visibility: 'visible', display: 'flex', ...nodeStyle },
    getAttribute: key => ({ 'aria-label': 'Pause', role: 'button' })[key],
    getBoundingClientRect: () => ({ x: 58.8, y: 175.2, width: 36, height: 36 }), contains: target => target === node };
  return vm.runInNewContext(`(${embeddedUiSnapshot.toString()})()`, { innerWidth: 411, innerHeight: 220,
    getComputedStyle: target => target.style, document: { querySelectorAll: () => [node], elementFromPoint: () => node } }).controls[0];
}

test('an AX-sized button under the actual opacity-zero control bar is not visible or hittable', () => {
  const value = observe({ opacity: '0' });
  assert.equal(value.visible, false); assert.equal(value.hittable, false);
});
test('a normal visible SDK control remains eligible for a native touch', () => {
  const value = observe(); assert.equal(value.visible, true); assert.equal(value.hittable, true);
});
test('hidden ancestors and disabled display cannot pass visibility', () => {
  for (const style of [{ visibility: 'hidden' }, { display: 'none' }]) assert.equal(observe(style).visible, false);
  assert.equal(observe({}, { display: 'none' }).visible, false);
});
